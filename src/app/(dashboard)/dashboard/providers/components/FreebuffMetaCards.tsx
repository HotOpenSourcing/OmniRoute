"use client";

/**
 * Freebuff quota + streak meta cards.
 *
 * Self-contained client component. Polls `/quota` every QUOTA_POLL_MS and
 * exposes an on-demand `/streak` fetcher. Surfaces a 501 "not implemented"
 * banner at the top so the UI stays informative while the backend lands.
 *
 * Endpoints (must be byte-compatible with the upstream API):
 *   - GET /api/v1/providers/freebuff/quota
 *   - GET /api/v1/providers/freebuff/streak
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "@/shared/components";

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const FREEBUFF_QUOTA_URL = "/api/v1/providers/freebuff/quota";
const FREEBUFF_STREAK_URL = "/api/v1/providers/freebuff/streak";
const QUOTA_POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// API helpers + state models.
// ---------------------------------------------------------------------------

interface ApiError {
  status: number;
  message: string;
  code?: string;
}

interface QuotaState {
  remaining: number;
  limit: number;
  resetsAt: string;
}

interface StreakState {
  current: number;
  longest: number;
  lastCheckin: string;
}

type QuotaModel =
  { kind: "loading" } | { kind: "ok"; quota: QuotaState } | { kind: "error"; error: ApiError };

type StreakModel =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; streak: StreakState }
  | { kind: "error"; error: ApiError };

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
    const message = body?.error?.message ?? `Request failed with HTTP ${res.status}`;
    const code = body?.error?.code;
    throw { status: res.status, message, code } as ApiError;
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface FreebuffMetaCardsProps {
  /** Optional — accepted for forward compatibility, not branched on. */
  providerId?: string;
}

export function FreebuffMetaCards(_props: FreebuffMetaCardsProps = {}) {
  const t = useTranslations("freebuff");

  const [quota, setQuota] = useState<QuotaModel>({ kind: "loading" });
  const [streak, setStreak] = useState<StreakModel>({ kind: "idle" });
  const quotaAbortRef = useRef<AbortController | null>(null);

  // i18n helper — falls back to an English literal when the key is missing.
  const tr = useCallback(
    (key: string, fallback: string): string => {
      try {
        return t(key as never);
      } catch {
        return fallback;
      }
    },
    [t]
  );

  // ── Quota polling ────────────────────────────────────────────────────────
  const refreshQuota = useCallback(async () => {
    quotaAbortRef.current?.abort();
    const controller = new AbortController();
    quotaAbortRef.current = controller;
    try {
      const data = await fetchFreebuff<{ quota: QuotaState }>(FREEBUFF_QUOTA_URL, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!controller.signal.aborted) {
        setQuota({ kind: "ok", quota: data.quota });
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setQuota({ kind: "error", error: err as ApiError });
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

  // ── Streak on-demand ─────────────────────────────────────────────────────
  const refreshStreak = useCallback(async () => {
    setStreak({ kind: "loading" });
    try {
      const data = await fetchFreebuff<{ streak: StreakState }>(FREEBUFF_STREAK_URL, {
        cache: "no-store",
      });
      setStreak({ kind: "ok", streak: data.streak });
    } catch (err) {
      setStreak({ kind: "error", error: err as ApiError });
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────
  const showUpstreamBanner = quota.kind === "error" && quota.error.status === 501;

  return (
    <div className="flex flex-col gap-4">
      {showUpstreamBanner && (
        <Card padding="md">
          <div className="flex items-start gap-2 rounded-control border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              info
            </span>
            <span>
              {tr(
                "meta.upstreamUnavailable",
                "The Quota and Streak endpoints return 501 (not implemented) — the Freebuff backend is not yet wired. Polling will resume automatically once the upstream lands."
              )}
            </span>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          title={tr("meta.quotaTitle", "Quota")}
          icon="speed"
          action={
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={refreshQuota}
              disabled={quota.kind === "loading"}
            >
              {tr("meta.refresh", "Refresh")}
            </Button>
          }
        >
          {quota.kind === "loading" && (
            <p className="text-sm text-text-muted">{tr("meta.loading", "Loading…")}</p>
          )}

          {quota.kind === "ok" && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-text-main">
                {quota.quota.remaining} / {quota.quota.limit} {tr("meta.remaining", "remaining")}
              </p>
              <p className="text-xs text-text-muted">
                {tr("meta.resetsAt", "Resets")} {quota.quota.resetsAt}
              </p>
            </div>
          )}

          {quota.kind === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{quota.error.message}</p>
          )}
        </Card>

        <Card
          title={tr("meta.streakTitle", "Streak")}
          icon="local_fire_department"
          action={
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={refreshStreak}
              disabled={streak.kind === "loading"}
            >
              {streak.kind === "idle" ? tr("meta.check", "Check") : tr("meta.refresh", "Refresh")}
            </Button>
          }
        >
          {streak.kind === "idle" && (
            <p className="text-sm text-text-muted">
              {tr("meta.streakIdle", "Click refresh to check your streak")}
            </p>
          )}

          {streak.kind === "loading" && (
            <p className="text-sm text-text-muted">{tr("meta.loading", "Loading…")}</p>
          )}

          {streak.kind === "ok" && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-text-main">
                {streak.streak.current} {tr("meta.dayStreak", "day streak")}
              </p>
              <p className="text-xs text-text-muted">
                {tr("meta.longest", "Longest")}: {streak.streak.longest}
              </p>
            </div>
          )}

          {streak.kind === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{streak.error.message}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export default FreebuffMetaCards;
