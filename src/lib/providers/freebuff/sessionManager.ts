/**
 * Freebuff session manager — mutex + cached seat + pre-expiry refresh.
 *
 * Implements the session lifecycle validated against the live Codebuff
 * backend (`~/.config/manicode/freebuff-model-tests/validation-scripts/
 * final-validations.md` §1, §2, §6).
 *
 * Behaviour matrix (per token + model):
 *
 *   - Mutex granularity: per `authToken` (NOT per `(token, model)`).
 *     Two different models for the same token can also conflict
 *     server-side via `model_locked` (C8), so we serialise the whole
 *     token's session acquisitions behind one promise queue.
 *
 *   - Seat TTL: 1 hour flat (`expiresAt = admittedAt + 3 600 000 ms`,
 *     see C5). We schedule a proactive refresh at `expiresAt - 5 min`
 *     so the caller never observes an `ended → none` gap.
 *
 *   - `superseded`: the server transitions an active row to
 *     `superseded` the moment a new POST arrives (C8, no grace period).
 *     We invalidate the cached seat in this case and re-POST.
 *
 *   - 401: the auth token itself expired (TTL ~1h, C6). Surfaced as
 *     `FreebuffAuthError` so the caller can route to a re-auth flow.
 *
 * @module lib/providers/freebuff/sessionManager
 */

import {
  acquireFreebuffSlot,
  releaseFreebuffSlot,
  type FreebuffSessionStatus,
  FreebuffAuthError,
} from "./quota.ts";

/** Default pre-expiry refresh lead — refresh 5 min before `expiresAt`. */
export const FREEBUFF_DEFAULT_REFRESH_LEAD_MS = 5 * 60 * 1000;

/** Default fallback TTL when the server does not return `expiresAt`
 *  (rare — defensive only). Matches the measured 1 h flat (C5). */
export const FREEBUFF_DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface SessionEntry {
  /** The seat UUID returned by `POST /session`. Stamped on the
   *  `x-freebuff-instance-id` header for chat calls. */
  instanceId: string;
  /** Echoes the model that the seat was acquired for. */
  model: string;
  /** Unix ms when the seat becomes invalid. */
  expiresAt: number;
  /** Unix ms when the seat was acquired. */
  acquiredAt: number;
  /** Last-known `accessTier` from the server (informational). */
  accessTier?: "full" | "limited";
}

export interface SessionManagerOptions {
  /** Pre-expiry refresh lead in ms. Default 5 min. */
  refreshLeadMs?: number;
  /** Fallback TTL when `expiresAt` is missing from the server. */
  fallbackTtlMs?: number;
  /** Optional callback fired after a successful proactive refresh. */
  onRefresh?: (token: string, model: string, entry: SessionEntry) => void;
  /** Optional callback fired when a seat is invalidated (e.g. superseded). */
  onInvalidate?: (
    token: string,
    model: string,
    reason: "superseded" | "released" | "auth_expired",
  ) => void;
}

export interface AcquireSessionArgs {
  /** The Freebuff `authToken` (Bearer). */
  authToken: string;
  /** The model id to seat (e.g. "deepseek/deepseek-v4-flash"). */
  model: string;
  /** Fingerprint triple for the SDK contract headers. */
  fingerprint?: { fingerprintId: string; fingerprintHash?: string };
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Abort signal — propagated to the underlying fetch. */
  signal?: AbortSignal;
}

export type SessionManagerErrorCode =
  | FreebuffSessionStatus
  | "auth_expired"
  | "no_instance"
  | "aborted";

export class FreebuffSessionManagerError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: SessionManagerErrorCode,
  ) {
    super(message);
    this.name = "FreebuffSessionManagerError";
  }
}

interface InternalState {
  /** Per-token cache: `model → SessionEntry`. */
  seats: Map<string, SessionEntry>;
  /** Per-token mutex chain head (Promise<void>). */
  mutex: Promise<unknown>;
  /** Refresh timers keyed by `${token}::${model}`. */
  refreshTimers: Map<string, NodeJS.Timeout>;
}

