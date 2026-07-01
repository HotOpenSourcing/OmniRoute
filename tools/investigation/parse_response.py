#!/usr/bin/env python3
"""Parse the saved binary response to extract readable text."""
import re
import json

# Read the binary file
with open('windsurf_model_response.bin', 'rb') as f:
    body_bytes = f.read()

print(f'Total bytes: {len(body_bytes)}')

# Try to find text content - look for ASCII/UTF-8 strings
text_pattern = rb'[\x20-\x7e\s]{20,}'  # Printable ASCII + whitespace, at least 20 chars
matches = re.findall(text_pattern, body_bytes)

print(f'\nFound {len(matches)} text segments\n')

# Decode and display the longest segments
decoded_matches = []
for match in matches:
    try:
        decoded = match.decode('utf-8', errors='ignore').strip()
        if len(decoded) > 20:
            decoded_matches.append(decoded)
    except:
        pass

# Sort by length and show top 10
decoded_matches.sort(key=len, reverse=True)

print('=== Top 10 Longest Text Segments ===\n')
for i, text in enumerate(decoded_matches[:10], 1):
    print(f'{i}. ({len(text)} chars)')
    print(f'   {text[:200]}...' if len(text) > 200 else f'   {text}')
    print()
