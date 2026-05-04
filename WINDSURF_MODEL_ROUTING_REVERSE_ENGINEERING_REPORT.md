# Windsurf Model Routing Architecture - Reverse Engineering Report

**Date**: 2026-05-04  
**Investigation Type**: Static Analysis & Passive Observation  
**Methodology**: Read-only forensic analysis (no active network requests)  
**Status**: ✅ Complete

---

## Executive Summary

This report documents the complete reverse engineering of Windsurf's model routing architecture through static code analysis, protobuf inspection, and log mining. The investigation reveals that **`modelRouterUid` is NOT a static model identifier** but rather a **session-specific routing token** generated per cascade.

### Key Findings

1. **Model Identification**: Windsurf uses human-readable string IDs (e.g., `kimi-k2-6`, `glm-5`) as model identifiers, NOT UUIDs
2. **Routing Token**: `modelRouterUid` (UUID format) is a per-cascade session token, not a model mapping
3. **Routing Mechanism**: Client sends model name → Backend assigns `modelRouterUid` → Used for subsequent requests in that cascade
4. **Model Types**: Three categories: Free (subscription-included), BYOK (Bring Your Own Key), and Pro subscription models

---

## Architecture Overview

### Routing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User selects model in UI                                     │
│    → Model name: "kimi-k2-6" (human-readable)                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Client: StartCascade RPC                                     │
│    → Creates new cascade session                                │
│    → Returns: cascadeId (UUID)                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Client: SendUserCascadeMessage RPC                           │
│    → Field 1: metadata (auth, IDE version)                      │
│    → Field 2: items (chat messages)                             │
│    → Field 5: cascadeConfig                                     │
│       └─ requestedModelUid: "kimi-k2-6"                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend: Model Assignment                                    │
│    → Validates model availability                               │
│    → Generates modelRouterUid (UUID) for this cascade           │
│    → Returns in ModelAssignmentInfo                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Client: GetCascadeTrajectory RPC                             │
│    → Response field 12: modelRouterUid (UUID)                   │
│    → Response field 11: assignedModelUid (string)               │
│    → Response field 24: model_assignment_info                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Subsequent requests use modelRouterUid as session token      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Model Routing Table

### Confirmed Available Models (Free Tier)

| Model Name         | Model UID     | Provider    | Type         | Confidence |
| ------------------ | ------------- | ----------- | ------------ | ---------- |
| Kimi K2.6          | `kimi-k2-6`   | Moonshot AI | Subscription | **HIGH**   |
| Kimi K2.6 Extended | `kimi-k2-6-e` | Moonshot AI | Subscription | **HIGH**   |
| GLM-5              | `glm-5`       | Zhipu AI    | Subscription | **HIGH**   |
| GLM-5.1            | `glm-5-1`     | Zhipu AI    | Subscription | **HIGH**   |

**Evidence Sources**:

- Runtime captures: `windsurf_probe_final_run.json`
- Test reports: `WINDSURF_MODELS_FINAL.md`
- Protobuf responses: Field 24 model_assignment_info

### BYOK Models (Require API Keys)

| Model Name              | Model UID                 | Provider  | Type | Status         |
| ----------------------- | ------------------------- | --------- | ---- | -------------- |
| GPT-5.5                 | `gpt-5-5`                 | OpenAI    | BYOK | Not configured |
| GPT-5.4                 | `gpt-5-4`                 | OpenAI    | BYOK | Not configured |
| GPT-5.2 Low Thinking    | `gpt-5-2-low-thinking`    | OpenAI    | BYOK | Not configured |
| Claude Opus 4.7         | `claude-opus-4-7`         | Anthropic | BYOK | Not configured |
| Claude Opus 4 BYOK Beta | `claude-opus-4-byok-beta` | Anthropic | BYOK | Not configured |
| Claude Sonnet 4 BYOK    | `claude-sonnet-4-byok`    | Anthropic | BYOK | Not configured |
| Gemini 3 Flash Low      | `gemini-3-flash-low`      | Google    | BYOK | Not configured |

**Evidence Sources**:

- Documentation: `WINDSURF_BYOK_VS_SUBSCRIPTION.md`
- Test failures: "unknown model UID: model not found"
- Naming convention: `-byok` suffix indicates BYOK requirement

### Pro Subscription Models (Unconfirmed)

