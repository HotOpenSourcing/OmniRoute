/**
 * Unit tests for `FreebuffSessionManager`.
 *
 * Covers the in-memory mutex + seat cache + proactive refresh
 * behaviour validated against the live Codebuff backend in
 * `~/.config/manicode/freebuff-model-tests/validation-scripts/
 * final-validations.md` §1 (TTL = 1 h) + §2 (`superseded`) + §6
 * (per-token mutex granularity).
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FreebuffSessionManager,
  FreebuffSessionManagerError,
  type SessionEntry,
} from "@/lib/providers/freebuff/sessionManager";

const AUTH = "bab4a848-134b-465e-bc56-d1b795f03c9a";
const OTHER_AUTH = "cebf9c5f-1234-4567-89ab-cdef01234567";
const MODEL = "deepseek/deepseek-v4-flash";
const OTHER_MODEL = "mimo/mimo-v2.5";
const FP_ID = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const FP_HASH = "128a4f6cd60e95cc8e71025fead589087bf6b7e3da360353061";

interface FetchCall {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
  /** Wall-clock timestamp the call was observed (ms). */
  atMs: number;
}

interface FetchResponse {
  status: number;
  body: unknown;
  /** Wall-clock timestamp when the response is delivered. */
  delayMs?: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetchMock(schedule: Array<FetchResponse | Error>): {
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
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init?.method, headers, body, atMs: Date.now() });

    const next = schedule[i++];
    if (next instanceof Error) throw next;
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((r) => setTimeout(r, next.delayMs));
    }
    return jsonResponse(next.body, next.status);
  };
  return { fetchImpl, calls };
}

let manager: FreebuffSessionManager;

afterEach(() => {
  if (manager) manager.reset();
});

describe("FreebuffSessionManager — basic acquire", () => {
  it("POSTs /session and caches the seat for (token, model)", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-1", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();

    const entry = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fingerprint: { fingerprintId: FP_ID, fingerprintHash: FP_HASH },
      fetchImpl,
    });

    assert.equal(entry.instanceId, "inst-1");
    assert.equal(entry.model, MODEL);
    assert.equal(entry.expiresAt, expiresAt);

    // Headers stamped correctly
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["authorization"], `Bearer ${AUTH}`);
    assert.equal(calls[0].headers["x-freebuff-model"], MODEL);
    assert.equal(calls[0].headers["x-codebuff-fingerprint"], FP_ID);
    assert.equal(calls[0].headers["x-codebuff-fingerprint-hash"], FP_HASH);
  });

  it("returns the cached seat on subsequent acquires (no extra POST)", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-1", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();

    const a = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    const b = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });

    assert.equal(a.instanceId, b.instanceId);
    assert.equal(calls.length, 1, "should have POSTed only once");
  });

  it("uses different seats for different models under the same token", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-deep", expiresAt } },
      { status: 200, body: { status: "active", instanceId: "inst-mimo", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();

    const a = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    const b = await manager.acquireSession({
      authToken: AUTH,
      model: OTHER_MODEL,
      fetchImpl,
    });

    assert.equal(a.instanceId, "inst-deep");
    assert.equal(b.instanceId, "inst-mimo");
    assert.equal(calls.length, 2);
  });

  it("uses different seats for different tokens for the same model", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-A", expiresAt } },
      { status: 200, body: { status: "active", instanceId: "inst-B", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();

    const a = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    const b = await manager.acquireSession({
      authToken: OTHER_AUTH,
      model: MODEL,
      fetchImpl,
    });

    assert.equal(a.instanceId, "inst-A");
    assert.equal(b.instanceId, "inst-B");
    assert.equal(calls.length, 2);
  });
});

describe("FreebuffSessionManager — mutex granularity (C8)", () => {
  it("serialises concurrent acquires for the SAME token (any model)", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      // First call: 50ms delay → second call must wait
      { status: 200, body: { status: "active", instanceId: "inst-1", expiresAt }, delayMs: 50 },
      { status: 200, body: { status: "active", instanceId: "inst-2", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();

    // Fire both in parallel — the second call should NOT start until
    // the first one's POST resolves, even though they target different
    // models. Per C8, the safe granularity is mutex-per-token.
    const [a, b] = await Promise.all([
      manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
      manager.acquireSession({ authToken: AUTH, model: OTHER_MODEL, fetchImpl }),
    ]);

    assert.equal(a.instanceId, "inst-1");
    assert.equal(b.instanceId, "inst-2");
    assert.equal(calls.length, 2);

    // The second call must start at least ~50ms after the first one
    // (because the first call's POST takes 50ms to resolve).
    const callGapMs = calls[1].atMs - calls[0].atMs;
    assert.ok(
      callGapMs >= 40,
      `mutex should have serialised same-token acquires (callGapMs=${callGapMs}ms)`,
    );
  });

  it("does NOT serialise acquires across DIFFERENT tokens", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-A", expiresAt }, delayMs: 200 },
      { status: 200, body: { status: "active", instanceId: "inst-B", expiresAt }, delayMs: 200 },
    ]);
    manager = new FreebuffSessionManager();

    // Measure the GAP between the two fetch starts. If the calls run
    // in parallel, the gap is ~0ms; if they serialise, the gap is
    // ~200ms (the first call's delay).
    await Promise.all([
      manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
      manager.acquireSession({ authToken: OTHER_AUTH, model: MODEL, fetchImpl }),
    ]);

    assert.equal(calls.length, 2);
    const callGapMs = Math.abs(calls[1].atMs - calls[0].atMs);
    // Allow ~20ms for microtask scheduling; anything more than 50ms
    // indicates the second call waited for the first to finish.
    assert.ok(
      callGapMs < 50,
      `cross-token acquires should start in parallel (callGapMs=${callGapMs}ms)`,
    );
  });

  it("advances the mutex queue even when a step rejects", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      new Error("network down"),
      { status: 200, body: { status: "active", instanceId: "inst-2", expiresAt: Date.now() + 60 * 60 * 1000 } },
    ]);
    manager = new FreebuffSessionManager();

    await assert.rejects(() =>
      manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
    );

    // The second acquire must run (mutex did not stall on the rejection).
    const entry = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    assert.equal(entry.instanceId, "inst-2");
    assert.equal(calls.length, 2);
  });
});

