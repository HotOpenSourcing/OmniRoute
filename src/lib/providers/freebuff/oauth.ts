/**
 * Freebuff OAuth / device-code flow.
 *
 * PROTOCOL OBSERVED IN codebuff/freebuff CLI
 * -----------------------------------------
 * The CLI starts a device-code style flow (no standard PKCE). Static
 * analysis of the monorepo at `~/.config/manicode/codebuff` (rapport
 * `rapport-architecture-reseau-avance.md` §5.3 + `rapport-architecture-
 * freebuff.md` §3.3) confirms the wire shape:
 *
 *   1. POST `/api/auth/cli/code` with `{ fingerprintId }` → server returns
 *      `{ loginUrl, fingerprintHash, expiresAt }`.
 *   2. User opens `loginUrl` in browser and completes Codebuff login.
 *   3. CLI polls `GET /api/auth/cli/status?fingerprintId&fingerprintHash
 *      &expiresAt` every 5 s for up to 5 min.
 *   4. On success, server returns
 *      `{ status: "completed", user: { authToken, fingerprintId,
 *      fingerprintHash, userId, userEmail } }`.
 *
 * The endpoints are env-overridable via `FREEBUFF_OAUTH_BASE_URL` (default
 * `https://www.codebuff.com`); for the free tier, use the same domain —
 * Freebuff's API is served from the Codebuff domain.
 *
 * Module conventions:
 * - Bearer auth happens at the call sites (Phase 5), not here.
 * - The `fingerprintId` is computed upstream by `fingerprint.ts`.
 * - Errors thrown as `FreebuffOAuthError` carry `(status, code)` so callers
 *   can branch on `country_blocked`, `rate_limited`, etc.
 */

import { z } from "zod";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";

// ---------------------------------------------------------------------------
// Endpoint configuration (env-overridable).
// ---------------------------------------------------------------------------

export const FREEBUFF_OAUTH_TIMEOUT_MS = 300_000;

/** Default poll cadence — matches the CLI spinner (5 s between polls). */
export const FREEBUFF_OAUTH_POLL_INTERVAL_MS = 5_000;

export interface FreebuffOAuthEndpoints {
  /** POST — start a new device-code flow. */
  code: string;
  /** GET — poll status of an in-flight flow. */
  status: string;
}

