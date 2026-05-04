#!/usr/bin/env python3
"""
Discover all available Windsurf models via GetModelStatuses API
"""

import json
import sys
import urllib.request
import urllib.error

# Configuration
LOCAL_LS_URL = "http://127.0.0.1:53302"
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1hNjliYzY5NWQyN2E0NWVjYmRmNjVmYWI5MWQxODZhNiJ9.KyaNgJ8vM6gQswVjs5YMDzSb4Q7lF5313TBlV_tybqM"

def get_model_statuses():
    """Query GetModelStatuses API to discover all available models"""
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

        print("Querying GetModelStatuses API...")
        print(f"URL: {url}")
        print()

        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()

            print(f"Status: {response.status}")
            print(f"Content-Type: {response.headers.get('Content-Type')}")
            print(f"Body length: {len(body)} bytes")
            print()

            # Try to decode as JSON
            try:
                body_text = body.decode('utf-8')
                data = json.loads(body_text)

                print("Response (JSON):")
                print(json.dumps(data, indent=2))

                return {
                    'status': response.status,
                    'data': data,
                    'format': 'json'
                }
            except (UnicodeDecodeError, json.JSONDecodeError):
                # Might be protobuf
                print("Response (Raw bytes - likely protobuf):")
                print(f"Hex: {body.hex()[:200]}...")
                print()
                print(f"Text preview: {body.decode('utf-8', errors='ignore')[:200]}...")

                return {
                    'status': response.status,
                    'data': body,
                    'format': 'protobuf'
                }

    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        print(f"HTTP Error {e.code}:")
        print(error_body)

        try:
            error_json = json.loads(error_body)
            print("\nError (JSON):")
            print(json.dumps(error_json, indent=2))
        except:
            pass

        return {
            'status': e.code,
            'error': error_body
        }
    except Exception as e:
        print(f"Exception: {e}")
        return {
            'status': 0,
            'error': str(e)
        }

def main():
    print("="*70)
    print("Windsurf Model Discovery - GetModelStatuses API")
    print("="*70)
    print()

    result = get_model_statuses()

    print()
    print("="*70)
    print("Summary")
    print("="*70)

    if result['status'] == 200:
        print("SUCCESS: GetModelStatuses returned 200")

        if result.get('format') == 'json':
            print("\nModels discovered (JSON format):")
            # Try to extract model list from JSON
            data = result.get('data', {})
            if isinstance(data, dict):
                models = data.get('models', [])
                if models:
                    for model in models:
                        print(f"  - {model}")
                else:
                    print("  (No 'models' field found in JSON)")
        else:
            print("\nResponse is in protobuf format")
            print("Need to decode protobuf to extract model list")
    else:
        print(f"FAILED: Status {result['status']}")
        if 'error' in result:
            print(f"Error: {result['error'][:200]}")

    # Save result
    output_file = 'windsurf_model_discovery_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        # Convert bytes to hex for JSON serialization
        if result.get('format') == 'protobuf':
            result['data'] = result['data'].hex()
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nResults saved: {output_file}")

if __name__ == '__main__':
    sys.exit(main())
