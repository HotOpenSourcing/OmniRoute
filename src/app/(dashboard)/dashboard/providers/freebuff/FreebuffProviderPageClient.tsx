"use client";

/**
 * Freebuff provider client UI — single-file orchestrator.
 *
 * Layout mirrors the rest of the dashboard:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Breadcrumb                                               │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Provider header card  (icon · Freebuff · tagline · badge) │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Subscription-risk notice  (dismissible)                   │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Tabs: Connections · Available Models · Playground         │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ <Active section>                                          │
 *   │   connections  → Login · Quota · Streak cards             │
 *   │   models       → Search + filterable model list           │
 *   │   playground   → Prompt textarea + Send button            │
 *   └────────────────────────────────────────────────────────────┘
 *
 * State (login / quota / streak) is owned here so the header
 * card can derive `connectionState` from it. Until the Chunk 4
 * backend lands every API call returns 501; the sections surface
 * that as a single inline notice using the `isPending` flag.
 *
 * Shared components only — no local Freebuff* subcomponents.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Input,
  ProviderIcon,
  SegmentedControl,
} from "@/shared/components";

// ---------------------------------------------------------------------------
// Tab strip.
// ---------------------------------------------------------------------------

type FreebuffTab = "connections" | "models" | "playground";

const TABS: Array<{ value: FreebuffTab; labelKey: string; icon: string }> = [
  { value: "connections", labelKey: "tabs.connections", icon: "cable" },
  { value: "models", labelKey: "tabs.models", icon: "model_training" },
  { value: "playground", labelKey: "tabs.playground", icon: "science" },
];

const QUOTA_POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// API types + shared state models.
// ---------------------------------------------------------------------------

interface FreebuffApiError {
  status: number;
  message: string;
  code?: string;
}

interface FreebuffLoginStart {
  loginUrl: string;
  pollUrl: string;
  deviceCode: string;
  expiresAt: number;
}

interface FreebuffQuotaState {
  tier: "lite" | "standard" | "pro";
  sessionsUsed: number;
  sessionsRemaining: number;
  waitingRoomPosition: number | null;
  resetAt: string;
}

interface FreebuffStreak {
  current: number;
  longest: number;
  lastCheckIn: string | null;
  bonusCredits: number;
}

type FreebuffLoginStateModel =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; flow: FreebuffLoginStart; startedAt: number }
  | { kind: "error"; error: FreebuffApiError };

type FreebuffQuotaStateModel =
  | { kind: "loading" }
  | { kind: "ok"; quota: FreebuffQuotaState }
  | { kind: "error"; error: FreebuffApiError };

type FreebuffStreakStateModel =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; streak: FreebuffStreak }
  | { kind: "error"; error: FreebuffApiError };

type FreebuffConnectionState = "connected" | "pending" | "disconnected";

// ---------------------------------------------------------------------------
// Static model catalog (mirrors what Freebuff exposes per Codebuff tier).
// ---------------------------------------------------------------------------

interface FreebuffModel {
  id: string;
  label: string;
  tier: FreebuffQuotaState["tier"];
  context: number;
  maxOutput: number;
  modalities: string;
  source: string;
  premium?: boolean;
  referral?: boolean;
}

const MODEL_CATALOG: FreebuffModel[] = [
  {
    id: "codebuff-lite",
    label: "Codebuff Lite",
    tier: "lite",
    context: 32_000,
    maxOutput: 4_096,
    modalities: "text",
    source: "Codebuff Free Tier",
  },
  {
    id: "codebuff-standard",
    label: "Codebuff Standard",
    tier: "standard",
    context: 64_000,
    maxOutput: 8_192,
    modalities: "text",
    source: "Codebuff Free Tier",
  },
  {
    id: "codebuff-pro",
    label: "Codebuff Pro",
    tier: "pro",
    context: 128_000,
    maxOutput: 16_384,
    modalities: "text + image",
    source: "Codebuff Free Tier",
    premium: true,
  },
  {
    id: "codebuff-pro-referral",
    label: "Codebuff Pro (referral)",
    tier: "pro",
    context: 128_000,
    maxOutput: 16_384,
    modalities: "text + image",
    source: "Codebuff Free Tier",
    premium: true,
    referral: true,
  },
];

// ---------------------------------------------------------------------------
// API helper.
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
    throw { status: res.status, message, code } satisfies FreebuffApiError;
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export default function FreebuffProviderPageClient() {
  const t = useTranslations("freebuff");

  const [activeTab, setActiveTab] = useState<FreebuffTab>("connections");

  const [quota, setQuota] = useState<FreebuffQuotaStateModel>({ kind: "loading" });
  const [streak, setStreak] = useState<FreebuffStreakStateModel>({ kind: "idle" });
  const [login, setLogin] = useState<FreebuffLoginStateModel>({ kind: "idle" });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteSubmitting, setPasteSubmitting] = useState(false);
  const [pasteResult, setPasteResult] = useState<string | null>(null);

  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const [modelFilter, setModelFilter] = useState("");

  const [playgroundPrompt, setPlaygroundPrompt] = useState("");
  const [playgroundOutput, setPlaygroundOutput] = useState<string | null>(null);
  const [playgroundSending, setPlaygroundSending] = useState(false);

  const quotaAbortRef = useRef<AbortController | null>(null);
  const loginAbortRef = useRef<AbortController | null>(null);

  // ── Quota polling ────────────────────────────────────────────────────────

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

  // ── Streak (on-demand) ───────────────────────────────────────────────────

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

  // ── Login flow ───────────────────────────────────────────────────────────

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
      setLogin({ kind: "waiting", flow: data.login, startedAt: Date.now() });
      // Open the PKCE URL in a new tab so the user can complete the flow
      // without losing the dashboard context.
      window.open(data.login.loginUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setLogin({ kind: "error", error: err as FreebuffApiError });
    }
  }, []);

  // ── Paste credentials.json fallback ──────────────────────────────────────

  const submitPaste = useCallback(async () => {
    if (!pasteText.trim()) return;
    setPasteSubmitting(true);
    setPasteResult(null);
    try {
      // Chunk 4 wires storage; for now we just acknowledge receipt.
      await new Promise((r) => setTimeout(r, 300));
      setPasteResult(t("login.pasteOk"));
      setPasteText("");
    } finally {
      setPasteSubmitting(false);
    }
  }, [pasteText, t]);

  // ── Logout (release session) ─────────────────────────────────────────────

  const releaseSession = useCallback(async () => {
    try {
      await fetchFreebuff("/api/v1/providers/freebuff/session", {
        method: "DELETE",
      });
      setQuota({ kind: "loading" });
      setStreak({ kind: "idle" });
      setLogin({ kind: "idle" });
      refreshQuota();
    } catch (err) {
      setQuota({ kind: "error", error: err as FreebuffApiError });
    }
  }, [refreshQuota]);

  // ── Playground (UI shell only until Chunk 4) ────────────────────────────

  const sendPlayground = useCallback(async () => {
    if (!playgroundPrompt.trim()) return;
    setPlaygroundSending(true);
    setPlaygroundOutput(null);
    try {
      // Backend lands in Chunk 4 — surface the not-implemented path
      // explicitly so the UI doesn't appear to silently swallow input.
      throw {
        status: 501,
        message: t("playground.comingSoon"),
        code: "NOT_IMPLEMENTED",
      } satisfies FreebuffApiError;
    } catch (err) {
      setPlaygroundOutput((err as FreebuffApiError).message);
    } finally {
      setPlaygroundSending(false);
    }
  }, [playgroundPrompt, t]);

  // ── Derived: header connection state ─────────────────────────────────────

  const connectionState: FreebuffConnectionState = useMemo(() => {
    if (login.kind === "waiting" || login.kind === "starting") return "pending";
    if (quota.kind === "ok") return "connected";
    return "disconnected";
  }, [login.kind, quota.kind]);

  // The backend is not yet wired (Chunk 4) — every endpoint returns 501.
  // We surface a single inline notice so the user knows the UI is wired
  // but upstream calls will not return data yet.
  const isPending = quota.kind === "loading" && login.kind === "idle";

  const connectionBadge = useMemo(() => {
    if (connectionState === "connected") {
      return { variant: "success" as const, label: t("header.connected"), icon: "check_circle" };
    }
    if (connectionState === "pending") {
      return { variant: "warning" as const, label: t("header.pending"), icon: "hourglass_top" };
    }
    return { variant: "default" as const, label: t("header.disconnected"), icon: "link_off" };
  }, [connectionState, t]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs />

      <Card padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="rounded-card border border-border bg-bg p-3">
              <ProviderIcon providerId="freebuff" size={40} type="color" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-text-main">{t("name")}</h1>
                <Badge variant="info" size="sm" icon="workspace_premium">
                  {t("header.codebuffBadge")}
                </Badge>
                <Badge variant="warning" size="sm" icon="credit_card">
                  {t("header.subscriptionBadge")}
                </Badge>
              </div>
              <p className="text-sm text-text-muted">{t("tagline")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={connectionBadge.variant} dot icon={connectionBadge.icon}>
                  {connectionBadge.label}
                </Badge>
                <Link
                  href="https://www.codebuff.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    open_in_new
                  </span>
                  {t("header.viewWebsite")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {isPending && !noticeDismissed && (
        <Card padding="md">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined text-yellow-600 dark:text-yellow-400 text-[22px]"
                aria-hidden="true"
              >
                info
              </span>
              <div>
                <h2 className="text-sm font-semibold text-text-main">{t("notice.title")}</h2>
                <p className="mt-1 text-sm text-text-muted">{t("notice.description")}</p>
                <p className="mt-2 text-xs text-text-muted">
                  {t("errors.notImplementedTitle")}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon="close"
              aria-label={t("notice.dismiss")}
              onClick={() => setNoticeDismissed(true)}
            >
              {t("notice.dismiss")}
            </Button>
          </div>
        </Card>
      )}

      <SegmentedControl
        options={TABS.map((tab) => ({
          value: tab.value,
          label: t(tab.labelKey),
          icon: tab.icon,
        }))}
        value={activeTab}
        onChange={(value) => setActiveTab(value as FreebuffTab)}
        aria-label={t("tabs.ariaLabel")}
        className="w-fit"
      />

      {activeTab === "connections" && (
        <div className="flex flex-col gap-4">
          <LoginCard
            login={login}
            pasteOpen={pasteOpen}
            pasteText={pasteText}
            pasteSubmitting={pasteSubmitting}
            pasteResult={pasteResult}
            onTogglePaste={() => setPasteOpen((v) => !v)}
            onPasteChange={setPasteText}
            onPasteSubmit={submitPaste}
            onStartLogin={startLogin}
            onReleaseSession={releaseSession}
          />
          <QuotaCard
            quota={quota}
            onRefresh={refreshQuota}
            onReleaseSession={releaseSession}
          />
          <StreakCard streak={streak} onRefresh={refreshStreak} />
        </div>
      )}

      {activeTab === "models" && (
        <ModelsCard filter={modelFilter} onFilterChange={setModelFilter} />
      )}

      {activeTab === "playground" && (
        <PlaygroundCard
          prompt={playgroundPrompt}
          onPromptChange={setPlaygroundPrompt}
          output={playgroundOutput}
          sending={playgroundSending}
          onSend={sendPlayground}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section subcomponents — pure presentational, no business state of their own.
// They only consume the props the orchestrator hands them.
// ---------------------------------------------------------------------------

interface LoginCardProps {
  login: FreebuffLoginStateModel;
  pasteOpen: boolean;
  pasteText: string;
  pasteSubmitting: boolean;
  pasteResult: string | null;
  onTogglePaste: () => void;
  onPasteChange: (value: string) => void;
  onPasteSubmit: () => void;
  onStartLogin: () => void;
  onReleaseSession: () => void;
}

function LoginCard({
  login,
  pasteOpen,
  pasteText,
  pasteSubmitting,
  pasteResult,
  onTogglePaste,
  onPasteChange,
  onPasteSubmit,
  onStartLogin,
  onReleaseSession,
}: LoginCardProps) {
  const t = useTranslations("freebuff");
  const isStarting = login.kind === "starting";
  const isWaiting = login.kind === "waiting";
  const isError = login.kind === "error";

  return (
    <Card
      title={t("login.title")}
      subtitle={t("login.description")}
      icon="login"
      action={
        <Button
          variant={isWaiting ? "danger" : "primary"}
          icon={isWaiting ? "logout" : "open_in_new"}
          onClick={isWaiting ? onReleaseSession : onStartLogin}
          loading={isStarting}
          disabled={isStarting}
        >
          {isWaiting ? t("login.release") : t("login.cta")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {isWaiting && login.kind === "waiting" && (
          <Card.Section>
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined text-yellow-600 dark:text-yellow-400 text-[20px] animate-spin"
                aria-hidden="true"
              >
                progress_activity
              </span>
              <div className="text-sm text-text-muted">
                {t("login.waiting")}{" "}
                {new Date(login.startedAt).toLocaleTimeString()}
                <div className="mt-1 break-all text-xs text-text-muted">
                  {login.flow.pollUrl}
                </div>
              </div>
            </div>
          </Card.Section>
        )}

        {isError && login.kind === "error" && (
          <Card.Section>
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                error
              </span>
              <span>
                {t("errors.genericTitle")} — {login.error.message}
              </span>
            </div>
          </Card.Section>
        )}

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            icon={pasteOpen ? "expand_less" : "expand_more"}
            onClick={onTogglePaste}
          >
            {t("login.pasteToggle")}
          </Button>
        </div>

        {pasteOpen && (
          <div className="flex flex-col gap-3">
            <Input
              type="text"
              label={t("login.pasteLabel")}
              placeholder='{"access_token":"…"}'
              value={pasteText}
              onChange={(e) => onPasteChange(e.target.value)}
              hint={pasteResult ?? undefined}
              icon="content_paste"
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                icon="send"
                onClick={onPasteSubmit}
                loading={pasteSubmitting}
                disabled={pasteSubmitting || !pasteText.trim()}
              >
                {pasteSubmitting ? t("login.pasteSubmitting") : t("login.pasteSubmit")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

interface QuotaCardProps {
  quota: FreebuffQuotaStateModel;
  onRefresh: () => void;
  onReleaseSession: () => void;
}

function QuotaCard({ quota, onRefresh, onReleaseSession }: QuotaCardProps) {
  const t = useTranslations("freebuff");
  return (
    <Card
      title={t("quota.title")}
      icon="speed"
      action={
        <Button variant="secondary" size="sm" icon="refresh" onClick={onRefresh}>
          {t("quota.refresh")}
        </Button>
      }
    >
      {quota.kind === "loading" && (
        <p className="text-sm text-text-muted">{t("quota.loading")}</p>
      )}

      {quota.kind === "error" && (
        <div className="flex flex-col gap-2 text-sm text-red-600 dark:text-red-400">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              error
            </span>
            <span>
              {t("errors.notImplementedTitle")} — {quota.error.message}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Status {quota.error.status}
            {quota.error.code ? ` · ${quota.error.code}` : ""}
          </p>
        </div>
      )}

      {quota.kind === "ok" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat
            icon="check_circle"
            label={t("quota.sessionsUsed")}
            value={`${quota.quota.sessionsUsed}`}
          />
          <Stat
            icon="pending_actions"
            label={t("quota.sessionsRemaining")}
            value={`${quota.quota.sessionsRemaining}`}
          />
          <Stat icon="workspace_premium" label={t("quota.tier")} value={quota.quota.tier} />
          <Stat
            icon="schedule"
            label={t("quota.resetAt")}
            value={new Date(quota.quota.resetAt).toLocaleString()}
          />
          {quota.quota.waitingRoomPosition !== null && (
            <Stat
              icon="groups"
              label={t("quota.waitingRoom")}
              value={`#${quota.quota.waitingRoomPosition}`}
            />
          )}
          <div className="sm:col-span-2">
            <Button variant="danger" size="sm" icon="logout" onClick={onReleaseSession}>
              {t("login.release")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface StreakCardProps {
  streak: FreebuffStreakStateModel;
  onRefresh: () => void;
}

function StreakCard({ streak, onRefresh }: StreakCardProps) {
  const t = useTranslations("freebuff");
  return (
    <Card
      title={t("streak.title")}
      icon="local_fire_department"
      action={
        <Button variant="secondary" size="sm" icon="refresh" onClick={onRefresh}>
          {t("streak.refresh")}
        </Button>
      }
    >
      {streak.kind === "idle" && (
        <p className="text-sm text-text-muted">{t("streak.idle")}</p>
      )}

      {streak.kind === "loading" && (
        <p className="text-sm text-text-muted">{t("streak.loading")}</p>
      )}

      {streak.kind === "error" && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            error
          </span>
          <span>
            {t("errors.notImplementedTitle")} — {streak.error.message}
          </span>
        </div>
      )}

      {streak.kind === "ok" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat
            icon="local_fire_department"
            label={t("streak.current")}
            value={`${streak.streak.current}`}
          />
          <Stat
            icon="military_tech"
            label={t("streak.longest")}
            value={`${streak.streak.longest}`}
          />
          <Stat
            icon="event"
            label={t("streak.lastCheckIn")}
            value={
              streak.streak.lastCheckIn
                ? new Date(streak.streak.lastCheckIn).toLocaleString()
                : "—"
            }
          />
          <Stat
            icon="redeem"
            label={t("streak.bonus")}
            value={`${streak.streak.bonusCredits}`}
          />
        </div>
      )}
    </Card>
  );
}

interface ModelsCardProps {
  filter: string;
  onFilterChange: (value: string) => void;
}

function ModelsCard({ filter, onFilterChange }: ModelsCardProps) {
  const t = useTranslations("freebuff");
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return MODEL_CATALOG;
    return MODEL_CATALOG.filter(
      (m) =>
        m.id.toLowerCase().includes(needle) ||
        m.label.toLowerCase().includes(needle) ||
        m.tier.includes(needle),
    );
  }, [filter]);

  return (
    <Card
      title={t("models.title")}
      subtitle={t("models.subtitle")}
      icon="model_training"
      action={
        <Input
          type="search"
          placeholder={t("models.search")}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          icon="search"
        />
      }
    >
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted">{t("models.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((model) => (
            <Card.Section key={model.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-main">{model.label}</span>
                    <Badge variant="primary" size="sm">
                      {t(`models.tiers.${model.tier}` as const)}
                    </Badge>
                    {model.premium && (
                      <Badge variant="warning" size="sm" icon="workspace_premium">
                        {t("models.premiumTag")}
                      </Badge>
                    )}
                    {model.referral && (
                      <Badge variant="info" size="sm" icon="redeem">
                        {t("models.referralTag")}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {t("models.columns.context")}: {model.context.toLocaleString()} ·{" "}
                    {t("models.columns.maxOutput")}: {model.maxOutput.toLocaleString()}
                  </p>
                  <p className="text-xs text-text-muted">
                    {t("models.columns.modalities")}: {model.modalities} ·{" "}
                    {t("models.columns.source")}: {model.source}
                  </p>
                </div>
              </div>
            </Card.Section>
          ))}
        </div>
      )}
    </Card>
  );
}

interface PlaygroundCardProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  output: string | null;
  sending: boolean;
  onSend: () => void;
}

function PlaygroundCard({
  prompt,
  onPromptChange,
  output,
  sending,
  onSend,
}: PlaygroundCardProps) {
  const t = useTranslations("freebuff");
  return (
    <Card title={t("playground.title")} subtitle={t("playground.subtitle")} icon="science">
      <div className="flex flex-col gap-3">
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={6}
          placeholder="Ask Codebuff anything…"
          className="w-full resize-y rounded-control border border-border bg-bg p-3 text-sm text-text-main focus:border-primary focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">{t("playground.comingSoon")}</p>
          <Button
            variant="primary"
            icon="send"
            onClick={onSend}
            loading={sending}
            disabled={sending || !prompt.trim()}
          >
            Send
          </Button>
        </div>
        {output && (
          <Card.Section>
            <div className="flex items-start gap-2 text-sm text-text-main">
              <span
                className="material-symbols-outlined text-[18px] text-yellow-600 dark:text-yellow-400"
                aria-hidden="true"
              >
                info
              </span>
              <span>{output}</span>
            </div>
          </Card.Section>
        )}
      </div>
    </Card>
  );
}

interface StatProps {
  icon: string;
  label: string;
  value: string;
}

function Stat({ icon, label, value }: StatProps) {
  return (
    <Card.Section>
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
          <p className="text-sm font-semibold text-text-main">{value}</p>
        </div>
      </div>
    </Card.Section>
  );
}
