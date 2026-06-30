import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { FREEBUFF_MODELS } from "../../../../src/lib/providers/freebuff/models.ts";
import {
  filterByAccessTier,
  isModelVisibleInLimitedTier,
  listFreeModels,
  groupByTier,
} from "../../../../src/lib/providers/freebuff/freeModelFilter.ts";

describe("freebuff access-tier filter", () => {
  test("limited tier exposes exactly 4 models (acceptance criterion)", () => {
    const limited = filterByAccessTier(FREEBUFF_MODELS, "limited");
    const limitedIds = limited.map((m) => m.id).sort();
    assert.deepEqual(limitedIds, [
      "deepseek/deepseek-v4-flash",
      "mimo/mimo-v2.5",
      "minimax/minimax-m2.7",
      "moonshotai/kimi-k2.6",
    ]);
  });

  test("full tier exposes all 8 models", () => {
    const full = filterByAccessTier(FREEBUFF_MODELS, "full");
    assert.equal(full.length, FREEBUFF_MODELS.length);
    // No model should be dropped on full tier — including premium and referral.
    for (const model of FREEBUFF_MODELS) {
      assert.ok(
        full.some((m) => m.id === model.id),
        `${model.id} must be visible on full tier`,
      );
    }
  });

  test("limited tier hides every premium model without explicit override", () => {
    const limited = filterByAccessTier(FREEBUFF_MODELS, "limited");
    const premiumWithoutOverride = FREEBUFF_MODELS.filter(
      (m) => m.premium && m.limitedTierAccess !== true,
    );
    for (const hidden of premiumWithoutOverride) {
      assert.ok(
        !limited.some((m) => m.id === hidden.id),
        `${hidden.id} must be hidden in limited tier`,
      );
    }
  });

  test("limited tier hides every requiresReferral model", () => {
    const limited = filterByAccessTier(FREEBUFF_MODELS, "limited");
    const referralModels = FREEBUFF_MODELS.filter(
      (m) => m.requiresReferral === true,
    );
    assert.ok(referralModels.length > 0, "test requires at least one referral model");
    for (const referral of referralModels) {
      assert.ok(
        !limited.some((m) => m.id === referral.id),
        `${referral.id} must be hidden in limited tier`,
      );
    }
  });

  test("limited tier keeps kimi-k2.6 despite its premium flag (explicit override)", () => {
    const limited = filterByAccessTier(FREEBUFF_MODELS, "limited");
    assert.ok(
      limited.some((m) => m.id === "moonshotai/kimi-k2.6"),
      "kimi-k2.6 has limitedTierAccess: true and must remain visible",
    );
  });

  test("filterByAccessTier preserves catalog order", () => {
    const limited = filterByAccessTier(FREEBUFF_MODELS, "limited");
    const originalOrder = FREEBUFF_MODELS.map((m) => m.id).filter((id) =>
      ["mimo/mimo-v2.5", "moonshotai/kimi-k2.6", "deepseek/deepseek-v4-flash", "minimax/minimax-m2.7"].includes(id),
    );
    assert.deepEqual(
      limited.map((m) => m.id),
      originalOrder,
    );
  });

  test("filterByAccessTier returns a fresh array — input is not mutated", () => {
    const before = FREEBUFF_MODELS.map((m) => m.id);
    filterByAccessTier(FREEBUFF_MODELS, "limited");
    const after = FREEBUFF_MODELS.map((m) => m.id);
    assert.deepEqual(before, after);
    // And the catalog reference is unchanged.
    assert.equal(FREEBUFF_MODELS.length, 8);
  });

  test("isModelVisibleInLimitedTier agrees with filterByAccessTier for every catalog entry", () => {
    for (const model of FREEBUFF_MODELS) {
      const visible = isModelVisibleInLimitedTier(model);
      const inFiltered = filterByAccessTier(FREEBUFF_MODELS, "limited").some(
        (m) => m.id === model.id,
      );
      assert.equal(
        visible,
        inFiltered,
        `predicate / filter mismatch for ${model.id}`,
      );
    }
  });
});

describe("freebuff model grouping helpers", () => {
  test("listFreeModels returns only non-premium, non-referral models", () => {
    const free = listFreeModels(FREEBUFF_MODELS);
    for (const model of free) {
      assert.equal(model.premium, false);
      assert.notEqual(model.requiresReferral, true);
    }
  });

  test("listFreeModels yields exactly the documented free models", () => {
    const freeIds = listFreeModels(FREEBUFF_MODELS).map((m) => m.id).sort();
    assert.deepEqual(freeIds, [
      "deepseek/deepseek-v4-flash",
      "mimo/mimo-v2.5",
      "minimax/minimax-m2.7",
    ]);
  });

  test("groupByTier partitions the catalog into lite/standard/pro buckets", () => {
    const groups = groupByTier(FREEBUFF_MODELS);
    assert.deepEqual(Object.keys(groups).sort(), ["lite", "pro", "standard"]);

    const liteIds = groups.lite.map((m) => m.id).sort();
    assert.deepEqual(liteIds, [
      "deepseek/deepseek-v4-flash",
      "minimax/minimax-m2.7",
    ]);

    const standardIds = groups.standard.map((m) => m.id).sort();
    assert.deepEqual(standardIds, ["mimo/mimo-v2.5", "moonshotai/kimi-k2.6"]);

    const proIds = groups.pro.map((m) => m.id).sort();
    assert.deepEqual(proIds, [
      "deepseek/deepseek-v4-pro",
      "mimo/mimo-v2.5-pro",
      "minimax/minimax-m3",
      "z-ai/glm-5.2",
    ]);
  });

  test("groupByTier returns frozen arrays", () => {
    const groups = groupByTier(FREEBUFF_MODELS);
    assert.ok(Object.isFrozen(groups.lite));
    assert.ok(Object.isFrozen(groups.standard));
    assert.ok(Object.isFrozen(groups.pro));
    assert.ok(Object.isFrozen(groups));
  });

  test("every catalog entry appears in exactly one tier bucket", () => {
    const groups = groupByTier(FREEBUFF_MODELS);
    const total =
      groups.lite.length + groups.standard.length + groups.pro.length;
    assert.equal(total, FREEBUFF_MODELS.length);
  });
});
