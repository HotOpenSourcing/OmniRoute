import { z } from "zod";
import { generatePKCE } from "../utils/pkce";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";
import { resolveFreebuffBaseUrl } from "@/lib/providers/freebuff/base";
import { generateFreebuffFingerprint } from "../freebuff/fingerprint";

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
 *
 * The provider object exposes the **standard OAuth v2 device_code** surface so
 * the shared OAuthModal and `/api/oauth/[provider]/[action]` route work without
 * special-casing Freebuff: `requestDeviceCode(config, codeChallenge, options)`
 * and `pollToken(config, deviceCode, codeVerifier, extraData, options)`.
 *
 * The polling parameters (fingerprintId / fingerprintHash / expiresAt) are
 * serialized into the `deviceCode` string returned by `requestDeviceCode` so
 * `pollToken` can decode and resume the same upstream poll loop. This matches
 * the Kiro / GitHub / Qwen pattern used by every other device_code provider.
 */

/** Options accepted by `requestDeviceCode` for testability + tracing. */
export interface FreebuffRequestDeviceCodeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /**
   * Override the locally-derived fingerprintId. Production callers leave this
   * undefined so the server-side hardware snapshot is used. Tests inject a
   * deterministic value to avoid touching `node-machine-id` (native binding).
   */
  fingerprintIdOverride?: string;
}

/** Options accepted by `pollToken` for testability + tracing. */
export interface FreebuffPollOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

/** Wire shape returned by the upstream /api/auth/cli/code endpoint. */
export interface FreebuffDeviceCodeWireResponse {
  flowId?: string;
  loginUrl: string;
  fingerprintHash: string;
  expiresAt: number;
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

/**
 * Serialize the upstream polling parameters into the opaque `deviceCode`
 * string that the standard OAuth v2 device_code protocol hands back to the
 * client. The client echoes this value to `pollToken` verbatim, where we
 * decode it and resume the upstream polling loop.
 */
interface FreebuffDeviceCodePayload {
  fingerprintId: string;
  fingerprintHash: string;
  expiresAt: number;
}

function encodeDeviceCode(payload: FreebuffDeviceCodePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeDeviceCode(deviceCode: string): FreebuffDeviceCodePayload {
  try {
    const json = Buffer.from(deviceCode, "base64url").toString("utf8");
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof obj.fingerprintId === "string" &&
      typeof obj.fingerprintHash === "string" &&
      typeof obj.expiresAt === "number"
    ) {
      return obj as unknown as FreebuffDeviceCodePayload;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    "freebuff.pollToken: deviceCode is not a Freebuff-issued token (invalid base64url payload).",
  );
}

/**
 * Internal: POST /api/auth/cli/code with the PKCE pair + server-derived
 * fingerprintId. Returns the wire shape from the upstream. Kept as a named
 * function so it can be exercised by unit tests without going through the
 * provider-object indirection.
 */
export async function startFreebuffDeviceCode(
  config: typeof FREEBUFF_OAUTH_CONFIG,
  options: FreebuffRequestDeviceCodeOptions = {},
): Promise<FreebuffDeviceCodeWireResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const pkce = generatePKCE();
  const fingerprintId =
    options.fingerprintIdOverride ?? generateFreebuffFingerprint().fingerprintId;

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
      `freebuff.startFreebuffDeviceCode: network error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `freebuff.startFreebuffDeviceCode failed: HTTP ${response.status} ${
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
      "freebuff.startFreebuffDeviceCode: response missing required fields " +
        "(loginUrl, fingerprintHash, expiresAt)",
    );
  }

  return {
    flowId: typeof data.flowId === "string" ? data.flowId : undefined,
    loginUrl: data.loginUrl,
    fingerprintHash: data.fingerprintHash,
    expiresAt: data.expiresAt,
  };
}

