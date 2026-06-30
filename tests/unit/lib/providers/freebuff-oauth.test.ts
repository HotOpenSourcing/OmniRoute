import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  startLogin,
  pollLoginStatus,
  waitForLogin,
  FreebuffOAuthError,
  freebuffLoginStartResponseSchema,
  freebuffLoginStatusResponseSchema,
  getFreebuffOAuthEndpoints,
} from "../../../../src/lib/providers/freebuff/oauth.ts";

// ---------------------------------------------------------------------------
// Endpoint configuration.
// ---------------------------------------------------------------------------

describe("getFreebuffOAuthEndpoints", () => {
  test("returns sensible defaults that match the binary's URL pattern", () => {
    // Wipe env override so the default kicks in.
    delete process.env.FREEBUFF_OAUTH_BASE_URL;
    const eps = getFreebuffOAuthEndpoints();
    assert.match(eps.start, /\/api\/v1\/cli-auth\/start$/);
    assert.match(eps.poll, /\/api\/v1\/cli-auth\/status$/);
    assert.ok(eps.start.startsWith("https://"));
  });

  test("respects FREEBUFF_OAUTH_BASE_URL override and trims trailing slashes", () => {
    process.env.FREEBUFF_OAUTH_BASE_URL = "https://staging.example.com///";
    try {
      const eps = getFreebuffOAuthEndpoints();
      assert.equal(eps.start, "https://staging.example.com/api/v1/cli-auth/start");
    } finally {
      delete process.env.FREEBUFF_OAUTH_BASE_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// Mocked fetch helper.
// ---------------------------------------------------------------------------

interface MockResponse {
  status: number;
  body: unknown;
}

function makeFetcher(responses: MockResponse[]) {
  let i = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL).href;
    calls.push({ url, init });
    const next = responses[i++] ?? { status: 404, body: { error: "no more responses" } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetcher, calls };
}

// ---------------------------------------------------------------------------
// startLogin.
// ---------------------------------------------------------------------------

describe("startLogin", () => {
  test("builds the user-facing loginUrl when only authCode is returned", async () => {
    const { fetcher, calls } = makeFetcher([
      {
        status: 200,
        body: {
          flowId: "11111111-1111-1111-1111-111111111111",
          authCode: "0birT9RhiYWlkXTYEQEn1g",
          expiresAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ]);
    const out = await startLogin({ fetcher });
    assert.equal(out.flowId, "11111111-1111-1111-1111-111111111111");
    assert.equal(out.authCode, "0birT9RhiYWlkXTYEQEn1g");
    assert.match(out.loginUrl, /^https:\/\/freebuff\.com\/login\?auth_code=/);
    assert.ok(out.loginUrl.includes("0birT9RhiYWlkXTYEQEn1g"));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/cli-auth\/start$/);
    assert.equal(calls[0].init?.method, "POST");
  });

  test("passes through a server-provided loginUrl verbatim", async () => {
    const { fetcher } = makeFetcher([
      {
        status: 200,
        body: {
          flowId: "22222222-2222-2222-2222-222222222222",
          authCode: "abc12345",
          loginUrl: "https://login.example.com/?code=abc",
          expiresAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ]);
    const out = await startLogin({ fetcher });
    assert.equal(out.loginUrl, "https://login.example.com/?code=abc");
  });

  test("throws FreebuffOAuthError on non-2xx", async () => {
    const { fetcher } = makeFetcher([
      { status: 401, body: { error: { message: "Invalid client id" } } },
    ]);
    await assert.rejects(
      () => startLogin({ fetcher }),
      (err: unknown) =>
        err instanceof FreebuffOAuthError &&
        err.status === 401 &&
        /Invalid client id/.test(err.message),
    );
  });
});

// ---------------------------------------------------------------------------
// pollLoginStatus.
// ---------------------------------------------------------------------------

describe("pollLoginStatus", () => {
  test("parses a completed response with credentials", async () => {
    const { fetcher, calls } = makeFetcher([
      {
        status: 200,
        body: {
          flowId: "33333333-3333-3333-3333-333333333333",
          status: "completed",
          authToken: "44444444-4444-4444-4444-444444444444",
          fingerprintId: "enhanced-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
          userId: "55555555-5555-5555-5555-555555555555",
          userEmail: "user@example.com",
        },
      },
    ]);
    const out = await pollLoginStatus(
      "33333333-3333-3333-3333-333333333333",
      { fetcher },
    );
    assert.equal(out.status, "completed");
    assert.equal(out.authToken, "44444444-4444-4444-4444-444444444444");
    assert.match(calls[0].url, /flowId=33333333/);
  });

  test("parses a pending response without credentials", async () => {
    const { fetcher } = makeFetcher([
      {
        status: 200,
        body: {
          flowId: "66666666-6666-6666-6666-666666666666",
          status: "pending",
        },
      },
    ]);
    const out = await pollLoginStatus(
      "66666666-6666-6666-6666-666666666666",
      { fetcher },
    );
    assert.equal(out.status, "pending");
    assert.equal(out.authToken, undefined);
  });

  test("treats 404 as a parseable (likely expired) response", async () => {
    const { fetcher } = makeFetcher([
      {
        status: 404,
        body: {
          flowId: "77777777-7777-7777-7777-777777777777",
          status: "expired",
        },
      },
    ]);
    const out = await pollLoginStatus(
      "77777777-7777-7777-7777-777777777777",
      { fetcher },
    );
    assert.equal(out.status, "expired");
  });

  test("throws on 5xx", async () => {
    const { fetcher } = makeFetcher([
      { status: 503, body: { error: { message: "down" } } },
    ]);
    await assert.rejects(
      () => pollLoginStatus("88888888-8888-8888-8888-888888888888", { fetcher }),
      FreebuffOAuthError,
    );
  });
});

// ---------------------------------------------------------------------------
// waitForLogin — polling loop with backoff.
// ---------------------------------------------------------------------------

describe("waitForLogin", () => {
  test("returns the first non-pending response without retrying", async () => {
    const { fetcher, calls } = makeFetcher([
      {
        status: 200,
        body: {
          flowId: "99999999-9999-9999-9999-999999999999",
          status: "completed",
          authToken: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          fingerprintId: "enhanced-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        },
      },
    ]);
    const out = await waitForLogin(
      "99999999-9999-9999-9999-999999999999",
      { fetcher, intervalMs: 5, maxIntervalMs: 5, timeoutMs: 1000 },
    );
    assert.equal(out.status, "completed");
    assert.equal(calls.length, 1);
  });

  test("polls multiple times until completion", async () => {
    const { fetcher, calls } = makeFetcher([
      { status: 200, body: { flowId: "x", status: "pending" } },
      { status: 200, body: { flowId: "x", status: "pending" } },
      {
        status: 200,
        body: {
          flowId: "x",
          status: "completed",
          authToken: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          fingerprintId: "enhanced-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        },
      },
    ]);
    const out = await waitForLogin("x", {
      fetcher,
      intervalMs: 1,
      maxIntervalMs: 2,
      timeoutMs: 1000,
    });
    assert.equal(out.status, "completed");
    assert.equal(calls.length, 3);
  });

  test("times out if the flow never completes", async () => {
    const { fetcher } = makeFetcher([
      { status: 200, body: { flowId: "x", status: "pending" } },
      { status: 200, body: { flowId: "x", status: "pending" } },
      { status: 200, body: { flowId: "x", status: "pending" } },
    ]);
    await assert.rejects(
      () =>
        waitForLogin("x", {
          fetcher,
          intervalMs: 1,
          maxIntervalMs: 1,
          timeoutMs: 5,
        }),
      (err: unknown) =>
        err instanceof FreebuffOAuthError && err.code === "timeout",
    );
  });

  test("returns the error response immediately when status === 'error'", async () => {
    const { fetcher, calls } = makeFetcher([
      {
        status: 200,
        body: { flowId: "x", status: "error", error: "Browser session expired" },
      },
    ]);
    const out = await waitForLogin("x", {
      fetcher,
      intervalMs: 1,
      timeoutMs: 1000,
    });
    assert.equal(out.status, "error");
    assert.equal(calls.length, 1);
    assert.equal(out.error, "Browser session expired");
  });
});

// ---------------------------------------------------------------------------
// Schema round-trips.
// ---------------------------------------------------------------------------

describe("zod schemas", () => {
  test("loginStart accepts a documented payload", () => {
    const parsed = freebuffLoginStartResponseSchema.parse({
      flowId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      authCode: "0birT9RhiYWlkXTYEQEn1g",
      loginUrl: "https://freebuff.com/login?auth_code=0birT9RhiYWlkXTYEQEn1g",
      expiresAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(parsed.authCode, "0birT9RhiYWlkXTYEQEn1g");
  });

  test("loginStart rejects an invalid flowId", () => {
    assert.throws(() =>
      freebuffLoginStartResponseSchema.parse({
        flowId: "not-a-uuid",
        authCode: "x",
        loginUrl: "https://x",
        expiresAt: "2026-07-01T00:00:00.000Z",
      }),
    );
  });

  test("loginStatus rejects an unknown status", () => {
    assert.throws(() =>
      freebuffLoginStatusResponseSchema.parse({
        flowId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        status: "frobnicating",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Error class.
// ---------------------------------------------------------------------------

describe("FreebuffOAuthError", () => {
  test("carries status + code + message", () => {
    const err = new FreebuffOAuthError("nope", 401, "unauthorized");
    assert.equal(err.status, 401);
    assert.equal(err.code, "unauthorized");
    assert.equal(err.message, "nope");
    assert.equal(err.name, "FreebuffOAuthError");
  });
});
