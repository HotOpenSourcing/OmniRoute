#!/usr/bin/env python3
"""
Query GetModelStatuses API directly to get all available models
"""

import json
import urllib.request
import urllib.error

# Configuration from HAR file
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

def get_model_statuses():
    """Query GetModelStatuses API"""
    url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/GetModelStatuses"

    # Payload with metadata (as seen in HAR)
    payload = {
        "metadata": {
            "apiKey": SESSION_TOKEN,
            "ideName": "windsurf",
            "ideVersion": "1.108.2",
            "extensionName": "windsurf",
            "extensionVersion": "1.108.2",
            "locale": "en",
            "sessionId": "windsurf-session-b38ff51bac374d2e8c2267d33840bd22"
        }
    }

    headers = {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/json",
        "Host": f"k.localhost:{PORT}",
        "Origin": "vscode-file://vscode-app",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "x-codeium-csrf-token": CSRF_TOKEN
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )

        print(f"Querying: {url}")
        print(f"Token: {SESSION_TOKEN[:50]}...")
        print()

        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()

            print(f"Status: {response.status}")
            print(f"Content-Type: {response.headers.get('Content-Type')}")
            print(f"Content-Encoding: {response.headers.get('Content-Encoding')}")
            print(f"Body length: {len(body)} bytes")
            print()

            # Decompress if gzipped
            if response.headers.get('Content-Encoding') == 'gzip' or body[:2] == b'\x1f\x8b':
                import gzip
                try:
                    body = gzip.decompress(body)
                    print(f"Decompressed body length: {len(body)} bytes")
                    print()
                except:
                    pass

            # Try JSON first
            try:
                body_text = body.decode('utf-8')
                data = json.loads(body_text)

                print("Response (JSON):")
                print(json.dumps(data, indent=2))

                # Extract models
                if 'models' in data:
                    models = data['models']
                    print(f"\nFound {len(models)} models:")
                    for model in models:
                        if isinstance(model, dict):
                            model_id = model.get('id') or model.get('uid') or model.get('name')
                            print(f"  - {model_id}")
                        else:
                            print(f"  - {model}")

                return data

            except (UnicodeDecodeError, json.JSONDecodeError):
                # Protobuf response
                print("Response is protobuf format")
                print(f"Hex preview: {body.hex()[:200]}...")
                print()
                print(f"Text preview: {body.decode('utf-8', errors='ignore')[:500]}...")

                # Try to extract model names from protobuf
                import re
                body_text = body.decode('utf-8', errors='ignore')

                # Look for model patterns
                model_patterns = [
                    r'(gpt-[0-9a-z.-]+)',
                    r'(claude-[0-9a-z.-]+)',
                    r'(gemini-[0-9a-z.-]+)',
                    r'(deepseek-[0-9a-z.-]+)',
                    r'(kimi-[0-9a-z.-]+)',
                    r'(glm-[0-9a-z.-]+)',
                    r'(o[0-9]-[0-9a-z.-]+)',
                    r'(grok-[0-9a-z.-]+)',
                    r'(llama-[0-9a-z.-]+)',
                    r'(mixtral-[0-9a-z.-]+)',
                    r'(qwen-[0-9a-z.-]+)',
                    r'(swe-[0-9a-z.-]+)'
                ]

                found_models = set()
                for pattern in model_patterns:
                    matches = re.findall(pattern, body_text)
                    found_models.update(matches)

                if found_models:
                    print(f"\nExtracted {len(found_models)} model names from protobuf:")
                    for model in sorted(found_models):
                        print(f"  - {model}")

                return {'models': sorted(list(found_models)), 'format': 'protobuf'}

    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}")
        error_body = e.read().decode('utf-8', errors='ignore')
        print(f"Error: {error_body}")
        return None
    except Exception as e:
        print(f"Exception: {e}")
        return None

if __name__ == '__main__':
    result = get_model_statuses()

    if result:
        # Save to file
        with open('windsurf_models_from_api.json', 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"\nResults saved to: windsurf_models_from_api.json")