| Model Name  | Model UID     | Provider    | Type             | Status      |
| ----------- | ------------- | ----------- | ---------------- | ----------- |
| Kimi K3 Pro | `kimi-k3-pro` | Moonshot AI | Pro Subscription | Unconfirmed |
| DeepSeek V3 | `deepseek-v3` | DeepSeek    | Pro Subscription | Unconfirmed |
| Qwen Max    | `qwen-max`    | Alibaba     | Pro Subscription | Unconfirmed |

**Evidence Sources**:

- Documentation mentions: `WINDSURF_BYOK_VS_SUBSCRIPTION.md`
- No runtime confirmation available

---

## Technical Deep Dive

### 1. Protobuf Structure Analysis

#### ModelAssignmentInfo Message

```protobuf
message ModelAssignmentInfo {
  string assignment_jwt = 1;        // JWT token for model assignment
  string assigned_model_uid = 2;    // Human-readable model ID (e.g., "kimi-k2-6")
  string harness_uid = 3;           // Harness/executor identifier
  string model_router_uid = 4;      // Session-specific UUID routing token
}
```

**Source**: `scripts/protobuf_parser.py:271-275`

#### GetCascadeTrajectory Response Fields

- **Field 2**: `cascadeId` (string) - Cascade session identifier
- **Field 11**: `assignedModelUid` (string) - Human-readable model name
- **Field 12**: `modelRouterUid` (string) - UUID routing token
- **Field 24**: `model_assignment_info` (message) - Complete assignment info

**Source**: `scripts/protobuf_parser.py:271-298`

### 2. Client-Side Routing Logic

From minified bundle analysis (`sessions.desktop.main.js`):

```javascript
// Extract modelRouterUid from ModelAssignmentInfo
let q = R.modelAssignmentInfo?.modelRouterUid;

// Use it as requestedModelUid for subsequent requests
if (q) {
  z.requestedModelUid = q;
} else if (F?.requestedModelUid) {
  z.requestedModelUid = F.requestedModelUid;
}
```

**Key Insight**: The client reads `modelRouterUid` from the backend response and uses it as `requestedModelUid` in subsequent requests. This confirms it's a **session token**, not a static model identifier.

**Source**: `C:\Users\amine\AppData\Local\Programs\Windsurf\resources\app\out\vs\sessions\sessions.desktop.main.js`

### 3. Model Registry (OmniRoute Integration)

From `open-sse/config/windsurfModels.ts`:

```typescript
export const WINDSURF_MODELS: readonly WindsurfModelCapability[] = [
  {
    id: "gpt4o",
    name: "GPT-4o",
    upstreamId: 109,
    autoToolChoice: true,
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    upstreamId: 166,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    upstreamId: 184,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    upstreamId: 205,
  },
  // ... more models
];
```

**Key Finding**: OmniRoute uses **numeric `upstreamId`** for routing, NOT the UUID `modelRouterUid`. This is a separate routing layer for OmniRoute's internal model management.

**Source**: `open-sse/config/windsurfModels.ts:21-68`

---

## Routing Mechanism Clarification

### What `modelRouterUid` IS

✅ **Session-specific routing token**

- Generated per cascade by the backend
- UUID format: `3ff1e703-8706-40e2-99dc-915c12f93091`
- Used to track model assignment for a specific cascade session
- Returned in `GetCascadeTrajectory` response (field 12)
- Sent in `AssignModel` RPC (field 2)

### What `modelRouterUid` IS NOT

❌ **NOT a static model identifier**

- Different cascades using the same model get different `modelRouterUid` values
- Example: Two cascades both using `kimi-k2-6` will have different UUIDs
- The UUID is not hardcoded in the client
- It's not a lookup key for model configuration

### Actual Model Identification

The **real model identifier** is the human-readable string:

- `kimi-k2-6` (not a UUID)
- `glm-5` (not a UUID)
- `claude-opus-4-byok-beta` (not a UUID)

These are sent in:

- `SendUserCascadeMessage` → `cascadeConfig.requestedModelUid`
- `AssignModel` → `model_router_uid` field (confusing naming!)

---

## BYOK vs Subscription Detection

### BYOK Models

**Characteristics**:

- Suffix: `-byok` or `-byok-beta`
- Require API key configuration in Windsurf Settings
- Return error: "unknown model UID: model not found" when not configured
- User pays provider directly (OpenAI, Anthropic, Google)

**Detection Strategy**:

```python
def is_byok_model(model_uid: str) -> bool:
    return "-byok" in model_uid or model_uid in [
        "gpt-5-5", "gpt-5-4", "gpt-5-2-low-thinking",
        "claude-opus-4-7", "gemini-3-flash-low"
    ]
```

