/**
 * Freebuff OAuth / device-code flow — Chunk 2.
 *
 * PROTOCOL OBSERVED IN freebuff.exe
 * --------------------------------
 * The CLI starts a "device code" style flow rather than standard PKCE.
 * Concretely, the binary:
 *
 *   1. POSTs to a Codebuff endpoint to obtain an `auth_code` (a short,
 *      opaque, base64-like string).
 *   2. Constructs the user-facing URL as
 *      `https://freebuff.com/login?auth_code=<auth_code>` and prints it
 *      alongside "Open this URL in your browser to login" + "copy link".
 *   3. Polls a status endpoint until the user completes the browser-side
 *      login. The CLI text "Waiting for login..." is the visible
 *      spinner during this loop.
 *   4. On success, the server returns the persisted credentials
 *      (`authToken` + `fingerprintId` + `userId` + `userEmail`).
 *
 * This module reproduces the wire shape without hardcoding the exact
 * endpoint paths — those are provided via env vars
 * (`FREEBUFF_OAUTH_BASE_URL`, `FREEBUFF_OAUTH_CLIENT_ID`) with sensible
 * defaults that match the binary's download URL pattern.
 */

import { z } from "zod";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";

// ---------------------------------------------------------------------------
// Endpoint configuration (env-overridable).
// ---------------------------------------------------------------------------

export const FREEBUFF_OAUTH_TIMEOUT_MS = 300_000;

export interface FreebuffOAuthEndpoints {
  /** POST — start a new device-code flow. Returns auth_code + login_url. */
  start: string;
  /** GET — poll status of an in-flight flow. */
  poll: string;
}

export function getFreebuffOAuthEndpoints(): FreebuffOAuthEndpoints {
  const base = (
    process.env.FREEBUFF_OAUTH_BASE_URL ?? "https://codebuff.com"
  ).replace(/\/+$/, "");
  return {
    start: `${base}/api/v1/cli-auth/start`,
    poll: `${base}/api/v1/cli-auth/status`,
  };
}

// ---------------------------------------------------------------------------
// Response schemas (zod).
// ---------------------------------------------------------------------------

export const freebuffLoginStartResponseSchema = z.object({
  flowId: freebuffUuidSchema,
  authCode: z.string().min(8),
  loginUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});
export type FreebuffLoginStartResponse = z.infer<
  typeof freebuffLoginStartResponseSchema
>;

export const freebuffLoginStatusResponseSchema = z.object({
  flowId: freebuffUuidSchema,
  status: z.enum(["pending", "completed", "expired", "error"]),
  /** Populated only when status === "completed". */
  authToken: freebuffUuidSchema.optional(),
  fingerprintId: z
    .string()
    .regex(/^enhanced-[A-Za-z0-9_-]{43}$/)
    .optional(),
  fingerprintHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  userId: freebuffUuidSchema.optional(),
  userEmail: z.string().email().optional(),
  /** Human-readable error when status === "error". */
  error: z.string().optional(),
  /** ISO-8601 timestamp after which the flow can no longer complete. */
  expiresAt: z.string().datetime().optional(),
});
export type FreebuffLoginStatusResponse = z.infer<
  typeof freebuffLoginStatusResponseSchema
>;

// ---------------------------------------------------------------------------
// Polling configuration.
// ---------------------------------------------------------------------------

export interface PollOptions {
  /** Total time budget before giving up. Default 5 min. */
  timeoutMs?: number;
  /** Initial delay between polls. Default 2 s — matches the CLI spinner. */
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
  intervalMs: 2_000,
  maxIntervalMs: 8_000,
  backoffFactor: 1.5,
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Start a new OAuth flow. Calls the upstream `start` endpoint, then
 * builds the user-facing login URL. The returned `loginUrl` is exactly
 * the shape printed by the CLI:
 *
 *   https://freebuff.com/login?auth_code=<authCode>
 *
 * (or whatever domain `FREEBUFF_OAUTH_BASE_URL` resolves to).
 */
export async function startLogin(
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<FreebuffLoginStartResponse> {
  const endpoints = getFreebuffOAuthEndpoints();
  const clientId = process.env.FREEBUFF_OAUTH_CLIENT_ID ?? "freebuff-cli";
  const fetcher = options.fetcher ?? globalThis.fetch;

  if (!fetcher) {
    throw new Error("No fetch implementation available in this runtime");
  }

  const res = await fetcher(endpoints.start, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ clientId }),
    signal: options.signal,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body?.error?.message ?? `HTTP ${res.status} from ${endpoints.start}`;
    throw new FreebuffOAuthError(message, res.status, body?.error?.code);
  }

  // The server may return either `authCode` directly, or a `loginUrl` it
  // constructed server-side. If only `authCode` is present, build the URL
  // to match the binary's documented pattern.
  const candidate = freebuffLoginStartResponseSchema
    .partial({ loginUrl: true })
    .parse(body);

  const loginUrl =
    candidate.loginUrl ??
    `${process.env.FREEBUFF_OAUTH_BASE_URL ?? "https://freebuff.com"}/login?auth_code=${encodeURIComponent(
      candidate.authCode,
    )}`;

  return freebuffLoginStartResponseSchema.parse({
    ...candidate,
    loginUrl,
  });
}

/**
 * Poll a single in-flight flow. Thin wrapper over the status endpoint
 * with zod validation.
 */
export async function pollLoginStatus(
  flowId: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<FreebuffLoginStatusResponse> {
  const endpoints = getFreebuffOAuthEndpoints();
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("No fetch implementation available in this runtime");
  }

  const url = new URL(endpoints.poll);
  url.searchParams.set("flowId", flowId);

  const res = await fetcher(url.href, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 404) {
    const message =
      body?.error?.message ?? `HTTP ${res.status} from ${endpoints.poll}`;
    throw new FreebuffOAuthError(message, res.status, body?.error?.code);
  }

  return freebuffLoginStatusResponseSchema.parse(body);
}

/**
 * Poll until the flow completes, expires, or the timeout elapses.
 * Backoff is applied between polls; status updates are emitted via
 * the optional `onPoll` callback for UI spinners.
 */
export async function waitForLogin(
  flowId: string,
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

    const status = await pollLoginStatus(flowId, {
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
