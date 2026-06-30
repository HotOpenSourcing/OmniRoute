import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  freebuff,
  FREEBUFF_OAUTH_CONFIG,
  freebuffTokenSchema,
  freebuffPollResponseSchema,
} from "@/lib/oauth/providers/freebuff";

const VALID_AUTH_TOKEN = "bab4a848-134b-465e-bc56-d1b795f03c9a";
const VALID_USER_ID = "00000000-0000-4000-8000-000000000002";
const FINGERPRINT_ID = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const FINGERPRINT_HASH =
  "0b8c96aa4487aff436dd2abe02d095a06dbaf9fa20f44add773f2e956484059f";

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

describe("freebuff.buildAuthUrl", () => {
  it("throws and directs callers to requestDeviceCode", () => {
    assert.throws(
      () => freebuff.buildAuthUrl(),
      /requestDeviceCode/,
    );
  });
});

describe("freebuff.requestDeviceCode", () => {
  it("POSTs to authorizeUrl with fingerprintId + PKCE pair + clientId", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        flowId: "flow-123",
        loginUrl: "https://codebuff.com/login?code=abc",
        fingerprintHash: FINGERPRINT_HASH,
        expiresAt: 1_700_000_000_000,
      }),
    ]);

    const result = await freebuff.requestDeviceCode(
      FREEBUFF_OAUTH_CONFIG,
      FINGERPRINT_ID,
      { fetchImpl },
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

    assert.equal(result.flowId, "flow-123");
    assert.equal(result.loginUrl, "https://codebuff.com/login?code=abc");
    assert.equal(result.fingerprintHash, FINGERPRINT_HASH);
    assert.equal(result.expiresAt, 1_700_000_000_000);
  });

  it("falls back to a synthetic flowId when the server omits one", async () => {
    const expiresAt = 1_700_000_000_000;
    const { fetchImpl } = makeFetchMock([
      jsonResponse({
        loginUrl: "https://codebuff.com/login",
        fingerprintHash: FINGERPRINT_HASH,
        expiresAt,
      }),
    ]);
    const result = await freebuff.requestDeviceCode(
      FREEBUFF_OAUTH_CONFIG,
      FINGERPRINT_ID,
      { fetchImpl },
    );
    assert.equal(result.flowId, `${FINGERPRINT_ID}:${expiresAt}`);
  });

  it("throws with HTTP status when the server returns non-OK", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("invalid fingerprint", { status: 400 }),
    ]);
    await assert.rejects(
      () =>
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, FINGERPRINT_ID, {
          fetchImpl,
        }),
      /HTTP 400/,
    );
  });

  it("wraps network errors", async () => {
    const { fetchImpl } = makeFetchMock([new Error("ECONNREFUSED")]);
    await assert.rejects(
      () =>
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, FINGERPRINT_ID, {
          fetchImpl,
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
        freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, FINGERPRINT_ID, {
          fetchImpl,
        }),
      /missing required fields/,
    );
  });

  it("forwards the AbortSignal to fetch", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        loginUrl: "https://x",
        fingerprintHash: FINGERPRINT_HASH,
        expiresAt: 1_700_000_000_000,
      }),
    ]);
    const ctrl = new AbortController();
    await freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, FINGERPRINT_ID, {
      fetchImpl,
      signal: ctrl.signal,
    });
    assert.equal(calls[0].signal, ctrl.signal);
  });
});

