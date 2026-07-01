import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FREEBUFF_ANTHROPIC_MESSAGES_PATH,
  FREEBUFF_FREEBUFF_BASE_URL,
  FREEBUFF_OPENAI_CHAT_PATH,
  getFreebuffAnthropicEndpoint,
  getFreebuffOpenAIEndpoint,
  getFreebuffProviderConfig,
  isFreebuffEnabled,
  resolveFreebuffBaseUrl,
} from "@/lib/providers/freebuff";

const ORIG_ENABLED = process.env.FREEBUFF_ENABLED;
const ORIG_TIER = process.env.FREEBUFF_TIER;

after(() => {
  if (ORIG_ENABLED === undefined) delete process.env.FREEBUFF_ENABLED;
  else process.env.FREEBUFF_ENABLED = ORIG_ENABLED;
  if (ORIG_TIER === undefined) delete process.env.FREEBUFF_TIER;
  else process.env.FREEBUFF_TIER = ORIG_TIER;
});

describe("barrel exports", () => {
  it("re-exports expected constants and functions", () => {
    assert.equal(typeof isFreebuffEnabled, "function");
    assert.equal(typeof resolveFreebuffBaseUrl, "function");
    assert.equal(typeof getFreebuffProviderConfig, "function");
    assert.equal(typeof getFreebuffOpenAIEndpoint, "function");
    assert.equal(typeof getFreebuffAnthropicEndpoint, "function");
    assert.equal(typeof FREEBUFF_OPENAI_CHAT_PATH, "string");
    assert.equal(typeof FREEBUFF_ANTHROPIC_MESSAGES_PATH, "string");
  });
});

describe("getFreebuffProviderConfig", () => {
  it("returns null when the provider is disabled", () => {
    delete process.env.FREEBUFF_ENABLED;
    delete process.env.FREEBUFF_TIER;
    assert.equal(getFreebuffProviderConfig(), null);
  });

  it("returns a config when enabled with default tier", () => {
    process.env.FREEBUFF_ENABLED = "1";
    delete process.env.FREEBUFF_TIER;
    const cfg = getFreebuffProviderConfig();
    assert.ok(cfg);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.providerId, "freebuff");
    assert.equal(cfg.baseUrl, FREEBUFF_FREEBUFF_BASE_URL);
    assert.equal(cfg.openaiChatPath, FREEBUFF_OPENAI_CHAT_PATH);
    assert.equal(cfg.anthropicMessagesPath, FREEBUFF_ANTHROPIC_MESSAGES_PATH);
    assert.match(cfg.credentialsPath, /credentials\.json$/);
  });
});

describe("endpoint helpers throw when disabled", () => {
  it("getFreebuffOpenAIEndpoint throws", () => {
    delete process.env.FREEBUFF_ENABLED;
    assert.throws(() => getFreebuffOpenAIEndpoint(), /FREEBUFF_ENABLED=1/);
  });

  it("getFreebuffAnthropicEndpoint throws", () => {
    delete process.env.FREEBUFF_ENABLED;
    assert.throws(() => getFreebuffAnthropicEndpoint(), /FREEBUFF_ENABLED=1/);
  });
});

describe("endpoint helpers return full URLs when enabled", () => {
  it("getFreebuffOpenAIEndpoint returns the OpenAI-compat URL", () => {
    process.env.FREEBUFF_ENABLED = "1";
    delete process.env.FREEBUFF_TIER;
    const url = getFreebuffOpenAIEndpoint();
    assert.equal(
      url,
      `${FREEBUFF_FREEBUFF_BASE_URL}${FREEBUFF_OPENAI_CHAT_PATH}`,
    );
  });

  it("getFreebuffAnthropicEndpoint returns the Anthropic-compat URL", () => {
    process.env.FREEBUFF_ENABLED = "1";
    process.env.FREEBUFF_TIER = "free";
    const url = getFreebuffAnthropicEndpoint();
    assert.equal(
      url,
      `${FREEBUFF_FREEBUFF_BASE_URL}${FREEBUFF_ANTHROPIC_MESSAGES_PATH}`,
    );
  });
});
