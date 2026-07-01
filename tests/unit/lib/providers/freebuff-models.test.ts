import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  FREEBUFF_MODELS,
  getFreebuffModel,
  hasFreebuffModel,
  listFreebuffModels,
  freebuffModelSchema,
  type FreebuffModel,
} from "../../../../src/lib/providers/freebuff/models.ts";

describe("freebuff models catalog", () => {
  test("FREEBUFF_MODELS contains at least 7 entries (acceptance criterion)", () => {
    assert.ok(
      FREEBUFF_MODELS.length >= 7,
      `expected ≥ 7 models, got ${FREEBUFF_MODELS.length}`,
    );
  });

  test("FREEBUFF_MODELS contains the 8 documented models", () => {
    const expectedIds = [
      "mimo/mimo-v2.5",
      "mimo/mimo-v2.5-pro",
      "minimax/minimax-m3",
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.2",
      "minimax/minimax-m2.7",
    ];
    const actualIds = FREEBUFF_MODELS.map((m) => m.id);
    for (const id of expectedIds) {
      assert.ok(actualIds.includes(id), `catalog missing model id "${id}"`);
    }
  });

  test("every model has unique id", () => {
    const ids = FREEBUFF_MODELS.map((m) => m.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "duplicate model ids in catalog");
  });

  test("every model declares at least the text modality", () => {
    for (const model of FREEBUFF_MODELS) {
      assert.ok(
        model.modalities.includes("text"),
        `model ${model.id} must support text modality`,
      );
    }
  });

  test("MiMo models carry the 128k context window extracted from the binary", () => {
    const mimoV25 = getFreebuffModel("mimo/mimo-v2.5");
    const mimoV25Pro = getFreebuffModel("mimo/mimo-v2.5-pro");
    assert.ok(mimoV25, "mimo-v2.5 must exist");
    assert.ok(mimoV25Pro, "mimo-v2.5-pro must exist");
    assert.equal(mimoV25.contextWindow, 128_000);
    assert.equal(mimoV25Pro.contextWindow, 128_000);
    assert.equal(mimoV25.source, "extracted");
    assert.equal(mimoV25Pro.source, "extracted");
  });

  test("z-ai/glm-5.2 carries the 1M context window extracted from the binary", () => {
    const glm = getFreebuffModel("z-ai/glm-5.2");
    assert.ok(glm, "glm-5.2 must exist");
    assert.equal(glm.contextWindow, 1_000_000);
    assert.equal(glm.source, "extracted");
    assert.equal(glm.requiresReferral, true);
  });

  test("non-binary-sourced models are marked external-default", () => {
    const externalSourceIds = [
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "minimax/minimax-m2.7",
    ];
    for (const id of externalSourceIds) {
      const model = getFreebuffModel(id);
      assert.ok(model, `${id} must exist in catalog`);
      assert.equal(
        model.source,
        "external-default",
        `${id} must be marked external-default per Chunk 6 Open Question`,
      );
    }
  });

  test("deepseek-v4-pro carries the data-training warning", () => {
    const deepseekPro = getFreebuffModel("deepseek/deepseek-v4-pro");
    assert.ok(deepseekPro);
    assert.ok(
      deepseekPro.warnings?.includes("Collects data for training"),
      "deepseek-v4-pro must surface the training warning",
    );
  });

  test("minimax-m3 advertises bedrock as its upstream provider", () => {
    const m3 = getFreebuffModel("minimax/minimax-m3");
    assert.ok(m3);
    assert.equal(m3.upstreamProvider, "bedrock");
  });

  test("mimo-v2.5 carries the free-default tag", () => {
    const mimo = getFreebuffModel("mimo/mimo-v2.5");
    assert.ok(mimo);
    assert.ok(mimo.tags?.includes("free-default"));
  });

  test("kimi-k2.6 is the only premium model with limitedTierAccess override", () => {
    const premiumWithOverride = FREEBUFF_MODELS.filter(
      (m) => m.premium && m.limitedTierAccess === true,
    );
    assert.equal(premiumWithOverride.length, 1);
    assert.equal(premiumWithOverride[0].id, "moonshotai/kimi-k2.6");
  });

  test("getFreebuffModel returns undefined for unknown ids", () => {
    assert.equal(getFreebuffModel("does/not-exist"), undefined);
  });

  test("hasFreebuffModel agrees with getFreebuffModel", () => {
    assert.equal(hasFreebuffModel("mimo/mimo-v2.5"), true);
    assert.equal(hasFreebuffModel("does/not-exist"), false);
  });

  test("listFreebuffModels returns the same array as FREEBUFF_MODELS", () => {
    assert.equal(listFreebuffModels(), FREEBUFF_MODELS);
  });

  test("catalog is frozen so consumers cannot mutate it at runtime", () => {
    assert.ok(Object.isFrozen(FREEBUFF_MODELS));
  });

  test("every entry round-trips through the zod schema", () => {
    for (const model of FREEBUFF_MODELS) {
      const parsed: FreebuffModel = freebuffModelSchema.parse(model);
      assert.deepEqual(parsed, model);
    }
  });
});
