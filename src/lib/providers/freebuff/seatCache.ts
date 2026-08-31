/**
 * Freebuff in-memory seat cache.
 *
 * The Codebuff/Freebuff upstream enforces a "1 chat seat per token" rule
 * via `POST /api/v1/freebuff/session`. Each seat carries:
 *
 *   - `instanceId` (UUID) — stamped on every chat request as the
 *     `x-freebuff-instance-id` header.
 *   - `expiresAt` (ISO-8601) — 1-hour TTL (C5 discovery, Mission 2).
 *   - `model` — the model the seat was acquired for.
 *
 * Without a valid seat, the upstream chat endpoint rejects the request
 * (or returns `status: superseded` for a stale seat — see C8: "no grace
 * period"). To avoid hammering `POST /session` on every chat, we cache
 * the seat per `(connectionId, modelId)` and refresh ~5 min before
 * expiry.
 *
 * Design notes:
 *   - In-memory only (lost on OmniRoute restart — that's fine: a cold
 *     start will simply claim a new seat on the first chat).
 *   - No background timer. Lazy refresh on access, exactly like
 *     `circuitBreaker.ts`. Keeps the runtime simple and avoids
 *     coordination with Node's event loop.
 *   - Mutex-per-(connectionId,modelId) prevents the "thundering herd"
 *     of concurrent chats all racing to claim the same seat.
 *
 * @module lib/providers/freebuff/seatCache
 */

import {
  claimFreebuffSession,
  freebuffSessionServerResponseSchema,
  type FreebuffSessionFetchOptions,
} from "./metaService.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FreebuffSeat {
  /** The seat instance id, sent on every chat request as `x-freebuff-instance-id`. */
  instanceId: string;
  /** The model this seat was acquired for. */
  model: string;
  /** Absolute expiry timestamp (ms since epoch). */
  expiresAtMs: number;
  /** When we acquired the seat (ms since epoch) — informational. */
  acquiredAtMs: number;
}

export interface EnsureFreebuffSeatOptions extends FreebuffSessionFetchOptions {
  /** Connection id — scopes the cache. */
  connectionId: string;
  /** Model id to claim the seat for. */
  modelId: string;
  /**
   * Safety margin (ms) subtracted from the seat's TTL on cache read.
   * Default: 5 minutes — the upstream does not extend the TTL on
   * `GET /session` reads, so we proactively refresh before expiry to
   * avoid a chat-side 401 mid-stream.
   */
  refreshMarginMs?: number;
}

// ---------------------------------------------------------------------------
// Internal cache + mutex
// ---------------------------------------------------------------------------

interface CacheEntry {
  seat: FreebuffSeat;
}

/**
 * Keyed by `${connectionId}\0${modelId}` to prevent cross-model bleed.
 * Using a single Map (vs LRU) is fine for our load — the number of
 * distinct (connection, model) tuples is bounded by the number of
 * Freebuff connections × a few models.
 */
const SEAT_CACHE = new Map<string, CacheEntry>();

/**
 * Per-key async lock. In-flight claims for the same `(connection, model)`
 * share a single promise so concurrent chats don't race to claim the
 * same seat. Other `(connection, model)` keys are unaffected.
 */
const SEAT_LOCKS = new Map<string, Promise<FreebuffSeat>>();

function cacheKey(connectionId: string, modelId: string): string {
  return `${connectionId}\0${modelId}`;
}

