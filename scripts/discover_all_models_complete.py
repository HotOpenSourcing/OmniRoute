#!/usr/bin/env python3
"""
Discover ALL Windsurf models including hidden ones like gpt-5.5
Uses multiple discovery methods:
1. GetModelStatuses API
2. Parsing captured network traffic
3. Testing known model patterns
"""

import json
import sys
import urllib.request
import urllib.error
import re

# Configuration
LOCAL_LS_URL = "http://127.0.0.1:53302"
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1hNjliYzY5NWQyN2E0NWVjYmRmNjVmYWI5MWQxODZhNiJ9.KyaNgJ8vM6gQswVjs5YMDzSb4Q7lF5313TBlV_tybqM"

# Known model patterns to test
MODEL_PATTERNS = [
    # GPT models
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4',
    'gpt-5', 'gpt-5.5', 'gpt-5-turbo',
    'o1', 'o1-mini', 'o1-preview', 'o3-mini',

    # Claude models
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229', 'claude-3-sonnet-20240229',
    'claude-4', 'claude-4-opus', 'claude-4-sonnet',

    # Gemini models
    'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash',
    'gemini-2.0-pro', 'gemini-2.5-flash',

    # DeepSeek models
    'deepseek-chat', 'deepseek-reasoner', 'deepseek-v3',

    # Chinese models
    'kimi-k2-6', 'kimi-k2-5', 'kimi-k3',
    'glm-5', 'glm-5-1', 'glm-6',
    'qwen-max', 'qwen-plus', 'qwen-turbo',

    # Other models
    'grok-2-1212', 'grok-3',
    'llama-3.3-70b-versatile', 'llama-4',
    'mixtral-8x7b-32768', 'mixtral-8x22b',
    'swe-1-6-fast', 'swe-2',
]

