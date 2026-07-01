/**
 * Access-tier filtering for the Freebuff model catalog.
 *
 * `filterByAccessTier` is the single source of truth for what models a
 * given OmniRoute user is allowed to see. It is called by the provider
 * adapter (`provider.listModels()`) and by the UI when rendering the
 * providers dashboard.
 *
 * Rules (mirrored from `models.ts`):
 *
 *   - `full` tier: every model is returned, including premium and
 *     referral-locked ones.
 *   - `limited` tier:
 *       * Drop models where `requiresReferral === true`.
 *       * Drop models where `premium === true && limitedTierAccess !== true`.
 *       * Everything else (free models + explicitly-promoted premium
 *         models like `moonshotai/kimi-k2.6`) is kept.
 *
 * The function is pure — it never mutates the input array, and accepts
 * the catalog as a parameter so tests can drive it with fixtures.
 */

import {
  type FreebuffAccessTier,
  type FreebuffModel,
} from "./models.ts";

/**
 * Returns the subset of `models` visible to a user on `accessTier`.
 *
 * The returned array is a fresh `FreebuffModel[]` (safe to mutate).
 * Ordering is preserved from the input catalog.
 */
export function filterByAccessTier(
  models: readonly FreebuffModel[],
  accessTier: FreebuffAccessTier,
): FreebuffModel[] {
  if (accessTier === "full") {
    return models.slice();
  }
  return models.filter((model) => isModelVisibleInLimitedTier(model));
}

/**
 * Predicate form — true when `model` is exposed to a `limited`-tier user.
 *
 * Centralised so individual routes and the dashboard share the same rule.
 */
export function isModelVisibleInLimitedTier(model: FreebuffModel): boolean {
  if (model.requiresReferral === true) return false;
  if (model.premium && model.limitedTierAccess !== true) return false;
  return true;
}

/**
 * Convenience: returns only the free (non-premium, non-referral) models.
 * Useful for the landing page hero and for analytics dashboards that
 * track conversion from `limited` → `full` tier.
 */
export function listFreeModels(
  models: readonly FreebuffModel[],
): FreebuffModel[] {
  return models.filter((m) => !m.premium && !m.requiresReferral);
}

/**
 * Group the catalog by `tier` for the dashboard rendering layer.
 *
 * Returns a frozen record with stable key order. Missing tiers are
 * present as empty arrays so consumers don't need to null-check.
 */
export function groupByTier(
  models: readonly FreebuffModel[],
): Record<"lite" | "standard" | "pro", FreebuffModel[]> {
  const grouped: Record<"lite" | "standard" | "pro", FreebuffModel[]> = {
    lite: [],
    standard: [],
    pro: [],
  };
  for (const model of models) {
    grouped[model.tier].push(model);
  }
  return Object.freeze({
    lite: Object.freeze(grouped.lite),
    standard: Object.freeze(grouped.standard),
    pro: Object.freeze(grouped.pro),
  });
}
