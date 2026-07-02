import { z } from "zod";
import { generatePKCE } from "../utils/pkce";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";
import { resolveFreebuffBaseUrl } from "@/lib/providers/freebuff/base";

export const FREEBUFF_OAUTH_CONFIG = {
  id: "freebuff",
  alias: "fb",
  name: "Freebuff (Codebuff Free Tier)",
  authorizeUrl: "https://www.codebuff.com/api/auth/cli/code",
  tokenUrl: "https://www.codebuff.com/api/auth/cli/status",
  logoutUrl: "https://www.codebuff.com/api/auth/cli/logout",
  meUrl: "https://www.codebuff.com/api/v1/me",
  sessionUrl: "https://www.codebuff.com/api/v1/freebuff/session",
  streakUrl: "https://www.codebuff.com/api/v1/freebuff/streak",
  clientId: "codebuff-cli",
  pollIntervalMs: 2000,
  pollTimeoutMs: 300000,
} as const;

/**
 * Returns the OAuth authorize endpoint for the current tier.
 * Honors `FREEBUFF_TIER` (defaults to `free` → freebuff.com).
 */
function resolveAuthorizeUrl(): string {
  const base = resolveFreebuffBaseUrl().replace(/\/$/, "");
  return `${base}/api/auth/cli/code`;
}

/**
 * Returns the OAuth token/status endpoint for the current tier.
 */
function resolveTokenUrl(): string {
  const base = resolveFreebuffBaseUrl().replace(/\/$/, "");
  return `${base}/api/auth/cli/status`;
}

export const freebuffTokenSchema = z.object({
  authToken: freebuffUuidSchema,
  userId: freebuffUuidSchema.optional(),
  email: z.string().email().optional(),
});
export type FreebuffToken = z.infer<typeof freebuffTokenSchema>;

export const freebuffPollStatusSchema = z.enum([
  "pending",
  "success",
  "expired",
  "error",
]);
export type FreebuffPollStatus = z.infer<typeof freebuffPollStatusSchema>;

export const freebuffPollResponseSchema = z.object({
  status: freebuffPollStatusSchema,
  authToken: freebuffUuidSchema.optional(),
  userId: freebuffUuidSchema.optional(),
  email: z.string().email().optional(),
  error: z.string().optional(),
});
export type FreebuffPollResponse = z.infer<typeof freebuffPollResponseSchema>;

/**
 * Freebuff (Codebuff) OAuth Provider — PKCE polling flow.
 *
 * Auth flow:
 *   1. POST /api/auth/cli/code { fingerprintId, codeChallenge, state, clientId }
 *      → { loginUrl, fingerprintHash, expiresAt, flowId? }
 *   2. User opens loginUrl in browser → completes OAuth at codebuff.com
 *   3. GET /api/auth/cli/status?fingerprintId=...&fingerprintHash=...&expiresAt=...
 *      → { status: "pending"|"success"|"expired"|"error", authToken?, userId?, email? }
 *
 * Note: fingerprintId is derived from server-side hardware and may not match
 * the user's local CLI fingerprint. UI must surface the "paste credentials.json"
 * fallback when PKCE polling returns status "error" or auth fails.
 */

export interface FreebuffDeviceCodeResponse {
  flowId: string;
  loginUrl: string;
  fingerprintHash: string;
  expiresAt: number;
}

export interface FreebuffPollOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface FreebuffRequestDeviceCodeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Sleep helper that respects an AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Default sleep wrapper: uses the internal sleep() helper.
 */
function defaultSleepFn(ms: number): Promise<void> {
  return sleep(ms);
}

