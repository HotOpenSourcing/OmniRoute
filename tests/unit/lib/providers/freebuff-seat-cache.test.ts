/**
 * Tests for the Freebuff in-memory seat cache (`src/lib/providers/freebuff/seatCache.ts`).
 *
 * Locks in the contract discovered in
 * `~/.config/manicode/freebuff-model-tests/final-validations.md`:
 *   - C5: Session TTL = 1 hour flat.
 *   - C8: `superseded` transitions are immediate (no grace period).
 *
 * The cache must:
 *   1. Reuse a fresh cached seat (avoid re-claim on every chat).
 *   2. Proactively refresh ~5 min before expiry.
 *   3. Coalesce concurrent claims for the same (connection, model).
 *   4. Invalidate on demand (used when the upstream returns `superseded`).
 *   5. Reject non-`active` upstream statuses (country_blocked, banned, …).
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  ensureFreebuffSeat,
  invalidateFreebuffSeat,
  getFreebuffSeatCacheSize,
  __resetFreebuffSeatCacheForTests,
} from "@/lib/providers/freebuff/seatCache";

const AUTH_TOKEN = "2f56b16e-b7c2-4575-bfd1-ee9c8a1e0309";
const CONN_ID = "conn-1";
const MODEL = "deepseek/deepseek-v4-flash";

function makeActiveResponse(instanceId: string, expiresInMs: number): unknown {
  return {
    status: "active",
    instanceId,
    model: MODEL,
    admittedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    remainingMs: expiresInMs,
  };
}

function makeFetchMock(response: unknown): typeof fetch {
  let calls = 0;
  return (async () => {
    calls++;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("ensureFreebuffSeat", () => {
  beforeEach(() => {
    __resetFreebuffSeatCacheForTests();
  });

  it("claims a seat on first call and returns the instanceId", async () => {
    const fetcher = makeFetchMock(makeActiveResponse("inst-A", 60 * 60 * 1000));
    const seat = await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(seat.instanceId, "inst-A");
    assert.equal(seat.model, MODEL);
    assert.equal(getFreebuffSeatCacheSize(), 1);
  });

  it("reuses the cached seat on a subsequent call (no second claim)", async () => {
    let claimCount = 0;
    const fetcher = (async () => {
      claimCount++;
      return new Response(
        JSON.stringify(makeActiveResponse(`inst-${claimCount}`, 60 * 60 * 1000)),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const first = await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    const second = await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(first.instanceId, second.instanceId);
    assert.equal(claimCount, 1, "must claim exactly once when seat is fresh");
  });

  it("re-claims when the cached seat has expired", async () => {
    let claimCount = 0;
    const fetcher = (async () => {
      claimCount++;
      // First call: 1-second TTL. Second call: 1-hour TTL.
      const ttl = claimCount === 1 ? 1 : 60 * 60 * 1000;
      return new Response(
        JSON.stringify(makeActiveResponse(`inst-${claimCount}`, ttl)),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const first = await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
      refreshMarginMs: 0,
    });
    // Wait for the 1-second seat to expire (plus a small buffer).
    await new Promise((r) => setTimeout(r, 1100));
    const second = await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
      refreshMarginMs: 0,
    });
    assert.notEqual(first.instanceId, second.instanceId);
    assert.equal(claimCount, 2);
  });

  it("proactively refreshes when the seat is within the safety margin", async () => {
    let claimCount = 0;
    const fetcher = (async () => {
      claimCount++;
      // First seat expires in 2 minutes. With a 5-minute safety margin,
      // the next call should refresh BEFORE 2 minutes have elapsed.
      const ttl = claimCount === 1 ? 2 * 60 * 1000 : 60 * 60 * 1000;
      return new Response(
        JSON.stringify(makeActiveResponse(`inst-${claimCount}`, ttl)),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    // Immediate second call — seat is within the safety margin so we re-claim.
    await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(claimCount, 2, "must refresh when within safety margin");
  });

  it("scopes the cache per (connectionId, modelId)", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify(makeActiveResponse("shared", 60 * 60 * 1000)), {
        status: 200,
      })) as unknown as typeof fetch;
    await ensureFreebuffSeat({
      connectionId: "conn-A",
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    await ensureFreebuffSeat({
      connectionId: "conn-B",
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(getFreebuffSeatCacheSize(), 2);
  });

  it("rejects non-active upstream statuses", async () => {
    const fetcher = makeFetchMock({
      status: "country_blocked",
      countryCode: "TN",
      countryBlockReason: "anonymous_network",
    });
    await assert.rejects(
      () =>
        ensureFreebuffSeat({
          connectionId: CONN_ID,
          modelId: MODEL,
          authToken: AUTH_TOKEN,
          fetcher,
        }),
      /country_blocked/,
    );
  });

  it("rejects banned upstream status", async () => {
    const fetcher = makeFetchMock({ status: "banned" });
    await assert.rejects(
      () =>
        ensureFreebuffSeat({
          connectionId: CONN_ID,
          modelId: MODEL,
          authToken: AUTH_TOKEN,
          fetcher,
        }),
      /banned/,
    );
  });
});

describe("invalidateFreebuffSeat", () => {
  beforeEach(() => {
    __resetFreebuffSeatCacheForTests();
  });

  it("drops a single (connection, model) entry", async () => {
    const fetcher = makeFetchMock(makeActiveResponse("inst-A", 60 * 60 * 1000));
    await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(getFreebuffSeatCacheSize(), 1);
    invalidateFreebuffSeat(CONN_ID, MODEL);
    assert.equal(getFreebuffSeatCacheSize(), 0);
  });

  it("drops all models for a connection when modelId is omitted", async () => {
    const fetcher = makeFetchMock(makeActiveResponse("inst-A", 60 * 60 * 1000));
    await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: MODEL,
      authToken: AUTH_TOKEN,
      fetcher,
    });
    await ensureFreebuffSeat({
      connectionId: CONN_ID,
      modelId: "mimo/mimo-v2.5",
      authToken: AUTH_TOKEN,
      fetcher,
    });
    assert.equal(getFreebuffSeatCacheSize(), 2);
    invalidateFreebuffSeat(CONN_ID);
    assert.equal(getFreebuffSeatCacheSize(), 0);
  });
});
