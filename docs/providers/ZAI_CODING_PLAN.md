# Z.AI Coding Plan Provider

> **Provider ID:** `zai-coding-plan`
> **Alias:** `zcp`
> **Format:** Anthropic-compatible (Claude Messages API)
> **Authentication:** OAuth 2.0 Authorization Code + refresh
> **Added:** v3.8.33 (2026-06-23)

## Overview

Z.AI Coding Plan is a subscription-based service that provides access to GLM models
through an Anthropic-compatible API endpoint. OAuth credentials extracted from
ZCode's `app.asar`.

## Authentication Flow

Standard Authorization Code flow (extracted from ZCode binary):

1. **Authorize** — `GET https://chat.z.ai/api/oauth/authorize`
   with `response_type=code`, `client_id`, `redirect_uri`, and `state`.
2. **User authorizes in browser** — redirects to the `redirect_uri` with
   `code=code-<hex>` and `state` query parameters.
3. **Token exchange** — `POST https://zcode.z.ai/api/v1/oauth/token`
   with `{ code: "<code-...>" }` → `{ access_token, refresh_token, ... }`.
4. **Token refresh** — tokens expire after ~1 hour; re-exchange with `refresh_token`.
5. **(Optional) User info** — `GET https://chat.z.ai/api/oauth/userinfo`.

### Redirect URI

- **ZCode native:** `zcode://zai-auth/callback` (intercepted by the ZCode desktop client).
- **OmniRoute fallback:** `http://localhost:<port>/callback` (server-side local server).

### Environment Variables

```bash
# Override the embedded OAuth client_id (optional — defaults to ZCode's public client)
ZAI_CODING_PLAN_CLIENT_ID=your_client_id_here
```

## API Endpoints

| Endpoint | URL |
|----------|-----|
| Authorize | `https://chat.z.ai/api/oauth/authorize` |
| Token exchange / refresh | `https://zcode.z.ai/api/v1/oauth/token` |
| User info | `https://chat.z.ai/api/oauth/userinfo` |
| Business login | `https://api.z.ai/api/auth/z/login` |
| Chat API | `https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages` |

## Available Models

The Coding Plan subscription provides access to 2 GLM models:

| Model ID | Name | Context Length | Max Output | Reasoning |
|----------|------|---------------|------------|-----------|
| `glm-5.2` | GLM 5.2 | 1,000,000 tokens | 8,192 tokens | Yes |
| `glm-5-turbo` | GLM 5 Turbo | 200,000 tokens | 64,000 tokens | Yes |

## Usage Example

```bash
curl https://your-omniroute-instance/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_OMNIROUTE_API_KEY" \
  -d '{
    "model": "zai-coding-plan/glm-5.2",
    "messages": [
      {
        "role": "user",
        "content": "Explain async/await in JavaScript"
      }
    ]
  }'
```

## Comparison with Standard Z.AI Provider

| Feature | `zai` (API Key) | `zai-coding-plan` (OAuth) |
|---------|-----------------|---------------------------|
| **Authentication** | API Key (`x-api-key`) | OAuth Bearer token |
| **Base URL** | `api.z.ai/api/anthropic` | `zcode.z.ai/api/v1/zcode-plan/anthropic` |
| **Models Available** | 6 models | 2 models (GLM-5.2, GLM-5-Turbo) |
| **Subscription** | Pay-per-use | Fixed plan (coding subscription) |

## Technical Implementation

| Component | File |
|-----------|------|
| Provider catalog entry | `src/shared/constants/providers.ts` → `OAUTH_PROVIDERS["zai-coding-plan"]` |
| OAuth provider | `src/lib/oauth/providers/zaiCodingPlan.ts` |
| OAuth config | `src/lib/oauth/constants/oauth.ts` → `ZAI_CODING_PLAN_CONFIG` |
| Model registry | `open-sse/config/providers/registry/zai-coding-plan/index.ts` |
| Public credential | `open-sse/utils/publicCreds.ts` → `zai_coding_plan_id` |
| Unit tests | `tests/unit/zaiCodingPlan.test.ts` |

## Security Considerations

- **Public client:** The OAuth `client_id` is public (extracted from the ZCode binary,
  stored as XOR-masked bytes in `publicCreds.ts` per `docs/security/PUBLIC_CREDS.md`).
- **Token expiry:** Access tokens expire after ~1 hour. Refresh tokens extend the session.
- **Encrypted at rest:** Tokens are stored encrypted in OmniRoute's SQLite database.
