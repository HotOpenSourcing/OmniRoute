"use client";

/**
 * Freebuff provider client UI.
 *
 * Renders three sections:
 *   1. Authentication — either start a PKCE flow (redirects the user to
 *      the Codebuff login URL) or paste a `credentials.json` previously
 *      exported by `freebuff login` on the user's machine.
 *   2. Quota — polls `/api/v1/providers/freebuff/quota` every 30s and
 *      renders sessions used, remaining, waiting-room position, and
 *      reset time.
 *   3. Streak — polls `/api/v1/providers/freebuff/streak` on demand and
 *      renders the gamification state.
 *
 * All network calls go through `fetchFreebuff()` which normalises errors
 * and surfaces the 501 "Chunk 4 pending" state cleanly so the dashboard
 * does not show a stack trace when the backend is not yet wired.
 *
 * Until Chunk 4 lands the API returns 501 for every call — the UI
 * handles that case with a single inline notice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// ---------------------------------------------------------------------------
// Types — mirror `src/lib/providers/freebuff/metaService.ts`.
// We re-declare them here rather than importing so the client bundle
// stays small (no zod dependency on the client).
// ---------------------------------------------------------------------------

interface FreebuffQuotaState {
  sessionsUsedToday: number;
  sessionsRemainingToday: number;
  waitingRoomPosition: number | null;
  resetAt: string | null;
  accessTier: "full" | "limited";
}

interface FreebuffStreak {
  currentStreak: number;
  longestStreak: number;
  lastCheckInAt: string | null;
  bonusCredits?: number;
}

interface FreebuffLoginStart {
  flowId: string;
  loginUrl: string;
  expiresAt: string;
}

interface FreebuffApiError {
  status: number;
  message: string;
  code?: string;
}

type QuotaState =
  | { kind: "loading" }
  | { kind: "ok"; quota: FreebuffQuotaState }
  | { kind: "error"; error: FreebuffApiError };

type StreakState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; streak: FreebuffStreak }
  | { kind: "error"; error: FreebuffApiError };

type LoginState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; flow: FreebuffLoginStart; startedAt: number }
  | { kind: "completed" }
  | { kind: "error"; error: FreebuffApiError };

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function fetchFreebuff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body?.error?.message ?? `Request failed with HTTP ${res.status}`;
    const code = body?.error?.code;
    const error: FreebuffApiError = { status: res.status, message, code };
    throw error;
  }
  return body as T;
}

function formatResetAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

const QUOTA_POLL_MS = 30_000;

export default function FreebuffProviderPageClient() {
  const t = useTranslations("freebuff");

  const [quota, setQuota] = useState<QuotaState>({ kind: "loading" });
  const [streak, setStreak] = useState<StreakState>({ kind: "idle" });
  const [login, setLogin] = useState<LoginState>({ kind: "idle" });
  const [pasteOpen, setPasteOpen] = useState(false);

  const quotaAbortRef = useRef<AbortController | null>(null);
  const loginAbortRef = useRef<AbortController | null>(null);

  // --- Quota polling -------------------------------------------------------

  const refreshQuota = useCallback(async () => {
    quotaAbortRef.current?.abort();
    const controller = new AbortController();
    quotaAbortRef.current = controller;
    try {
      const data = await fetchFreebuff<{ quota: FreebuffQuotaState }>(
        "/api/v1/providers/freebuff/quota",
        { signal: controller.signal, cache: "no-store" },
      );
      setQuota({ kind: "ok", quota: data.quota });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setQuota({ kind: "error", error: err as FreebuffApiError });
    }
  }, []);

  useEffect(() => {
    refreshQuota();
    const id = setInterval(refreshQuota, QUOTA_POLL_MS);
    return () => {
      clearInterval(id);
      quotaAbortRef.current?.abort();
    };
  }, [refreshQuota]);

  // --- Streak (on-demand) --------------------------------------------------

  const refreshStreak = useCallback(async () => {
    setStreak({ kind: "loading" });
    try {
      const data = await fetchFreebuff<{ streak: FreebuffStreak }>(
        "/api/v1/providers/freebuff/streak",
        { cache: "no-store" },
      );
      setStreak({ kind: "ok", streak: data.streak });
    } catch (err) {
      setStreak({ kind: "error", error: err as FreebuffApiError });
    }
  }, []);

  // --- Login flow ----------------------------------------------------------

  const startLogin = useCallback(async () => {
    setLogin({ kind: "starting" });
    loginAbortRef.current?.abort();
    const controller = new AbortController();
    loginAbortRef.current = controller;
    try {
      const data = await fetchFreebuff<{ login: FreebuffLoginStart }>(
        "/api/v1/providers/freebuff/login/start",
        { method: "POST", signal: controller.signal },
      );
      setLogin({
        kind: "waiting",
        flow: data.login,
        startedAt: Date.now(),
      });
      // Open the PKCE URL in a new tab so the user can complete the flow
      // without losing the dashboard context.
      window.open(data.login.loginUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setLogin({ kind: "error", error: err as FreebuffApiError });
    }
  }, []);

  // --- Logout (release session) -------------------------------------------

  const releaseSession = useCallback(async () => {
    try {
      await fetchFreebuff("/api/v1/providers/freebuff/session", {
        method: "DELETE",
      });
      setQuota({ kind: "loading" });
      refreshQuota();
    } catch (err) {
      // Surface as a quota error so the user sees the failure.
      setQuota({ kind: "error", error: err as FreebuffApiError });
    }
  }, [refreshQuota]);

  // --- Render --------------------------------------------------------------

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          {t("name", { defaultValue: "Freebuff" })}
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          {t("tagline", {
            defaultValue:
              "Route OmniRoute through the Codebuff Free Tier (Codebuff-backed models).",
          })}
        </p>
      </header>

      {/* Authentication card */}
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <h2 className="text-lg font-medium">
          {t("login.title", { defaultValue: "Authentication" })}
        </h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          {t("login.description", {
            defaultValue:
              "Sign in with Codebuff to bind your account, or paste a credentials.json previously exported by `freebuff login`.",
          })}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={startLogin}
            disabled={login.kind === "starting" || login.kind === "waiting"}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {login.kind === "starting"
              ? t("login.starting", { defaultValue: "Starting…" })
              : t("login.cta", { defaultValue: "Login with Codebuff" })}
          </button>

          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-200"
          >
            {t("login.pasteToggle", {
              defaultValue: "Paste credentials.json",
            })}
          </button>

          <button
            type="button"
            onClick={releaseSession}
            className="ml-auto rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300"
          >
            {t("login.release", { defaultValue: "Sign out" })}
          </button>
        </div>

        {login.kind === "waiting" && (
          <p className="mt-3 text-xs text-stone-500">
            {t("login.waiting", {
              defaultValue:
                "Waiting for browser confirmation. Poll started at ",
            })}
            {new Date(login.startedAt).toLocaleTimeString()}
          </p>
        )}

        {login.kind === "error" && (
          <ErrorBanner error={login.error} t={t} />
        )}

        {pasteOpen && <PasteCredentialsForm t={t} />}
      </section>

      {/* Quota card */}
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t("quota.title", { defaultValue: "Quota" })}
          </h2>
          <button
            type="button"
            onClick={refreshQuota}
            className="text-xs text-blue-600 hover:underline"
          >
            {t("quota.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>

        <div className="mt-4">
          {quota.kind === "loading" && (
            <p className="text-sm text-stone-500">
              {t("quota.loading", { defaultValue: "Loading…" })}
            </p>
          )}

          {quota.kind === "ok" && (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Stat
                label={t("quota.sessionsUsed", {
                  defaultValue: "Sessions used today",
                })}
                value={quota.quota.sessionsUsedToday}
              />
              <Stat
                label={t("quota.sessionsRemaining", {
                  defaultValue: "Sessions remaining",
                })}
                value={quota.quota.sessionsRemainingToday}
              />
              <Stat
                label={t("quota.tier", { defaultValue: "Access tier" })}
                value={quota.quota.accessTier}
              />
              <Stat
                label={t("quota.waitingRoom", {
                  defaultValue: "Waiting room position",
                })}
                value={
                  quota.quota.waitingRoomPosition === null
                    ? "—"
                    : `#${quota.quota.waitingRoomPosition}`
                }
              />
              <Stat
                label={t("quota.resetAt", { defaultValue: "Next reset" })}
                value={formatResetAt(quota.quota.resetAt)}
              />
            </dl>
          )}

          {quota.kind === "error" && <ErrorBanner error={quota.error} t={t} />}
        </div>
      </section>

      {/* Streak card */}
      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700 dark:bg-stone-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t("streak.title", { defaultValue: "Streak" })}
          </h2>
          <button
            type="button"
            onClick={refreshStreak}
            disabled={streak.kind === "loading"}
            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
          >
            {t("streak.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>

        <div className="mt-4">
          {streak.kind === "idle" && (
            <p className="text-sm text-stone-500">
              {t("streak.idle", {
                defaultValue: "Click refresh to fetch your streak.",
              })}
            </p>
          )}
          {streak.kind === "loading" && (
            <p className="text-sm text-stone-500">
              {t("streak.loading", { defaultValue: "Loading…" })}
            </p>
          )}
          {streak.kind === "ok" && (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Stat
                label={t("streak.current", { defaultValue: "Current" })}
                value={`${streak.streak.currentStreak} days`}
              />
              <Stat
                label={t("streak.longest", { defaultValue: "Longest" })}
                value={`${streak.streak.longestStreak} days`}
              />
              <Stat
                label={t("streak.lastCheckIn", {
                  defaultValue: "Last check-in",
                })}
                value={formatResetAt(streak.streak.lastCheckInAt)}
              />
              {streak.streak.bonusCredits !== undefined && (
                <Stat
                  label={t("streak.bonus", { defaultValue: "Bonus credits" })}
                  value={streak.streak.bonusCredits}
                />
              )}
            </dl>
          )}
          {streak.kind === "error" && <ErrorBanner error={streak.error} t={t} />}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components.
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-base text-stone-900 dark:text-stone-100">
        {value}
      </dd>
    </div>
  );
}

function ErrorBanner({
  error,
  t,
}: {
  error: FreebuffApiError;
  t: ReturnType<typeof useTranslations>;
}) {
  const isPending = error.status === 501;
  return (
    <div
      className={`mt-3 rounded-md border p-3 text-sm ${
        isPending
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-red-300 bg-red-50 text-red-900"
      }`}
    >
      <p className="font-medium">
        {isPending
          ? t("errors.notImplementedTitle", {
              defaultValue: "Provider backend not yet wired",
            })
          : t("errors.genericTitle", { defaultValue: "Error" })}
      </p>
      <p className="mt-1">{error.message}</p>
      {error.code && (
        <p className="mt-1 font-mono text-xs opacity-75">{error.code}</p>
      )}
    </div>
  );
}

function PasteCredentialsForm({
  t,
}: {
  t: ReturnType<typeof useTranslations>;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Chunk 4 will provide a POST /api/v1/providers/freebuff/credentials
      // endpoint that accepts the pasted JSON. Until then we simply
      // validate that the value is JSON and inform the user.
      JSON.parse(value);
      setSubmitted(true);
    } catch {
      setSubmitted(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3">
      <label className="block text-xs font-medium text-stone-700 dark:text-stone-300">
        {t("login.pasteLabel", {
          defaultValue: "credentials.json contents",
        })}
      </label>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSubmitted(false);
        }}
        rows={6}
        className="w-full rounded-md border border-stone-300 bg-stone-50 p-2 font-mono text-xs dark:border-stone-600 dark:bg-stone-800"
        placeholder='{"authToken":"…","fingerprintId":"enhanced-…"}'
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || value.length === 0}
          className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-stone-900 disabled:opacity-50"
        >
          {submitting
            ? t("login.pasteSubmitting", { defaultValue: "Submitting…" })
            : t("login.pasteSubmit", { defaultValue: "Submit" })}
        </button>
        {submitted && (
          <span className="text-xs text-green-700">
            {t("login.pasteOk", { defaultValue: "Accepted (storage pending)" })}
          </span>
        )}
      </div>
    </form>
  );
}
