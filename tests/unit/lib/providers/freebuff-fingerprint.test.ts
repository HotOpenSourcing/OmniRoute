import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  computeFreebuffFingerprint,
  computeFreebuffFingerprintSync,
  fingerprintFromPayload,
  fingerprintId,
} from "../../../../src/lib/providers/freebuff/fingerprint.ts";

// ---------------------------------------------------------------------------
// Wire format — Chunk 3 acceptance criterion.
// ---------------------------------------------------------------------------

describe("fingerprint wire format", () => {
  test("fingerprintId matches /^enhanced-[A-Za-z0-9_-]{43}$/", async () => {
    const fp = await computeFreebuffFingerprint();
    assert.match(
      fp.fingerprintId,
      /^enhanced-[A-Za-z0-9_-]{43}$/,
      "fingerprintId must match the observed wire format (43 base64url chars after the prefix)",
    );
  });

  test("fingerprintId starts with the `enhanced-` prefix", async () => {
    const fp = await computeFreebuffFingerprint();
    assert.ok(fp.fingerprintId.startsWith("enhanced-"));
  });

  test("fingerprintHash is a 64-char lowercase hex SHA-256 digest", async () => {
    const fp = await computeFreebuffFingerprint();
    assert.match(fp.fingerprintHash, /^[a-f0-9]{64}$/);
  });

  test("fingerprintHash length is exactly 64 characters", async () => {
    const fp = await computeFreebuffFingerprint();
    assert.equal(fp.fingerprintHash.length, 64);
  });

  test("the base64url body has no `+`, `/`, or `=` padding chars", async () => {
    const fp = await computeFreebuffFingerprint();
    const body = fp.fingerprintId.slice("enhanced-".length);
    assert.doesNotMatch(body, /[+/=]/);
  });
});

// ---------------------------------------------------------------------------
// Determinism — Chunk 3 acceptance criterion.
// ---------------------------------------------------------------------------

describe("fingerprint determinism", () => {
  test("computeFreebuffFingerprintSync returns the same value on every call", () => {
    const a = computeFreebuffFingerprintSync();
    const b = computeFreebuffFingerprintSync();
    assert.equal(a.fingerprintId, b.fingerprintId);
    assert.equal(a.fingerprintHash, b.fingerprintHash);
    assert.equal(a.payload, b.payload);
  });

  test("async and sync variants produce identical results", async () => {
    const sync = computeFreebuffFingerprintSync();
    const async_ = await computeFreebuffFingerprint();
    assert.equal(sync.fingerprintId, async_.fingerprintId);
    assert.equal(sync.fingerprintHash, async_.fingerprintHash);
    assert.equal(sync.payload, async_.payload);
  });

  test("fingerprintId() is a thin alias for computeFreebuffFingerprint().fingerprintId", async () => {
    const id = await fingerprintId();
    const fp = await computeFreebuffFingerprint();
    assert.equal(id, fp.fingerprintId);
  });
});

// ---------------------------------------------------------------------------
// Test seam — fingerprintFromPayload.
// ---------------------------------------------------------------------------

describe("fingerprintFromPayload (test seam)", () => {
  test("produces the documented format for any input", () => {
    const fp = fingerprintFromPayload("hello world");
    assert.match(
      fp.fingerprintId,
      /^enhanced-[A-Za-z0-9_-]{43}$/,
    );
    assert.match(fp.fingerprintHash, /^[a-f0-9]{64}$/);
  });

  test("is deterministic for the same payload", () => {
    const a = fingerprintFromPayload("machine=abc|host=xyz|arch=x64|platform=linux");
    const b = fingerprintFromPayload("machine=abc|host=xyz|arch=x64|platform=linux");
    assert.equal(a.fingerprintId, b.fingerprintId);
    assert.equal(a.fingerprintHash, b.fingerprintHash);
  });

  test("different payloads produce different fingerprints", () => {
    const a = fingerprintFromPayload("machine=A|host=x|arch=x64|platform=linux");
    const b = fingerprintFromPayload("machine=B|host=x|arch=x64|platform=linux");
    assert.notEqual(a.fingerprintId, b.fingerprintId);
    assert.notEqual(a.fingerprintHash, b.fingerprintHash);
  });

  test("different hostnames produce different fingerprints", () => {
    const a = fingerprintFromPayload("machine=x|host=alpha|arch=x64|platform=linux");
    const b = fingerprintFromPayload("machine=x|host=beta|arch=x64|platform=linux");
    assert.notEqual(a.fingerprintId, b.fingerprintId);
  });

  test("case-insensitivity: lowercased inputs hash identically", () => {
    const a = fingerprintFromPayload("machine=ABC|host=XYZ|arch=X64|platform=LINUX");
    const b = fingerprintFromPayload("machine=abc|host=xyz|arch=x64|platform=linux");
    assert.equal(a.fingerprintHash, b.fingerprintHash);
  });
});

// ---------------------------------------------------------------------------
// base64url encoding — direct tests.
// ---------------------------------------------------------------------------

describe("base64url encoding shape", () => {
  test("43-char body decodes back to 32 bytes (256 bits)", () => {
    // 43 chars of base64url = 43 * 6 = 258 bits ≈ 32.25 bytes, but
    // base64url decoders trim padding so 32 bytes is the canonical size.
    const fp = fingerprintFromPayload("verify-roundtrip");
    const body = fp.fingerprintId.slice("enhanced-".length);
    // Re-pad to a multiple of 4 then decode.
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url");
    assert.equal(decoded.length, 32);
  });

  test("decoded bytes match the raw SHA-256 hex of the payload", () => {
    const fp = fingerprintFromPayload("verify-roundtrip");
    const body = fp.fingerprintId.slice("enhanced-".length);
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url");
    const fromHex = Buffer.from(fp.fingerprintHash, "hex");
    assert.deepEqual(decoded, fromHex);
  });
});
