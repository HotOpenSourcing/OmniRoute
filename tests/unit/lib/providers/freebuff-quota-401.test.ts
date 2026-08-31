/**
 * Tests for the 401 / fingerprint-header paths in `freebuff/quota.ts`.
 *
 * Locks in the behaviour validated against the live Codebuff backend:
 *
 *   - C6: HTTP 401 on `/api/v1/freebuff/session` (any verb) means the
 *     authToken has expired (TTL ≈ 1 h). The adapter MUST surface this
 *     as `FreebuffAuthError` so callers can route to a re-auth flow.
 *
 *   - Mission 1: `x-codebuff-fingerprint` and `x-codebuff-fingerprint-hash`
 *     are NOT validated by the server, but the SDK binary sends them —
 *     so we send them too when the credentials carry a fingerprint.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  acquireFreebuffSlot,
  FreebuffAuthError,
  getFreebuffQuota,
  releaseFreebuffSlot,
} from "@/lib/providers/freebuff/quota";

const AUTH = "bab4a848-134b-465e-bc56-d1b795f03c9a";
const FP_ID = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const FP_HASH = "128a4f6cd60e95cc8e71025fead589087bf6b7e3da360353061";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchMock(responses: Array<Response | Error>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
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
    calls.push({ url, headers });
    const next = responses[i++];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

describe("getFreebuffQuota — 401 auth-expired path (C6)", () => {
  it("throws FreebuffAuthError on session endpoint HTTP 401", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ error: { message: "Invalid API key" } }, 401),
    ]);
    await assert.rejects(
      () =>
        getFreebuffQuota(AUTH, undefined, { fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof FreebuffAuthError);
        assert.match(
          (err as FreebuffAuthError).message,
          /HTTP 401.*auth token expired/,
        );
        return true;
      },
    );
  });

  it("forwards fingerprint headers when fingerprint option is supplied", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({ status: "active" }),
      jsonResponse({ streak: 0 }),
    ]);
    await getFreebuffQuota(AUTH, undefined, {
      fetchImpl,
      fingerprint: { fingerprintId: FP_ID, fingerprintHash: FP_HASH },
    });
    // Session call
    assert.equal(calls[0].headers["x-codebuff-fingerprint"], FP_ID);
    assert.equal(calls[0].headers["x-codebuff-fingerprint-hash"], FP_HASH);
    // Streak call
    assert.equal(calls[1].headers["x-codebuff-fingerprint"], FP_ID);
    assert.equal(calls[1].headers["x-codebuff-fingerprint-hash"], FP_HASH);
  });

  it("omits fingerprint headers when fingerprint option is not supplied", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({ status: "active" }),
      jsonResponse({ streak: 0 }),
    ]);
    await getFreebuffQuota(AUTH, undefined, { fetchImpl });
    assert.equal(calls[0].headers["x-codebuff-fingerprint"], undefined);
    assert.equal(calls[1].headers["x-codebuff-fingerprint"], undefined);
  });
});

describe("acquireFreebuffSlot — 401 auth-expired path (C6)", () => {
  it("throws FreebuffAuthError on POST /session HTTP 401", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ error: { message: "Invalid API key" } }, 401),
    ]);
    await assert.rejects(
      () =>
        acquireFreebuffSlot(AUTH, "deepseek/deepseek-v4-flash", {
          fetchImpl,
          fingerprint: { fingerprintId: FP_ID, fingerprintHash: FP_HASH },
        }),
      (err: unknown) => {
        assert.ok(err instanceof FreebuffAuthError);
        return true;
      },
    );
  });

  it("forwards fingerprint headers on POST /session", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({ status: "active", instanceId: "inst-1", expiresAt }),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "deepseek/deepseek-v4-flash", {
      fetchImpl,
      fingerprint: { fingerprintId: FP_ID, fingerprintHash: FP_HASH },
    });
    assert.equal(r.status, "active");
    assert.equal(r.instanceId, "inst-1");
    assert.equal(r.expiresAt, expiresAt);
    assert.equal(calls[0].headers["x-freebuff-model"], "deepseek/deepseek-v4-flash");
    assert.equal(calls[0].headers["x-codebuff-fingerprint"], FP_ID);
    assert.equal(calls[0].headers["x-codebuff-fingerprint-hash"], FP_HASH);
  });

  it("includes expiresAt and remainingMs in the response when server returns them", async () => {
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const { fetchImpl } = makeFetchMock([
      jsonResponse({
        status: "active",
        instanceId: "inst-2",
        expiresAt,
        remainingMs: expiresAt - Date.now(),
      }),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.expiresAt, expiresAt);
    assert.ok(typeof r.remainingMs === "number");
  });
});

describe("releaseFreebuffSlot — fingerprint + instance headers", () => {
  it("forwards x-freebuff-instance-id and fingerprint headers on DELETE", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({ status: "ended" }),
    ]);
    await releaseFreebuffSlot(AUTH, {
      fetchImpl,
      instanceId: "inst-xyz",
      fingerprint: { fingerprintId: FP_ID, fingerprintHash: FP_HASH },
    });
    assert.equal(calls[0].headers["x-freebuff-instance-id"], "inst-xyz");
    assert.equal(calls[0].headers["x-codebuff-fingerprint"], FP_ID);
    assert.equal(calls[0].headers["x-codebuff-fingerprint-hash"], FP_HASH);
  });
});
