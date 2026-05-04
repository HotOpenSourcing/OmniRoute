#!/usr/bin/env python3
"""
Analyze the correct request format for SendUserCascadeMessage
Based on the error: "neither PlanModel nor RequestedModel specified"

The API expects either:
- planModel field
- requestedModel field

Not modelUid as we were using.
"""

import json
import urllib.request
import urllib.error
import time

# Configuration
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

# Test models
TEST_MODELS = [
    "gpt-5-5-low-20260424",
    "claude-opus-4-7-medium-20260424",
    "deepseek-v4-20260424"
]

def test_model_with_field(model_uid, field_name):
    """Test a model using specific field name"""

    # Step 1: Start cascade
    start_url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/StartCascade"

    start_payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": f"test-{model_uid}-{field_name}"
        },
        "source": 1
    }

    start_headers = {
        "Accept": "*/*",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/json",
        "Host": f"l.localhost:{PORT}",
        "Origin": "vscode-file://vscode-app",
        "x-codeium-csrf-token": CSRF_TOKEN
    }

    try:
        req = urllib.request.Request(
            start_url,
            data=json.dumps(start_payload).encode('utf-8'),
            headers=start_headers,
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()

            # Decompress if gzipped
            if body[:2] == b'\x1f\x8b':
                import gzip
                body = gzip.decompress(body)

            body_text = body.decode('utf-8', errors='ignore')

            # Extract cascade ID
            import re
            match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', body_text)
            if not match:
                return {'status': 'error', 'reason': 'No cascade ID'}

            cascade_id = match.group(0)

            # Step 2: Send message with different field names
            send_url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

            send_payload = {
                "metadata": {
                    "apiKey": SESSION_TOKEN,
                    "ideName": "windsurf",
                    "ideVersion": "1.108.2",
                    "extensionName": "windsurf",
                    "extensionVersion": "1.108.2",
                    "locale": "en",
                    "sessionId": f"test-{model_uid}-{field_name}"
                },
                "cascadeId": cascade_id,
                "chatText": "quelle model llm vous etes",
                field_name: model_uid  # Try different field names
            }

            send_headers = {
                "Accept": "*/*",
                "Authorization": SESSION_TOKEN,
                "Content-Type": "application/json",
                "Host": f"e.localhost:{PORT}",
                "Origin": "vscode-file://vscode-app",
                "x-codeium-csrf-token": CSRF_TOKEN
            }

            send_req = urllib.request.Request(
                send_url,
                data=json.dumps(send_payload).encode('utf-8'),
                headers=send_headers,
                method='POST'
            )

            with urllib.request.urlopen(send_req, timeout=30) as send_response:
                return {
                    'status': 'success',
                    'http_status': send_response.status,
                    'field_name': field_name
                }

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        return {
            'status': 'error',
            'http_status': e.code,
            'field_name': field_name,
            'reason': error_body[:300]
        }
    except Exception as e:
        return {
            'status': 'error',
            'field_name': field_name,
            'reason': str(e)[:200]
        }

def main():
    print("="*70)
    print("TESTING DIFFERENT MODEL FIELD NAMES")
    print("="*70)
    print()

    # Field names to try based on error message
    field_names = [
        "planModel",
        "requestedModel",
        "modelUid",
        "model",
        "modelId"
    ]

    results = []

    for model in TEST_MODELS:
        print(f"\nTesting model: {model}")
        print("-" * 70)

        for field_name in field_names:
            print(f"  Field '{field_name}'...", end=' ', flush=True)

            result = test_model_with_field(model, field_name)

            if result['status'] == 'success':
                print(f"SUCCESS (HTTP {result['http_status']})")
                results.append({
                    'model': model,
                    'field_name': field_name,
                    'status': 'success'
                })
                # Found working field, stop trying others for this model
                break
            else:
                print(f"FAILED (HTTP {result.get('http_status', 'N/A')})")
                if 'neither PlanModel nor RequestedModel' not in result.get('reason', ''):
                    # Different error - might be progress
                    print(f"    New error: {result.get('reason', '')[:100]}")

                results.append({
                    'model': model,
                    'field_name': field_name,
                    'status': 'error',
                    'reason': result.get('reason', '')[:200]
                })

            time.sleep(0.3)

    # Summary
    print()
    print("="*70)
    print("SUMMARY")
    print("="*70)
    print()

    success = [r for r in results if r['status'] == 'success']

    if success:
        print("WORKING COMBINATIONS:")
        for r in success:
            print(f"  Model: {r['model']}")
            print(f"  Field: {r['field_name']}")
            print()
    else:
        print("No working combinations found.")
        print()
        print("All tested field names:")
        for fn in field_names:
            print(f"  - {fn}")

    # Save results
    output = {
        'timestamp': '2026-05-04T13:11:00Z',
        'tested_fields': field_names,
        'results': results
    }

    with open('windsurf_field_name_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print("\nResults saved to: windsurf_field_name_test_results.json")

if __name__ == '__main__':
    main()