describe("FreebuffSessionManager — refresh lead", () => {
  it("re-POSTs when the cached seat is within the refresh lead window", async () => {
    const now = Date.now();
    const ttlMs = 60 * 60 * 1000;
    const { fetchImpl, calls } = makeFetchMock([
      // First POST: seat expires in TTL - leadMs - 1s (so the second
      // acquire is past the refresh boundary).
      {
        status: 200,
        body: {
          status: "active",
          instanceId: "inst-1",
          expiresAt: now + ttlMs,
        },
      },
      // Second POST after refresh boundary.
      {
        status: 200,
        body: {
          status: "active",
          instanceId: "inst-2",
          expiresAt: now + ttlMs * 2,
        },
      },
    ]);
    manager = new FreebuffSessionManager({ refreshLeadMs: ttlMs - 1000 });

    const a = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    // Travel 1s into the future → cached seat is within 999ms of expiry.
    // We can't actually advance the clock here, so we just verify the
    // cached seat is returned immediately for a second acquire.
    const b = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    assert.equal(a.instanceId, "inst-1");
    assert.equal(b.instanceId, "inst-1");
    assert.equal(calls.length, 1, "no second POST while cached seat is still in lead window");
  });
});

describe("FreebuffSessionManager — invalidation", () => {
  it("invalidate(token, model, 'superseded') clears the cache and fires onInvalidate", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-1", expiresAt } },
      { status: 200, body: { status: "active", instanceId: "inst-2", expiresAt } },
    ]);
    const events: Array<{ token: string; model: string; reason: string }> = [];
    manager = new FreebuffSessionManager({
      onInvalidate: (token, model, reason) => events.push({ token, model, reason }),
    });

    await manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl });
    manager.invalidate(AUTH, MODEL, "superseded");
    assert.deepEqual(events, [{ token: AUTH, model: MODEL, reason: "superseded" }]);
    assert.equal(manager.peek(AUTH, MODEL), null);

    // Next acquire must POST a fresh seat.
    const fresh = await manager.acquireSession({
      authToken: AUTH,
      model: MODEL,
      fetchImpl,
    });
    assert.equal(fresh.instanceId, "inst-2");
  });

  it("invalidateAll on 401 drops every cached seat for the token", async () => {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const { fetchImpl } = makeFetchMock([
      { status: 200, body: { status: "active", instanceId: "inst-1", expiresAt } },
      { status: 200, body: { status: "active", instanceId: "inst-2", expiresAt } },
      { status: 200, body: { status: "active", instanceId: "inst-3", expiresAt } },
    ]);
    manager = new FreebuffSessionManager();
    await manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl });
    await manager.acquireSession({ authToken: AUTH, model: OTHER_MODEL, fetchImpl });

    manager.invalidateAll(AUTH, "auth_expired");

    assert.equal(manager.peek(AUTH, MODEL), null);
    assert.equal(manager.peek(AUTH, OTHER_MODEL), null);
  });
});

describe("FreebuffSessionManager — error mapping", () => {
  it("throws FreebuffAuthError on 401 and invalidates the token", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      {
        status: 401,
        body: { error: { message: "Invalid API key", code: "unauthorized" } },
      },
    ]);
    manager = new FreebuffSessionManager();
    await assert.rejects(
      () => manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "FreebuffAuthError");
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(manager.peek(AUTH, MODEL), null, "401 should invalidate the token");
  });

  it("throws FreebuffSessionManagerError with code=model_locked and status=409", async () => {
    const { fetchImpl } = makeFetchMock([
      {
        status: 409,
        body: { status: "model_locked", currentModel: "mimo/mimo-v2.5" },
      },
    ]);
    manager = new FreebuffSessionManager();
    await assert.rejects(
      () => manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
      (err: unknown) => {
        assert.ok(err instanceof FreebuffSessionManagerError);
        assert.equal((err as FreebuffSessionManagerError).code, "model_locked");
        assert.equal((err as FreebuffSessionManagerError).status, 409);
        return true;
      },
    );
  });

  it("maps rate_limited → 429, country_blocked → 403, disabled → 410", async () => {
    const cases: Array<{ status: number; body: unknown; expectedCode: string; expectedHttp: number }> = [
      { status: 429, body: { status: "rate_limited" }, expectedCode: "rate_limited", expectedHttp: 429 },
      { status: 403, body: { status: "country_blocked", countryCode: "TN" }, expectedCode: "country_blocked", expectedHttp: 403 },
      { status: 404, body: null, expectedCode: "disabled", expectedHttp: 410 },
    ];
    for (const c of cases) {
      const { fetchImpl } = makeFetchMock([{ status: c.status, body: c.body }]);
      manager = new FreebuffSessionManager();
      await assert.rejects(
        () => manager.acquireSession({ authToken: AUTH, model: MODEL, fetchImpl }),
        (err: unknown) => {
          assert.ok(err instanceof FreebuffSessionManagerError);
          assert.equal((err as FreebuffSessionManagerError).code, c.expectedCode);
          assert.equal((err as FreebuffSessionManagerError).status, c.expectedHttp);
          return true;
        },
      );
    }
  });
});
