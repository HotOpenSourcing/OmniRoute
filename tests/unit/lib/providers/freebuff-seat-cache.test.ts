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
  withFreebuffChatLock,
  getFreebuffChatLockCount,
  __resetFreebuffSeatCacheForTests,
  __resetFreebuffChatLocksForTests,
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

/**
 * Per-connection chat mutex (C8). Locks the ENTIRE chat flow per
 * `connectionId` so the upstream never sees two simultaneous writes for
 * the same token (otherwise the no-grace-period `superseded`
 * transition kicks in and we get a 4xx back).
 */
describe("withFreebuffChatLock", () => {
  beforeEach(() => {
    __resetFreebuffChatLocksForTests();
  });

  it("returns the inner function's resolved value", async () => {
    const result = await withFreebuffChatLock("conn-1", async () => 42);
    assert.equal(result, 42);
  });

  it("rethrows the inner function's rejection", async () => {
    await assert.rejects(
      () =>
        withFreebuffChatLock("conn-1", async () => {
          throw new Error("kaboom");
        }),
      /kaboom/,
    );
  });

  it("serialises concurrent callers targeting the same connectionId", async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(label);
      return label;
    };

    // Fire two calls "simultaneously". The second MUST wait for the
    // first to release — proven by the order array (A finishes before
    // B starts).
    const a = withFreebuffChatLock("conn-1", slow("A", 30));
    const b = withFreebuffChatLock("conn-1", slow("B", 5));

    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, "A");
    assert.equal(rb, "B");
    assert.deepEqual(order, ["A", "B"]);
  });

  it("does NOT serialise callers targeting different connectionIds", async () => {
    const order: string[] = [];
    const tag = (label: string, ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      order.push(label);
    };

    // Two different connections run in parallel — both finish in the
    // shorter time, and order is NOT deterministic (proves parallel).
    const start = Date.now();
    await Promise.all([
      withFreebuffChatLock("conn-A", tag("A", 30)),
      withFreebuffChatLock("conn-B", tag("B", 30)),
    ]);
    const elapsed = Date.now() - start;
    // If serialised, this would take ≥ 60 ms. If parallel, ~30 ms.
    assert.ok(
      elapsed < 55,
      `expected parallel execution (<55 ms), took ${elapsed} ms`,
    );
  });

  it("releases the lock even when the inner function throws", async () => {
    await assert.rejects(
      () =>
        withFreebuffChatLock("conn-1", async () => {
          throw new Error("first call fails");
        }),
      /first call fails/,
    );
    // After the failure, a second call must succeed immediately (no
    // stuck lock).
    let secondRan = false;
    await withFreebuffChatLock("conn-1", async () => {
      secondRan = true;
    });
    assert.equal(secondRan, true);
  });

  it("exposes the lock count for observability", async () => {
    assert.equal(getFreebuffChatLockCount(), 0);
    let resolveInner!: () => void;
    const blocker = new Promise<void>((r) => {
      resolveInner = r;
    });
    const holding = withFreebuffChatLock("conn-obs", () => blocker);
    // Give the lock a microtask to register.
    await new Promise((r) => setImmediate(r));
    assert.equal(getFreebuffChatLockCount(), 1);
    resolveInner();
    await holding;
    // After release the count drops back to 0 (microtask GC).
    await new Promise((r) => setImmediate(r));
    assert.equal(getFreebuffChatLockCount(), 0);
  });
});
