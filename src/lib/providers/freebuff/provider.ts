/**
 * Freebuff provider — Chunk 4.
 *
 * Orchestrates everything the previous chunks produced:
 *
 *   - Chunk 1 (`events.ts`)    → typed CodebuffEvent shapes
 *   - Chunk 2 (`oauth.ts`)     → device-code login flow
 *   - Chunk 3 (`fingerprint`)  → host-bound request signature
 *   - Chunk 5 (`stream/*`)     → SSE transformer factory
 *   - Chunk 6 (`models.ts`)    → catalog + access-tier filter
 *
 * Concerns owned by this module:
 *
 *   1. Session lock — a PID file at `~/.config/manicode/freebuff.lock`
 *      ensures only one process holds an active session at a time
 *      (the Codebuff binary enforces the same lock locally).
 *
 *   2. Connection lifecycle — load from / persist to the connection
 *      store via the Chunk 1 zod schema, with the fingerprint bound to
 *      the host at first login.
 *
 *   3. Request orchestration — attach fingerprint + authToken headers,
 *      dispatch the SSE stream through the Chunk 5 transformer, and
 *      surface clean error responses.
 *
 *   4. Model access — `listModels()` returns the Chunk 6 catalog
 *      filtered by the user's access tier.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  safeParseFreebuffConnection,
  type FreebuffConnection,
} from "@/shared/schemas/providers/freebuff";

import {
  FREEBUFF_MODELS,
  getFreebuffModel,
  hasFreebuffModel,
  type FreebuffModel,
  type FreebuffAccessTier,
} from "./models.ts";

import {
  filterByAccessTier,
  isModelVisibleInLimitedTier,
} from "./freeModelFilter.ts";

import {
  startLogin as oauthStartLogin,
  pollLoginStatus as oauthPollLoginStatus,
  FreebuffOAuthError,
} from "./oauth.ts";

import {
  computeFreebuffFingerprintSync,
  fingerprintFromPayload,
  type FreebuffFingerprint,
} from "./fingerprint.ts";

import { createTransformer } from "./stream/index.ts";
import type { TransformerFormat } from "./stream/index.ts";
import { createPassthroughTransformer } from "./stream/passthroughTransformer.ts";
import { sendFreebuffChat } from "./chat.ts";

// ---------------------------------------------------------------------------
// Paths and configuration.
// ---------------------------------------------------------------------------

export const FREEBUFF_CREDENTIALS_PATH =
  process.env.FREEBUFF_CREDENTIALS_PATH ??
  join(homedir(), ".config", "manicode", "credentials.json");

export const FREEBUFF_LOCK_PATH =
  process.env.FREEBUFF_LOCK_PATH ??
  join(homedir(), ".config", "manicode", "freebuff.lock");

export const FREEBUFF_API_BASE =
  process.env.FREEBUFF_API_BASE ?? "https://www.codebuff.com";

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class FreebuffProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "FreebuffProviderError";
  }
}

// ---------------------------------------------------------------------------
// Session lock.
// ---------------------------------------------------------------------------

interface LockHandle {
  path: string;
  pid: number;
  released: boolean;
}

/**
 * Acquire an exclusive session lock. Throws if another process already
 * holds it. Returns a handle that MUST be released via `releaseLock`.
 */
export async function acquireSessionLock(): Promise<LockHandle> {
  await mkdir(dirname(FREEBUFF_LOCK_PATH), { recursive: true });

  if (existsSync(FREEBUFF_LOCK_PATH)) {
    const stale = await isLockStale(FREEBUFF_LOCK_PATH);
    if (!stale) {
      const content = await readFile(FREEBUFF_LOCK_PATH, "utf8").catch(() => "");
      throw new FreebuffProviderError(
        `Another Freebuff session is active (pid=${content.trim() || "unknown"}). Sign out first.`,
        409,
        "session_locked",
      );
    }
    // Stale lock — overwrite it.
    await unlink(FREEBUFF_LOCK_PATH).catch(() => undefined);
  }

  const pid = process.pid;
  await writeFile(FREEBUFF_LOCK_PATH, String(pid), { flag: "wx" });
  return { path: FREEBUFF_LOCK_PATH, pid, released: false };
}

