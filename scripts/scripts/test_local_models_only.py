#!/usr/bin/env python3
"""
Test Windsurf models via localhost:53302 only (no cloud API)
This avoids DEVIN_TOKEN_EXCHANGE_PSK errors
"""

import json
import os
import subprocess
import sys
from datetime import datetime

# Models to test
MODELS = [
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'gemini-2.0-flash-exp',
    'deepseek-chat',
    'kimi-k2-6',
    'kimi-k2-5',
    'glm-5',
    'glm-5-1',
    'swe-1-6-fast'
]

MESSAGE = "quelle model llm vous etes"

def test_model_local(model):
    """Test a model using only local API (no AssignModel call)"""
    env = os.environ.copy()
    env['WINDSURF_CHAT_MODEL_NAME'] = model
    env['WINDSURF_CHAT_TEXT'] = MESSAGE
    # Force local-only mode (skip AssignModel)
    env['WINDSURF_SKIP_ASSIGN_MODEL'] = '1'

    print(f"\n{'='*70}")
    print(f"Testing: {model}")
    print(f"Message: {MESSAGE}")
    print(f"Mode: Local API only (localhost:53302)")
    print(f"{'='*70}")

    try:
        result = subprocess.run(
            [sys.executable, 'windsurf_direct_probe.py'],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(__file__)
        )

        if result.returncode != 0:
            print(f"[ERROR] Exit code {result.returncode}")
            print(f"stderr: {result.stderr[:500]}")
            return {'model': model, 'status': 'error', 'error': 'Non-zero exit code'}

        # Parse JSON output
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            print(f"[JSON ERROR] {e}")
            print(f"stdout preview: {result.stdout[:500]}")
            return {'model': model, 'status': 'parse_error', 'error': str(e)}

        # Check SendUserCascadeMessage status
        send_status = data.get('sendUserCascadeMessage', {}).get('status')

        if send_status == 200:
            print(f"[SUCCESS] SendUserCascadeMessage Status 200")

            # Try to get response
            response = data.get('response', '')
            if response:
                print(f"Response preview: {response[:200]}")

            return {
                'model': model,
                'status': 'success',
                'http_status': 200,
                'response_preview': response[:200] if response else ''
            }
        else:
            print(f"[REJECTED] SendUserCascadeMessage Status {send_status}")
            error_msg = data.get('sendUserCascadeMessage', {}).get('body', {})
            if isinstance(error_msg, dict):
                error_msg = error_msg.get('message', 'Unknown error')

            return {
                'model': model,
                'status': 'rejected',
                'http_status': send_status,
                'error': str(error_msg)
            }

    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT]")
        return {'model': model, 'status': 'timeout'}
    except Exception as e:
        print(f"[EXCEPTION] {e}")
        return {'model': model, 'status': 'exception', 'error': str(e)}

def main():
    print("="*70)
    print("Test Windsurf Models - Local API Only")
    print(f"Message: '{MESSAGE}'")
    print(f"Total: {len(MODELS)} models")
    print(f"Mode: localhost:53302 (no cloud API calls)")
    print("="*70)

    results = []
    success = 0
    rejected = 0
    errors = 0

    for model in MODELS:
        result = test_model_local(model)
        results.append(result)

        if result['status'] == 'success':
            success += 1
        elif result['status'] == 'rejected':
            rejected += 1
        else:
            errors += 1

    # Summary
    print("\n" + "="*70)
    print("FINAL SUMMARY")
    print("="*70)
    print(f"\n[SUCCESS] {success}/{len(MODELS)}")
    print(f"[REJECTED] {rejected}/{len(MODELS)}")
    print(f"[ERRORS] {errors}/{len(MODELS)}")

    print("\n[SUCCESS] Working Models:")
    for r in results:
        if r['status'] == 'success':
            print(f"  - {r['model']}")
            if r.get('response_preview'):
                print(f"    Response: {r['response_preview']}")

    print("\n[REJECTED] Rejected Models:")
    for r in results:
        if r['status'] == 'rejected':
            print(f"  - {r['model']} (Status {r.get('http_status', 'unknown')})")
            if r.get('error'):
                print(f"    Error: {r['error']}")

    print("\n[ERRORS] Error Models:")
    for r in results:
        if r['status'] not in ['success', 'rejected']:
            print(f"  - {r['model']} ({r['status']})")
            if r.get('error'):
                print(f"    Error: {r['error']}")

    # Save results
    output = {
        'timestamp': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        'message': MESSAGE,
        'mode': 'local_api_only',
        'total': len(MODELS),
        'success': success,
        'rejected': rejected,
        'errors': errors,
        'results': results
    }

    output_file = 'test_local_models_only_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nResults saved: {output_file}")
    print("="*70)

    return 0 if success > 0 else 1

if __name__ == '__main__':
    sys.exit(main())
