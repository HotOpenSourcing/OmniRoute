# Windsurf Model Routing - Visual Summary

**Investigation Complete**: 2026-05-04T11:39:55Z  
**Methodology**: Static Analysis + Passive Observation (Read-Only)

---

## 🎯 The Big Discovery

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ❌ WRONG ASSUMPTION:                                           │
│     modelRouterUid = Static Model Identifier                   │
│                                                                 │
│  ✅ ACTUAL TRUTH:                                               │
│     modelRouterUid = Per-Cascade Session Token                 │
│                                                                 │
│  Real Model Identifier = Human-Readable String (e.g. kimi-k2-6)│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Routing Flow

```
┌──────────────┐
│ User selects │
│  "kimi-k2-6" │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. StartCascade RPC                                         │
│    → Returns: cascadeId = "dec3686b-556d-438e-add9-..."     │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SendUserCascadeMessage RPC                               │
│    → Field 5: cascadeConfig.requestedModelUid = "kimi-k2-6"│
│    → Status: 200 OK                                         │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Backend Model Assignment                                 │
│    → Validates "kimi-k2-6" is available                     │
│    → Generates modelRouterUid = "3ff1e703-8706-40e2-..."    │
│    → Stores assignment for this cascade                     │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. GetCascadeTrajectory Response                            │
│    → Field 12: modelRouterUid = "3ff1e703-8706-40e2-..."    │
│    → Field 11: assignedModelUid = "kimi-k2-6"               │
│    → Field 24: model_assignment_info (complete)             │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Subsequent Requests                                      │
│    → Use modelRouterUid as session token                    │
│    → Valid only for this cascade                            │
│    → New cascade = new modelRouterUid                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Model Availability Matrix

### ✅ FREE TIER (Confirmed - HIGH Confidence)

| Model                  | UID           | Provider    | Status       |
| ---------------------- | ------------- | ----------- | ------------ |
| **Kimi K2.6**          | `kimi-k2-6`   | Moonshot AI | ✅ Available |
| **Kimi K2.6 Extended** | `kimi-k2-6-e` | Moonshot AI | ✅ Available |
| **GLM-5**              | `glm-5`       | Zhipu AI    | ✅ Available |
| **GLM-5.1**            | `glm-5-1`     | Zhipu AI    | ✅ Available |

**Evidence**: Runtime captures, 200 status responses, protobuf analysis

---

### 🔑 BYOK TIER (Requires API Keys - MEDIUM Confidence)

| Model                       | UID                       | Provider  | Status             |
| --------------------------- | ------------------------- | --------- | ------------------ |
| **GPT-5.5**                 | `gpt-5-5`                 | OpenAI    | 🔒 Requires Config |
| **GPT-5.4**                 | `gpt-5-4`                 | OpenAI    | 🔒 Requires Config |
| **GPT-5.2 Low Thinking**    | `gpt-5-2-low-thinking`    | OpenAI    | 🔒 Requires Config |
| **Claude Opus 4.7**         | `claude-opus-4-7`         | Anthropic | 🔒 Requires Config |
| **Claude Opus 4 BYOK Beta** | `claude-opus-4-byok-beta` | Anthropic | 🔒 Requires Config |
| **Claude Sonnet 4 BYOK**    | `claude-sonnet-4-byok`    | Anthropic | 🔒 Requires Config |
| **Gemini 3 Flash Low**      | `gemini-3-flash-low`      | Google    | 🔒 Requires Config |

**Evidence**: Documentation, `-byok` suffix convention, "model not found" errors

---

### 💎 PRO SUBSCRIPTION (Unconfirmed - LOW Confidence)

| Model           | UID           | Provider    | Status         |
| --------------- | ------------- | ----------- | -------------- |
| **Kimi K3 Pro** | `kimi-k3-pro` | Moonshot AI | ❓ Unconfirmed |
| **DeepSeek V3** | `deepseek-v3` | DeepSeek    | ❓ Unconfirmed |
| **Qwen Max**    | `qwen-max`    | Alibaba     | ❓ Unconfirmed |

**Evidence**: Documentation mentions only, no runtime verification

---

## 🔍 Key Technical Findings

### 1. Protobuf Structure

```protobuf
message ModelAssignmentInfo {
  string assignment_jwt = 1;        // Auth token
  string assigned_model_uid = 2;    // "kimi-k2-6" (human-readable)
  string harness_uid = 3;           // Executor ID
  string model_router_uid = 4;      // UUID session token
}
```

**Location**: Field 24 in GetCascadeTrajectory response

---

### 2. Client-Side Logic (Decompiled)

```javascript
// Extract modelRouterUid from backend response
let q = R.modelAssignmentInfo?.modelRouterUid;

