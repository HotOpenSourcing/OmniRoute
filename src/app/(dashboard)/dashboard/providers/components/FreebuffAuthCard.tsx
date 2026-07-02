"use client";

/**
 * Freebuff PKCE auth + paste-credentials card.
 *
 * Self-contained client component. Owns all login / paste state internally —
 * does not consume any state from props. May optionally receive a
 * `providerId` for telemetry / future scoping, but does not branch on it.
 *
 * Endpoints (must be byte-compatible with the upstream API):
 *   - POST   /api/v1/providers/freebuff/login/start
 *   - POST   /api/v1/providers/freebuff/session      (paste credentials.json)
 *   - DELETE /api/v1/providers/freebuff/session      (sign out)
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@/shared/components";

// ---------------------------------------------------------------------------
// Endpoint constants — kept as top-level string constants per spec.
// ---------------------------------------------------------------------------

const FREEBUFF_LOGIN_START_URL = "/api/v1/providers/freebuff/login/start";
const FREEBUFF_SESSION_URL = "/api/v1/providers/freebuff/session";

// ---------------------------------------------------------------------------
// API helpers.
// ---------------------------------------------------------------------------

interface ApiError {
  status: number;
  message: string;
  code?: string;
}

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
// State machines.
// ---------------------------------------------------------------------------

interface LoginFlow {
  loginUrl: string;
  sessionId: string;
}

type LoginState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; flow: LoginFlow; startedAt: number }
  | { kind: "error"; error: ApiError };

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface FreebuffAuthCardProps {
  /** Optional — accepted for forward compatibility, not branched on. */
  providerId?: string;
}

export function FreebuffAuthCard(_props: FreebuffAuthCardProps = {}) {
  const t = useTranslations("freebuff");

  const [login, setLogin] = useState<LoginState>({ kind: "idle" });

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedJson, setPastedJson] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  // ── i18n helper: fall back to English literal when a key is missing ───────
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

  // ── Start OAuth (PKCE) flow ──────────────────────────────────────────────
  const startOAuth = useCallback(async () => {
    setLogin({ kind: "starting" });
    try {
      const data = await fetchFreebuff<{ login: LoginFlow }>(FREEBUFF_LOGIN_START_URL, {
        method: "POST",
      });
      const startedAt = Date.now();
      // Open PKCE URL in a new tab so the user keeps dashboard context.
      window.open(data.login.loginUrl, "_blank", "noopener,noreferrer");
      setLogin({ kind: "waiting", flow: data.login, startedAt });
    } catch (err) {
      setLogin({ kind: "error", error: err as ApiError });
    }
  }, []);

  // ── Cancel waiting flow → sign out and reset ────────────────────────────
  const cancelWaiting = useCallback(async () => {
    try {
      await fetchFreebuff(FREEBUFF_SESSION_URL, { method: "DELETE" });
    } catch {
      // Best-effort — even if the DELETE fails we still reset local state so
      // the user is not stuck on the waiting screen.
    }
    setLogin({ kind: "idle" });
  }, []);

  // ── Submit pasted credentials.json ───────────────────────────────────────
  const submitPaste = useCallback(async () => {
    setPasteError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(pastedJson);
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : tr("auth.pasteError", "Invalid JSON"));
      return;
    }
    setPasting(true);
    try {
      await fetchFreebuff(FREEBUFF_SESSION_URL, {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      setPastedJson("");
      setPasteOpen(false);
    } catch (err) {
      const apiErr = err as ApiError;
      setPasteError(apiErr.message ?? tr("auth.pasteError", "Invalid JSON"));
    } finally {
      setPasting(false);
    }
  }, [pastedJson, tr]);

  // ── Render ──────────────────────────────────────────────────────────────
  const isStarting = login.kind === "starting";
  const isWaiting = login.kind === "waiting";
  const isError = login.kind === "error";

  const statusVariant: "default" | "warning" | "error" | "success" =
    login.kind === "waiting" || login.kind === "starting"
      ? "warning"
      : login.kind === "error"
        ? "error"
        : login.kind === "idle"
          ? "default"
          : "success";

  const statusLabel =
    login.kind === "idle"
      ? tr("auth.statusIdle", "Idle")
      : login.kind === "starting"
        ? tr("auth.statusStarting", "Starting…")
        : login.kind === "waiting"
          ? tr("auth.statusWaiting", "Waiting")
          : tr("auth.statusError", "Error");

  return (
    <Card
      title={tr("auth.pkceTitle", "PKCE Login")}
      icon="login"
      action={
        <Badge variant={statusVariant} dot>
          {statusLabel}
        </Badge>
      }
    >
      <div className="flex flex-col gap-4">
        {(login.kind === "idle" || login.kind === "error") && (
          <Button
            variant="primary"
            icon="open_in_new"
            onClick={startOAuth}
            disabled={isStarting}
            loading={isStarting}
          >
            {tr("auth.startFlow", "Start OAuth flow")}
          </Button>
        )}

        {isWaiting && login.kind === "waiting" && (
          <div className="flex flex-col gap-2 rounded-control border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                hourglass_top
              </span>
              <span>{tr("auth.waitingMessage", "Complete the sign-in in the opened tab.")}</span>
            </div>
            <a
              href={login.flow.loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 text-xs hover:underline break-all"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                open_in_new
              </span>
              {tr("auth.reopen", "Reopen login tab")}
            </a>
            <div>
              <Button variant="ghost" size="sm" icon="close" onClick={cancelWaiting}>
                {tr("auth.cancel", "Cancel")}
              </Button>
            </div>
          </div>
        )}

        {isError && login.kind === "error" && (
          <div className="flex items-start gap-2 rounded-control border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              error
            </span>
            <span>
              {tr("auth.errorBanner", "Authentication failed.")} — {login.error.message}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            icon={pasteOpen ? "expand_less" : "expand_more"}
            onClick={() => setPasteOpen((v) => !v)}
          >
            {tr("auth.pasteCredentials", "Paste credentials.json")}
          </Button>
        </div>

        {pasteOpen && (
          <div className="flex flex-col gap-3">
            <textarea
              value={pastedJson}
              onChange={(e) => setPastedJson(e.target.value)}
              placeholder={tr("auth.pastePlaceholder", '{\n  "access_token": "…"\n}')}
              className="min-h-[120px] w-full rounded border border-border bg-bg p-2 font-mono text-sm text-text-main focus:border-primary focus:outline-none"
              spellCheck={false}
            />
            {pasteError && <p className="text-xs text-red-600 dark:text-red-400">{pasteError}</p>}
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                icon="send"
                onClick={submitPaste}
                loading={pasting}
                disabled={pasting || !pastedJson.trim()}
              >
                {tr("auth.pasteSubmit", "Submit")}
              </Button>
            </div>
          </div>
        )}

        {(isWaiting || isStarting) && (
          <div className="flex justify-end border-t border-border pt-3">
            <Button
              variant="danger"
              size="sm"
              icon="logout"
              onClick={cancelWaiting}
              disabled={isStarting}
            >
              {tr("auth.signOut", "Sign out")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default FreebuffAuthCard;
