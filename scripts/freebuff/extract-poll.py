#!/usr/bin/env python3
"""Extract auth-related flows from freebuff-poll.mitm."""

import sys
import json
from mitmproxy import io
from mitmproxy.exceptions import FlowReadException

flow_file = r"C:\Users\amine\freebuff-poll.mitm"

print("=" * 80)
print("ANALYZING freebuff-poll.mitm")
print("=" * 80)

flows = []
try:
    with open(flow_file, "rb") as f:
        for i, flow in enumerate(io.FlowReader(f).stream()):
            flows.append((i, flow))
except FlowReadException as e:
    print(f"Error reading flow file: {e}")
    sys.exit(1)

print(f"\nTotal flows: {len(flows)}\n")

auth_flows = []
for idx, flow in flows:
    if not hasattr(flow, "request"):
        continue
    url = flow.request.url
    if any(
        kw in url.lower()
        for kw in [
            "codebuff.com",
            "freebuff.com",
            "api/auth",
            "auth/cli",
            "auth_code",
            "access_token",
            "github.com/login",
            "github.com/session",
            "api/v1",
            "oauth",
        ]
    ):
        auth_flows.append((idx, flow))

print(f"Auth/API flows: {len(auth_flows)}\n")
print("=" * 80)
print("ALL AUTH/API FLOWS")
print("=" * 80)

for idx, flow in auth_flows:
    url = flow.request.url
    method = flow.request.method
    status = flow.response.status_code if flow.response else "N/A"

    print(f"\n[Flow #{idx}] {method} {url[:140]}")
    print(f"  Status: {status}")

    for k, v in flow.request.headers.items():
        kl = k.lower()
        if kl in [
            "authorization",
            "cookie",
            "x-codebuff",
            "x-freebuff",
            "content-type",
            "origin",
            "referer",
        ]:
            v_display = v if len(v) < 300 else v[:300] + "..."
            print(f"  REQ {k}: {v_display}")

    if flow.request.content:
        try:
            body = flow.request.content.decode("utf-8", errors="replace")
            if body and len(body) < 1000:
                print(f"  REQ BODY: {body[:800]}")
        except Exception:
            pass

    if flow.response:
        for k, v in flow.response.headers.items():
            kl = k.lower()
            if kl in [
                "set-cookie",
                "authorization",
                "x-auth-token",
                "x-codebuff-token",
                "location",
            ]:
                v_display = v if len(v) < 300 else v[:300] + "..."
                print(f"  RESP {k}: {v_display}")

    if flow.response and flow.response.content:
        try:
            body = flow.response.content.decode("utf-8", errors="replace")
            if body:
                try:
                    j = json.loads(body)
                    print(f"  RESP JSON: {json.dumps(j, indent=2)[:1500]}")
                except Exception:
                    safe = body.encode("ascii", "replace").decode("ascii")[:800]
                    if safe.strip():
                        print(f"  RESP BODY: {safe}")
        except Exception:
            pass
