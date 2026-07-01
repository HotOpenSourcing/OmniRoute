import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  acquireFreebuffSlot,
  freebuffSessionSchema,
  freebuffStreakSchema,
  getFreebuffQuota,
  releaseFreebuffSlot,
} from "@/lib/providers/freebuff/quota";

const AUTH = "bab4a848-134b-465e-bc56-d1b795f03c9a";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
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
    calls.push({ url, method: init?.method, headers });
    const next = responses[i++];
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

describe("freebuffSessionSchema", () => {
  it("accepts a minimal session response", () => {
    const parsed = freebuffSessionSchema.parse({ status: "active" });
    assert.equal(parsed.status, "active");
  });

  it("accepts a fully-populated session response", () => {
    const parsed = freebuffSessionSchema.parse({
      status: "queued",
      accessTier: "limited",
      queueDepthByModel: { "mimo/mimo-v2.5": 3 },
      rateLimitsByModel: { "mimo/mimo-v2.5": { recentCount: 0, limit: 5 } },
      referral: { code: "ABC", weeklySessionsRemaining: 2 },
      countryCode: "FR",
      position: 1,
      queueDepth: 5,
      estimatedWaitMs: 30_000,
      queuedAt: new Date().toISOString(),
      model: "mimo/mimo-v2.5",
    });
    assert.equal(parsed.accessTier, "limited");
    assert.equal(parsed.position, 1);
  });

  it("rejects an unknown status", () => {
    assert.throws(() => freebuffSessionSchema.parse({ status: "weird" }));
  });
});

describe("freebuffStreakSchema", () => {
  it("accepts a valid streak", () => {
    assert.equal(freebuffStreakSchema.parse({ streak: 7 }).streak, 7);
  });
  it("rejects a negative streak", () => {
    assert.throws(() => freebuffStreakSchema.parse({ streak: -1 }));
  });
  it("rejects a non-integer streak", () => {
    assert.throws(() => freebuffStreakSchema.parse({ streak: 1.5 }));
  });
});

describe("getFreebuffQuota", () => {
  it("parses session + streak and derives state flags", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        status: "queued",
        accessTier: "limited",
        position: 4,
        queueDepth: 10,
        estimatedWaitMs: 60_000,
      }),
      jsonResponse({ streak: 3 }),
    ]);
    const snap = await getFreebuffQuota(AUTH, "inst-1", { fetchImpl });

    assert.equal(snap.session.status, "queued");
    assert.equal(snap.session.position, 4);
    assert.equal(snap.streak, 3);
    assert.equal(snap.isQueued, true);
    assert.equal(snap.isActive, false);
    assert.equal(snap.isLimited, false);
    assert.equal(snap.isBlocked, false);

    // Headers + instance id propagated
    const sessionCall = calls[0];
    assert.equal(sessionCall.headers["authorization"], `Bearer ${AUTH}`);
    assert.equal(sessionCall.headers["x-freebuff-instance-id"], "inst-1");
    const streakCall = calls[1];
    assert.equal(streakCall.headers["authorization"], `Bearer ${AUTH}`);
  });

  it("marks isActive for status active", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "active" }),
      jsonResponse({ streak: 0 }),
    ]);
    const snap = await getFreebuffQuota(AUTH, undefined, { fetchImpl });
    assert.equal(snap.isActive, true);
    assert.equal(snap.isQueued, false);
  });

  it("marks isLimited for rate_limited / model_locked / model_unavailable", async () => {
    for (const status of ["rate_limited", "model_locked", "model_unavailable"]) {
      const { fetchImpl } = makeFetchMock([
        jsonResponse({ status }),
        jsonResponse({ streak: 0 }),
      ]);
      const snap = await getFreebuffQuota(AUTH, undefined, { fetchImpl });
      assert.equal(snap.isLimited, true, `status=${status} should be isLimited`);
    }
  });

  it("marks isBlocked for country_blocked / banned", async () => {
    for (const status of ["country_blocked", "banned"]) {
      const { fetchImpl } = makeFetchMock([
        jsonResponse({ status, countryCode: "FR", countryBlockReason: "vpn" }),
        jsonResponse({ streak: 0 }),
      ]);
      const snap = await getFreebuffQuota(AUTH, undefined, { fetchImpl });
      assert.equal(snap.isBlocked, true, `status=${status} should be isBlocked`);
    }
  });

  it("treats streak fetch failure as null (best-effort)", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "active" }),
      new Error("network error"),
    ]);
    const snap = await getFreebuffQuota(AUTH, undefined, { fetchImpl });
    assert.equal(snap.session.status, "active");
    assert.equal(snap.streak, null);
  });

  it("skips the streak endpoint when includeStreak:false", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({ status: "active" }),
      jsonResponse({ streak: 99 }), // would be reached only if includeStreak is true
    ]);
    const snap = await getFreebuffQuota(AUTH, undefined, {
      fetchImpl,
      includeStreak: false,
    });
    assert.equal(snap.streak, null);
    assert.equal(calls.length, 1);
  });

  it("throws when the session endpoint returns non-OK", async () => {
    const { fetchImpl } = makeFetchMock([
      new Response("server error", { status: 500 }),
    ]);
    await assert.rejects(
      () => getFreebuffQuota(AUTH, undefined, { fetchImpl }),
      /HTTP 500/,
    );
  });

  it("throws when the session response does not match the schema", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "not-a-valid-status" }),
    ]);
    await assert.rejects(
      () => getFreebuffQuota(AUTH, undefined, { fetchImpl }),
      /did not match schema/,
    );
  });
});

describe("acquireFreebuffSlot", () => {
  it("returns status:disabled on HTTP 404", async () => {
    const { fetchImpl } = makeFetchMock([new Response("", { status: 404 })]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.status, "disabled");
  });

  it("returns country_blocked on HTTP 403", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "country_blocked", countryCode: "FR" }, 403),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.status, "country_blocked");
  });

  it("returns model_locked on HTTP 409", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "model_locked", currentModel: "deepseek/deepseek-v4-flash" }, 409),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.status, "model_locked");
  });

  it("returns rate_limited on HTTP 429", async () => {
    const { fetchImpl } = makeFetchMock([
      jsonResponse({ status: "rate_limited", recentCount: 5, limit: 5 }, 429),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.status, "rate_limited");
  });

  it("parses the success response and returns instanceId", async () => {
    const { fetchImpl, calls } = makeFetchMock([
      jsonResponse({
        status: "active",
        instanceId: "inst-abc",
        model: "mimo/mimo-v2.5",
      }),
    ]);
    const r = await acquireFreebuffSlot(AUTH, "mimo/mimo-v2.5", { fetchImpl });
    assert.equal(r.status, "active");
    assert.equal(r.instanceId, "inst-abc");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers["x-freebuff-model"], "mimo/mimo-v2.5");
  });
});

describe("releaseFreebuffSlot", () => {
  it("issues a DELETE and swallows network errors", async () => {
    const { fetchImpl, calls } = makeFetchMock([new Error("network")]);
    await releaseFreebuffSlot(AUTH, { fetchImpl }); // does not throw
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "DELETE");
  });

  it("succeeds on non-OK response", async () => {
    const { fetchImpl } = makeFetchMock([new Response("oops", { status: 500 })]);
    await releaseFreebuffSlot(AUTH, { fetchImpl }); // does not throw
  });
});
