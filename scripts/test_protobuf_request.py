#!/usr/bin/env python3
"""
Send protobuf-encoded SendUserCascadeMessage request
The API expects protobuf binary, not JSON
"""

import urllib.request
import urllib.error

# Configuration
PORT = 51834
SESSION_TOKEN = "devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoid2luZHN1cmYtc2Vzc2lvbi1iMzhmZjUxYmFjMzc0ZDJlOGMyMjY3ZDMzODQwYmQyMiJ9.Bh2TUtbSyCkAEKngLUdpWFmpJdMKNGV8xTfRsrXnnII"
CSRF_TOKEN = "965fdd75-25f9-45cc-ac13-ee8dea91fa46"

def encode_protobuf_string(field_number, value):
    """Encode a protobuf string field"""
    # Wire type 2 (length-delimited)
    tag = (field_number << 3) | 2

    # Encode value as UTF-8
    value_bytes = value.encode('utf-8')
    length = len(value_bytes)

    # Varint encode tag
    result = bytearray()
    result.append(tag)

    # Varint encode length
    result.append(length)

    # Add value
    result.extend(value_bytes)

    return bytes(result)

def encode_protobuf_message(field_number, message_bytes):
    """Encode a nested protobuf message"""
    # Wire type 2 (length-delimited)
    tag = (field_number << 3) | 2

    length = len(message_bytes)

    result = bytearray()
    result.append(tag)
    result.append(length)
    result.extend(message_bytes)

    return bytes(result)

def test_protobuf_request():
    """Test with actual protobuf encoding"""

    model_uid = "gpt-5-5-low-20260424"
    cascade_id = "test-cascade-id-12345678-1234-1234-1234-123456789abc"
    chat_text = "quelle model llm vous etes"

    print("Building protobuf message...")
    print(f"Model: {model_uid}")
    print(f"Cascade ID: {cascade_id}")
    print(f"Chat text: {chat_text}")
    print()

    # Build the message
    # Field 1: cascadeId (string)
    # Field 2: chatText (string)
    # Field 3: planModel (message with uid field)
    # Field 4: requestedModel (message with uid field)

    message = bytearray()

    # Add cascadeId (field 1)
    message.extend(encode_protobuf_string(1, cascade_id))

    # Add chatText (field 2)
    message.extend(encode_protobuf_string(2, chat_text))

    # Add planModel (field 3) - nested message with uid
    plan_model_msg = encode_protobuf_string(1, model_uid)  # uid is field 1 in the nested message
    message.extend(encode_protobuf_message(3, plan_model_msg))

    print(f"Protobuf message size: {len(message)} bytes")
    print(f"Hex: {message.hex()[:100]}...")
    print()

    # Send request
    url = f"http://127.0.0.1:{PORT}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage"

    headers = {
        "Accept": "*/*",
        "Authorization": SESSION_TOKEN,
        "Content-Type": "application/grpc-web+proto",  # Protobuf content type
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

        print("Sending protobuf request...")

        with urllib.request.urlopen(req, timeout=30) as response:
            print(f"SUCCESS - HTTP {response.status}")
            print(f"Content-Type: {response.headers.get('Content-Type')}")

            body = response.read()
            print(f"Response size: {len(body)} bytes")
            print(f"Response hex: {body.hex()[:200]}...")

            return True

    except urllib.error.HTTPError as e:
        print(f"FAILED - HTTP {e.code}")
        error_body = e.read()
        print(f"Error body: {error_body.decode('utf-8', errors='ignore')[:300]}")
        return False

    except Exception as e:
        print(f"ERROR: {e}")
        return False

if __name__ == '__main__':
    print("="*70)
    print("TESTING PROTOBUF-ENCODED REQUEST")
    print("="*70)
    print()

    success = test_protobuf_request()

    print()
    print("="*70)
    if success:
        print("PROTOBUF REQUEST WORKED!")
    else:
        print("PROTOBUF REQUEST FAILED")
        print()
        print("Note: This is a simplified protobuf encoder.")
        print("Real Windsurf likely uses the full protobuf library.")
    print("="*70)