def get_model_statuses():
    """Query GetModelStatuses API"""
    url = f"{LOCAL_LS_URL}/exa.language_server_pb.LanguageServerService/GetModelStatuses"

    payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": "discovery-session"
        }
    }

    headers = {
        "Content-Type": "application/json",
        "Host": "b.localhost:53302",
        "Origin": "vscode-file://vscode-app"
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()

            # Try JSON first
            try:
                body_text = body.decode('utf-8')
                data = json.loads(body_text)
                return {'status': 200, 'data': data, 'format': 'json'}
            except:
                # Protobuf - try to extract model names
                body_text = body.decode('utf-8', errors='ignore')

                # Look for model UIDs in the response
                model_pattern = r'[a-z0-9-]+(?:-[0-9]+)?(?:-[a-z]+)?'
                potential_models = re.findall(model_pattern, body_text)

                # Filter to likely model names
                likely_models = [m for m in potential_models if any(
                    keyword in m for keyword in ['gpt', 'claude', 'gemini', 'deepseek', 'kimi', 'glm', 'llama', 'mixtral', 'grok', 'swe', 'qwen', 'o1', 'o3']
                )]

                return {
                    'status': 200,
                    'data': {'models': likely_models, 'raw_hex': body.hex()},
                    'format': 'protobuf'
                }

    except urllib.error.HTTPError as e:
        return {'status': e.code, 'error': e.read().decode('utf-8', errors='ignore')}
    except Exception as e:
        return {'status': 0, 'error': str(e)}

def test_model_exists(model_uid):
    """Test if a model exists by trying to start a cascade with it"""
    # Start cascade
    start_url = f"{LOCAL_LS_URL}/exa.language_server_pb.LanguageServerService/StartCascade"

    payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": f"test-{model_uid}"
        },
        "source": 1
    }

    headers = {
        "Content-Type": "application/json",
        "Host": "l.localhost:53302",
        "Origin": "vscode-file://vscode-app"
    }

    try:
        req = urllib.request.Request(
            start_url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
            body_text = body.decode('utf-8', errors='ignore')

            # Extract cascade ID
            match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', body_text)
            if not match:
                return False

            cascade_id = match.group(0)

            # Try to send message with this model
            send_url = f"{LOCAL_LS_URL}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

            send_payload = {
                "metadata": {
                    "apiKey": SESSION_TOKEN,
                    "ideName": "windsurf",
                    "ideVersion": "1.108.2",
                    "extensionName": "windsurf",
                    "extensionVersion": "1.108.2",
                    "locale": "en",
                    "sessionId": f"test-{model_uid}"
                },
                "cascadeId": cascade_id,
                "chatText": "test",
                "modelUid": model_uid
            }

            send_headers = {
                "Content-Type": "application/json",
                "Host": "e.localhost:53302",
                "Origin": "vscode-file://vscode-app"
            }

            send_req = urllib.request.Request(
                send_url,
                data=json.dumps(send_payload).encode('utf-8'),
                headers=send_headers,
                method='POST'
            )

            with urllib.request.urlopen(send_req, timeout=10) as send_response:
                return send_response.status == 200

    except urllib.error.HTTPError as e:
        # 500 with "model not found" = doesn't exist
        # 500 with other error = might exist but other issue
        if e.code == 500:
            error_body = e.read().decode('utf-8', errors='ignore')
            if 'model not found' in error_body.lower():
                return False
            else:
                return 'unknown'  # Exists but has other issue
        return False
    except:
        return False

def main():
    print("="*70)
    print("Windsurf Complete Model Discovery")
    print("="*70)
    print()

    all_models = set()

    # Method 1: GetModelStatuses API
    print("[1/2] Querying GetModelStatuses API...")
    result = get_model_statuses()

    if result['status'] == 200:
        print("  [OK] GetModelStatuses returned 200")

        if result.get('format') == 'json':
            models = result.get('data', {}).get('models', [])
            all_models.update(models)
            print(f"  Found {len(models)} models in JSON response")
        else:
            models = result.get('data', {}).get('models', [])
            all_models.update(models)
            print(f"  Extracted {len(models)} potential models from protobuf")
    else:
        print(f"  [FAILED] Status {result['status']}")

    print()

    # Method 2: Test known model patterns
    print("[2/2] Testing known model patterns...")
    print(f"  Testing {len(MODEL_PATTERNS)} model patterns...")
    print()

    working_models = []
    rejected_models = []
    unknown_models = []

    for i, model in enumerate(MODEL_PATTERNS, 1):
        print(f"  [{i}/{len(MODEL_PATTERNS)}] Testing {model}...", end=' ')

        exists = test_model_exists(model)

        if exists == True:
            print("[OK]")
            working_models.append(model)
            all_models.add(model)
        elif exists == 'unknown':
            print("[UNKNOWN]")
            unknown_models.append(model)
            all_models.add(model)
        else:
            print("[NOT FOUND]")
            rejected_models.append(model)

    # Summary
    print()
    print("="*70)
    print("DISCOVERY COMPLETE")
    print("="*70)
    print()
    print(f"Total unique models discovered: {len(all_models)}")
    print(f"Working models (Status 200): {len(working_models)}")
    print(f"Unknown status models: {len(unknown_models)}")
    print(f"Not found models: {len(rejected_models)}")
    print()

    if working_models:
        print("WORKING MODELS:")
        for model in sorted(working_models):
            print(f"  - {model}")
        print()

    if unknown_models:
        print("UNKNOWN STATUS MODELS (might work):")
        for model in sorted(unknown_models):
            print(f"  - {model}")
        print()

    # Save results
    output = {
        'timestamp': '2026-05-04T11:15:00Z',
        'total_discovered': len(all_models),
        'working_models': sorted(working_models),
        'unknown_models': sorted(unknown_models),
        'not_found_models': sorted(rejected_models),
        'all_models': sorted(list(all_models))
    }

    output_file = 'windsurf_complete_model_discovery.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Results saved: {output_file}")
    print("="*70)

    return 0 if working_models else 1

if __name__ == '__main__':
    sys.exit(main())