/**
 * Internal: poll the upstream /api/auth/cli/status endpoint until success,
 * expiry, error, or timeout. Returns the same wire shape as the upstream.
 * Exposed as a named function so unit tests can drive it without the
 * provider object indirection.
 */
export async function pollFreebuffDeviceCode(
  config: typeof FREEBUFF_OAUTH_CONFIG,
  payload: FreebuffDeviceCodePayload,
  options: FreebuffPollOptions = {},
): Promise<FreebuffPollResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleepFn = options.sleepFn ?? defaultSleepFn;
  const deadline = now() + config.pollTimeoutMs;
  const baseInterval = config.pollIntervalMs;
  const maxInterval = 10_000;
  const { fingerprintId, fingerprintHash, expiresAt } = payload;

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
      attempt++;
      await sleepFn(Math.min(baseInterval * Math.pow(1.5, attempt - 1), maxInterval));
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
      }
    }

    attempt++;
    await sleepFn(Math.min(baseInterval * Math.pow(1.5, attempt - 1), maxInterval));
  }

  return { status: "expired", error: "Poll timeout exceeded" };
}

/**
 * Internal: best-effort parse of the pasted text into a FreebuffToken. Used by
 * `mapTokens` (import-token path) so the same logic can be unit-tested
 * independently from the connection-shaping concerns.
 */
export function parseFreebuffPastedCredentials(
  pasted: string,
): FreebuffToken {
  const trimmed = pasted?.trim() ?? "";
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      const result = freebuffTokenSchema.safeParse(obj);
      if (result.success) return result.data;
    } catch {
      /* fall through to bare-token path */
    }
  }
  return { authToken: trimmed };
}