### Subscription Models

**Characteristics**:

- No special suffix
- Included in Windsurf subscription (free or Pro)
- Work without API key configuration
- Return 200 status on `SendUserCascadeMessage`

**Detection Strategy**:

```python
def is_subscription_model(model_uid: str) -> bool:
    return model_uid in [
        "kimi-k2-6", "kimi-k2-6-e",
        "glm-5", "glm-5-1"
    ]
```

---

## Injection Points

### Where `modelRouterUid` is Used

1. **AssignModel RPC** (Field 2)
   - URL: `https://eu.windsurf.com/_route/api_server/exa.api_server_pb.ApiServerService/AssignModel`
   - Purpose: Assign model to cascade
   - Field structure:
     ```
     Field 1: metadata (auth, IDE version)
     Field 2: modelRouterUid (UUID)
     Field 3: cascadeId (UUID)
     Field 4: chatMessagePrompt (bytes)
     ```

2. **GetCascadeTrajectory Response** (Field 12)
   - Returns the assigned `modelRouterUid` for the cascade
   - Client extracts and stores for subsequent requests

3. **ModelAssignmentInfo** (Field 4 in protobuf)
   - Complete assignment information
   - Includes `modelRouterUid`, `assignedModelUid`, `harnessUid`

**Source**: `windsurf_probe_final_run.json:174-186`

---

## Confidence Levels

### HIGH Confidence (Runtime Verified)

- ✅ `kimi-k2-6` → Moonshot AI (observed in multiple captures)
- ✅ `kimi-k2-6-e` → Moonshot AI (observed in protobuf responses)
- ✅ `glm-5` → Zhipu AI (200 status in tests)
- ✅ `glm-5-1` → Zhipu AI (200 status in tests)
- ✅ `modelRouterUid` is session-specific, not model-specific

### MEDIUM Confidence (Documentation + Code Analysis)

- ⚠️ BYOK models require `-byok` suffix
- ⚠️ `upstreamId` (numeric) used for OmniRoute routing
- ⚠️ Pro subscription models exist but unconfirmed

### LOW Confidence (Speculation)

- ⚠️ Exact list of Pro subscription models
- ⚠️ Model availability by subscription tier
- ⚠️ Backend model assignment algorithm

---

## Key Discoveries

### 1. UUID ≠ Model Identifier

**Finding**: The UUID `3ff1e703-8706-40e2-99dc-915c12f93091` found in captures is NOT a model identifier.

**Evidence**:

- Same model (`kimi-k2-6`) produces different UUIDs across cascades
- UUID is generated server-side per cascade
- Human-readable strings (`kimi-k2-6`) are the actual model IDs

**Source**: `WINDSURF_LLM_MODELS_REPORT.md:86-93`

### 2. Two-Tier Routing System

**Client → Windsurf Backend**:

- Uses human-readable model names: `kimi-k2-6`
- Backend assigns `modelRouterUid` (UUID) per cascade

**OmniRoute Internal**:

- Uses numeric `upstreamId`: 109, 166, 184, 205
- Maps to provider-specific executors

**Source**: `open-sse/config/windsurfModels.ts:21-68`

### 3. Model Availability Tiers

**Free Tier** (confirmed):

- Kimi K2.6 (primary)
- GLM-5, GLM-5.1 (secondary)

**BYOK** (requires configuration):

- GPT-5.x series
- Claude Opus 4.x series
- Gemini 3.x series

**Pro Subscription** (unconfirmed):

- Kimi K3 Pro
- DeepSeek V3
- Qwen Max

**Source**: `WINDSURF_BYOK_VS_SUBSCRIPTION.md`

---

## Limitations & Unknowns

### What We Don't Know

1. **Backend Model Assignment Algorithm**
   - How does the backend decide which `modelRouterUid` to assign?
   - Is there load balancing or routing logic?
   - Are there multiple backend instances per model?

2. **Complete Pro Model List**
   - Which models are available with Pro subscription?
   - Are there tier differences (Pro vs Pro+)?

3. **BYOK Configuration Format**
   - How are API keys stored in Windsurf?
   - What's the exact configuration schema?

4. **Model Versioning**
   - How does Windsurf handle model version updates?
   - Are there version-specific UIDs?

### Why We Don't Know

- **Read-only constraint**: No active network requests allowed
- **No runtime access**: Cannot test with actual Pro subscription
- **No BYOK keys**: Cannot test BYOK model configuration
- **Backend opacity**: Server-side logic not observable

