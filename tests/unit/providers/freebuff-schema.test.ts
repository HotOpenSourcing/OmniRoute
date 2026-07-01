import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  freebuffConnectionSchema,
  parseFreebuffConnection,
  safeParseFreebuffConnection,
} from "@/shared/schemas/providers/freebuff";

const VALID = {
  authToken: "bab4a848-134b-465e-bc56-d1b795f03c9a",
  fingerprintId: "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw",
};

describe("freebuffConnectionSchema", () => {
  it("accepts a valid minimal payload", () => {
    const parsed = freebuffConnectionSchema.parse(VALID);
    assert.equal(parsed.authToken, VALID.authToken);
    assert.equal(parsed.fingerprintId, VALID.fingerprintId);
  });

  it("accepts a fully-populated payload", () => {
    const full = {
      ...VALID,
      fingerprintHash:
        "0b8c96aa4487aff436dd2abe02d095a06dbaf9fa20f44add773f2e956484059f",
      instanceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      userEmail: "user@example.com",
      accessTier: "limited" as const,
      selectedModel: "mimo/mimo-v2.5",
      loginCompletedAt: Date.now(),
    };
    const parsed = freebuffConnectionSchema.parse(full);
    assert.equal(parsed.accessTier, "limited");
    assert.equal(parsed.selectedModel, "mimo/mimo-v2.5");
    assert.equal(parsed.userEmail, "user@example.com");
  });

  it("rejects a non-UUID authToken", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({ ...VALID, authToken: "not-a-uuid" }),
    );
  });

  it("rejects a fingerprintId without the 'enhanced-' prefix", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({
        ...VALID,
        fingerprintId: "DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw",
      }),
    );
  });

  it("rejects a fingerprintId with wrong length suffix", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({
        ...VALID,
        fingerprintId: "enhanced-tooshort",
      }),
    );
  });

  it("rejects a missing authToken", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({ fingerprintId: VALID.fingerprintId }),
    );
  });

  it("rejects an invalid fingerprintHash (not 64 hex chars)", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({ ...VALID, fingerprintHash: "short" }),
    );
  });

  it("rejects an invalid fingerprintHash (non-hex)", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({
        ...VALID,
        fingerprintHash: "Z".repeat(64),
      }),
    );
  });

  it("safeParse returns success=false on invalid input", () => {
    const r = safeParseFreebuffConnection({ authToken: "x" });
    assert.equal(r.success, false);
  });

  it("safeParse returns success=true on valid input", () => {
    const r = safeParseFreebuffConnection(VALID);
    assert.equal(r.success, true);
  });

  it("parseFreebuffConnection throws on invalid input", () => {
    assert.throws(() => parseFreebuffConnection({ authToken: "x" }));
  });

  it("rejects an invalid accessTier", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({ ...VALID, accessTier: "god-mode" }),
    );
  });

  it("rejects an invalid email", () => {
    assert.throws(() =>
      freebuffConnectionSchema.parse({ ...VALID, userEmail: "not-an-email" }),
    );
  });
});
