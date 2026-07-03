import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  freebuff,
  FREEBUFF_OAUTH_CONFIG,
  freebuffTokenSchema,
  freebuffPollResponseSchema,
  parseFreebuffPastedCredentials,
} from "@/lib/oauth/providers/freebuff";

const VALID_AUTH_TOKEN = "bab4a848-134b-465e-bc56-d1b795f03c9a";
const VALID_USER_ID = "00000000-0000-4000-8000-000000000002";
const FINGERPRINT_ID = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const FINGERPRINT_HASH =
  "0b8c96aa4487aff436dd2abe02d095a06dbaf9fa20f44add773f2e956484059f";
const EXPIRES_AT = 1_700_000_000_000;

interface FetchCall {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchMock(responses: Array<Response | Error>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(h as Record<string, string>)) {
          headers[k.toLowerCase()] = v;
        }
      }
    }
    calls.push({
      url,
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      headers,
      signal: init?.signal ?? null,
    });
    const next = responses[i++];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

/** Encode a polling payload the way `requestDeviceCode` does. */
function encodeFreebuffDeviceCode(
  fingerprintId: string,
  fingerprintHash: string,
  expiresAt: number,
): string {
  return Buffer.from(
    JSON.stringify({ fingerprintId, fingerprintHash, expiresAt }),
    "utf8",
  ).toString("base64url");
}

describe("freebuff.buildAuthUrl", () => {
  it("throws and directs callers to requestDeviceCode", () => {
    assert.throws(() => freebuff.buildAuthUrl(), /requestDeviceCode/);
  });
});

describe("freebuff.requestDeviceCode (standard device_code surface)", () => {
  it("POSTs to authorizeUrl with the overridden fingerprintId + PKCE pair + clientId", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        loginUrl: "https://codebuff.com/login?code=abc",
        fingerprintHash: FINGERPRINT_HASH,
        expiresAt: EXPIRES_AT,
      }),
    ]);

    const result = await freebuff.requestDeviceCode(
      FREEBUFF_OAUTH_CONFIG,
      // codeChallenge is unused for Freebuff — the wrapper in lib/oauth/providers.ts
      // always passes the PKCE challenge, but Freebuff derives its own fingerprint.
      "ignored-pkce-challenge",
      { fetchImpl, fingerprintIdOverride: FINGERPRINT_ID },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, FREEBUFF_OAUTH_CONFIG.authorizeUrl);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].headers["content-type"] ?? "", /application\/json/);
    assert.equal(calls[0].headers["accept"], "application/json");

    const body = JSON.parse(calls[0].body ?? "{}");
    assert.equal(body.fingerprintId, FINGERPRINT_ID);
    assert.equal(typeof body.codeChallenge, "string");
    assert.ok(body.codeChallenge.length > 0);
    assert.equal(typeof body.state, "string");
    assert.ok(body.state.length > 0);
    assert.equal(body.clientId, FREEBUFF_OAUTH_CONFIG.clientId);

    // The returned device_code is opaque to the client. Decode it to verify
    // the upstream polling parameters were embedded as expected.
    assert.equal(typeof result.device_code, "string");
    assert.equal(result.user_code, "");
    assert.equal(result.verification_uri, "https://codebuff.com/login?code=abc");
    assert.equal(
      result.verification_uri_complete,
      "https://codebuff.com/login?code=abc",
    );
    assert.equal(typeof result.interval, "number");
    assert.ok(result.interval >= 1);
    assert.equal(typeof result.expires_in, "number");

    const decoded = JSON.parse(
      Buffer.from(result.device_code, "base64url").toString("utf8"),
    );
    assert.equal(decoded.fingerprintId, FINGERPRINT_ID);
    assert.equal(decoded.fingerprintHash, FINGERPRINT_HASH);
    assert.equal(decoded.expiresAt, EXPIRES_AT);
  });

  it("throws with HTTP status when the server returns non-OK", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("invalid fingerprint", { status: 400 }),
    ]);
    await assert.rejects(
      () =>
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, "challenge", {
          fetchImpl,
          fingerprintIdOverride: FINGERPRINT_ID,
        }),
      /HTTP 400/,
    );
  });

  it("wraps network errors", async () => {
    const { fetchImpl } = makeFetchMock([new Error("ECONNREFUSED")]);
    await assert.rejects(
      () =>
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, "challenge", {
          fetchImpl,
          fingerprintIdOverride: FINGERPRINT_ID,
        }),
      /network error: ECONNREFUSED/,
    );
  });

  it("throws when the response is missing required fields", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ loginUrl: "https://x", expiresAt: 1 }),
    ]);
    await assert.rejects(
      () =>
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, "challenge", {
          fetchImpl,
          fingerprintIdOverride: FINGERPRINT_ID,
        }),
      /missing required fields/,
    );
  });

  it("forwards the AbortSignal to fetch", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        loginUrl: "https://x",
        fingerprintHash: FINGERPRINT_HASH,
        expiresAt: EXPIRES_AT,
      }),
    ]);
    const ctrl = new AbortController();
    await freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, "challenge", {
      fetchImpl,
      fingerprintIdOverride: FINGERPRINT_ID,
      signal: ctrl.signal,
    });
    assert.equal(calls[0].signal, ctrl.signal);
  });
});