---

## Recommendations for OmniRoute Integration

### 1. Model Mapping

Use human-readable model UIDs, not UUIDs:

```typescript
const WINDSURF_MODEL_MAP = {
  // Free tier (confirmed)
  "kimi-k2-6": {
    name: "Kimi K2.6",
    provider: "Moonshot AI",
    type: "subscription",
    available: true,
  },
  "glm-5": {
    name: "GLM-5",
    provider: "Zhipu AI",
    type: "subscription",
    available: true,
  },
  "glm-5-1": {
    name: "GLM-5.1",
    provider: "Zhipu AI",
    type: "subscription",
    available: true,
  },

  // BYOK (requires configuration)
  "gpt-5-5": {
    name: "GPT-5.5",
    provider: "OpenAI",
    type: "byok",
    available: false, // requires API key
  },
  "claude-opus-4-7": {
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    type: "byok",
    available: false, // requires API key
  },
};
```

### 2. Routing Strategy

**Do NOT** try to map `modelRouterUid` (UUID) to models. Instead:

1. Accept model name from user (e.g., `kimi-k2-6`)
2. Send to Windsurf backend in `SendUserCascadeMessage`
3. Extract `modelRouterUid` from response
4. Use `modelRouterUid` for subsequent requests in that cascade
5. Discard `modelRouterUid` when cascade ends

### 3. Model Detection

To detect available models:

```typescript
async function detectAvailableModels(auth: WindsurfAuth): Promise<string[]> {
  const available: string[] = [];

  for (const modelUid of CANDIDATE_MODELS) {
    try {
      const cascade = await startCascade(auth);
      const response = await sendUserCascadeMessage(auth, cascade.id, "test", modelUid);

      if (response.status === 200) {
        available.push(modelUid);
      }
    } catch (error) {
      // Model not available
    }
  }

  return available;
}
```

### 4. BYOK Support

For BYOK models, OmniRoute should:

1. Detect `-byok` suffix in model UID
2. Prompt user for API key configuration
3. Store API keys securely
4. Pass keys to Windsurf backend in metadata

---

## Conclusion

The reverse engineering investigation successfully mapped Windsurf's model routing architecture through static analysis. The key finding is that **`modelRouterUid` is a session token, not a model identifier**. The actual model routing uses human-readable string IDs like `kimi-k2-6`.

### Final Routing Table Summary

| Category                 | Count   | Confidence | Evidence               |
| ------------------------ | ------- | ---------- | ---------------------- |
| Free Subscription Models | 4       | HIGH       | Runtime verified       |
| BYOK Models              | 7+      | MEDIUM     | Documentation + naming |
| Pro Subscription Models  | Unknown | LOW        | Speculation            |

### Next Steps for Complete Mapping

To obtain a complete model routing table with HIGH confidence:

1. **Acquire Windsurf Pro subscription** → Test Pro-only models
2. **Configure BYOK API keys** → Test BYOK model availability
3. **Runtime monitoring** → Capture actual model assignment flows
4. **Backend API documentation** → Official model list from Windsurf

---

## Appendix: Evidence Files

### Runtime Captures

- `windsurf_probe_final_run.json` - Complete cascade flow with modelRouterUid
- `windsurf-model-runtime-capture.jsonl` - Runtime hook captures
- `abc-experiment.json` - Multiple cascade experiments

### Investigation Reports

- `WINDSURF_LLM_MODELS_REPORT.md` - Model identification testing
- `WINDSURF_MODELS_FINAL.md` - Final model availability tests
- `WINDSURF_BYOK_VS_SUBSCRIPTION.md` - BYOK vs subscription analysis

### Code Analysis

- `scripts/protobuf_parser.py` - Protobuf structure analysis
- `open-sse/config/windsurfModels.ts` - OmniRoute model registry
- `C:\Users\amine\AppData\Local\Programs\Windsurf\resources\app\out\vs\sessions\sessions.desktop.main.js` - Client routing logic

### Test Scripts

- `scripts/windsurf_direct_probe.py` - Direct API testing
- `test_windsurf_builtin_models_auto.py` - Free model testing
- `test_windsurf_pro_models.py` - BYOK model testing

---

**Report Status**: ✅ Complete  
**Methodology**: Static analysis + passive observation (read-only)  
**Confidence**: HIGH for free models, MEDIUM for BYOK detection, LOW for Pro models  
**Date**: 2026-05-04T11:35:51Z