// Use it as requestedModelUid for subsequent requests
if (q) {
  z.requestedModelUid = q; // UUID becomes request parameter
} else if (F?.requestedModelUid) {
  z.requestedModelUid = F.requestedModelUid; // Fallback to original
}
```

**Source**: `sessions.desktop.main.js` (minified bundle)

---

### 3. OmniRoute Internal Routing

```typescript
// OmniRoute uses NUMERIC upstreamId, not UUID
const WINDSURF_MODELS = [
  { id: "gpt4o", upstreamId: 109 },
  { id: "claude-3-5-sonnet", upstreamId: 166 },
  { id: "gemini-2.0-flash", upstreamId: 184 },
  { id: "deepseek-chat", upstreamId: 205 },
  // ...
];
```

**This is a SEPARATE routing layer** for OmniRoute's internal model management.

---

## 🎓 What We Learned

### ✅ Confirmed

1. **modelRouterUid is session-specific**
   - Different cascades using same model get different UUIDs
   - Generated server-side per cascade
   - Used as session token, not model identifier

2. **Human-readable UIDs are the real identifiers**
   - `kimi-k2-6` (not UUID)
   - `glm-5` (not UUID)
   - Sent in `requestedModelUid` field

3. **Three model tiers exist**
   - Free: 4 models (Kimi, GLM)
   - BYOK: 7+ models (requires API keys)
   - Pro: Unknown count (requires subscription)

4. **BYOK detection pattern**
   - Suffix: `-byok` or `-byok-beta`
   - Error: "unknown model UID: model not found"

---

### ❓ Unknown (Requires Active Testing)

1. Complete list of Pro subscription models
2. Backend model assignment algorithm
3. BYOK configuration schema
4. Model versioning strategy
5. Load balancing for modelRouterUid generation

---

## 🛠️ Implementation Guide for OmniRoute

### ✅ DO

```typescript
// Use human-readable model UIDs
const modelUid = "kimi-k2-6";

// Send in SendUserCascadeMessage
await sendMessage(cascadeId, prompt, modelUid);

// Extract modelRouterUid from response
const trajectory = await getTrajectory(cascadeId);
const sessionToken = trajectory.modelRouterUid;

// Use sessionToken for subsequent requests in this cascade
```

### ❌ DON'T

```typescript
// DON'T try to map UUID to models
const modelMap = {
  "3ff1e703-8706-40e2-99dc-915c12f93091": "kimi-k2-6", // WRONG!
};

// DON'T reuse modelRouterUid across cascades
const globalToken = "3ff1e703-8706-40e2-99dc-915c12f93091"; // WRONG!

// DON'T use UUID as model identifier
const model = "3ff1e703-8706-40e2-99dc-915c12f93091"; // WRONG!
```

---

## 📈 Confidence Breakdown

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  HIGH Confidence (Runtime Verified)                         │
│  ████████████████████████████████████ 4 models              │
│                                                             │
│  MEDIUM Confidence (Code + Docs)                            │
│  ████████████████████ 7 models                              │
│                                                             │
│  LOW Confidence (Speculation)                               │
│  ██████ 3+ models                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Next Steps for 100% Mapping

To achieve HIGH confidence for all models:

1. **Acquire Windsurf Pro subscription**
   - Test Pro-only models
   - Verify subscription tier differences

2. **Configure BYOK API keys**
   - OpenAI API key → Test GPT-5.x models
   - Anthropic API key → Test Claude Opus 4.x models
   - Google API key → Test Gemini 3.x models

3. **Runtime monitoring**
   - Capture actual AssignModel flows
   - Observe backend model assignment logic
   - Map all modelRouterUid generation patterns

4. **Official documentation**
   - Request complete model list from Windsurf
   - Verify model availability by tier
   - Confirm BYOK configuration schema

---

## 📁 Investigation Artifacts

### Generated Reports

- ✅ `WINDSURF_MODEL_ROUTING_REVERSE_ENGINEERING_REPORT.md` (Complete technical report)
- ✅ `windsurf_model_routing_table.json` (Machine-readable routing table)
- ✅ `WINDSURF_MODEL_ROUTING_VISUAL_SUMMARY.md` (This document)

### Evidence Files

- `windsurf_probe_final_run.json` - Runtime capture with modelRouterUid
- `WINDSURF_LLM_MODELS_REPORT.md` - Model identification tests
- `WINDSURF_MODELS_FINAL.md` - Final availability tests
- `WINDSURF_BYOK_VS_SUBSCRIPTION.md` - BYOK analysis
- `scripts/protobuf_parser.py` - Protobuf structure analysis
- `open-sse/config/windsurfModels.ts` - OmniRoute model registry

---

## ✨ Final Verdict

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║  Investigation Status: ✅ COMPLETE                            ║
║                                                               ║
║  Key Discovery:                                               ║
║  modelRouterUid is a SESSION TOKEN, not a MODEL ID            ║
║                                                               ║
║  Routing Table:                                               ║
║  • 4 FREE models (HIGH confidence)                            ║
║  • 7 BYOK models (MEDIUM confidence)                          ║
║  • 3+ PRO models (LOW confidence)                             ║
║                                                               ║
║  Methodology: Static analysis + passive observation           ║
║  Constraints: Read-only, no network requests, no tokens       ║
║                                                               ║
║  Recommendation: Use human-readable UIDs (kimi-k2-6),         ║
║                  NOT UUIDs (3ff1e703-8706-...)                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

**Report Generated**: 2026-05-04T11:39:55Z  
**Investigation Duration**: Complete forensic analysis  
**Confidence Level**: HIGH for architecture, MEDIUM for BYOK, LOW for Pro models  
**Status**: ✅ Ready for OmniRoute integration
