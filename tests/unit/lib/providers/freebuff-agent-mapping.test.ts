/**
 * Unit tests for the Freebuff model → upstream `agentId` mapping
 * (`src/lib/providers/freebuff/agentMapping.ts`).
 *
 * Source: upstream `codebuff/common/src/agents/free-buff/*.ts` (each
 * agent file is named `base2-free-<slug>.ts`). Mirror the table so a
 * typo in the slug fails the build.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  getFreebuffAgentId,
  listFreebuffMappedModels,
  generateFreebuffRequestId,
} from "../../../../src/lib/providers/freebuff/agentMapping.ts";

test("getFreebuffAgentId: maps every documented free model", () => {
  const cases: Array<[string, string]> = [
    ["deepseek/deepseek-v4-flash", "base2-free-deepseek-flash"],
    ["deepseek/deepseek-v4-pro", "base2-free-deepseek-v4-pro"],
    ["mimo/mimo-v2.5", "base2-free-mimo-v2.5"],
    ["mimo/mimo-v2.5-pro", "base2-free-mimo-v2.5-pro"],
    ["minimax/minimax-m3", "base2-free-minimax-m3"],
    ["moonshotai/kimi-k2.6", "base2-free-kimi-k2.6"],
    ["z-ai/glm-5.2", "base2-free-glm-5.2"],
  ];
  for (const [modelId, expectedAgentId] of cases) {
    assert.equal(
      getFreebuffAgentId(modelId),
      expectedAgentId,
      `model ${modelId} should map to ${expectedAgentId}`,
    );
  }
});

test("getFreebuffAgentId: returns null for unknown model", () => {
  assert.equal(getFreebuffAgentId("openai/gpt-5"), null);
  assert.equal(getFreebuffAgentId(""), null);
});

test("listFreebuffMappedModels: returns all 7 documented models", () => {
  const models = listFreebuffMappedModels();
  assert.equal(models.length, 7);
  assert.ok(models.includes("deepseek/deepseek-v4-flash"));
  assert.ok(models.includes("z-ai/glm-5.2"));
});

test("generateFreebuffRequestId: returns a 36-char UUIDv4", () => {
  const id = generateFreebuffRequestId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