describe("freebuff.pollToken", () => {
  const fp = FINGERPRINT_ID;
  const fh = FINGERPRINT_HASH;
  const exp = 1_700_000_000_000;

  it("returns parsed success on first poll", async () => {
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
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.status, "success");
    assert.equal(result.authToken, VALID_AUTH_TOKEN);
    assert.equal(result.userId, VALID_USER_ID);
    assert.equal(result.email, "u@example.com");

    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, FREEBUFF_OAUTH_CONFIG.tokenUrl);
    assert.equal(url.searchParams.get("fingerprintId"), fp);
    assert.equal(url.searchParams.get("fingerprintHash"), fh);
    assert.equal(url.searchParams.get("expiresAt"), String(exp));
  });

  it("loops pending → success and calls sleepFn once", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "pending" }),
      jsonResponse({
        status: "success",
        authToken: VALID_AUTH_TOKEN,
      }),
    ]);
    const sleepCalls: number[] = [];
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      {
        fetchImpl,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    assert.equal(result.status, "success");
    assert.equal(result.authToken, VALID_AUTH_TOKEN);
    assert.equal(sleepCalls.length, 1);
  });

  it("returns expired on HTTP 410", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("gone", { status: 410 }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.status, "expired");
  });

  it("returns error on HTTP 401/403", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("nope", { status: 401 }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /401/);
  });

  it("retries on network error and eventually succeeds", async () => {
    const { fetchImpl } = makeFetchMock([
      new Error("ETIMEDOUT"),
      new Error("ETIMEDOUT"),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.status, "success");
  });

  it("returns expired when the deadline is already past", async () => {
    // First call sets deadline = 0 + 300_000 = 300_000.
    // Second call returns 600_000 (past deadline) so the while-loop never enters.
    let n = 0;
    const now = () => (n++ === 0 ? 0 : 600_000);
    const { fetchImpl } = makeFetchMock([]); // loop should exit before fetch
    const sleepCalls: number[] = [];
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      {
        fetchImpl,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
        now,
      },
    );
    assert.equal(result.status, "expired");
    assert.match(result.error ?? "", /timeout/i);
    assert.equal(sleepCalls.length, 0);
  });

  it("treats schema-mismatched responses as pending", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ totally: "unexpected shape" }),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {} },
    );
    assert.equal(result.status, "success");
  });

  it("returns error immediately when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { fetchImpl } = makeFetchMock([]);
    const result = await freebuff.pollToken(
      FREEBUFF_OAUTH_CONFIG,
      "flow",
      fp,
      fh,
      exp,
      { fetchImpl, sleepFn: async () => {}, signal: ctrl.signal },
    );
    assert.equal(result.status, "error");
    assert.equal(result.error, "aborted");
  });

  it("grows backoff by ×1.5 per attempt up to a 10s cap", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "success", authToken: VALID_AUTH_TOKEN }),
    ]);
    const intervals: number[] = [];
    await freebuff.pollToken(FREEBUFF_OAUTH_CONFIG, "flow", fp, fh, exp, {
      fetchImpl,
      sleepFn: async (ms) => {
        intervals.push(ms);
      },
    });
    // First attempt sleeps baseInterval (2000ms), then ×1.5, then ×1.5…
    assert.ok(intervals.length >= 3);
    for (let i = 1; i < intervals.length; i++) {
      assert.ok(
        intervals[i] >= intervals[i - 1],
        `interval ${i} (${intervals[i]}) should be >= interval ${i - 1} (${intervals[i - 1]})`,
      );
    }
    assert.ok(intervals.every((ms) => ms <= 10_000));
  });
});

describe("freebuff.mapTokens", () => {
  it("maps a full FreebuffToken to access_token Bearer shape", () => {
    const mapped = freebuff.mapTokens({
      authToken: VALID_AUTH_TOKEN,
      userId: VALID_USER_ID,
      email: "u@example.com",
    });
    assert.equal(mapped.access_token, VALID_AUTH_TOKEN);
    assert.equal(mapped.token_type, "Bearer");
    assert.equal(mapped.user_id, VALID_USER_ID);
    assert.equal(mapped.email, "u@example.com");
  });

  it("works with only authToken", () => {
    const mapped = freebuff.mapTokens({ authToken: VALID_AUTH_TOKEN });
    assert.equal(mapped.access_token, VALID_AUTH_TOKEN);
    assert.equal(mapped.token_type, "Bearer");
    assert.equal(mapped.user_id, undefined);
    assert.equal(mapped.email, undefined);
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