export function getFreebuffOAuthEndpoints(): FreebuffOAuthEndpoints {
  const base = (
    process.env.FREEBUFF_OAUTH_BASE_URL ?? "https://www.codebuff.com"
  ).replace(/\/+$/, "");
  return {
    code: `${base}/api/auth/cli/code`,
    status: `${base}/api/auth/cli/status`,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint triple — what callers must persist across the device-code flow.
// ---------------------------------------------------------------------------

export interface FreebuffFingerprintTriple {
  fingerprintId: string;
  /** SHA-256 hex (64 chars) returned by `startLogin`. */
  fingerprintHash: string;
  /** ISO-8601 timestamp after which the flow expires. */
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Response schemas (zod).
// ---------------------------------------------------------------------------

export const freebuffLoginStartResponseSchema = z.object({
  /** URL the user must open in a browser to complete the login. */
  loginUrl: z.string().url(),
  /** Server-returned fingerprint hash; required for status polling. */
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** ISO-8601 timestamp after which the flow expires. */
  expiresAt: z.string().datetime(),
});
export type FreebuffLoginStartResponse = z.infer<
  typeof freebuffLoginStartResponseSchema
>;

const freebuffLoginPendingSchema = z.object({
  status: z.literal("pending"),
});

const freebuffLoginExpiredSchema = z.object({
  status: z.literal("expired"),
});

const freebuffLoginCompletedSchema = z.object({
  status: z.literal("completed"),
  user: z.object({
    authToken: freebuffUuidSchema,
    fingerprintId: z.string().min(1),
    fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
    userId: freebuffUuidSchema,
    userEmail: z.string().email(),
  }),
});

const freebuffLoginErrorSchema = z.object({
  status: z.literal("error"),
  /** Human-readable error message. */
  error: z.string(),
});

export const freebuffLoginStatusResponseSchema = z.discriminatedUnion(
  "status",
  [
    freebuffLoginPendingSchema,
    freebuffLoginExpiredSchema,
    freebuffLoginCompletedSchema,
    freebuffLoginErrorSchema,
  ],
);
export type FreebuffLoginStatusResponse = z.infer<
  typeof freebuffLoginStatusResponseSchema
>;

// ---------------------------------------------------------------------------
// Polling configuration.
// ---------------------------------------------------------------------------

export interface PollOptions {
  /** Total time budget before giving up. Default 5 min. */
  timeoutMs?: number;
  /** Initial delay between polls. Default 5 s — matches the CLI spinner. */
  intervalMs?: number;
  /** Cap on the polling interval (exponential backoff ceiling). */
  maxIntervalMs?: number;
  /** Multiplier applied to `intervalMs` after each "pending" response. */
  backoffFactor?: number;
  /** Optional abort signal — typically the request `signal`. */
  signal?: AbortSignal;
  /** Inject a custom fetch (tests use this to mock the HTTP layer). */
  fetcher?: typeof fetch;
}

const DEFAULT_POLL: Required<Omit<PollOptions, "signal" | "fetcher">> = {
  timeoutMs: FREEBUFF_OAUTH_TIMEOUT_MS,
  intervalMs: FREEBUFF_OAUTH_POLL_INTERVAL_MS,
  maxIntervalMs: 16_000,
  backoffFactor: 1.5,
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export interface StartLoginOptions {
  /** Fingerprint id computed upstream by `fingerprint.ts`. */
  fingerprintId: string;
  /** Inject a custom fetch (tests use this to mock the HTTP layer). */
  fetcher?: typeof fetch;
  /** Optional abort signal — typically the request `signal`. */
  signal?: AbortSignal;
}

/**
 * Start a new OAuth flow. POSTs the fingerprint id to the upstream `code`
 * endpoint and returns the login URL + fingerprint hash that the caller
 * must persist for the subsequent status poll.
 */
export async function startLogin(
  options: StartLoginOptions,
): Promise<FreebuffLoginStartResponse> {
  const endpoints = getFreebuffOAuthEndpoints();
  const fetcher = options.fetcher ?? globalThis.fetch;

  if (!fetcher) {
    throw new Error("No fetch implementation available in this runtime");
  }

  const res = await fetcher(endpoints.code, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ fingerprintId: options.fingerprintId }),
    signal: options.signal,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body?.error?.message ?? `HTTP ${res.status} from ${endpoints.code}`;
    throw new FreebuffOAuthError(message, res.status, body?.error?.code);
  }

  return freebuffLoginStartResponseSchema.parse(body);
}

export interface PollLoginStatusOptions {
  /** Inject a custom fetch (tests use this to mock the HTTP layer). */
  fetcher?: typeof fetch;
  /** Optional abort signal — typically the request `signal`. */
  signal?: AbortSignal;
}

/**
 * Poll the status endpoint once. The caller must keep the `fingerprintHash`
 * and `expiresAt` returned by `startLogin` for the lifetime of the flow.
 */
export async function pollLoginStatus(
  triple: FreebuffFingerprintTriple,
  options: PollLoginStatusOptions = {},
): Promise<FreebuffLoginStatusResponse> {
  const endpoints = getFreebuffOAuthEndpoints();
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("No fetch implementation available in this runtime");
  }

  const url = new URL(endpoints.status);
  url.searchParams.set("fingerprintId", triple.fingerprintId);
  url.searchParams.set("fingerprintHash", triple.fingerprintHash);
  url.searchParams.set("expiresAt", triple.expiresAt);

  const res = await fetcher(url.href, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 404) {
    const message =
      body?.error?.message ?? `HTTP ${res.status} from ${endpoints.status}`;
    throw new FreebuffOAuthError(message, res.status, body?.error?.code);
  }

  return freebuffLoginStatusResponseSchema.parse(body);
}

/**
 * Poll until the flow completes, expires, or the timeout elapses.
 * Backoff is applied between polls.
 */
export async function waitForLogin(
  triple: FreebuffFingerprintTriple,
  options: PollOptions = {},
): Promise<FreebuffLoginStatusResponse> {
  const opts = { ...DEFAULT_POLL, ...options };
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("No fetch implementation available in this runtime");
  }

  const start = Date.now();
  let interval = opts.intervalMs;

  while (true) {
    if (options.signal?.aborted) {
      throw new FreebuffOAuthError("Polling aborted", 0, "aborted");
    }
    if (Date.now() - start > opts.timeoutMs) {
      throw new FreebuffOAuthError(
        `Login flow did not complete within ${opts.timeoutMs} ms`,
        0,
        "timeout",
      );
    }

    const status = await pollLoginStatus(triple, {
      fetcher,
      signal: options.signal,
    });

    if (status.status !== "pending") return status;

    await sleep(interval, options.signal);

    interval = Math.min(
      opts.maxIntervalMs,
      Math.round(interval * opts.backoffFactor),
    );
  }
}

// ---------------------------------------------------------------------------
// Error type.
// ---------------------------------------------------------------------------

export class FreebuffOAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "FreebuffOAuthError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FreebuffOAuthError("Aborted", 0, "aborted"));
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new FreebuffOAuthError("Aborted", 0, "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
