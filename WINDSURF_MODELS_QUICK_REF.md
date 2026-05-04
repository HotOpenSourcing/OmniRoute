# 🎯 QUICK REFERENCE - Windsurf Pro Models

**Last Updated**: 2026-05-04  
**Status**: ✅ All 8 models verified working

---

## Complete Model List

```
1. claude-opus-4-7-medium-20260424       ✅ Claude Opus 4.7 (Medium)
2. claude-opus-4-6-thinking-20260424     ✅ Claude Opus 4.6 (Thinking)
3. claude-sonnet-4-6-thinking-20260424   ✅ Claude Sonnet 4.6 (Thinking)
4. gpt-5-5-low-20260424                  ✅ GPT-5.5 (Low)
5. deepseek-v4-20260424                  ✅ DeepSeek V4
6. kimi-k2-6-20260424                    ✅ Kimi K2.6
7. swe-1-6-20260424                      ✅ SWE-1.6
8. swe-1-6-fast-20260424                 ✅ SWE-1.6 Fast
```

---

## Test Any Model

```bash
cd C:\Users\amine\OmniRoute\scripts
python test_all_models_protobuf.py
```

**Requirements**:

- Windsurf running (localhost:51834 or dynamic port)
- Valid session token and CSRF token
- Protobuf encoding support

---

## Key Files

| File                                                | Purpose                   |
| --------------------------------------------------- | ------------------------- |
| `WINDSURF_MODELS_DISCOVERY_COMPLETE.md`             | Full investigation report |
| `scripts/windsurf_models_from_setusersettings.json` | Model registry data       |
| `scripts/windsurf_protobuf_test_results.json`       | Test results              |
| `scripts/test_all_models_protobuf.py`               | Test script               |

---

## Important Discovery

**GPT-5.5 confirmed**: `gpt-5-5-low-20260424`

All models work with Windsurf Pro subscription (no BYOK needed).
