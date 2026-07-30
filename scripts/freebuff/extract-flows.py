#!/usr/bin/env python3
"""Extract auth-related flows from mitmproxy dump file."""

import sys
from mitmproxy import io
from mitmproxy.exceptions import FlowReadException
import json
import re

flow_file = r"C:\Users\amine\freebuff-login.mitm"

print("=" * 80)
print("ANALYZING ALL FLOWS")
print("=" * 80)

flows = []
try:
    with open(flow_file, "rb") as f:
        for i, flow in enumerate(io.FlowReader(f).stream()):
            flows.append((i, flow))
except FlowReadException as e:
    print(f"Error reading flow file: {e}")
    sys.exit(1)

print(f"\nTotal flows: {len(flows)}")
print(f"\n{'='*80}")
print("AUTH/LOGIN FLOWS")
print(f"{'='*80}")

for idx, flow in flows:
    # Skip TCP flows (no HTTP request/response)
    if not hasattr(flow, 'request'):
        continue

    url = flow.request.url
    if any(kw in url.lower() for kw in ["codebuff", "auth", "oauth", "token", "session", "login", "github", "api/v1", "api/auth"]):
        print(f"\n[Flow #{idx}] {flow.request.method} {url}")
        print(f"  Status: {flow.response.status_code if flow.response else 'N/A'}")
        print(f"  Request headers:")
        for k, v in flow.request.headers.items():
            if k.lower() in ["authorization", "cookie", "x-codebuff", "x-freebuff", "user-agent", "content-type", "origin", "referer"]:
                v_display = v if len(v) < 200 else v[:200] + "..."
                print(f"    {k}: {v_display}")
        if flow.request.content:
            content = flow.request.content.decode('utf-8', errors='ignore')
            if content:
                print(f"  Request body: {content[:500]}")
        if flow.response and flow.response.content:
            try:
                content = flow.response.content.decode('utf-8', errors='replace')
            except:
                content = repr(flow.response.content)
            if content:
                # Try to parse JSON
                try:
                    json_data = json.loads(content)
                    print(f"  Response JSON: {json.dumps(json_data, indent=2)[:1000]}")
                except:
                    # Truncate safely to avoid encoding errors
                    safe_content = content.encode('ascii', 'replace').decode('ascii')[:500]
                    print(f"  Response body: {safe_content}")
        # Don't truncate
