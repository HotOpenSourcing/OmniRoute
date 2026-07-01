#!/usr/bin/env python3
"""Extract the complete model response."""
import sys
import os
import re
sys.path.insert(0, 'scripts')
import windsurf_direct_probe as p

os.environ['WINDSURF_USER_ID'] = 'user-a0877fa492bb4eb3b0697a7c72bbb97b'
os.environ['WINDSURF_TEAM_ID'] = 'devin-team$account-2a2bd7ac9a4e47ee83140eace192c9be'
os.environ['WINDSURF_METADATA_F'] = '000103'
os.environ['WINDSURF_SESSION_ID'] = '20924'
os.environ['WINDSURF_SWE_VERSION'] = 'swe-1-6'
os.environ['WINDSURF_CSRF_TOKEN'] = 'a5d004fc-a32d-49ab-ab4d-3d27db4167f9'

token = p.resolve_auth_context_for_mode('ls_emulator')['token']
cascade_id = 'b9924bd6-04d5-4738-a170-765616671f0c'

print('=== RECUPERATION DE LA REPONSE COMPLETE ===\n')

traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
_, traj_result = p.run_request(traj_req)

body_hex = traj_result.get('bodyHex', '')
if not body_hex:
    print('Pas de reponse')
    sys.exit(1)

body_bytes = bytes.fromhex(body_hex)
print(f'Taille de la reponse: {len(body_bytes)} bytes\n')

# Extract all text segments
text_pattern = rb'[\x20-\x7e\s]{30,}'
matches = re.findall(text_pattern, body_bytes)

print('=== REPONSE DU MODELE WINDSURF ===\n')

# Find all meaningful text (excluding system prompts and tool definitions)
found_response = False
for match in matches:
    text = match.decode('utf-8', errors='ignore').strip()

    # Skip system prompts, tool definitions, and very long segments
    if 'You are Cascade' in text:
        continue
    if 'permission_denied' in text:
        continue
    if len(text) > 1000:
        continue
    if '$schema' in text:
        continue
    if 'github.com/Exafunction' in text:
        continue

    # Look for actual response content
    if len(text) > 50 and len(text) < 500:
        print(f'{text}\n')
        print('---\n')
        found_response = True

if not found_response:
    print('Recherche de segments plus courts...\n')
    for match in matches[:30]:
        text = match.decode('utf-8', errors='ignore').strip()
        if 20 < len(text) < 200 and 'You are Cascade' not in text:
            print(f'{text}\n')
