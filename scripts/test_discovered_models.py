#!/usr/bin/env python3
"""
Test all 8 models discovered from SetUserSettings protobuf
"""

import json
import urllib.request
import urllib.error
import time

# Configuration from HAR file
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

# Load discovered models
with open('windsurf_models_from_setusersettings.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    MODELS = [m['full_uid'] for m in data['models']]

def test_model(model_uid):
    """Test a model by starting cascade and sending message"""

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
            "sessionId": f"test-{model_uid}"
        },
        "source": 1
    }

    start_headers = {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/json",
        "Host": f"l.localhost:{PORT}",
        "Origin": "vscode-file://vscode-app",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
            if response.headers.get('Content-Encoding') == 'gzip' or body[:2] == b'\x1f\x8b':
                import gzip
                body = gzip.decompress(body)

            body_text = body.decode('utf-8', errors='ignore')

            # Extract cascade ID
            import re
            match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', body_text)
            if not match:
                return {'status': 'error', 'reason': 'No cascade ID in response'}

            cascade_id = match.group(0)

            # Step 2: Send message with this model
            send_url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

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
                "chatText": "quelle model llm vous etes",
                "modelUid": model_uid
            }

            send_headers = {
                "Accept": "*/*",
                "Accept-Encoding": "gzip, deflate, br, zstd",
                "Accept-Language": "en-US,en;q=0.9",
                "Authorization": SESSION_TOKEN,
                "Content-Type": "application/json",
                "Host": f"e.localhost:{PORT}",
                "Origin": "vscode-file://vscode-app",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
    print("TESTING DISCOVERED WINDSURF MODELS")
    print("="*70)
    print()
    print(f"Port: {PORT}")
    print(f"Models to test: {len(MODELS)}")
    print()

    results = []

    for i, model in enumerate(MODELS, 1):
        print(f"[{i}/{len(MODELS)}] Testing {model}...", end=' ', flush=True)

        result = test_model(model)

        if result['status'] == 'success':
            print(f"OK (Status {result['http_status']})")
        else:
            print(f"FAILED")
            if 'http_status' in result:
                print(f"    HTTP {result['http_status']}")
            if 'reason' in result:
                print(f"    Reason: {result['reason']}")

        results.append({
            'model': model,
            'result': result
        })

        # Small delay between requests
        time.sleep(0.5)

    # Summary
    print()
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
            print(f"  - {r['model']}")
        print()

    if failed:
        print("FAILED MODELS:")
        for r in failed:
            print(f"  - {r['model']}")
            if 'http_status' in r['result']:
                print(f"    HTTP {r['result']['http_status']}")
        print()

    # Save results
    output = {
        'timestamp': '2026-05-04T13:08:00Z',
        'port': PORT,
        'total_tested': len(results),
        'success_count': len(success),
        'failed_count': len(failed),
        'results': results
    }

    output_file = 'windsurf_discovered_models_test_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Results saved to: {output_file}")
    print()

if __name__ == '__main__':
    main()