export const freebuff = {
  config: FREEBUFF_OAUTH_CONFIG,
  /**
   * Freebuff participates in the standard OAuth v2 device_code protocol so the
   * shared `OAuthModal` and `/api/oauth/[provider]/[action]` route drive it
   * without special-casing. The paste-credentials.json fallback is exposed as
   * a second auth method via `FreebuffOAuthWrapper` (import-token path).
   */
  flowType: "device_code" as const,

  /**
   * Not supported: freebuff uses device-code polling, not redirect-based
   * authorization_code. Callers that want a browser OAuth flow should use
   * `requestDeviceCode` instead.
   */
  buildAuthUrl: (): string => {
    throw new Error(
      "freebuff.buildAuthUrl: not supported. Freebuff uses device_code; " +
        "call requestDeviceCode(config, codeChallenge) to start the flow.",
    );
  },

  /**
   * Standard OAuth v2 device_code surface — called by the shared
   * `/api/oauth/[provider]/device-code` route via the `requestDeviceCode`
   * wrapper in `lib/oauth/providers.ts`.
   *
   * The upstream polling parameters (`fingerprintId` / `fingerprintHash` /
   * `expiresAt`) are base64url-encoded into the returned `device_code` so the
   * client can echo them back verbatim to `pollToken`.
   */
  requestDeviceCode: async (
    config: typeof FREEBUFF_OAUTH_CONFIG,
    _codeChallenge: string,
    options: FreebuffRequestDeviceCodeOptions = {},
  ) => {
    const wire = await startFreebuffDeviceCode(config, options);
    const payload: FreebuffDeviceCodePayload = {
      fingerprintId:
        options.fingerprintIdOverride ?? generateFreebuffFingerprint().fingerprintId,
      fingerprintHash: wire.fingerprintHash,
      expiresAt: wire.expiresAt,
    };
    return {
      device_code: encodeDeviceCode(payload),
      user_code: "",
      verification_uri: wire.loginUrl,
      verification_uri_complete: wire.loginUrl,
      interval: Math.max(1, Math.ceil(config.pollIntervalMs / 1000)),
      expires_in: Math.max(1, Math.ceil((wire.expiresAt - Date.now()) / 1000)),
    };
  },

  /**
   * Standard OAuth v2 device_code polling — called by the shared
   * `/api/oauth/[provider]/poll` route via the `pollForToken` wrapper.
   *
   * Decodes the `deviceCode` we minted in `requestDeviceCode` and translates
   * the upstream Freebuff poll status into the standard OAuth error codes
   * (`authorization_pending`, `expired_token`, `access_denied`).
   */
  pollToken: async (
    config: typeof FREEBUFF_OAUTH_CONFIG,
    deviceCode: string,
    _codeVerifier: string | null,
    _extraData: unknown,
    options: FreebuffPollOptions = {},
  ) => {
    const payload = decodeDeviceCode(deviceCode);
    const result = await pollFreebuffDeviceCode(config, payload, options);

    if (result.status === "success") {
      return {
        ok: true as const,
        data: {
          access_token: result.authToken,
          user_id: result.userId,
          email: result.email,
        },
      };
    }
    if (result.status === "pending") {
      return {
        ok: true as const,
        data: { error: "authorization_pending" as const },
      };
    }
    if (result.status === "expired") {
      return {
        ok: true as const,
        data: {
          error: "expired_token" as const,
          error_description: result.error ?? "Device code expired",
        },
      };
    }
    // status === "error"
    return {
      ok: true as const,
      data: {
        error: "access_denied" as const,
        error_description: result.error ?? "Authentication failed",
      },
    };
  },

  /**
   * Map a Freebuff upstream token bundle onto a connection record.
   *
   * The shared route calls this in two places:
   *
   *   1. `/api/oauth/[provider]/import-token` — input shape is
   *      `{ accessToken: <pasted text> }`. The pasted text can be:
   *        - a JSON object matching `freebuffTokenSchema`
   *          (`{ authToken, userId?, email? }`) — the credentials.json path
   *        - a bare UUID — the simplest paste fallback
   *   2. `/api/oauth/[provider]/poll` (success path) — input shape is
   *      `{ access_token, user_id?, email? }` produced by our
   *      `pollToken` adapter above.
   *
   * Returns connection-shaped data (`accessToken`, `refreshToken`,
   * `expiresIn`, `providerSpecificData`, etc.) so the shared
   * `createProviderConnection` / `updateProviderConnection` can spread it
   * into the DB row.
   */
  mapTokens: (input: Record<string, unknown>) => {
    let authToken: string;
    let userId: string | undefined;
    let email: string | undefined;
    let authMethod: "freebuff-import" | "freebuff-oauth";

    if (typeof input?.accessToken === "string") {
      // Path 1: import-token route — pasted text or credentials.json
      const parsed = parseFreebuffPastedCredentials(input.accessToken);
      authToken = parsed.authToken;
      userId = parsed.userId;
      email = parsed.email;
      authMethod = "freebuff-import";
    } else if (typeof input?.access_token === "string") {
      // Path 2: device-code poll success — upstream OAuth bundle
      authToken = input.access_token;
      userId = typeof input.user_id === "string" ? input.user_id : undefined;
      email = typeof input.email === "string" ? input.email : undefined;
      authMethod = "freebuff-oauth";
    } else {
      throw new Error(
        "freebuff.mapTokens: unrecognized input shape " +
          "(expected { accessToken } for import-token or { access_token } for device-code poll).",
      );
    }

    return {
      accessToken: authToken,
      refreshToken: null,
      expiresIn: null,
      name: email ?? null,
      email: email ?? null,
      /**
       * Freebuff tokens have a hard 1-hour TTL (C6 in
       * `validation-scripts/final-validations.md`). The upstream has no
       * refresh endpoint, so we stamp the expiry here and let the
       * dashboard warn the user ~5 min before it elapses. Stored both
       * at the top level (consumed by `freebuffConnectionSchema`) and
       * inside `providerSpecificData` (consumed by the generic
       * `createProviderConnection` spread) so it survives whichever
       * storage path the route takes.
       */
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      providerSpecificData: {
        ...(userId ? { userId } : {}),
        authMethod,
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      },
    };
  },
};
