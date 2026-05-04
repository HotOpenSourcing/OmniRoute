#!/usr/bin/env python3
"""
Test all 8 discovered Windsurf models using protobuf encoding
"""

import json
import urllib.request
import urllib.error
import time
import re

# Configuration
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

# Load discovered models
with open('windsurf_models_from_setusersettings.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    MODELS = [m['full_uid'] for m in data['models']]

def encode_protobuf_string(field_number, value):
    """Encode a protobuf string field"""
    tag = (field_number << 3) | 2
    value_bytes = value.encode('utf-8')
    length = len(value_bytes)

    result = bytearray()
    result.append(tag)
    result.append(length)
    result.extend(value_bytes)

    return bytes(result)

def encode_protobuf_message(field_number, message_bytes):
    """Encode a nested protobuf message"""
    tag = (field_number << 3) | 2
    length = len(message_bytes)

    result = bytearray()
    result.append(tag)
    result.append(length)
    result.extend(message_bytes)

    return bytes(result)

def start_cascade():
    """Start a new cascade and return cascade ID"""
    url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/StartCascade"

    payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": f"test-{int(time.time())}"
        },
        "source": 1
    }

    headers = {
        "Accept": "*/*",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/json",
        "Host": f"l.localhost:{PORT}",
        "Origin": "vscode-file://vscode-app",
        "x-codeium-csrf-token": CSRF_TOKEN
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
            if body[:2] == b'\x1f\x8b':
                import gzip
                body = gzip.decompress(body)

            body_text = body.decode('utf-8', errors='ignore')
            match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', body_text)

            if match:
                return match.group(0)
            return None

    except Exception as e:
        print(f"    StartCascade error: {e}")
        return None

def test_model_protobuf(model_uid, cascade_id):
    """Test a model using protobuf encoding"""

    chat_text = "quelle model llm vous etes"

    # Build protobuf message
    message = bytearray()

    # Field 1: cascadeId
    message.extend(encode_protobuf_string(1, cascade_id))

    # Field 2: chatText
    message.extend(encode_protobuf_string(2, chat_text))

    # Field 3: planModel (nested message with uid)
    plan_model_msg = encode_protobuf_string(1, model_uid)
    message.extend(encode_protobuf_message(3, plan_model_msg))

    # Send request
    url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

    headers = {
        "Accept": "*/*",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/grpc-web+proto",
        "Host": f"e.localhost:{PORT}",
        "Origin": "vscode-file://vscode-app",
        "x-codeium-csrf-token": CSRF_TOKEN
    }

    try:
        req = urllib.request.Request(
            url,
            data=bytes(message),
            headers=headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            return {
                'status': 'success',
                'http_status': response.status,
                'cascade_id': cascade_id
            }

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        return {
            'status': 'error',
            'http_status': e.code,
            'reason': error_body[:200]
        }
    except Exception as e:
        return {
            'status': 'error',
            'reason': str(e)[:200]
        }

def main():
    print("="*70)
    print("TESTING ALL DISCOVERED MODELS WITH PROTOBUF")
    print("="*70)
    print()
    print(f"Port: {PORT}")
    print(f"Models to test: {len(MODELS)}")
    print()

    results = []

    for i, model in enumerate(MODELS, 1):
        print(f"[{i}/{len(MODELS)}] {model}")

        # Start cascade
        print(f"    Starting cascade...", end=' ', flush=True)
        cascade_id = start_cascade()

        if not cascade_id:
            print("FAILED (no cascade ID)")
            results.append({
                'model': model,
                'result': {'status': 'error', 'reason': 'Failed to start cascade'}
            })
            continue

        print(f"OK ({cascade_id[:8]}...)")

        # Test model
        print(f"    Testing model...", end=' ', flush=True)
        result = test_model_protobuf(model, cascade_id)

        if result['status'] == 'success':
            print(f"SUCCESS (HTTP {result['http_status']})")
        else:
            print(f"FAILED")
            if 'http_status' in result:
                print(f"    HTTP {result['http_status']}")
            if 'reason' in result:
                print(f"    {result['reason'][:100]}")

        results.append({
            'model': model,
            'result': result
        })

        time.sleep(0.5)
        print()

    # Summary
    print("="*70)
    print("SUMMARY")
    print("="*70)
    print()

    success = [r for r in results if r['result']['status'] == 'success']
    failed = [r for r in results if r['result']['status'] == 'error']

    print(f"Total: {len(results)}")
    print(f"Success: {len(success)}")
    print(f"Failed: {len(failed)}")
    print()

    if success:
        print("WORKING MODELS:")
        for r in success:
            base_name = r['model'].replace('-20260424', '')
            print(f"  - {base_name}")
        print()

    if failed:
        print("FAILED MODELS:")
        for r in failed:
            base_name = r['model'].replace('-20260424', '')
            print(f"  - {base_name}")
        print()

    # Highlight special models
    print("="*70)
    print("KEY DISCOVERIES")
    print("="*70)
    print()

    special_models = {
        'gpt-5-5-low-20260424': 'GPT-5.5 (Low)',
        'claude-opus-4-7-medium-20260424': 'Claude Opus 4.7 (Medium)',
        'claude-opus-4-6-thinking-20260424': 'Claude Opus 4.6 (Thinking)',
        'claude-sonnet-4-6-thinking-20260424': 'Claude Sonnet 4.6 (Thinking)',
        'deepseek-v4-20260424': 'DeepSeek V4'
    }

    for model_uid, display_name in special_models.items():
        model_result = next((r for r in results if r['model'] == model_uid), None)
        if model_result:
            status = "WORKS" if model_result['result']['status'] == 'success' else "FAILED"
            print(f"{display_name}: {status}")

    # Save results
    output = {
        'timestamp': '2026-05-04T13:14:00Z',
        'port': PORT,
        'encoding': 'protobuf',
        'total_tested': len(results),
        'success_count': len(success),
        'failed_count': len(failed),
        'results': results
    }

    output_file = 'windsurf_protobuf_test_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print()
    print(f"Results saved to: {output_file}")
    print("="*70)

if __name__ == '__main__':
    main()
