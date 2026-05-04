#!/usr/bin/env python3
"""
Windsurf Hidden Models Discovery Script
========================================

Objective: Find hidden models available WITHOUT BYOK configuration
Strategy: Systematic testing of model name patterns based on discovered conventions

Constraints:
- Read-only where possible
- Test only subscription models (no BYOK)
- Use discovered naming patterns (dashes, not dots)

Date: 2026-05-04
"""

import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from windsurf_direct_probe import (
        start_cascade,
        send_user_cascade_message,
        get_cascade_trajectory,
        validate_token,
    )
except ImportError:
    print("⚠️  Warning: windsurf_direct_probe not available")
    print("    This script requires windsurf_direct_probe.py")
    sys.exit(1)


# ============================================================================
# MODEL CANDIDATES - Based on discovered patterns
# ============================================================================

CANDIDATE_MODELS = {
    "confirmed_free": [
        "kimi-k2-6",
        "kimi-k2-6-e",
        "glm-5",
        "glm-5-1",
    ],

    "kimi_variants": [
        "kimi-k2-5",
        "kimi-k2-7",
        "kimi-k3",
        "kimi-k3-pro",
        "kimi-k2-6-fast",
        "kimi-k2-6-lite",
        "kimi-k2-6-plus",
    ],

    "glm_variants": [
        "glm-4",
        "glm-4-5",
        "glm-4-7",
        "glm-5-0",
        "glm-5-2",
        "glm-5-pro",
        "glm-5-plus",
        "glm-5-lite",
        "glm-5-fast",
    ],

    "deepseek_models": [
        "deepseek-v3",
        "deepseek-v2-5",
        "deepseek-coder",
        "deepseek-coder-v2",
        "deepseek-chat",
        "deepseek-reasoner",
    ],

    "qwen_models": [
        "qwen-max",
        "qwen-plus",
        "qwen-turbo",
        "qwen-2-5",
        "qwen-2-5-coder",
        "qwen-coder",
    ],

    "yi_models": [
        "yi-large",
        "yi-medium",
        "yi-vision",
        "yi-34b",
    ],

    "baichuan_models": [
        "baichuan-4",
        "baichuan-3",
        "baichuan-turbo",
    ],

    "minimax_models": [
        "minimax-abab-6",
        "minimax-abab-6-5",
        "minimax-abab-5-5",
    ],

    "swe_models": [
        "swe-1-6",
        "swe-1-6-fast",
        "swe-1-5",
        "swe-2-0",
    ],

    "generic_variants": [
        "adaptive",
        "adaptive-ss",
        "cascade-default",
        "windsurf-default",
    ],
}


# ============================================================================
# TEST FUNCTIONS
# ============================================================================

def test_model_availability(model_uid: str, timeout: int = 5) -> Dict:
    """
    Test if a model is available without BYOK.

    Strategy:
    1. StartCascade (should always work)
    2. SendUserCascadeMessage with model_uid
    3. Check response status

    Returns:
        Dict with test results and availability status
    """
    result = {
        "model_uid": model_uid,
        "available": False,
        "status": "unknown",
        "error": None,
        "cascade_id": None,
        "response_status": None,
        "model_name_in_response": None,
    }

    try:
        # Step 1: Start cascade
        print(f"  Testing: {model_uid}...", end=" ", flush=True)

        cascade_response = start_cascade()
        if not cascade_response or cascade_response.get("status") != 200:
            result["status"] = "cascade_failed"
            result["error"] = "Failed to start cascade"
            print("❌ Cascade failed")
            return result

        cascade_id = cascade_response.get("cascadeId")
        result["cascade_id"] = cascade_id

        # Step 2: Send message with model_uid
        message_response = send_user_cascade_message(
            cascade_id=cascade_id,
            message="test",
            requested_model_uid=model_uid,
        )

        if not message_response:
            result["status"] = "no_response"
            result["error"] = "No response from SendUserCascadeMessage"
            print("❌ No response")
            return result

        status = message_response.get("status")
        result["response_status"] = status

        # Step 3: Analyze response
        if status == 200:
            result["available"] = True
            result["status"] = "available"
            print(f"✅ Available (200)")

            # Try to get trajectory to confirm model assignment
            time.sleep(0.5)  # Brief delay for backend processing
            trajectory = get_cascade_trajectory(cascade_id)
            if trajectory:
                # Extract model name from trajectory
                model_name = extract_model_name_from_trajectory(trajectory)
                result["model_name_in_response"] = model_name
                if model_name:
                    print(f"    → Assigned model: {model_name}")

        elif status == 500:
            error_body = message_response.get("body", {})
            error_message = error_body.get("message", "")

            if "unknown model UID" in error_message or "model not found" in error_message:
                result["status"] = "not_found"
                result["error"] = "Model not found"
                print("❌ Not found")
            else:
                result["status"] = "error"
                result["error"] = error_message
                print(f"❌ Error: {error_message[:50]}")
        else:
            result["status"] = "unexpected_status"
            result["error"] = f"Unexpected status: {status}"
            print(f"⚠️  Status {status}")

    except Exception as e:
        result["status"] = "exception"
        result["error"] = str(e)
        print(f"❌ Exception: {str(e)[:50]}")

    return result