describe("freebuff.pollToken (standard OAuth v2 surface)", () => {
  const deviceCode = encodeFreebuffDeviceCode(
    FINGERPRINT_ID,
    FINGERPRINT_HASH,
    EXPIRES_AT,
  );

  it("returns ok=true with access_token bundle on first success poll", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        status: "success",
        authToken: VALID_AUTH_TOKEN,
        userId: VALID_USER_ID,
        email: "u@example.com",
      }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.access_token, VALID_AUTH_TOKEN);
    assert.equal(result.data.user_id, VALID_USER_ID);
    assert.equal(result.data.email, "u@example.com");

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, FREEBUFF_OAUTH_CONFIG.tokenUrl);
    assert.equal(url.searchParams.get("fingerprintId"), FINGERPRINT_ID);
    assert.equal(url.searchParams.get("fingerprintHash"), FINGERPRINT_HASH);
    assert.equal(url.searchParams.get("expiresAt"), String(EXPIRES_AT));
  });

  it("loops pending → success and returns the access_token bundle", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const sleepCalls: number[] = [];
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      {
        fetchImpl,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.access_token, VALID_AUTH_TOKEN);
    // sleepFn was called once between the two fetch calls.
    assert.equal(sleepCalls.length, 1);
  });

  it("returns expired_token after timing out while pending", async () => {
    // Five pending responses — never completes. The poll loop will hit
    // the deadline and return expired_token (the timeout wraps `pending`
    // into `expired_token` per the OAuth v2 device_code protocol).
    const { fetchImpl } = makeFetchMock(
      Array(5).fill(jsonResponse({ status: "pending" })),
    );
    // Advance the virtual clock past the poll timeout so the loop exits
    // on the first iteration (deadline = now() + 300_000 ms).
    let virtualNow = Date.now();
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      {
        fetchImpl,
        sleepFn: async () => {
          // Each sleep tick advances the virtual clock past the deadline.
          virtualNow += FREEBUFF_OAUTH_CONFIG.pollTimeoutMs + 1;
        },
        now: () => virtualNow,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.error, "expired_token");
    assert.match(result.data.error_description ?? "", /timeout/i);
  });

  it("returns expired_token when the upstream returns HTTP 410", async () => {
    const { fetchImpl } = makeFetchMock([new Response("gone", { status: 410 })]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.error, "expired_token");
    assert.match(result.data.error_description ?? "", /expired/i);
  });

  it("returns access_denied when the upstream returns HTTP 401/403", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("nope", { status: 401 }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.error, "access_denied");
    assert.match(result.data.error_description ?? "", /401/);
  });

  it("retries on network error and eventually succeeds", async () => {
    const { fetchImpl } = makeFetchMock([
      new Error("ETIMEDOUT"),
      new Error("ETIMEDOUT"),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.access_token, VALID_AUTH_TOKEN);
  });

  it("returns expired_token when the deadline is already past", async () => {
    let n = 0;
    const now = () => (n++ === 0 ? 0 : 600_000);
    const { fetchImpl } = makeFetchMock([]);
    const sleepCalls: number[] = [];
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      {
        fetchImpl,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
        now,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.error, "expired_token");
    assert.match(result.data.error_description ?? "", /timeout/i);
    assert.equal(sleepCalls.length, 0);
  });

  it("treats schema-mismatched responses as pending", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ totally: "unexpected shape" }),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.access_token, VALID_AUTH_TOKEN);
  });

  it("returns access_denied when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { fetchImpl } = makeFetchMock([]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      deviceCode,
      null,
      null,
      { fetchImpl, sleepFn: async () => {}, signal: ctrl.signal },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.error, "access_denied");
    assert.equal(result.data.error_description, "aborted");
  });

  it("rejects a deviceCode that is not a Freebuff-issued payload", async () => {
    const { fetchImpl } = makeFetchMock([]);
    await assert.rejects(
      () =>
        freebuff.pollToken(
          FREEBUFF_OAUTH_CONFIG,
          "not-base64url-json",
          null,
          null,
          { fetchImpl, sleepFn: async () => {} },
        ),
      /deviceCode is not a Freebuff-issued token/,
    );
  });
});

