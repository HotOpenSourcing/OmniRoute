import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  FreebuffExecutor,
  extractFreebuffCredentials,
} from "../../../../open-sse/executors/freebuff.ts";
import type { ExecuteInput } from "../../../../open-sse/executors/base.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an ExecuteInput with sensible defaults for credential-gating tests.
 * Individual tests override the fields they need to exercise.
 */
function buildInput(
  overrides: Partial<ExecuteInput> & {
    body: unknown;
    credentials: ExecuteInput["credentials"];
  },
): ExecuteInput {
  return {
    model: "glm-5.2",
    stream: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractFreebuffCredentials — credential extraction from OmniRoute shapes.
//
// The executor accepts two storage paths:
//   1. `apiKey` as a JSON blob (legacy meta-service path).
//   2. `accessToken` + `providerSpecificData` (OAuth import-token path).
//
// `fingerprintHash` is REQUIRED on the FreebuffCredentials interface, so
// both paths must produce a complete triple.
// ---------------------------------------------------------------------------

describe("extractFreebuffCredentials — apiKey JSON blob path", () => {
  test("parses a valid credentials.json blob", () => {
    const creds = extractFreebuffCredentials({
      apiKey: JSON.stringify({
        authToken: "tok-abc",
        fingerprintId: "enhanced-abc123",
        fingerprintHash: "hash-xyz",
      }),
    });
    assert.deepEqual(creds, {
      authToken: "tok-abc",
      fingerprintId: "enhanced-abc123",
      fingerprintHash: "hash-xyz",
    });
  });

  test("propagates optional userId / email / name fields when present", () => {
    const creds = extractFreebuffCredentials({
      apiKey: JSON.stringify({
        authToken: "tok-abc",
        fingerprintId: "enhanced-abc123",
        fingerprintHash: "hash-xyz",
        userId: "u1",
        email: "u@example.com",
        name: "User",
      }),
    });
    assert.equal(creds?.userId, "u1");
    assert.equal(creds?.email, "u@example.com");
    assert.equal(creds?.name, "User");
  });

  test("returns null when apiKey is not valid JSON", () => {
    assert.equal(
      extractFreebuffCredentials({ apiKey: "not-json" }),
      null,
    );
  });

  test("returns null when apiKey JSON is missing authToken", () => {
    assert.equal(
      extractFreebuffCredentials({
        apiKey: JSON.stringify({
          fingerprintId: "enhanced-abc",
          fingerprintHash: "h",
        }),
      }),
      null,
    );
  });

  test("returns null when apiKey JSON is missing fingerprintId", () => {
    assert.equal(
      extractFreebuffCredentials({
        apiKey: JSON.stringify({ authToken: "tok", fingerprintHash: "h" }),
      }),
      null,
    );
  });

  test("returns null when apiKey JSON is missing fingerprintHash", () => {
    assert.equal(
      extractFreebuffCredentials({
        apiKey: JSON.stringify({ authToken: "tok", fingerprintId: "enhanced-abc" }),
      }),
      null,
    );
  });

  test("returns null when apiKey is empty", () => {
    assert.equal(extractFreebuffCredentials({ apiKey: "" }), null);
  });
});

describe("extractFreebuffCredentials — accessToken + providerSpecificData path", () => {
  test("parses a valid fingerprint triple", () => {
    const creds = extractFreebuffCredentials({
      accessToken: "tok-bearer",
      providerSpecificData: {
        fingerprintId: "enhanced-" + "a".repeat(43),
        fingerprintHash: "h",
      },
    });
    assert.deepEqual(creds, {
      authToken: "tok-bearer",
      fingerprintId: "enhanced-" + "a".repeat(43),
      fingerprintHash: "h",
    });
  });

  test("returns null when fingerprintId does not match the enhanced-* pattern", () => {
    assert.equal(
      extractFreebuffCredentials({
        accessToken: "tok-bearer",
        providerSpecificData: {
          fingerprintId: "wrong-format",
          fingerprintHash: "h",
        },
      }),
      null,
    );
  });

  test("returns null when fingerprintId is missing entirely", () => {
    assert.equal(
      extractFreebuffCredentials({
        accessToken: "tok-bearer",
        providerSpecificData: { fingerprintHash: "h" },
      }),
      null,
    );
  });

  test("returns null when fingerprintHash is missing", () => {
    assert.equal(
      extractFreebuffCredentials({
        accessToken: "tok-bearer",
        providerSpecificData: {
          fingerprintId: "enhanced-" + "c".repeat(43),
        },
      }),
      null,
    );
  });

  test("returns null when accessToken is missing", () => {
    assert.equal(
      extractFreebuffCredentials({
        providerSpecificData: {
          fingerprintId: "enhanced-" + "d".repeat(43),
          fingerprintHash: "h",
        },
      }),
      null,
    );
  });

  test("apiKey path takes precedence over accessToken path", () => {
    const creds = extractFreebuffCredentials({
      apiKey: JSON.stringify({
        authToken: "from-apiKey",
        fingerprintId: "enhanced-" + "e".repeat(43),
        fingerprintHash: "h",
      }),
      accessToken: "from-accessToken",
      providerSpecificData: {
        fingerprintId: "enhanced-" + "f".repeat(43),
        fingerprintHash: "h2",
      },
    });
    assert.equal(creds?.authToken, "from-apiKey");
  });
});

// ---------------------------------------------------------------------------
// FreebuffExecutor — credential gating.
//
// These tests verify the executor's fail-fast behaviour without actually
// hitting the network. We pass empty / invalid credentials and assert that
// the executor returns a typed JSON Response (not throws).
// ---------------------------------------------------------------------------

describe("FreebuffExecutor — credential gating", () => {
  test("returns 401 when connectionId is missing", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2", messages: [] },
        credentials: {},
      }),
    );
    assert.equal(result.response.status, 401);
    const json = (await result.response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(json.error.type, "authentication_error");
    assert.match(json.error.message, /connection id/i);
  });

  test("returns 401 when connectionId is present but credentials are missing", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2", messages: [] },
        credentials: { connectionId: "conn-1" },
      }),
    );
    assert.equal(result.response.status, 401);
    const json = (await result.response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(json.error.type, "authentication_error");
    assert.match(json.error.message, /credentials/i);
  });

  test("returns 401 when credentials are present but fingerprint is malformed", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2", messages: [] },
        credentials: {
          connectionId: "conn-1",
          accessToken: "tok",
          providerSpecificData: {
            fingerprintId: "bad-format",
            fingerprintHash: "h",
          },
        },
      }),
    );
    assert.equal(result.response.status, 401);
  });

  test("returns 400 when body is missing the model field", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { messages: [] },
        credentials: {
          connectionId: "conn-1",
          accessToken: "tok",
          providerSpecificData: {
            fingerprintId: "enhanced-" + "f".repeat(43),
            fingerprintHash: "h",
          },
        },
      }),
    );
    assert.equal(result.response.status, 400);
    const json = (await result.response.json()) as {
      error: { type: string; message: string };
    };
    assert.equal(json.error.type, "validation_error");
    assert.match(json.error.message, /model/);
  });

  test("returns 400 when body is missing the messages field", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2" },
        credentials: {
          connectionId: "conn-1",
          accessToken: "tok",
          providerSpecificData: {
            fingerprintId: "enhanced-" + "g".repeat(43),
            fingerprintHash: "h",
          },
        },
      }),
    );
    assert.equal(result.response.status, 400);
    const json = (await result.response.json()) as {
      error: { type: string; message: string };
    };
    assert.match(json.error.message, /messages/);
  });

  test("returns 400 when body is not an object", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: "not-an-object",
        credentials: {
          connectionId: "conn-1",
          accessToken: "tok",
          providerSpecificData: {
            fingerprintId: "enhanced-" + "h".repeat(43),
            fingerprintHash: "h",
          },
        },
      }),
    );
    assert.equal(result.response.status, 400);
  });
});

