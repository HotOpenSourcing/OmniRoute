#!/usr/bin/env python3
import json
import urllib.error
import urllib.request

BASE_URL = "http://35.223.238.178"
TESTS = [
    {
        "name": "root-get",
        "url": f"{BASE_URL}/",
        "method": "GET",
        "headers": {"Accept": "text/plain,application/json,*/*"},
        "body": None,
    },
    {
        "name": "seat-status-post-json-no-auth",
        "url": f"{BASE_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "Accept": "application/json",
        },
        "body": json.dumps({"metadata": {"ideName": "windsurf"}}).encode("utf-8"),
    },
    {
        "name": "chat-post-json-no-auth",
        "url": f"{BASE_URL}/exa.api_server_pb.ApiServerService/GetChatMessage",
        "method": "POST",
        "headers": {
            "Content-Type": "application/json",
            "Connect-Protocol-Version": "1",
            "Accept": "application/json",
        },
        "body": json.dumps({"chat_model_name": "claude-sonnet-4.6"}).encode("utf-8"),
    },
    {
        "name": "chat-post-proto-empty-no-auth",
        "url": f"{BASE_URL}/exa.api_server_pb.ApiServerService/GetChatMessage",
        "method": "POST",
        "headers": {
            "Content-Type": "application/connect+proto",
            "Connect-Protocol-Version": "1",
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Connect-Accept-Encoding": "gzip",
            "Host": "server.codeium.com",
        },
        "body": bytes([0, 0, 0, 0, 0]),
    },
]


def parse_body(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        return raw[:1000]


def run_test(case):
    request = urllib.request.Request(
        case["url"],
        data=case["body"],
        headers=case["headers"],
        method=case["method"],
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
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
    print(json.dumps({"results": [run_test(case) for case in TESTS]}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