export class FreebuffSessionManager {
  private readonly states = new Map<string, InternalState>();
  private readonly options: Required<
    Pick<SessionManagerOptions, "refreshLeadMs" | "fallbackTtlMs">
  > &
    Pick<SessionManagerOptions, "onRefresh" | "onInvalidate">;

  constructor(options: SessionManagerOptions = {}) {
    this.options = {
      refreshLeadMs: options.refreshLeadMs ?? FREEBUFF_DEFAULT_REFRESH_LEAD_MS,
      fallbackTtlMs: options.fallbackTtlMs ?? FREEBUFF_DEFAULT_TTL_MS,
      onRefresh: options.onRefresh,
      onInvalidate: options.onInvalidate,
    };
  }

  /** Returns the cached seat for `(token, model)` without acquiring a
   *  new one. `null` when no seat is cached or it has expired. */
  peek(token: string, model: string): SessionEntry | null {
    const seat = this.states.get(token)?.seats.get(model);
    if (!seat) return null;
    if (seat.expiresAt <= Date.now()) return null;
    return seat;
  }

  /** Returns a fresh-or-cached seat. Throws `FreebuffSessionManagerError`
   *  on `model_locked`, `rate_limited`, `country_blocked`, `banned`,
   *  `disabled`. Throws `FreebuffAuthError` on 401. */
  async acquireSession(args: AcquireSessionArgs): Promise<SessionEntry> {
    return this.withMutex(args.authToken, async () => {
      if (args.signal?.aborted) {
        throw new FreebuffSessionManagerError(
          "aborted before acquire",
          0,
          "aborted",
        );
      }

      const state = this.getState(args.authToken);
      const cached = state.seats.get(args.model);
      const now = Date.now();
      if (cached && cached.expiresAt - this.options.refreshLeadMs > now) {
        return cached;
      }

      let slot: Awaited<ReturnType<typeof acquireFreebuffSlot>>;
      try {
        slot = await acquireFreebuffSlot(args.authToken, args.model, {
          fetchImpl: args.fetchImpl,
          fingerprint: args.fingerprint,
          signal: args.signal,
        });
      } catch (err) {
        // 401 is a typed error — propagate as-is so the caller can
        // route to a re-auth flow.
        if (err instanceof FreebuffAuthError) {
          this.invalidateAll(args.authToken, "auth_expired");
          throw err;
        }
        throw err;
      }

      if (slot.status !== "active" || !slot.instanceId) {
        throw new FreebuffSessionManagerError(
          `freebuff: refused seat for model=${args.model}: ${slot.status}`,
          // 409 for model_locked / model_unavailable, 429 for
          // rate_limited, 403 for country_blocked / banned, 410 for
          // disabled. The exact mapping mirrors the SDK binary.
          slot.status === "model_locked" ||
          slot.status === "model_unavailable"
            ? 409
            : slot.status === "rate_limited"
              ? 429
              : slot.status === "country_blocked" ||
                  slot.status === "banned"
                ? 403
                : slot.status === "disabled"
                  ? 410
                  : 503,
          slot.status,
        );
      }

      const entry: SessionEntry = {
        instanceId: slot.instanceId,
        model: args.model,
        expiresAt:
          typeof slot.expiresAt === "number" && slot.expiresAt > now
            ? slot.expiresAt
            : now + this.options.fallbackTtlMs,
        acquiredAt: now,
      };
      state.seats.set(args.model, entry);
      this.armRefresh(args.authToken, args.model, entry);
      return entry;
    });
  }

  /**
   * Release the seat for `(token, model)`. Best-effort: fires a
   * DELETE upstream and clears the cache so the next `acquireSession`
   * starts a fresh row.
   *
   * Note: the `superseded` lifecycle does NOT go through this path —
   * it is detected implicitly when the next POST returns a new
   * `instanceId` differing from the cached one. We do, however, call
   * `invalidate` here so `peek()` returns null until the next acquire.
   */
  async releaseSession(args: {
    authToken: string;
    model: string;
    instanceId?: string;
    fingerprint?: { fingerprintId: string; fingerprintHash?: string };
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  }): Promise<void> {
    await releaseFreebuffSlot(args.authToken, {
      fetchImpl: args.fetchImpl,
      instanceId: args.instanceId,
      fingerprint: args.fingerprint,
      signal: args.signal,
    });
    this.invalidate(args.authToken, args.model, "released");
  }

