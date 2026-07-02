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
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@/shared/components";
import { FREEBUFF_MODELS, type FreebuffModel } from "@/lib/providers/freebuff/models";

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
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/providers"
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            {t("back", { defaultValue: "Back to providers" })}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text-main">
              {t("name", { defaultValue: "Freebuff" })}
            </h1>
            <Badge variant="info" size="sm" dot>
              {t("badge", { defaultValue: "Codebuff Free Tier" })}
            </Badge>
          </div>
          <p className="text-sm text-text-muted">
            {t("tagline", {
              defaultValue:
                "Route OmniRoute through the Codebuff Free Tier (Codebuff-backed models).",
            })}
          </p>
        </div>
      </div>

      {/* Authentication card */}
      <Card
        title={t("login.title", { defaultValue: "Authentication" })}
        subtitle={t("login.description", {
          defaultValue:
            "Sign in with Codebuff to bind your account, or paste a credentials.json previously exported by `freebuff login`.",
        })}
        icon="key"
      >
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={startLogin}
            loading={login.kind === "starting"}
            disabled={login.kind === "waiting"}
            icon="login"
          >
            {login.kind === "starting"
              ? t("login.starting", { defaultValue: "Starting…" })
              : t("login.cta", { defaultValue: "Login with Codebuff" })}
          </Button>

          <Button
            variant="secondary"
            onClick={() => setPasteOpen((v) => !v)}
            icon="content_paste"
          >
            {t("login.pasteToggle", {
              defaultValue: "Paste credentials.json",
            })}
          </Button>

          <Button
            variant="outline"
            className="ml-auto"
            onClick={releaseSession}
            icon="logout"
          >
            {t("login.release", { defaultValue: "Sign out" })}
          </Button>
        </div>

        {login.kind === "waiting" && (
          <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
            <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            {t("login.waiting", {
              defaultValue: "Waiting for browser confirmation. Poll started at ",
            })}
            {new Date(login.startedAt).toLocaleTimeString()}
          </div>
        )}

        {login.kind === "error" && <ErrorBanner error={login.error} t={t} />}

        {pasteOpen && <PasteCredentialsForm t={t} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quota card */}
        <Card
          title={t("quota.title", { defaultValue: "Quota" })}
          subtitle={t("quota.subtitle", {
            defaultValue: "Live usage limits from your Codebuff account.",
          })}
          icon="speed"
          action={
            <Button variant="ghost" size="sm" onClick={refreshQuota} icon="refresh">
              {t("quota.refresh", { defaultValue: "Refresh" })}
            </Button>
          }
        >
          {quota.kind === "loading" && (
            <p className="text-sm text-text-muted">
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
        </Card>

          {/* Streak card */}
        <Card
          title={t("streak.title", { defaultValue: "Streak" })}
          subtitle={t("streak.subtitle", {
            defaultValue: "Daily check-in gamification state.",
          })}
          icon="local_fire_department"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshStreak}
              loading={streak.kind === "loading"}
              icon="refresh"
            >
              {t("streak.refresh", { defaultValue: "Refresh" })}
            </Button>
          }
        >
          {streak.kind === "idle" && (
            <p className="text-sm text-text-muted">
              {t("streak.idle", {
                defaultValue: "Click refresh to fetch your streak.",
              })}
            </p>
          )}
          {streak.kind === "loading" && (
            <p className="text-sm text-text-muted">
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
        </Card>
      </div>

      {/* Available models */}
      <Card
        title={t("models.title", { defaultValue: "Available models" })}
        subtitle={t("models.subtitle", {
          defaultValue: "Models exposed through the Codebuff Free Tier.",
        })}
        icon="model_training"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="pb-2 pr-4 font-medium">{t("models.model", { defaultValue: "Model" })}</th>
                <th className="pb-2 pr-4 font-medium">{t("models.tier", { defaultValue: "Tier" })}</th>
                <th className="pb-2 pr-4 font-medium">{t("models.context", { defaultValue: "Context" })}</th>
                <th className="pb-2 pr-4 font-medium">{t("models.modalities", { defaultValue: "Modalities" })}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FREEBUFF_MODELS.map((model) => (
                <tr key={model.id} className="text-text-main">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{model.displayName}</div>
                    <div className="text-xs text-text-muted font-mono">{model.id}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant={model.tier === "lite" ? "success" : model.tier === "pro" ? "error" : "info"}
                      size="sm"
                    >
                      {model.tier}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap">{model.contextWindow.toLocaleString()} tokens</td>
                  <td className="py-3 pr-4">{model.modalities.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components.
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-base text-text-main">
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
      className={`mt-3 rounded-lg border p-3 text-sm ${
        isPending
          ? "border-warning bg-warning/10 text-warning"
          : "border-error bg-error/10 text-error"
      }`}
    >
      <p className="font-medium">
        {isPending
          ? t("errors.notImplementedTitle", {
              defaultValue: "Provider backend not yet wired",
            })
          : t("errors.genericTitle", { defaultValue: "Error" })}
      </p>
      <p className="mt-1 opacity-90">{error.message}</p>
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
      <label className="block text-xs font-medium text-text-secondary">
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
        className="w-full rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder='{"authToken":"…","fingerprintId":"enhanced-…"}'
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          size="sm"
          loading={submitting}
          disabled={value.length === 0}
        >
          {submitting
            ? t("login.pasteSubmitting", { defaultValue: "Submitting…" })
            : t("login.pasteSubmit", { defaultValue: "Submit" })}
        </Button>
        {submitted && (
          <span className="text-xs text-success">
            {t("login.pasteOk", { defaultValue: "Accepted (storage pending)" })}
          </span>
        )}
      </div>
    </form>
  );
}
