#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test Claude Variants Discovery
================================

Suite à la découverte de claude-opus-4-7-medium, ce script teste
toutes les variantes Claude possibles.

Date: 2026-05-04
"""

import json
import os
import sys
import time
from pathlib import Path

# Fix encoding for Windows
if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "strict")

sys.path.insert(0, str(Path(__file__).parent))

try:
    from windsurf_direct_probe import start_cascade, send_user_cascade_message
    PROBE_AVAILABLE = True
except ImportError:
    PROBE_AVAILABLE = False
    print("ERROR: windsurf_direct_probe.py not available")
    sys.exit(1)


# Claude variants to test based on the discovery of claude-opus-4-7-medium
CLAUDE_VARIANTS = [
    # Opus 4.7 variants
    ("claude-opus-4-7-medium", "Claude Opus 4.7 Medium (CONFIRMED)"),
    ("claude-opus-4-7", "Claude Opus 4.7 (standard)"),
    ("claude-opus-4-7-fast", "Claude Opus 4.7 Fast"),
    ("claude-opus-4-7-lite", "Claude Opus 4.7 Lite"),
    ("claude-opus-4-7-plus", "Claude Opus 4.7 Plus"),
    ("claude-opus-4-7-thinking", "Claude Opus 4.7 Thinking"),

    # Sonnet 4.6 variants
    ("claude-sonnet-4-6", "Claude Sonnet 4.6 (standard)"),
    ("claude-sonnet-4-6-medium", "Claude Sonnet 4.6 Medium"),
    ("claude-sonnet-4-6-fast", "Claude Sonnet 4.6 Fast"),
    ("claude-sonnet-4-6-lite", "Claude Sonnet 4.6 Lite"),
    ("claude-sonnet-4-6-plus", "Claude Sonnet 4.6 Plus"),
    ("claude-sonnet-4-6-thinking", "Claude Sonnet 4.6 Thinking"),

    # Haiku 4.5 variants
    ("claude-haiku-4-5", "Claude Haiku 4.5 (standard)"),
    ("claude-haiku-4-5-medium", "Claude Haiku 4.5 Medium"),
    ("claude-haiku-4-5-fast", "Claude Haiku 4.5 Fast"),
    ("claude-haiku-4-5-lite", "Claude Haiku 4.5 Lite"),

    # Older versions
    ("claude-3-7-sonnet", "Claude 3.7 Sonnet"),
    ("claude-3-5-sonnet", "Claude 3.5 Sonnet"),
]


def test_model(model_uid: str, description: str, token: str, port: int) -> dict:
    """Test a single Claude model variant."""
    print(f"  {model_uid:30} ... ", end="", flush=True)

    try:
        # Override base URL with current port
        base_url = f"http://127.0.0.1:{port}"

        # Start cascade
        exit_code, request, preview, cascade_response = start_cascade(token, base_url)

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
            base_url=base_url,
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
    """Test all Claude variants."""
    print("=" * 80)
    print("Claude Variants Discovery")
    print("=" * 80)
    print()
    print(f"Testing {len(CLAUDE_VARIANTS)} Claude model variants...")
    print()

    # Get config
    token = os.environ.get("WINDSURF_DIRECT_KEY", "").strip()
    port = int(os.environ.get("WINDSURF_LS_PORT", "51834"))

    if not token:
        print("ERROR: WINDSURF_DIRECT_KEY not set")
        print()
        print("Load from .env.windsurf.local:")
        print("  $envContent = Get-Content .env.windsurf.local -Raw")
        print("  if ($envContent -match 'WINDSURF_DIRECT_KEY=([^\\r\\n]+)') {")
        print("    $env:WINDSURF_DIRECT_KEY = $matches[1]")
        print("  }")
        return 1

    print(f"Configuration:")
    print(f"  Port: {port}")
    print(f"  Token: {token[:30]}...")
    print()

    # Test each variant
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_tested": len(CLAUDE_VARIANTS),
        "available": [],
        "not_available": [],
    }

    print("Testing Claude variants:")
    print("-" * 80)

    for model_uid, description in CLAUDE_VARIANTS:
        result = test_model(model_uid, description, token, port)

        if result["available"]:
            results["available"].append(result)
        else:
            results["not_available"].append(result)

        # Rate limiting
        time.sleep(0.5)

    print()
    print("=" * 80)
    print("Results")
    print("=" * 80)
    print()

    available_count = len(results["available"])
    print(f"Available Claude models: {available_count}/{len(CLAUDE_VARIANTS)}")
    print()

    if results["available"]:
        print("DISCOVERED CLAUDE MODELS:")
        print("-" * 80)
        for model in results["available"]:
            print(f"  SUCCESS: {model['model_uid']}")
            print(f"           {model['description']}")
        print()
    else:
        print("No Claude models discovered.")
        print()
        print("Possible reasons:")
        print("  - Token expired")
        print("  - Wrong port")
        print("  - Windsurf not running")
        print("  - Models require Pro subscription")
        print()

    # Save results
    output_file = Path(__file__).parent.parent / "windsurf_claude_variants_results.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Results saved to: {output_file}")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