  /**
   * Drop the cached seat for `(token, model)`. Called when the caller
   * observes a 4xx from the chat endpoint (stale instance) or when the
   * mutex detects a `superseded` transition (caller passes the new
   * instanceId from the POST response, which differs from cached).
   */
  invalidate(
    token: string,
    model: string,
    reason: "superseded" | "released" | "auth_expired" = "released",
  ): void {
    const state = this.states.get(token);
    if (!state) return;
    if (state.seats.delete(model)) {
      this.options.onInvalidate?.(token, model, reason);
    }
    const key = `${token}::${model}`;
    const timer = state.refreshTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      state.refreshTimers.delete(key);
    }
  }

  /** Drop all cached seats for `token`. Used on 401. */
  invalidateAll(
    token: string,
    reason: "superseded" | "released" | "auth_expired" = "released",
  ): void {
    const state = this.states.get(token);
    if (!state) return;
    const models = [...state.seats.keys()];
    for (const model of models) {
      this.invalidate(token, model, reason);
    }
  }

  /** Drop everything (test seam). */
  reset(): void {
    for (const state of this.states.values()) {
      for (const timer of state.refreshTimers.values()) clearTimeout(timer);
      state.refreshTimers.clear();
      state.seats.clear();
    }
    this.states.clear();
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  private getState(token: string): InternalState {
    let state = this.states.get(token);
    if (!state) {
      state = {
        seats: new Map(),
        mutex: Promise.resolve(),
        refreshTimers: new Map(),
      };
      this.states.set(token, state);
    }
    return state;
  }

  private withMutex<T>(token: string, fn: () => Promise<T>): Promise<T> {
    const state = this.getState(token);
    const prev = state.mutex;
    // Chain the new work behind the previous one; the `.then(_,
    // _)` runs `fn` regardless of how the previous step resolved so
    // a single rejection does not stall the queue.
    const next = prev.then(
      () => fn(),
      () => fn(),
    );
    // Advance the queue head with a never-rejecting wrapper so the
    // NEXT caller sees a settled promise (and does not pile on top
    // of a stale rejection).
    state.mutex = next.catch(() => undefined);
    return next;
  }

  private armRefresh(token: string, model: string, entry: SessionEntry): void {
    const state = this.getState(token);
    const key = `${token}::${model}`;
    const previous = state.refreshTimers.get(key);
    if (previous) clearTimeout(previous);

    const delay = Math.max(0, entry.expiresAt - Date.now() - this.options.refreshLeadMs);
    if (delay <= 0) {
      // Already past the refresh window — schedule immediately on the
      // next tick so we do not busy-loop.
      const timer = setTimeout(() => {
        void this.proactiveRefresh(token, model);
      }, 0);
      this.unrefTimer(timer);
      state.refreshTimers.set(key, timer);
      return;
    }

    const timer = setTimeout(() => {
      void this.proactiveRefresh(token, model);
    }, delay);
    this.unrefTimer(timer);
    state.refreshTimers.set(key, timer);
  }

  private async proactiveRefresh(token: string, model: string): Promise<void> {
    try {
      const entry = await this.acquireSession({ authToken: token, model });
      this.options.onRefresh?.(token, model, entry);
    } catch {
      // Swallow — the next user-driven acquire will retry.
    }
  }

  private unrefTimer(timer: NodeJS.Timeout): void {
    // Node typings expose `unref` only on Timeout, not on the union
    // returned by `setTimeout` in lib.dom. Guard at runtime.
    const t = timer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }
}

// ---------------------------------------------------------------------------
// Default singleton.
// ---------------------------------------------------------------------------

/**
 * The default module-level singleton. Production code should use this
 * so concurrent OmniRoute requests share the same seat cache + mutex
 * queue. Tests should construct their own `FreebuffSessionManager`
 * instance to isolate state.
 */
export const freebuffSessionManager = new FreebuffSessionManager();