def extract_model_name_from_trajectory(trajectory: Dict) -> Optional[str]:
    """Extract model name from GetCascadeTrajectory response."""
    try:
        # Try to extract from parsed response
        if "extracted" in trajectory:
            return trajectory["extracted"].get("modelName")

        # Try to extract from raw response
        if "body" in trajectory:
            body = trajectory["body"]
            if isinstance(body, str):
                # Search for common model name patterns
                import re
                patterns = [
                    r'kimi-[a-z0-9-]+',
                    r'glm-[a-z0-9-]+',
                    r'deepseek-[a-z0-9-]+',
                    r'qwen-[a-z0-9-]+',
                ]
                for pattern in patterns:
                    match = re.search(pattern, body)
                    if match:
                        return match.group(0)
    except Exception:
        pass

    return None


def discover_hidden_models(
    categories: Optional[List[str]] = None,
    skip_confirmed: bool = True,
) -> Dict:
    """
    Systematically test model candidates to find hidden models.

    Args:
        categories: List of category names to test (None = all)
        skip_confirmed: Skip already confirmed models

    Returns:
        Dict with discovery results
    """
    print("=" * 70)
    print("Windsurf Hidden Models Discovery")
    print("=" * 70)
    print()

    # Validate token first
    print("🔐 Validating authentication...")
    if not validate_token():
        print("❌ Authentication failed. Please set WINDSURF_DIRECT_KEY")
        return {"error": "authentication_failed"}
    print("✅ Authentication valid")
    print()

    # Determine which categories to test
    if categories is None:
        categories = list(CANDIDATE_MODELS.keys())

    if skip_confirmed and "confirmed_free" in categories:
        categories.remove("confirmed_free")

    # Results storage
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_tested": 0,
        "available": [],
        "not_found": [],
        "errors": [],
        "by_category": {},
    }

    # Test each category
    for category in categories:
        if category not in CANDIDATE_MODELS:
            print(f"⚠️  Unknown category: {category}")
            continue

        models = CANDIDATE_MODELS[category]
        print(f"📦 Testing category: {category} ({len(models)} models)")
        print("-" * 70)

        category_results = {
            "available": [],
            "not_found": [],
            "errors": [],
        }

        for model_uid in models:
            result = test_model_availability(model_uid)
            results["total_tested"] += 1

            if result["available"]:
                results["available"].append(result)
                category_results["available"].append(result)
            elif result["status"] == "not_found":
                results["not_found"].append(result)
                category_results["not_found"].append(result)
            else:
                results["errors"].append(result)
                category_results["errors"].append(result)

            # Rate limiting
            time.sleep(0.5)

        results["by_category"][category] = category_results
        print()

    return results


def print_summary(results: Dict):
    """Print discovery summary."""
    print("=" * 70)
    print("Discovery Summary")
    print("=" * 70)
    print()

    print(f"📊 Total models tested: {results['total_tested']}")
    print(f"✅ Available: {len(results['available'])}")
    print(f"❌ Not found: {len(results['not_found'])}")
    print(f"⚠️  Errors: {len(results['errors'])}")
    print()

    if results["available"]:
        print("🎉 NEWLY DISCOVERED MODELS:")
        print("-" * 70)
        for model in results["available"]:
            model_uid = model["model_uid"]
            assigned = model.get("model_name_in_response", "unknown")
            print(f"  ✅ {model_uid}")
            if assigned and assigned != model_uid:
                print(f"     → Backend assigned: {assigned}")
        print()

    # Print by category
    print("📦 Results by Category:")
    print("-" * 70)
    for category, cat_results in results["by_category"].items():
        available_count = len(cat_results["available"])
        total_count = (
            available_count +
            len(cat_results["not_found"]) +
            len(cat_results["errors"])
        )
        print(f"  {category}: {available_count}/{total_count} available")

        if cat_results["available"]:
            for model in cat_results["available"]:
                print(f"    ✅ {model['model_uid']}")
    print()


def save_results(results: Dict, output_file: str = "windsurf_hidden_models_discovery.json"):
    """Save results to JSON file."""
    output_path = Path(__file__).parent.parent / output_file
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"💾 Results saved to: {output_path}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main discovery routine."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Discover hidden Windsurf models without BYOK"
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        help="Categories to test (default: all except confirmed_free)",
    )
    parser.add_argument(
        "--include-confirmed",
        action="store_true",
        help="Include confirmed free models in testing",
    )
    parser.add_argument(
        "--output",
        default="windsurf_hidden_models_discovery.json",
        help="Output JSON file",
    )

    args = parser.parse_args()

    # Run discovery
    results = discover_hidden_models(
        categories=args.categories,
        skip_confirmed=not args.include_confirmed,
    )

    if "error" in results:
        print(f"❌ Discovery failed: {results['error']}")
        return 1

    # Print summary
    print_summary(results)

    # Save results
    save_results(results, args.output)

    return 0


if __name__ == "__main__":
    sys.exit(main())