function isSeatFresh(seat: FreebuffSeat, refreshMarginMs: number, nowMs: number): boolean {
  return seat.expiresAtMs - refreshMarginMs > nowMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a valid seat for `(connectionId, modelId)`, claiming a fresh one
 * from the upstream if the cached seat is missing or about to expire.
 *
 * Idempotent for concurrent callers: in-flight claims share a single
 * upstream request via a per-key mutex.
 */
export async function ensureFreebuffSeat(
  options: EnsureFreebuffSeatOptions,
): Promise<FreebuffSeat> {
  const refreshMarginMs = options.refreshMarginMs ?? 5 * 60 * 1000; // 5 min
  const key = cacheKey(options.connectionId, options.modelId);
  const now = Date.now();

  // Fast path — cache hit + still fresh.
  const cached = SEAT_CACHE.get(key);
  if (cached && isSeatFresh(cached.seat, refreshMarginMs, now)) {
    return cached.seat;
  }

  // Coalesce concurrent claims for the same key.
  const existingLock = SEAT_LOCKS.get(key);
  if (existingLock) return existingLock;

  const claimPromise = (async () => {
    try {
      const seat = await claimSeatFromUpstream(options);
      SEAT_CACHE.set(key, { seat });
      return seat;
    } finally {
      SEAT_LOCKS.delete(key);
    }
  })();

  SEAT_LOCKS.set(key, claimPromise);
  return claimPromise;
}

/**
 * Drop the cached seat for `(connectionId, modelId)`. Call this when:
 *   - the upstream chat returned `status: superseded` (C8: no grace period)
 *   - the upstream chat returned 401 (token expired → also clear other
 *     seats belonging to the same connection; pass `modelId: "*"` to
 *     clear all models for a connection).
 *   - `DELETE /api/v1/freebuff/session` was called explicitly.
 */
export function invalidateFreebuffSeat(connectionId: string, modelId?: string): void {
  if (modelId === undefined) {
    // Clear all seats for the connection.
    const prefix = `${connectionId}\0`;
    for (const key of SEAT_CACHE.keys()) {
      if (key.startsWith(prefix)) SEAT_CACHE.delete(key);
    }
    return;
  }
  SEAT_CACHE.delete(cacheKey(connectionId, modelId));
}

/** Diagnostic — number of cached seats (for tests + observability). */
export function getFreebuffSeatCacheSize(): number {
  return SEAT_CACHE.size;
}

/** Test-only — wipe the entire cache. Never call from production code. */
export function __resetFreebuffSeatCacheForTests(): void {
  SEAT_CACHE.clear();
  SEAT_LOCKS.clear();
}

// ---------------------------------------------------------------------------
// Per-connection chat mutex (C8: serialise the full chat flow)
//
// The seat-claim mutex (`SEAT_LOCKS`) above only coalesces concurrent
// `POST /api/v1/freebuff/session` calls. It does NOT prevent two chat
// requests from racing through the claim + chat-completions window.
//
// Captured in `validation-scripts/final-validations.md` Mission 2 C8:
//   "When B arrives while A is active (same token, same model), A
//    transitions immediately to status: superseded. No grace period."
//
// In-process consequence: if T1 is mid-claim and T2 arrives for the
// same connection, T2's claim either (a) coalesces on T1's seat (same
// instanceId — safe) or (b) races and forces a re-claim (T1 sees
// `superseded` and re-claims — also safe via the retry loop in
// `routeFreebuffChat`).
//
// This second mutex (`CHAT_LOCKS`) is the broader belt-and-braces
// guarantee: serialise the ENTIRE chat flow per `connectionId` so the
// upstream never sees two simultaneous writes for the same token.
// Other connections (different tokens) are unaffected.
//
// Lock granularity: per `connectionId` (= per token). NOT per
// `(connectionId, modelId)` — per the protocol spec the upstream's
// mutex is per token (different models for the same token can also
// conflict via `model_locked`).
// ---------------------------------------------------------------------------

const CHAT_LOCKS = new Map<string, Promise<void>>();

/**
 * Serialise the execution of `fn` against other callers targeting the
 * same `connectionId`. Returns whatever `fn` returns (or rethrows its
 * rejection). Lock is FIFO — concurrent callers wait in arrival order.
 *
 * Usage from `routeFreebuffChat`:
 *
 *   return withFreebuffChatLock(connectionId, async () => {
 *     const seat = await ensureFreebuffSeat({...});
 *     return tryChat(...);
 *   });
 */
export async function withFreebuffChatLock<T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = CHAT_LOCKS.get(connectionId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Chain `previous -> next` and store the chained promise so we can
  // compare identity in the GC step (each `.then` call produces a new
  // promise, so we must keep a reference).
  const chained = previous.then(() => next);
  CHAT_LOCKS.set(connectionId, chained);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    // Garbage-collect the lock if no one is waiting. Use a microtask so
    // we don't delete the entry while another caller is still chaining.
    queueMicrotask(() => {
      if (CHAT_LOCKS.get(connectionId) === chained) {
        CHAT_LOCKS.delete(connectionId);
      }
    });
  }
}

/** Diagnostic — number of held chat locks (for tests + observability). */
export function getFreebuffChatLockCount(): number {
  return CHAT_LOCKS.size;
}

/** Test-only — wipe the chat-mutex state. Never call from production. */
export function __resetFreebuffChatLocksForTests(): void {
  CHAT_LOCKS.clear();
}

// ---------------------------------------------------------------------------
// Internal: claim from upstream
// ---------------------------------------------------------------------------

async function claimSeatFromUpstream(
  options: EnsureFreebuffSeatOptions,
): Promise<FreebuffSeat> {
  const response = await claimFreebuffSession({
    authToken: options.authToken,
    modelId: options.modelId,
    fetcher: options.fetcher,
    signal: options.signal,
  });

  // Validate shape (defense in depth — `claimFreebuffSession` already
  // parses, but the discriminated union narrows the success case).
  const parsed = freebuffSessionServerResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `freebuff.claimSeat: upstream response failed schema validation: ${parsed.error.message}`,
    );
  }

  if (parsed.data.status !== "active") {
    throw new Error(
      `freebuff.claimSeat: upstream returned status="${parsed.data.status}" ` +
        `(expected "active" to obtain a usable seat). ` +
        `Re-auth may be required: run FreebuffOAuthWrapper → Browser OAuth again.`,
    );
  }

  return {
    instanceId: parsed.data.instanceId,
    model: parsed.data.model,
    expiresAtMs: Date.parse(parsed.data.expiresAt),
    acquiredAtMs: Date.now(),
  };
}
