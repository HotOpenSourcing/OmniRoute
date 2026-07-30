#!/usr/bin/env python3
"""
Parse mitmdump capture file and extract all requests/responses.
"""

from mitmproxy import io
from mitmproxy.exceptions import FlowReadException
import sys
import json

def parse_flow(flow):
    """Extract key info from a flow."""
    request = flow.request
    response = flow.response
    
    print(f"\n{'='*80}")
    print(f"[{request.method}] {request.url}")
    print(f"Status: {response.status_code if response else 'N/A'}")
    
    # Headers
    print(f"\nRequest Headers:")
    for k, v in request.headers.items():
        if k.lower() in ['authorization', 'x-freebuff-instance-id', 'content-type', 'user-agent']:
            print(f"  {k}: {v}")
    
    # Request body
    if request.content:
        try:
            body = json.loads(request.content)
            print(f"\nRequest Body:")
            print(json.dumps(body, indent=2)[:500])
        except:
            print(f"\nRequest Body (raw): {request.content[:200]}")
    
    # Response body
    if response and response.content:
        try:
            body = json.loads(response.content)
            print(f"\nResponse Body:")
            print(json.dumps(body, indent=2)[:500])
        except:
            print(f"\nResponse Body (raw): {response.content[:200]}")

def main():
    mitm_file = r"C:\Users\amine\freebuff-real.mitm"
    
    print(f"Parsing {mitm_file}...\n")
    
    with open(mitm_file, "rb") as f:
        reader = io.FlowReader(f)
        try:
            for flow in reader.stream():
                # Skip non-HTTP flows (TCPFlow, etc.)
                if hasattr(flow, 'request') and flow.request and 'codebuff.com' in flow.request.url:
                    parse_flow(flow)
        except FlowReadException as e:
            print(f"Flow read error: {e}")

if __name__ == "__main__":
    main()
