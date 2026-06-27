import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zaiCodingPlan } from "../../src/lib/oauth/providers/zaiCodingPlan";
import { ZAI_CODING_PLAN_CONFIG } from "../../src/lib/oauth/constants/oauth";
import { zaiCodingPlanProvider } from "../../open-sse/config/providers/registry/zai-coding-plan/index";

// Correct OAuth endpoints extracted from ZCode app.asar
const AUTHORIZE_URL = "https://chat.z.ai/api/oauth/authorize";
const TOKEN_URL = "https://zcode.z.ai/api/v1/oauth/token";
const USERINFO_URL = "https://chat.z.ai/api/oauth/userinfo";
const BUSINESS_LOGIN_URL = "https://api.z.ai/api/auth/z/login";
const CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";

describe("Z.AI Coding Plan OAuth Provider", () => {
  describe("config", () => {
    it("should have correct authorize URL (chat.z.ai/api/oauth/authorize)", () => {
      assert.strictEqual(zaiCodingPlan.config.authorizeUrl, AUTHORIZE_URL);
    });

    it("should have token exchange URL", () => {
      assert.strictEqual(zaiCodingPlan.config.tokenUrl, TOKEN_URL);
    });

    it("should have userinfo URL", () => {
      assert.strictEqual(zaiCodingPlan.config.userinfoUrl, USERINFO_URL);
    });

    it("should have business login URL", () => {
      assert.strictEqual(zaiCodingPlan.config.businessLoginUrl, BUSINESS_LOGIN_URL);
    });

    it("should resolve client_id from embedded credentials", () => {
      assert.ok(zaiCodingPlan.config.clientId, "clientId should be non-empty");
      assert.strictEqual(
        zaiCodingPlan.config.clientId,
        CLIENT_ID,
        "clientId should match the public credential from ZCode binary",
      );
    });

    it("should have correct native redirect URI (zcode:// scheme)", () => {
      assert.strictEqual(zaiCodingPlan.config.redirectUri, "zcode://zai-auth/callback");
    });

    it("should have correct API base URL", () => {
      assert.strictEqual(
        zaiCodingPlan.config.apiBaseUrl,
        "https://zcode.z.ai/api/v1/zcode-plan/anthropic",
      );
    });
  });

  describe("flowType", () => {
    it("should be authorization_code", () => {
      assert.strictEqual(zaiCodingPlan.flowType, "authorization_code");
    });
  });

  describe("buildAuthUrl", () => {
    it("should build correct authorization URL with client_id and state", () => {
      const redirectUri = "http://localhost:20128/api/oauth/callback";
      const state = "test_state_abc";

      const authUrl = zaiCodingPlan.buildAuthUrl(
        ZAI_CODING_PLAN_CONFIG,
        redirectUri,
        state,
      );

      assert.ok(authUrl.startsWith(`${AUTHORIZE_URL}?`));
      assert.ok(authUrl.includes("response_type=code"));
      assert.ok(authUrl.includes(`client_id=${CLIENT_ID}`));
      assert.ok(authUrl.includes(`redirect_uri=${encodeURIComponent(redirectUri)}`));
      assert.ok(authUrl.includes(`state=${state}`));
    });

    it("should use zcode:// redirect URI when passed", () => {
      const redirectUri = "zcode://zai-auth/callback";
      const state = "zcode_state_xyz";

      const authUrl = zaiCodingPlan.buildAuthUrl(
        ZAI_CODING_PLAN_CONFIG,
        redirectUri,
        state,
      );

      assert.ok(authUrl.includes(`redirect_uri=${encodeURIComponent(redirectUri)}`));
    });

    it("should NOT include code_challenge (no PKCE)", () => {
      const authUrl = zaiCodingPlan.buildAuthUrl(
        ZAI_CODING_PLAN_CONFIG,
        "http://localhost:20128/api/oauth/callback",
        "state",
      );

      assert.ok(!authUrl.includes("code_challenge"));
      assert.ok(!authUrl.includes("code_challenge_method"));
    });
  });

  describe("exchangeToken", () => {
    it("should validate code-... prefix before calling token endpoint", async () => {
      await assert.rejects(
        () =>
          zaiCodingPlan.exchangeToken(
            ZAI_CODING_PLAN_CONFIG,
            "invalid-token-123",
            "http://localhost:20128/api/oauth/callback",
          ),
        { message: /Invalid Z.AI authorization code/ },
      );
    });

    it("should reject empty codes", async () => {
      await assert.rejects(
        () =>
          zaiCodingPlan.exchangeToken(
            ZAI_CODING_PLAN_CONFIG,
            "",
            "http://localhost:20128/api/oauth/callback",
          ),
        { message: /Invalid Z.AI authorization code/ },
      );
    });
  });

  describe("mapTokens", () => {
    it("should map tokens with refresh_token to OmniRoute format", () => {
      const mapped = zaiCodingPlan.mapTokens({
        access_token: "za_test_access_token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "za_test_refresh_token",
        scope: "coding",
      });

      assert.strictEqual(mapped.accessToken, "za_test_access_token");
      assert.strictEqual(mapped.refreshToken, "za_test_refresh_token");
      assert.strictEqual(mapped.idToken, null);
      assert.strictEqual(mapped.expiresIn, 3600);
      assert.strictEqual(mapped.scope, "coding");
    });

    it("should handle missing refresh token", () => {
      const mapped = zaiCodingPlan.mapTokens({
        access_token: "za_test_token",
        token_type: "Bearer",
      });

      assert.strictEqual(mapped.accessToken, "za_test_token");
      assert.strictEqual(mapped.refreshToken, null);
      assert.strictEqual(mapped.expiresIn, null);
      assert.strictEqual(mapped.scope, "coding");
    });

    it("should pass through expires_in when present", () => {
      const mapped = zaiCodingPlan.mapTokens({
        access_token: "za_token",
        token_type: "Bearer",
        expires_in: 7200,
      });

      assert.strictEqual(mapped.expiresIn, 7200);
    });
  });
});

describe("Z.AI Coding Plan Registry Entry", () => {
  it("should have correct id and format", () => {
    assert.strictEqual(zaiCodingPlanProvider.id, "zai-coding-plan");
    assert.strictEqual(zaiCodingPlanProvider.format, "claude");
    assert.strictEqual(zaiCodingPlanProvider.authType, "bearer");
    assert.strictEqual(zaiCodingPlanProvider.authHeader, "authorization");
  });

  it("should have 2 models", () => {
    assert.strictEqual(zaiCodingPlanProvider.models.length, 2);
  });

  it("should declare GLM 5.2 with correct contextLength", () => {
    const m = zaiCodingPlanProvider.models.find((m) => m.id === "glm-5.2");
    assert.ok(m);
    assert.strictEqual(m.name, "GLM 5.2");
    assert.strictEqual(m.contextLength, 1_000_000);
    assert.strictEqual(m.maxOutputTokens, 8192);
    assert.strictEqual(m.supportsReasoning, true);
  });

  it("should declare GLM 5 Turbo with correct contextLength", () => {
    const m = zaiCodingPlanProvider.models.find((m) => m.id === "glm-5-turbo");
    assert.ok(m);
    assert.strictEqual(m.name, "GLM 5 Turbo");
    assert.strictEqual(m.contextLength, 200_000);
    assert.strictEqual(m.maxOutputTokens, 64_000);
    assert.strictEqual(m.supportsReasoning, true);
  });
});
