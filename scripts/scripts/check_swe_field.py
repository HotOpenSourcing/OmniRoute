#!/usr/bin/env python3
"""Check if sweVersion field is encoded in StartCascade payload."""
import sys
import os
sys.path.insert(0, '.')
import windsurf_direct_probe as p

os.environ['WINDSURF_USER_ID'] = 'user-a0877fa492bb4eb3b0697a7c72bbb97b'
os.environ['WINDSURF_TEAM_ID'] = 'devin-team$account-2a2bd7ac9a4e47ee83140eace192c9be'
os.environ['WINDSURF_METADATA_F'] = '000103'
os.environ['WINDSURF_SESSION_ID'] = '20924'
os.environ['WINDSURF_SWE_VERSION'] = 'swe-1-6'

token = p.resolve_auth_context_for_mode('ls_emulator')['token']
body, preview = p.build_start_cascade_request(token)

print('Payload size:', len(body))
print('Payload hex (first 100 bytes):')
print(body[:100].hex())
print()
print('Checking for sweVersion field (822):')
field_marker = (822 << 3) | 2
print(f'Field marker decimal: {field_marker}')
print(f'Field marker hex: 0x{field_marker:04x}')

# Encode as varint
varint_bytes = []
n = field_marker
while n > 0x7f:
    varint_bytes.append((n & 0x7f) | 0x80)
    n >>= 7
varint_bytes.append(n)

varint_hex = bytes(varint_bytes).hex()
print(f'Varint encoding: {varint_hex}')
print(f'Present in payload: {varint_hex in body.hex()}')

if varint_hex in body.hex():
    idx = body.hex().index(varint_hex)
    print(f'Found at byte offset: {idx // 2}')
