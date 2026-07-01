#!/usr/bin/env python3
"""Extract the actual model response (not system prompt)."""
import re

with open('windsurf_model_response.bin', 'rb') as f:
    body_bytes = f.read()

# Look for the rate limit error message
error_pattern = rb'permission_denied[^\x00]{100,3000}'
error_matches = re.findall(error_pattern, body_bytes)

if error_matches:
    print('=== Rate Limit Error ===\n')
    for match in error_matches[:1]:
        text = match.decode('utf-8', errors='ignore')
        print(text)
        print()

# Look for any actual assistant response (after "Hello" or similar greeting patterns)
response_patterns = [
    rb'Hello[^\x00]{50,500}',
    rb'Hi[^\x00]{50,500}',
    rb'Greetings[^\x00]{50,500}',
]

print('=== Potential Model Responses ===\n')
for pattern in response_patterns:
    matches = re.findall(pattern, body_bytes, re.IGNORECASE)
    for match in matches[:3]:
        text = match.decode('utf-8', errors='ignore')
        if 'You are Cascade' not in text:  # Skip system prompt
            print(f'Match: {text}\n')
