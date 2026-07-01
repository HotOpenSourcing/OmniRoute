#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN_ENV_VAR = "WINDSURF_DIRECT_KEY"
TOKEN = os.environ.get(TOKEN_ENV_VAR, "").strip()

if not TOKEN:
    print(json.dumps({
        "error": f"{TOKEN_ENV_VAR} is empty",
        "hint": f"Set {TOKEN_ENV_VAR} in your shell before running this script."
    }, indent=2))
    raise SystemExit(1)

TEXT_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/json",
    "Connect-Protocol-Version": "1",
}

JSON_TEXT_HEADERS = {
    **TEXT_HEADERS,
    "Content-Type": "application/json",
}

PROTO_HEADERS = {
    **TEXT_HEADERS,
    "Content-Type": "application/connect+proto",
    "User-Agent": "connect-go/1.17.0 (go1.23.4 X:nocoverageredesign)",
    "Accept-Encoding": "identity",
    "Connect-Accept-Encoding": "gzip",
    "Host": "server.codeium.com",
}

TESTS = [
    {
        "name": "seat-status-self-serve-json",
        "url": "https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
        "headers": JSON_TEXT_HEADERS,
        "body": {
            "metadata": {
                "apiKey": TOKEN,
                "ideName": "windsurf",
                "ideVersion": "1.108.2",
                "extensionName": "windsurf",
                "extensionVersion": "1.108.2",
                "locale": "en",
            }
        },
    },
    {
        "name": "chat-server-json-wrong-contract",
        "url": "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage",
        "headers": JSON_TEXT_HEADERS,
        "body": {
            "metadata": {
                "apiKey": TOKEN,
            },
            "chat_messages": [
                {"content": "hello"}
            ],
            "chat_model_name": "claude-sonnet-4.6",
        },
    },
    {
        "name": "chat-server-proto-empty-frame",
        "url": "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage",
        "headers": PROTO_HEADERS,
        "raw_body": bytes([0, 0, 0, 0, 0]),
    },
    {
        "name": "inference-root-json",
        "url": "https://inference.codeium.com/",
        "headers": JSON_TEXT_HEADERS,
        "body": {},
    },
    {
        "name": "inference-chat-path-json",
        "url": "https://inference.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage",
        "headers": JSON_TEXT_HEADERS,
        "body": {
            "metadata": {
                "apiKey": TOKEN,
            },
            "chat_messages": [
                {"content": "hello"}
            ],
            "chat_model_name": "claude-sonnet-4.6",
        },
    },
    {
        "name": "inference-chat-path-proto-empty-frame",
        "url": "https://inference.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage",
        "headers": PROTO_HEADERS,
        "raw_body": bytes([0, 0, 0, 0, 0]),
    },
]


def parse_body(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        return raw[:1000]


def run_test(case):
    body = case.get("raw_body")
    if body is None:
        body = json.dumps(case.get("body", {})).encode("utf-8")

    request = urllib.request.Request(
        case["url"],
        data=body,
        headers=case["headers"],
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return {
                "name": case["name"],
                "url": case["url"],
                "status": response.status,
                "reason": getattr(response, "reason", None),
                "contentType": response.headers.get("content-type"),
                "body": parse_body(raw),
            }
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        return {
            "name": case["name"],
            "url": case["url"],
            "status": error.code,
            "reason": error.reason,
            "contentType": error.headers.get("content-type"),
            "body": parse_body(raw),
        }
    except Exception as error:
        return {
            "name": case["name"],
            "url": case["url"],
            "error": error.__class__.__name__,
            "message": str(error),
        }


def main():
    results = [run_test(case) for case in TESTS]
    print(json.dumps({"results": results}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
