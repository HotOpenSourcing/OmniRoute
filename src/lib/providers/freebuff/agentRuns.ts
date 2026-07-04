/**
 * Freebuff (Codebuff Free Tier) — `agent-runs` handshake.
 *
 * The Codebuff chat-completions endpoint requires a `runId` that has been
 * **previously registered** via `POST /api/v1/agent-runs {action:"START"}`.
 * Sending a freshly-generated UUID (or omitting the field entirely) returns
 * HTTP 400 with one of:
 *
 *   - `{"message":"No runId found in request body"}` — missing entirely
 *   - `{"message":"runId Not Found: <uuid>"}` — present but not in DB
 *
 * Captured in `~/.config/manicode/freebuff-model-tests/phase4-deliverables/
 * 00-PROTOCOL-SPEC.md` §6 and confirmed in `chat-v4.py` (2026-07-03).
 *
 * PROTOCOL
 * --------
 *   START   POST /api/v1/agent-runs  body: { action:"START", agentId, ancestorRunIds? }
 *          → 200 { runId: <uuid> }
 *
 *   FINISH  POST /api/v1/agent-runs  body: { action:"FINISH", runId, status,
 *                                          totalSteps, directCredits,
 *                                          totalCredits, errorMessage? }
 *          → 200 { success: true }
 *
 * Required headers (same as chat-completions):
 *   Authorization: Bearer <authToken>
 *   x-unique-id: <fingerprintId>
 *   x-codebuff-fingerprint: <fingerprintId>
 *   x-codebuff-fingerprint-hash: <fingerprintHash>
 *   Cookie: __session=eyJhbGciOiJIUzI1NiJ9.fake.<token-prefix>
 *   User-Agent: codebuff-cli/<v> (<os>; node/<runtime>)
 *
 * @module lib/providers/freebuff/agentRuns
 */

import { FREEBUFF_AGENT_RUNS_PATH } from "./base.ts";

/** Status values accepted by FINISH. Matches the upstream Zod schema. */
export type FinishAgentRunStatus = "completed" | "failed" | "canceled";

/** Credentials required to call agent-runs. */
export interface FreebuffCredentials {
  authToken: string;
  fingerprintId: string;
  fingerprintHash?: string;
}

export interface StartAgentRunParams {
  credentials: FreebuffCredentials;
  agentId: string;
  ancestorRunIds?: readonly string[];
  baseUrl?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export interface FinishAgentRunParams {
  credentials: FreebuffCredentials;
  runId: string;
  status: FinishAgentRunStatus;
  totalSteps: number;
  directCredits: number;
  totalCredits: number;
  errorMessage?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export class FreebuffProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FreebuffProviderError";
  }
}

/**
 * Build the standard Freebuff request headers (excluding the
 * `Content-Type` and `Content-Length` which are set by the fetch call).
 *
 * Aligned with `00-PROTOCOL-SPEC.md` §2.2 and validated by
 * `validation-scripts/test-headers.ts` Mission 1 (all 5 cases returned
 * 200 regardless of UA / fingerprint / cookie — only `Authorization`
 * is strictly required). The legacy `x-unique-id` header name and the
 * fabricated `Cookie: __session=...` from the original protocol draft
 * were removed in v3.8.43 — the spec header name is
 * `x-codebuff-fingerprint` and the cookie is not part of the wire.
 *
 * Exported for unit testing so the header set stays in one place.
 */
export function buildFreebuffHeaders(
  credentials: FreebuffCredentials,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.authToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-codebuff-fingerprint": credentials.fingerprintId,
  };
  if (credentials.fingerprintHash) {
    headers["x-codebuff-fingerprint-hash"] = credentials.fingerprintHash;
  }
  return headers;
}

/**
 * `POST /api/v1/agent-runs {action:"START"}` → `{runId}`.
 *
 * Throws `FreebuffProviderError` on non-2xx or malformed response.
 * Never returns null — callers should handle the exception.
 */
export async function startAgentRun(
  params: StartAgentRunParams,
): Promise<string> {
  const doFetch = params.fetcher ?? fetch;
  const base = params.baseUrl ?? "https://www.codebuff.com";
  const url = `${base.replace(/\/$/, "")}${FREEBUFF_AGENT_RUNS_PATH}`;
  const body = {
    action: "START",
    agentId: params.agentId,
    ancestorRunIds: params.ancestorRunIds ?? [],
  };

  let resp: Response;
  try {
    resp = await doFetch(url, {
      method: "POST",
      headers: buildFreebuffHeaders(params.credentials),
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (err) {
    throw new FreebuffProviderError(
      `agent-runs START network error: ${(err as Error).message}`,
      0,
      "network_error",
    );
  }

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      code = parsed?.error?.code;
    } catch {
      // ignore — body may not be JSON
    }
    throw new FreebuffProviderError(
      `agent-runs START failed: HTTP ${resp.status} ${text.slice(0, 200)}`,
      resp.status,
      code,
    );
  }

  let parsed: { runId?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FreebuffProviderError(
      `agent-runs START invalid JSON: ${text.slice(0, 200)}`,
      resp.status,
      "invalid_response",
    );
  }

  if (typeof parsed?.runId !== "string" || parsed.runId.length === 0) {
    throw new FreebuffProviderError(
      `agent-runs START missing runId in response: ${text.slice(0, 200)}`,
      resp.status,
      "invalid_response",
    );
  }
  return parsed.runId;
}

/**
 * `POST /api/v1/agent-runs {action:"FINISH"}` — best-effort.
 *
 * Returns `true` if the upstream acknowledged, `false` otherwise. Never
 * throws — FINISH is intentionally non-blocking so a network glitch on
 * teardown does not break the chat stream response.
 */
export async function finishAgentRun(
  params: FinishAgentRunParams,
): Promise<boolean> {
  const doFetch = params.fetcher ?? fetch;
  const base = params.baseUrl ?? "https://www.codebuff.com";
  const url = `${base.replace(/\/$/, "")}${FREEBUFF_AGENT_RUNS_PATH}`;
  const body: Record<string, unknown> = {
    action: "FINISH",
    runId: params.runId,
    status: params.status,
    totalSteps: params.totalSteps,
    directCredits: params.directCredits,
    totalCredits: params.totalCredits,
  };
  if (params.errorMessage) {
    body.errorMessage = params.errorMessage;
  }

  try {
    const resp = await doFetch(url, {
      method: "POST",
      headers: buildFreebuffHeaders(params.credentials),
      body: JSON.stringify(body),
      signal: params.signal,
    });
    if (!resp.ok) {
      return false;
    }
    const text = await resp.text().catch(() => "");
    try {
      const parsed = JSON.parse(text);
      return parsed?.success === true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