// ---------------------------------------------------------------------------
// FreebuffExecutor — response shape contract.
//
// Verifies the executor returns the documented `{ response, url, headers,
// transformedBody }` shape so combo / account-fallback logic in chatCore
// can react on errors uniformly.
// ---------------------------------------------------------------------------

describe("FreebuffExecutor — response shape", () => {
  test("returns the standard 4-tuple shape on auth failure", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2", messages: [] },
        credentials: {},
      }),
    );
    assert.equal(typeof result.response, "object");
    assert.equal(typeof result.url, "string");
    assert.equal(typeof result.headers, "object");
    assert.ok("Content-Type" in result.headers);
    assert.equal(result.headers["Content-Type"], "application/json");
    assert.deepEqual(result.transformedBody, {
      model: "glm-5.2",
      messages: [],
    });
  });

  test("error responses carry a stable `type` discriminator", async () => {
    const exec = new FreebuffExecutor();
    const result = await exec.execute(
      buildInput({
        body: { model: "glm-5.2", messages: [] },
        credentials: {},
      }),
    );
    const json = (await result.response.json()) as {
      error: { type: string };
    };
    // The discriminator must be one of the documented values so the
    // downstream combo / fallback logic can branch on it.
    assert.ok(
      [
        "authentication_error",
        "validation_error",
        "chain_exhausted",
        "provider_error",
        "unauthenticated",
      ].includes(json.error.type),
      `unexpected error.type: ${json.error.type}`,
    );
  });
});
