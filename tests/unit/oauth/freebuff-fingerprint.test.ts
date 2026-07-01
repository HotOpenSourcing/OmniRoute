import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FREEBUFF_FINGERPRINT_PREFIX,
  FREEBUFF_FINGERPRINT_REGEX,
  assertFidelityWarning,
  captureFreebuffHardwareSnapshot,
  computeFreebuffFingerprintId,
  extractFreebuffFingerprintFromCredentials,
  generateFreebuffFingerprint,
  parseFreebuffCredentialsJson,
  safeParseFreebuffCredentialsJson,
  type FreebuffHardwareSnapshot,
} from "@/lib/oauth/freebuff/fingerprint";

const VALID_AUTH_TOKEN = "bab4a848-134b-465e-bc56-d1b795f03c9a";
const VALID_FINGERPRINT_ID = "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const VALID_FINGERPRINT_HASH =
  "0b8c96aa4487aff436dd2abe02d095a06dbaf9fa20f44add773f2e956484059f";

/** Build a stable fake snapshot for deterministic tests. */
function makeFakeSnapshot(
  overrides: Partial<FreebuffHardwareSnapshot> = {},
): FreebuffHardwareSnapshot {
  return {
    system: { manufacturer: "Dell", model: "XPS", serial: "ABC123", uuid: "uuid-1" },
    cpu: { manufacturer: "Intel", brand: "Core i7", cores: 8, physicalCores: 4 },
    os: {
      platform: "linux",
      distro: "Ubuntu",
      arch: "x64",
      hostname: "host-a",
    },
    runtime: {
      nodeVersion: "v22.0.0",
      platform: "linux",
      arch: "x64",
      shell: "/bin/bash",
      cpuCount: 8,
    },
    network: {
      macAddresses: ["aa:bb:cc:dd:ee:ff"],
      interfaceCount: 1,
    },
    machineId: "machine-id-1",
    fingerprintVersion: "2.0",
    ...overrides,
  };
}

describe("computeFreebuffFingerprintId", () => {
  it("produces a string starting with 'enhanced-' followed by 43 base64url chars", () => {
    const id = computeFreebuffFingerprintId(makeFakeSnapshot());
    assert.equal(id.length, 9 + 43); // "enhanced-" (9 chars) + 43
    assert.ok(id.startsWith(FREEBUFF_FINGERPRINT_PREFIX));
    assert.match(id, FREEBUFF_FINGERPRINT_REGEX);
  });

  it("is deterministic for the same snapshot", () => {
    const snap = makeFakeSnapshot();
    const a = computeFreebuffFingerprintId(snap);
    const b = computeFreebuffFingerprintId(snap);
    assert.equal(a, b);
  });

  it("differs when the snapshot differs in any field", () => {
    const a = computeFreebuffFingerprintId(makeFakeSnapshot());
    const b = computeFreebuffFingerprintId(
      makeFakeSnapshot({
        os: {
          platform: "linux",
          distro: "Ubuntu",
          arch: "x64",
          hostname: "host-b",
        },
      }),
    );
    assert.notEqual(a, b);
  });

  it("is invariant under property insertion order (canonical JSON)", () => {
    const snap = makeFakeSnapshot();
    // Re-build the same snapshot by re-ordering keys
    const reordered: FreebuffHardwareSnapshot = {
      fingerprintVersion: snap.fingerprintVersion,
      machineId: snap.machineId,
      network: snap.network,
      runtime: snap.runtime,
      os: snap.os,
      cpu: snap.cpu,
      system: snap.system,
    };
    assert.equal(computeFreebuffFingerprintId(snap), computeFreebuffFingerprintId(reordered));
  });
});

describe("generateFreebuffFingerprint", () => {
  it("returns a snapshot and an id derived from it", () => {
    const { fingerprintId, snapshot } = generateFreebuffFingerprint();
    assert.match(fingerprintId, FREEBUFF_FINGERPRINT_REGEX);
    assert.equal(fingerprintId, computeFreebuffFingerprintId(snapshot));
  });
});

describe("captureFreebuffHardwareSnapshot", () => {
  it("returns a snapshot with the expected shape", () => {
    const snap = captureFreebuffHardwareSnapshot();
    assert.equal(typeof snap.system, "object");
    assert.equal(typeof snap.cpu, "object");
    assert.equal(typeof snap.os, "object");
    assert.equal(typeof snap.runtime, "object");
    assert.equal(typeof snap.network, "object");
    assert.equal(snap.fingerprintVersion, "2.0");
    assert.ok(Array.isArray(snap.network.macAddresses));
    assert.ok(snap.network.interfaceCount >= 0);
  });

  it("filters out internal and zero MACs", () => {
    const snap = captureFreebuffHardwareSnapshot();
    for (const mac of snap.network.macAddresses) {
      assert.notEqual(mac, "00:00:00:00:00:00");
    }
  });
});