describe("freebuff.mapTokens", () => {
  it("maps a credentials.json paste to connection-shaped data (import-token path)", () => {
    // The shared /api/oauth/[provider]/import-token route invokes
    // mapTokens({ accessToken: <pasted text> }). Freebuff's implementation
    // accepts either a credentials.json object or a bare authToken UUID and
    // returns connection-shaped data that the import-token route spreads into
    // createProviderConnection.
    const pastedJson = JSON.stringify({
      authToken: VALID_AUTH_TOKEN,
      userId: VALID_USER_ID,
      email: "u@example.com",
    });
    const mapped = freebuff.mapTokens({ accessToken: pastedJson });
    assert.equal(mapped.accessToken, VALID_AUTH_TOKEN);
    assert.equal(mapped.refreshToken, null);
    assert.equal(mapped.expiresIn, null);
    assert.equal(mapped.email, "u@example.com");
    assert.equal(mapped.name, "u@example.com");
    assert.equal(mapped.providerSpecificData.userId, VALID_USER_ID);
    assert.equal(mapped.providerSpecificData.authMethod, "freebuff-import");
  });

  it("maps a bare authToken paste to connection-shaped data", () => {
    const mapped = freebuff.mapTokens({ accessToken: VALID_AUTH_TOKEN });
    assert.equal(mapped.accessToken, VALID_AUTH_TOKEN);
    assert.equal(mapped.refreshToken, null);
    assert.equal(mapped.email, null);
    assert.equal(mapped.name, null);
    assert.equal(mapped.providerSpecificData.authMethod, "freebuff-import");
    assert.equal(mapped.providerSpecificData.userId, undefined);
  });

  it("treats malformed JSON as a bare token (no crash, no leak)", () => {
    const mapped = freebuff.mapTokens({ accessToken: "{ not valid json" });
    assert.equal(mapped.accessToken, "{ not valid json");
    assert.equal(mapped.refreshToken, null);
  });

  it("ignores extra credentials.json fields not declared in schema", () => {
    const pastedJson = JSON.stringify({
      authToken: VALID_AUTH_TOKEN,
      userId: VALID_USER_ID,
      email: "u@example.com",
      unknownField: "ignored",
    });
    const mapped = freebuff.mapTokens({ accessToken: pastedJson });
    assert.equal(mapped.accessToken, VALID_AUTH_TOKEN);
    assert.equal(mapped.providerSpecificData.userId, VALID_USER_ID);
  });

  it("maps a device-code poll success bundle (freebuff-oauth path)", () => {
    const mapped = freebuff.mapTokens({
      access_token: VALID_AUTH_TOKEN,
      user_id: VALID_USER_ID,
      email: "u@example.com",
    });
    assert.equal(mapped.accessToken, VALID_AUTH_TOKEN);
    assert.equal(mapped.refreshToken, null);
    assert.equal(mapped.email, "u@example.com");
    assert.equal(mapped.providerSpecificData.userId, VALID_USER_ID);
    assert.equal(mapped.providerSpecificData.authMethod, "freebuff-oauth");
  });

  it("throws when the input shape is unrecognized", () => {
    assert.throws(() => freebuff.mapTokens({}), /unrecognized input shape/);
    assert.throws(() => freebuff.mapTokens(null), /unrecognized input shape/);
  });
});

describe("parseFreebuffPastedCredentials", () => {
  it("parses a credentials.json object", () => {
    const parsed = parseFreebuffPastedCredentials(
      JSON.stringify({
        authToken: VALID_AUTH_TOKEN,
        userId: VALID_USER_ID,
        email: "u@example.com",
      }),
    );
    assert.equal(parsed.authToken, VALID_AUTH_TOKEN);
    assert.equal(parsed.userId, VALID_USER_ID);
    assert.equal(parsed.email, "u@example.com");
  });

  it("returns a bare-token object for non-JSON input", () => {
    const parsed = parseFreebuffPastedCredentials(VALID_AUTH_TOKEN);
    assert.deepEqual(parsed, { authToken: VALID_AUTH_TOKEN });
  });

  it("returns a bare-token object for malformed JSON", () => {
    const parsed = parseFreebuffPastedCredentials("{ broken");
    assert.deepEqual(parsed, { authToken: "{ broken" });
  });
});

describe("freebuff schemas", () => {
  it("freebuffPollResponseSchema accepts a pending response with no other fields", () => {
    const parsed = freebuffPollResponseSchema.parse({ status: "pending" });
    assert.equal(parsed.status, "pending");
  });

  it("freebuffPollResponseSchema rejects an unknown status", () => {
    assert.throws(() =>
      freebuffPollResponseSchema.parse({ status: "maybe" }),
    );
  });

  it("freebuffTokenSchema rejects a non-UUID authToken", () => {
    assert.throws(() => freebuffTokenSchema.parse({ authToken: "nope" }));
  });

  it("freebuffTokenSchema accepts a valid UUID", () => {
    const parsed = freebuffTokenSchema.parse({ authToken: VALID_AUTH_TOKEN });
    assert.equal(parsed.authToken, VALID_AUTH_TOKEN);
  });
});