export const freebuff = {
  config: FREEBUFF_OAUTH_CONFIG,
  flowType: "pkce_polling" as const,

  /**
   * Not supported: freebuff uses PKCE polling (requestDeviceCode + pollToken),
   * not redirect-based OAuth.
   */
  buildAuthUrl: (): string => {
    throw new Error(
      "freebuff.buildAuthUrl: not supported. Freebuff uses PKCE polling; " +
        "call requestDeviceCode(config, fingerprintId) to start the flow.",
    );
  },

  /**
   * Start the PKCE polling flow against /api/auth/cli/code.
   * The server returns a loginUrl that the user opens in their browser,
   * plus a fingerprintHash and expiresAt used for subsequent polling.
   */
  requestDeviceCode: async (
    config: typeof FREEBUFF_OAUTH_CONFIG,
    fingerprintId: string,
    options: FreebuffRequestDeviceCodeOptions = {},
  ): Promise<FreebuffDeviceCodeResponse> => {
    const doFetch = options.fetchImpl ?? fetch;
    const pkce = generatePKCE();

    let response: Response;
    try {
      response = await doFetch(resolveAuthorizeUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          fingerprintId,
          codeChallenge: pkce.codeChallenge,
          state: pkce.state,
          clientId: config.clientId,
        }),
        signal: options.signal,
      });
    } catch (err) {
      throw new Error(
        `freebuff.requestDeviceCode: network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `freebuff.requestDeviceCode failed: HTTP ${response.status} ${
          response.statusText
        } ${errorText}`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (
      typeof data.loginUrl !== "string" ||
      typeof data.fingerprintHash !== "string" ||
      typeof data.expiresAt !== "number"
    ) {
      throw new Error(
        "freebuff.requestDeviceCode: response missing required fields " +
          "(loginUrl, fingerprintHash, expiresAt)",
      );
    }

    return {
      flowId:
        typeof data.flowId === "string"
          ? data.flowId
          : `${fingerprintId}:${data.expiresAt}`,
      loginUrl: data.loginUrl,
      fingerprintHash: data.fingerprintHash,
      expiresAt: data.expiresAt,
    };
  },

  /**
   * Poll /api/auth/cli/status until the user completes OAuth, the device
   * code expires, or the pollTimeoutMs budget is exhausted.
   *
   * Backoff: starts at config.pollIntervalMs (2 s default), grows by ×1.5
   * per attempt, capped at 10 s.
   */
  pollToken: async (
    config: typeof FREEBUFF_OAUTH_CONFIG,
    _flowId: string,
    fingerprintId: string,
    fingerprintHash: string,
    expiresAt: number,
    options: FreebuffPollOptions = {},
  ): Promise<FreebuffPollResponse> => {
    const doFetch = options.fetchImpl ?? fetch;
    const now = options.now ?? Date.now;
    const sleepFn = options.sleepFn ?? defaultSleepFn;
    const deadline = now() + config.pollTimeoutMs;
    const baseInterval = config.pollIntervalMs;
    const maxInterval = 10_000;

    let attempt = 0;

    while (now() < deadline) {
      if (options.signal?.aborted) {
        return { status: "error", error: "aborted" };
      }

      const url = new URL(resolveTokenUrl());
      url.searchParams.set("fingerprintId", fingerprintId);
      url.searchParams.set("fingerprintHash", fingerprintHash);
      url.searchParams.set("expiresAt", String(expiresAt));

      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: options.signal,
        });
      } catch {
        // Network error: retry with backoff
        attempt++;
        await sleepFn(
          Math.min(baseInterval * Math.pow(1.5, attempt - 1), maxInterval),
        );
        continue;
      }

      if (response.status === 410) {
        return { status: "expired", error: "Device code expired" };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: "error",
          error: `Authentication failed (HTTP ${response.status})`,
        };
      }

      if (response.ok) {
        const raw = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const parsed = freebuffPollResponseSchema.safeParse(raw);
        if (parsed.success) {
          if (parsed.data.status !== "pending") {
            return parsed.data;
          }
          // status === "pending" → continue polling
        }
        // Schema mismatch: treat as pending and continue
      }

      attempt++;
      await sleepFn(
        Math.min(baseInterval * Math.pow(1.5, attempt - 1), maxInterval),
      );
    }

    return { status: "expired", error: "Poll timeout exceeded" };
  },

  mapTokens: (raw: FreebuffToken) => ({
    access_token: raw.authToken,
    token_type: "Bearer" as const,
    user_id: raw.userId,
    email: raw.email,
  }),
};