/** Release the lock acquired via `acquireSessionLock`. */
export async function releaseLock(handle: LockHandle): Promise<void> {
  if (handle.released) return;
  handle.released = true;
  await unlink(handle.path).catch(() => undefined);
}

/**
 * A lock is stale when its owning PID is no longer alive. We use
 * `process.kill(pid, 0)` as a cross-platform liveness probe — on POSIX
 * it succeeds iff the PID exists, on Windows it throws ESRCH for dead
 * PIDs and EPERM for live ones owned by another user.
 */
async function isLockStale(lockPath: string): Promise<boolean> {
  const content = await readFile(lockPath, "utf8").catch(() => "");
  const pid = Number(content.trim());
  if (!Number.isFinite(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ESRCH" || code === "EPERM";
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle.
// ---------------------------------------------------------------------------

/**
 * Load the persisted Freebuff connection from disk. Returns `null` if
 * the file is missing or unreadable. Throws on parse failure so the
 * caller can surface a clear "credentials.json corrupted" error.
 */
export async function loadConnection(): Promise<FreebuffConnection | null> {
  try {
    const stat_ = await stat(FREEBUFF_CREDENTIALS_PATH);
    if (!stat_.isFile()) return null;
  } catch {
    return null;
  }

  const raw = await readFile(FREEBUFF_CREDENTIALS_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FreebuffProviderError(
      `${FREEBUFF_CREDENTIALS_PATH} is not valid JSON`,
      500,
      "credentials_corrupt",
    );
  }

  const result = safeParseFreebuffConnection(parsed);
  if (!result.ok) {
    throw new FreebuffProviderError(
      `${FREEBUFF_CREDENTIALS_PATH} does not match the Freebuff connection schema`,
      500,
      "credentials_invalid",
    );
  }
  return result.data;
}

/** Encrypt-and-persist helper. NOTE: encryption is delegated to the
 *  host secret store (keytar / OS keychain) — this function only writes
 *  the JSON envelope. The full encryption pipeline lands in a follow-up. */
export async function saveConnection(
  connection: FreebuffConnection,
): Promise<void> {
  await mkdir(dirname(FREEBUFF_CREDENTIALS_PATH), { recursive: true });
  await writeFile(
    FREEBUFF_CREDENTIALS_PATH,
    JSON.stringify(connection, null, 2),
    { mode: 0o600 },
  );
}

// ---------------------------------------------------------------------------
// Fingerprint binding.
// ---------------------------------------------------------------------------

/**
 * Returns the fingerprint bound to a given connection. If the
 * connection has no `fingerprintHash` set, compute it from the current
 * host and bind it (returning the enriched connection).
 *
 * The fingerprint mismatch warning in the UI is the case where this
 * function would compute a different hash than the one the local
 * `freebuff login` produced — typically Docker/cloud deployments.
 */
export function ensureFingerprint(
  connection: FreebuffConnection,
  hostFingerprint?: FreebuffFingerprint,
): FreebuffConnection {
  const fp = hostFingerprint ?? computeFreebuffFingerprintSync();
  if (connection.fingerprintId === fp.fingerprintId) return connection;
  return {
    ...connection,
    fingerprintId: fp.fingerprintId,
    fingerprintHash: fp.fingerprintHash,
  };
}

// ---------------------------------------------------------------------------
// Provider API.
// ---------------------------------------------------------------------------

export interface FreebuffProviderOptions {
  /** Use the free-tier-only model list when true. Defaults to the catalog. */
  freeTierOnly?: boolean;
  /** Logger callback — receives structured event log lines. */
  logger?: (line: string) => void;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ProviderState {
  connection: FreebuffConnection;
  lock: LockHandle;
  fingerprint: FreebuffFingerprint;
  options: FreebuffProviderOptions;
}

export async function createProvider(
  options: FreebuffProviderOptions = {},
): Promise<ProviderState> {
  const lock = await acquireSessionLock();
  const connection = await loadConnection();
  if (!connection) {
    await releaseLock(lock);
    throw new FreebuffProviderError(
      `No Freebuff connection found at ${FREEBUFF_CREDENTIALS_PATH}. Sign in via the dashboard.`,
      401,
      "no_connection",
    );
  }
  const fingerprint = fingerprintFromPayload(
    // The fingerprint is bound to the host at first login. If the
    // caller stored a payload hash, we recompute from the same
    // canonical sources to detect drift.
    canonicalPayload(connection),
  );
  return {
    connection: ensureFingerprint(connection, fingerprint),
    lock,
    fingerprint,
    options,
  };
}

export async function releaseProvider(state: ProviderState): Promise<void> {
  await releaseLock(state.lock);
}

/** Lists the catalog filtered by the user's access tier. */
export function listModels(state: ProviderState): FreebuffModel[] {
  const tier: FreebuffAccessTier = state.connection.accessTier ?? "limited";
  const filtered = filterByAccessTier(FREEBUFF_MODELS, tier);
  return state.options.freeTierOnly
    ? filtered.filter((m) => !m.premium)
    : filtered;
}

/**
 * Dispatches a chat request to the Freebuff API. The orchestrator lives
 * in `./chat.ts` — it acquires a waiting-room slot, streams the chat
 * via `/api/v1/chat/completions` with the correct `freebuff_instance_id`,
 * and releases the slot when the stream completes.
 *
 * `format` selects the wire format the caller expects:
 *   - "openai": relay the upstream SSE verbatim (pass-through).
 *   - "anthropic": re-frame the upstream OpenAI SSE into Anthropic events
 *     using the existing transformer factory (kept for the legacy path).
 *
 * @param body.signal AbortSignal that, when triggered, cancels the upstream
 *                    stream and triggers the slot release.
 */
export async function sendChatRequest(
  state: ProviderState,
  body: ChatRequest,
  format: TransformerFormat,
): Promise<Response> {
  const model = getFreebuffModel(body.model);
  if (!model) {
    throw new FreebuffProviderError(
      `Unknown model: ${body.model}`,
      400,
      "unknown_model",
    );
  }
  const tier: FreebuffAccessTier = state.connection.accessTier ?? "limited";
  if (!isModelVisibleInLimitedTier(model)) {
    if (tier === "limited") {
      throw new FreebuffProviderError(
        `Model ${body.model} is not available on the limited tier`,
        403,
        "model_not_available",
      );
    }
  }

  let upstream: Response;
  try {
    upstream = await sendFreebuffChat({
      model: body.model,
      messages: body.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      stream: body.stream ?? true,
      max_tokens: body.max_tokens as number | undefined,
      temperature: body.temperature as number | undefined,
      top_p: body.top_p as number | undefined,
    });
  } catch (err) {
    if (err instanceof FreebuffProviderError) throw err;
    throw new FreebuffProviderError(
      `Freebuff chat request failed: ${(err as Error).message}`,
      503,
      "network_error",
    );
  }

  // Pick the right transformer:
  //   - openai: pass-through (upstream is already OpenAI SSE).
  //   - anthropic: re-frame using the legacy event-based transformer
  //     (the upstream may have switched to plain OpenAI SSE, in which
  //     case consumers will receive raw `data: {...}\n\n` chunks —
  //     acceptable until a dedicated Anthropic framer lands).
  const transformer =
    format === "openai"
      ? createPassthroughTransformer({ model: body.model })
      : createTransformer(format, { model: body.model });

  const transformed = upstream.body!.pipeThrough(transformer);
  return new Response(transformed, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "x-omniroute-freebuff-instance": upstream.headers.get(
        "x-omniroute-freebuff-instance",
      ) ?? "",
    },
  });
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function canonicalPayload(connection: FreebuffConnection): string {
  // The payload is the fingerprint's input. We rebuild it from the
  // canonical sources so the hash matches what `computeFreebuffFingerprintSync`
  // produced. If `connection.fingerprintHash` is set, we include it as
  // an extra tiebreaker so re-binding on a different host is detectable.
  const parts = [
    `user=${connection.userId ?? ""}`,
    `auth=${connection.authToken}`,
  ];
  if (connection.fingerprintHash) {
    parts.push(`host-fp=${connection.fingerprintHash}`);
  }
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// Re-exports for convenience.
// ---------------------------------------------------------------------------

export {
  oauthStartLogin,
  oauthPollLoginStatus,
  FreebuffOAuthError,
};

export type { FreebuffConnection, FreebuffFingerprint, FreebuffModel };