describe("assertFidelityWarning", () => {
  it("returns lowFidelity:false for a fully-populated snapshot", () => {
    const result = assertFidelityWarning(makeFakeSnapshot());
    assert.equal(result.lowFidelity, false);
  });

  it("warns when system info is empty (server-side / Docker)", () => {
    const snap = makeFakeSnapshot({
      system: { manufacturer: "", model: "", serial: "", uuid: "" },
    });
    const result = assertFidelityWarning(snap);
    assert.equal(result.lowFidelity, true);
    if (result.lowFidelity) {
      assert.ok(result.reasons.some((r) => r.includes("systeminformation")));
    }
  });

  it("warns when there are no external MACs", () => {
    const snap = makeFakeSnapshot({
      network: { macAddresses: [], interfaceCount: 0 },
    });
    const result = assertFidelityWarning(snap);
    assert.equal(result.lowFidelity, true);
    if (result.lowFidelity) {
      assert.ok(result.reasons.some((r) => r.toLowerCase().includes("mac")));
    }
  });

  it("warns when machineId is missing", () => {
    const snap = makeFakeSnapshot({ machineId: "" });
    const result = assertFidelityWarning(snap);
    assert.equal(result.lowFidelity, true);
    if (result.lowFidelity) {
      assert.ok(result.reasons.some((r) => r.toLowerCase().includes("machineid")));
    }
  });
});

describe("parseFreebuffCredentialsJson", () => {
  const validJson = JSON.stringify({
    anonymousId: "anon_70b56586-cd48-48a1-a8bc-917d25f99a0c",
    default: {
      id: "3007ab39-7390-4812-a4e3-0f71087ed9ea",
      name: "Twi Ti",
      email: "amine.twiti17@gmail.com",
      authToken: VALID_AUTH_TOKEN,
      fingerprintId: VALID_FINGERPRINT_ID,
      fingerprintHash: VALID_FINGERPRINT_HASH,
    },
  });

  it("accepts a real-world credentials.json payload", () => {
    const parsed = parseFreebuffCredentialsJson(validJson);
    assert.equal(parsed.default.authToken, VALID_AUTH_TOKEN);
    assert.equal(parsed.default.fingerprintId, VALID_FINGERPRINT_ID);
    assert.equal(parsed.default.fingerprintHash, VALID_FINGERPRINT_HASH);
    assert.equal(parsed.default.email, "amine.twiti17@gmail.com");
    assert.equal(parsed.anonymousId, "anon_70b56586-cd48-48a1-a8bc-917d25f99a0c");
  });

  it("ignores extra fields (passthrough)", () => {
    const withExtras = JSON.stringify({
      default: {
        authToken: VALID_AUTH_TOKEN,
        fingerprintId: VALID_FINGERPRINT_ID,
        extraUnknownField: "should not throw",
      },
      moreExtras: { foo: "bar" },
    });
    const parsed = parseFreebuffCredentialsJson(withExtras);
    assert.equal(parsed.default.authToken, VALID_AUTH_TOKEN);
  });

  it("rejects an authToken that is empty", () => {
    assert.throws(() =>
      parseFreebuffCredentialsJson(
        JSON.stringify({
          default: { authToken: "", fingerprintId: VALID_FINGERPRINT_ID },
        }),
      ),
    );
  });

  it("rejects a fingerprintId that does not match the regex", () => {
    assert.throws(() =>
      parseFreebuffCredentialsJson(
        JSON.stringify({
          default: { authToken: VALID_AUTH_TOKEN, fingerprintId: "bad" },
        }),
      ),
    );
  });

  it("rejects invalid JSON syntax", () => {
    assert.throws(() => parseFreebuffCredentialsJson("not json {"));
  });

  it("safeParse returns ok:false on invalid JSON", () => {
    const r = safeParseFreebuffCredentialsJson("not json {");
    assert.equal(r.success, false);
  });

  it("safeParse returns ok:true on valid JSON", () => {
    const r = safeParseFreebuffCredentialsJson(validJson);
    assert.equal(r.success, true);
  });
});

describe("extractFreebuffFingerprintFromCredentials", () => {
  it("returns the default profile fields", () => {
    const parsed = parseFreebuffCredentialsJson(
      JSON.stringify({
        default: {
          id: "user-uuid-1",
          email: "u@example.com",
          authToken: VALID_AUTH_TOKEN,
          fingerprintId: VALID_FINGERPRINT_ID,
          fingerprintHash: VALID_FINGERPRINT_HASH,
        },
      }),
    );
    const extracted = extractFreebuffFingerprintFromCredentials(parsed);
    assert.deepEqual(extracted, {
      authToken: VALID_AUTH_TOKEN,
      fingerprintId: VALID_FINGERPRINT_ID,
      fingerprintHash: VALID_FINGERPRINT_HASH,
      userId: "user-uuid-1",
      userEmail: "u@example.com",
    });
  });

  it("returns null when default profile is missing", () => {
    const parsed = parseFreebuffCredentialsJson(
      JSON.stringify({
        anonymousId: "anon",
      }),
    );
    assert.equal(extractFreebuffFingerprintFromCredentials(parsed), null);
  });
});
