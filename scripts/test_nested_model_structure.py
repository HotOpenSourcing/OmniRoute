#!/usr/bin/env python3
"""
Test SendUserCascadeMessage with nested model structure
Based on protobuf conventions, the model might be in a nested object
"""

import json
import urllib.request
import urllib.error

# Configuration
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

def test_nested_model_structure():
    """Test with nested model structures"""

    model_uid = "gpt-5-5-low-20260424"

    # Start cascade
    start_url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/StartCascade"

    start_payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": "test-nested"
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
            if body[:2] == b'\x1f\x8b':
                import gzip
                body = gzip.decompress(body)

            body_text = body.decode('utf-8', errors='ignore')

            import re
            match = re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', body_text)
            if not match:
                print("ERROR: No cascade ID found")
                return

            cascade_id = match.group(0)
            print(f"Cascade ID: {cascade_id}")
            print()

            # Test different nested structures
            test_payloads = [
                {
                    "name": "planModel nested object",
                    "payload": {
                        "cascadeId": cascade_id,
                        "chatText": "quelle model llm vous etes",
                        "planModel": {
                            "uid": model_uid
                        }
                    }
                },
                {
                    "name": "requestedModel nested object",
                    "payload": {
                        "cascadeId": cascade_id,
                        "chatText": "quelle model llm vous etes",
                        "requestedModel": {
                            "uid": model_uid
                        }
                    }
                },
                {
                    "name": "planModel with modelUid",
                    "payload": {
                        "cascadeId": cascade_id,
                        "chatText": "quelle model llm vous etes",
                        "planModel": {
                            "modelUid": model_uid
                        }
                    }
                },
                {
                    "name": "requestedModel with modelUid",
                    "payload": {
                        "cascadeId": cascade_id,
                        "chatText": "quelle model llm vous etes",
                        "requestedModel": {
                            "modelUid": model_uid
                        }
                    }
                },
                {
                    "name": "Both planModel and requestedModel",
                    "payload": {
                        "cascadeId": cascade_id,
                        "chatText": "quelle model llm vous etes",
                        "planModel": {
                            "uid": model_uid
                        },
                        "requestedModel": {
                            "uid": model_uid
                        }
                    }
                }
            ]

            send_url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

            for test in test_payloads:
                print(f"Testing: {test['name']}")

                full_payload = {
                    "metadata": {
                        "apiKey": SESSION_TOKEN,
                        "ideName": "windsurf",
                        "ideVersion": "1.108.2",
                        "extensionName": "windsurf",
                        "extensionVersion": "1.108.2",
                        "locale": "en",
                        "sessionId": "test-nested"
                    },
                    **test['payload']
                }

                send_headers = {
                    "Accept": "*/*",
                    "Authorization": SESSION_TOKEN,
                    "Content-Type": "application/json",
                    "Host": f"e.localhost:{PORT}",
                    "Origin": "vscode-file://vscode-app",
                    "x-codeium-csrf-token": CSRF_TOKEN
                }

                try:
                    send_req = urllib.request.Request(
                        send_url,
                        data=json.dumps(full_payload).encode('utf-8'),
                        headers=send_headers,
                        method='POST'
                    )

                    with urllib.request.urlopen(send_req, timeout=30) as send_response:
                        print(f"  SUCCESS - HTTP {send_response.status}")
                        print(f"  Payload structure: {json.dumps(test['payload'], indent=4)}")
                        return test['name']

                except urllib.error.HTTPError as e:
                    error_body = e.read().decode('utf-8', errors='ignore')
                    print(f"  FAILED - HTTP {e.code}")
                    print(f"  Error: {error_body[:150]}")

                except Exception as e:
                    print(f"  ERROR: {str(e)[:100]}")

                print()

    except Exception as e:
        print(f"StartCascade failed: {e}")

if __name__ == '__main__':
    print("="*70)
    print("TESTING NESTED MODEL STRUCTURES")
    print("="*70)
    print()

    result = test_nested_model_structure()

    if result:
        print("="*70)
        print(f"WORKING STRUCTURE: {result}")
        print("="*70)
    else:
        print("="*70)
        print("NO WORKING STRUCTURE FOUND")
        print("="*70)
