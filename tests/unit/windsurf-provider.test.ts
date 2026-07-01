import test from "node:test";
import assert from "node:assert/strict";

import { REGISTRY } from "../../open-sse/config/providerRegistry.ts";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "../../open-sse/config/providerModels.ts";
import {
  WINDSURF_DEFAULT_MAX_OUTPUT_TOKENS,
  WINDSURF_DEFAULT_TOP_K_LIMIT,
  WINDSURF_MODELS,
  getWindsurfUpstreamModelId,
} from "../../open-sse/config/windsurfModels.ts";
import { APIKEY_PROVIDERS, OAUTH_PROVIDERS } from "../../src/shared/constants/providers.ts";

test("Windsurf provider is registered across runtime and UI metadata", () => {
  assert.ok(REGISTRY.windsurf, "windsurf should be present in provider registry");
  assert.equal(REGISTRY.windsurf.alias, "ws");
  assert.equal(REGISTRY.windsurf.executor, "windsurf");
  assert.equal(REGISTRY.windsurf.format, "openai");
  assert.equal(REGISTRY.windsurf.authType, "apikey");
  assert.equal(REGISTRY.windsurf.runtimeCategory, "apikey");
  assert.equal(REGISTRY.windsurf.supportLevel, "experimental-native-runtime");
  assert.equal(PROVIDER_ID_TO_ALIAS.windsurf, "ws");
  assert.equal(APIKEY_PROVIDERS.windsurf, undefined);
  assert.ok(OAUTH_PROVIDERS.windsurf, "windsurf should be present in OAUTH_PROVIDERS");
});

test("Windsurf models expose upstream ids and provider catalog entries", () => {
  assert.equal(WINDSURF_DEFAULT_MAX_OUTPUT_TOKENS, 8192);
  assert.equal(WINDSURF_DEFAULT_TOP_K_LIMIT, 200);
  assert.equal(getWindsurfUpstreamModelId("gpt4o"), 109);
  assert.equal(getWindsurfUpstreamModelId("deepseek-reasoner"), 206);
  assert.equal(getWindsurfUpstreamModelId("missing-model"), null);

  const catalog = PROVIDER_MODELS.ws;
  assert.ok(Array.isArray(catalog), "windsurf alias should expose provider models");
  assert.equal(catalog.length, WINDSURF_MODELS.length);
  assert.ok(catalog.some((model) => model.id === "deepseek-reasoner"));
  assert.ok(catalog.some((model) => model.id === "claude-3-7-sonnet-think"));
});
