#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Quick Test: Top Candidate Hidden Models (Simplified)
=====================================================

Test rapide des modèles les plus susceptibles d'être disponibles sans BYOK.

Date: 2026-05-04
"""

import json
import os
import sys
import time
from pathlib import Path

# Fix encoding for Windows console
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from windsurf_direct_probe import (
        start_cascade,
        send_user_cascade_message,
    )
    PROBE_AVAILABLE = True
except ImportError:
    PROBE_AVAILABLE = False
    print("Warning: windsurf_direct_probe.py not fully available")


# Top candidates based on discovered patterns
TOP_CANDIDATES = [
    # Kimi variants (Moonshot AI - confirmed partner)
    ("kimi-k2-7", "Kimi K2.7 (newer version)"),
    ("kimi-k3", "Kimi K3 (next generation)"),
    ("kimi-k2-6-fast", "Kimi K2.6 Fast"),
    ("kimi-k2-5", "Kimi K2.5 (older version)"),

    # GLM variants (Zhipu AI - confirmed partner)
    ("glm-4", "GLM-4"),
    ("glm-4-5", "GLM-4.5"),
    ("glm-4-7", "GLM-4.7"),
    ("glm-5-0", "GLM-5.0"),
    ("glm-5-2", "GLM-5.2"),
    ("glm-5-pro", "GLM-5 Pro"),

    # DeepSeek (very popular Chinese model)
    ("deepseek-v3", "DeepSeek V3"),
    ("deepseek-v2-5", "DeepSeek V2.5"),
    ("deepseek-chat", "DeepSeek Chat"),
    ("deepseek-coder", "DeepSeek Coder"),

    # Qwen (Alibaba - major player)
    ("qwen-max", "Qwen Max"),
    ("qwen-plus", "Qwen Plus"),
    ("qwen-turbo", "Qwen Turbo"),
    ("qwen-2-5", "Qwen 2.5"),

    # Windsurf-specific
    ("swe-1-6", "Software Engineering 1.6"),
    ("swe-1-6-fast", "SWE 1.6 Fast"),
    ("swe-2-0", "SWE 2.0"),
    ("adaptive", "Adaptive Model"),
]


def check_auth():
    """Check if authentication is configured."""
    token = os.environ.get("WINDSURF_DIRECT_KEY", "").strip()
    if not token:
        print("ERROR: WINDSURF_DIRECT_KEY environment variable not set")
        print()
        print("Please set your Windsurf token:")
        print("  $env:WINDSURF_DIRECT_KEY = \"your-token-here\"")
        print()
        return False
    return True


def quick_test_model(model_uid: str, description: str, token: str) -> dict:
    """Quick test of a single model."""
    print(f"Testing: {model_uid:25} ({description})... ", end="", flush=True)

    try:
        # Start cascade
        exit_code, request, preview, cascade_response = start_cascade(token)
        if not cascade_response or cascade_response.get("status") != 200:
            print("FAIL (cascade)")
            return {"model_uid": model_uid, "available": False, "error": "cascade_failed"}

        cascade_id = cascade_response.get("cascadeId")

        # Send message with model
        exit_code, request, preview, message_response = send_user_cascade_message(
            token=token,
            cascade_id=cascade_id,
            message="test",
            requested_model_uid=model_uid,
        )

        if not message_response:
            print("FAIL (no response)")
            return {"model_uid": model_uid, "available": False, "error": "no_response"}

        status = message_response.get("status")

        if status == 200:
            print("SUCCESS!")
            return {
                "model_uid": model_uid,
                "description": description,
                "available": True,
                "status": 200,
            }
        elif status == 500:
            error_body = message_response.get("body", {})
            error_msg = error_body.get("message", "")

            if "unknown model UID" in error_msg or "model not found" in error_msg:
                print("NOT FOUND")
                return {"model_uid": model_uid, "available": False, "error": "not_found"}
            else:
                print(f"ERROR: {error_msg[:40]}")
                return {"model_uid": model_uid, "available": False, "error": error_msg}
        else:
            print(f"STATUS {status}")
            return {"model_uid": model_uid, "available": False, "error": f"status_{status}"}

    except Exception as e:
        print(f"EXCEPTION: {str(e)[:40]}")
        return {"model_uid": model_uid, "available": False, "error": str(e)}


def main():
    """Run quick test on top candidates."""
    print("=" * 80)
    print("Windsurf Hidden Models - Quick Test")
    print("=" * 80)
    print()

    if not PROBE_AVAILABLE:
        print("ERROR: windsurf_direct_probe.py not available")
        print("Please ensure the script is in the scripts/ directory")
        return 1

    print(f"Testing {len(TOP_CANDIDATES)} top candidates...")
    print()

    # Check auth
    print("Checking authentication...")
    if not check_auth():
        return 1

    # Get token
    token = os.environ.get("WINDSURF_DIRECT_KEY", "").strip()
    print("Authentication configured")
    print()

    # Test each candidate
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_tested": len(TOP_CANDIDATES),
        "available": [],
        "not_available": [],
    }

    print("Testing models...")
    print("-" * 80)

    for model_uid, description in TOP_CANDIDATES:
        result = quick_test_model(model_uid, description, token)

        if result["available"]:
            results["available"].append(result)
        else:
            results["not_available"].append(result)

        # Rate limiting
        time.sleep(0.5)

    print()
    print("=" * 80)
    print("Results Summary")
    print("=" * 80)
    print()

    available_count = len(results["available"])
    print(f"Available models: {available_count}/{len(TOP_CANDIDATES)}")
    print()

    if results["available"]:
        print("NEWLY DISCOVERED MODELS:")
        print("-" * 80)
        for model in results["available"]:
            print(f"  SUCCESS: {model['model_uid']:25} - {model['description']}")
        print()

        print("Next steps:")
        print("  1. Test these models with actual prompts to verify quality")
        print("  2. Check if they're aliases or real new models")
        print("  3. Update windsurf_model_routing_table.json")
        print("  4. Add to open-sse/config/windsurfModels.ts")
        print()
    else:
        print("No new models discovered in this quick test.")
        print()
        print("Try:")
        print("  1. Run full discovery: python scripts/discover_hidden_windsurf_models.py")
        print("  2. Check if you have Windsurf Pro subscription")
        print("  3. Verify authentication token is valid")
        print()

    # Save results
    output_file = Path(__file__).parent.parent / "windsurf_quick_test_results.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Results saved to: {output_file}")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
