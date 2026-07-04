/**
 * Tests for the Freebuff token-TTL tracking layer (v3.8.43).
 *
 * Captures the contract from
 * `~/.config/manicode/freebuff-model-tests/final-validations.md` C6:
 *   "authToken TTL ≈ 1 hour. The token captured by relogin.ts at 16:34
 *    was still working at 17:33 but rejected as 'Invalid API key' at 17:47."
 *
 * The Freebuff upstream has NO refresh endpoint — the only path to a
 * fresh token is to re-run OAuth PKCE or paste credentials.json. So
 * OmniRoute's job is to:
 *   1. Stamp `tokenExpiresAt` on every connection (when mapTokens runs).
 *   2. Resolve the effective expiry even for old connections persisted
 *      before the field existed (fallback to `loginCompletedAt + 1h`).
 *   3. Compute a status snapshot (`active` / `expiring` / `expired` /
 *      `unknown`) so the dashboard can show a banner with re-auth.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FREEBUFF_TOKEN_TTL_MS,
  effectiveTokenExpiresAt,
  isFreebuffTokenExpiringSoon,
  type FreebuffConnection,
} from "@/shared/schemas/providers/freebuff";

import {
  deriveFreebuffConnectionStatus,
} from "@/lib/providers/freebuff/metaService";

const VALID_FINGERPRINT = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const VALID_TOKEN = "2f56b16e-b7c2-4575-bfd1-ee9c8a1e0309";
const VALID_HASH = "128a4f6cd60e95cc8e71025fead589087bf6b7e3da360353061";

function baseConnection(): FreebuffConnection {
  return {
    authToken: VALID_TOKEN,
    fingerprintId: VALID_FINGERPRINT,
    fingerprintHash: VALID_HASH,
  };
}

describe("FREEBUFF_TOKEN_TTL_MS", () => {
  it("is exactly 1 hour", () => {
    assert.equal(FREEBUFF_TOKEN_TTL_MS, 60 * 60 * 1000);
  });
});

describe("effectiveTokenExpiresAt", () => {
  it("prefers the top-level tokenExpiresAt when present", () => {
    const expiresAt = 1_700_000_000_000;
    const conn: FreebuffConnection = {
      ...baseConnection(),
      tokenExpiresAt: expiresAt,
      loginCompletedAt: 1_600_000_000_000,
    };
    assert.equal(effectiveTokenExpiresAt(conn), expiresAt);
  });

  it("falls back to loginCompletedAt + 1h for legacy connections", () => {
    const loginAt = 1_700_000_000_000;
    const conn: FreebuffConnection = {
      ...baseConnection(),
      loginCompletedAt: loginAt,
    };
    assert.equal(effectiveTokenExpiresAt(conn), loginAt + FREEBUFF_TOKEN_TTL_MS);
  });

  it("falls back to providerSpecificData.tokenExpiresAt when top-level is absent", () => {
    const expiresAt = 1_700_000_000_000;
    const conn: FreebuffConnection = {
      ...baseConnection(),
      loginCompletedAt: 1_600_000_000_000,
      providerSpecificData: { tokenExpiresAt: expiresAt },
    };
    assert.equal(effectiveTokenExpiresAt(conn), expiresAt);
  });

  it("returns undefined when no TTL field is available", () => {
    assert.equal(effectiveTokenExpiresAt(baseConnection()), undefined);
  });
});

describe("isFreebuffTokenExpiringSoon", () => {
  const now = 1_700_000_000_000;

  it("returns false when > 5 min remain", () => {
    const conn: FreebuffConnection = {
      ...baseConnection(),
      tokenExpiresAt: now + 10 * 60 * 1000,
    };
    assert.equal(isFreebuffTokenExpiringSoon(conn, 5 * 60 * 1000, now), false);
  });

  it("returns true when <= 5 min remain", () => {
    const conn: FreebuffConnection = {
      ...baseConnection(),
      tokenExpiresAt: now + 4 * 60 * 1000,
    };
    assert.equal(isFreebuffTokenExpiringSoon(conn, 5 * 60 * 1000, now), true);
  });

  it("returns true when token has already expired", () => {
    const conn: FreebuffConnection = {
      ...baseConnection(),
      tokenExpiresAt: now - 1,
    };
    assert.equal(isFreebuffTokenExpiringSoon(conn, 5 * 60 * 1000, now), true);
  });

  it("returns false when TTL is unknown (does not block)", () => {
    assert.equal(isFreebuffTokenExpiringSoon(baseConnection(), 5 * 60 * 1000, now), false);
  });
});

describe("deriveFreebuffConnectionStatus", () => {
  const now = 1_700_000_000_000;

  it("returns state=active when > 5 min remain", () => {
    const status = deriveFreebuffConnectionStatus(
      "c1",
      { ...baseConnection(), tokenExpiresAt: now + 30 * 60 * 1000 },
      now,
    );
    assert.equal(status.state, "active");
    assert.equal(status.isExpiring, false);
    assert.equal(status.tokenExpiresAt, now + 30 * 60 * 1000);
    assert.equal(status.remainingMs, 30 * 60 * 1000);
    assert.equal(status.hasUnknownTtl, false);
  });

  it("returns state=expiring when <= 5 min remain (banner time)", () => {
    const status = deriveFreebuffConnectionStatus(
      "c2",
      { ...baseConnection(), tokenExpiresAt: now + 3 * 60 * 1000 },
      now,
    );
    assert.equal(status.state, "expiring");
    assert.equal(status.isExpiring, true);
    assert.equal(status.remainingMs, 3 * 60 * 1000);
  });

  it("returns state=expired when the token has elapsed", () => {
    const status = deriveFreebuffConnectionStatus(
      "c3",
      { ...baseConnection(), tokenExpiresAt: now - 1000 },
      now,
    );
    assert.equal(status.state, "expired");
    assert.equal(status.isExpiring, true);
    assert.equal(status.remainingMs, -1000);
  });

  it("returns state=unknown when no TTL field exists", () => {
    const status = deriveFreebuffConnectionStatus("c4", baseConnection(), now);
    assert.equal(status.state, "unknown");
    assert.equal(status.hasUnknownTtl, true);
    assert.equal(status.tokenExpiresAt, null);
    assert.equal(status.remainingMs, null);
    assert.equal(status.isExpiring, false);
  });

  it("falls back to loginCompletedAt + 1h for legacy connections", () => {
    const loginAt = now - 30 * 60 * 1000;
    const status = deriveFreebuffConnectionStatus(
      "c5",
      { ...baseConnection(), loginCompletedAt: loginAt },
      now,
    );
    assert.equal(status.tokenExpiresAt, loginAt + FREEBUFF_TOKEN_TTL_MS);
    assert.equal(status.remainingMs, 30 * 60 * 1000);
    assert.equal(status.state, "active");
  });

  it("honors a custom warningMarginMs", () => {
    const status = deriveFreebuffConnectionStatus(
      "c6",
      { ...baseConnection(), tokenExpiresAt: now + 90 * 1000 },
      now,
      2 * 60 * 1000, // 2-min margin
    );
    assert.equal(status.state, "expiring");
  });
});
