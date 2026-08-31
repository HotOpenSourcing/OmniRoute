/**
 * Unit tests for the Freebuff `agent-runs` handshake
 * (`src/lib/providers/freebuff/agentRuns.ts`).
 *
 * Source: `~/.config/manicode/freebuff-model-tests/phase4-deliverables/
 * 00-PROTOCOL-SPEC.md` §3.4 (captured 2026-07-03) **plus** the empirical
 * header-validation findings in `final-validations.md` Mission 1,
 * which proved that `x-unique-id`, `Cookie: __session=<jwt>`, and any
 * specific `User-Agent` are NOT validated by the server — only
 * `Authorization` is strictly required.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  FreebuffProviderError,
  buildFreebuffHeaders,
  startAgentRun,
  finishAgentRun,
} from "@/lib/providers/freebuff/agentRuns";
import {
  FREEBUFF_AGENT_RUNS_PATH,
  FREEBUFF_DEFAULT_API_BASE,
} from "@/lib/providers/freebuff/base";

// ---------------------------------------------------------------------------
// Mock fetcher helpers.
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function makeFetcher(
  handler: (req: CapturedRequest) => Response,
): { fetcher: typeof fetch; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const req: CapturedRequest = {
      url: typeof input === "string" ? input : (input as URL).href,
      init: init ?? {},
    };
    captured.push(req);
    return handler(req);
  };
  return { fetcher, captured };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CREDENTIALS = {
  authToken: "test-token-xyz",
  fingerprintId: "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw",
  fingerprintHash: "f" + "a".repeat(63),
};

// ---------------------------------------------------------------------------
// buildFreebuffHeaders tests — locked to the validated wire contract.
// ---------------------------------------------------------------------------

test("buildFreebuffHeaders: Authorization + x-codebuff-fingerprint are the only required headers", () => {
  const h = buildFreebuffHeaders(CREDENTIALS);
  assert.equal(h.Authorization, "Bearer test-token-xyz");
  assert.equal(h["x-codebuff-fingerprint"], CREDENTIALS.fingerprintId);
  assert.equal(
    h["x-codebuff-fingerprint-hash"],
    CREDENTIALS.fingerprintHash,
  );
});

test("buildFreebuffHeaders: omits x-unique-id (Mission 1 — server does not validate)", () => {
  const h = buildFreebuffHeaders(CREDENTIALS);
  assert.equal(h["x-unique-id"], undefined);
});

test("buildFreebuffHeaders: omits Cookie (Mission 1 — server does not validate the session cookie)", () => {
  const h = buildFreebuffHeaders(CREDENTIALS);
  assert.equal(h.Cookie, undefined);
  assert.equal(h.cookie, undefined);
});

test("buildFreebuffHeaders: does NOT pin a User-Agent (Mission 1 case 4 — server accepts any UA)", () => {
  const h = buildFreebuffHeaders(CREDENTIALS);
  // We allow `User-Agent` to be present (informational, e.g. for
  // upstream analytics) but it MUST NOT start with `codebuff-cli/...`
  // (that UA was the OLD binary signature; we use `ai-sdk/openai-compatible/...`
  // to match the SDK contract). Either way the server does not care.
  const ua = h["User-Agent"] ?? h["user-agent"];
  if (ua !== undefined) {
    assert.doesNotMatch(
      ua,
      /^codebuff-cli\//,
      "User-Agent should match SDK pattern, not the legacy CLI binary",
    );
  }
});

test("buildFreebuffHeaders: omits fingerprint-hash when not provided", () => {
  const h = buildFreebuffHeaders({
    authToken: "tok",
    fingerprintId: "fid",
  });
  assert.equal(h["x-codebuff-fingerprint"], "fid");
  assert.equal(h["x-codebuff-fingerprint-hash"], undefined);
});

// ---------------------------------------------------------------------------
// startAgentRun tests.
// ---------------------------------------------------------------------------

test("startAgentRun: POSTs to www.codebuff.com/api/v1/agent-runs with START action", async () => {
  const VALID_RUN_ID = "e2812b1c-bee6-4cf5-bb8d-bc9050b7fc1d";
  const { fetcher, captured } = makeFetcher(() =>
    jsonResponse(200, { runId: VALID_RUN_ID }),
  );

  const runId = await startAgentRun({
    credentials: CREDENTIALS,
    agentId: "base2-free-deepseek-flash",
    fetcher,
  });

  assert.equal(runId, VALID_RUN_ID);
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0].url,
    `${FREEBUFF_DEFAULT_API_BASE}${FREEBUFF_AGENT_RUNS_PATH}`,
  );
  assert.equal(captured[0].init.method, "POST");

  const headers = captured[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-token-xyz");
  assert.equal(headers["x-codebuff-fingerprint"], CREDENTIALS.fingerprintId);
  assert.equal(
    headers["x-codebuff-fingerprint-hash"],
    CREDENTIALS.fingerprintHash,
  );
  // Per Mission 1, the server does NOT validate these legacy headers.
  assert.equal(headers["x-unique-id"], undefined);
  assert.equal(headers.Cookie, undefined);

  const body = JSON.parse(captured[0].init.body as string);
  assert.deepEqual(body, {
    action: "START",
    agentId: "base2-free-deepseek-flash",
    ancestorRunIds: [],
  });
});

test("startAgentRun: respects ancestorRunIds when supplied", async () => {
  const { fetcher, captured } = makeFetcher(() =>
    jsonResponse(200, { runId: "r-1" }),
  );

  await startAgentRun({
    credentials: CREDENTIALS,
    agentId: "base2-free-deepseek-flash",
    ancestorRunIds: ["a1b2c3d4-0000-4000-8000-000000000001"],
    fetcher,
  });

  const body = JSON.parse(captured[0].init.body as string);
  assert.deepEqual(body.ancestorRunIds, [
    "a1b2c3d4-0000-4000-8000-000000000001",
  ]);
});

test("startAgentRun: raises FreebuffProviderError on 401", async () => {
  const { fetcher } = makeFetcher(() =>
    jsonResponse(401, {
      error: { message: "Missing or invalid Authorization header" },
    }),
  );

  await assert.rejects(
    () =>
      startAgentRun({
        credentials: CREDENTIALS,
        agentId: "base2-free-deepseek-flash",
        fetcher,
      }),
    (err: unknown) => {
      assert.ok(err instanceof FreebuffProviderError);
      assert.equal((err as FreebuffProviderError).status, 401);
      assert.match((err as Error).message, /HTTP 401/);
      return true;
    },
  );
});

test("startAgentRun: raises FreebuffProviderError on invalid response shape", async () => {
  const { fetcher } = makeFetcher(() =>
    jsonResponse(200, { wrongField: "no runId here" }),
  );

  await assert.rejects(
    () =>
      startAgentRun({
        credentials: CREDENTIALS,
        agentId: "base2-free-deepseek-flash",
        fetcher,
      }),
    (err: unknown) => {
      assert.ok(err instanceof FreebuffProviderError);
      assert.equal((err as FreebuffProviderError).code, "invalid_response");
      return true;
    },
  );
});

test("startAgentRun: raises FreebuffProviderError on network failure", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  await assert.rejects(
    () =>
      startAgentRun({
        credentials: CREDENTIALS,
        agentId: "base2-free-deepseek-flash",
        fetcher,
      }),
    (err: unknown) => {
      assert.ok(err instanceof FreebuffProviderError);
      assert.equal((err as FreebuffProviderError).status, 0);
      assert.equal((err as FreebuffProviderError).code, "network_error");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// finishAgentRun tests.
// ---------------------------------------------------------------------------

test("finishAgentRun: POSTs FINISH action with runId, status, totalSteps, credits", async () => {
  const { fetcher, captured } = makeFetcher(() =>
    jsonResponse(200, { success: true }),
  );

  const ok = await finishAgentRun({
    credentials: CREDENTIALS,
    runId: "r-1",
    status: "completed",
    totalSteps: 5,
    directCredits: 0,
    totalCredits: 0,
    fetcher,
  });

  assert.equal(ok, true);
  assert.equal(captured.length, 1);
  const body = JSON.parse(captured[0].init.body as string);
  assert.deepEqual(body, {
    action: "FINISH",
    runId: "r-1",
    status: "completed",
    totalSteps: 5,
    directCredits: 0,
    totalCredits: 0,
  });
});

test("finishAgentRun: returns false on non-2xx (does not throw)", async () => {
  const { fetcher } = makeFetcher(() =>
    jsonResponse(500, { error: "internal" }),
  );

  const ok = await finishAgentRun({
    credentials: CREDENTIALS,
    runId: "r-1",
    status: "failed",
    totalSteps: 0,
    directCredits: 0,
    totalCredits: 0,
    fetcher,
  });

  assert.equal(ok, false);
});

test("finishAgentRun: returns false on network failure (does not throw)", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("ENOTFOUND www.codebuff.com");
  };

  const ok = await finishAgentRun({
    credentials: CREDENTIALS,
    runId: "r-1",
    status: "canceled",
    totalSteps: 0,
    directCredits: 0,
    totalCredits: 0,
    fetcher,
  });

  assert.equal(ok, false);
});
