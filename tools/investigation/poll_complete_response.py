#!/usr/bin/env python3
"""Poll for complete model response."""
import sys
import os
import time
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
cascade_id = 'b9924bd6-04d5-4738-a170-765616671f0c'  # Use existing cascade

print('=== Polling for Complete Response ===')
for attempt in range(10):
    time.sleep(2)

    traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
    _, traj_result = p.run_request(traj_req)

    body_hex = traj_result.get('bodyHex', '')
    if not body_hex:
        continue

    body_bytes = bytes.fromhex(body_hex)
    print(f'\nAttempt {attempt + 1}: {len(body_bytes)} bytes')

    # Look for actual text response (not system messages)
    text_pattern = rb'[\x20-\x7e\s]{50,}'
    matches = re.findall(text_pattern, body_bytes)

    # Find the actual greeting response
    for match in matches:
        text = match.decode('utf-8', errors='ignore').strip()
        # Look for greeting patterns
        if any(word in text.lower() for word in ['hello', 'hi', 'greetings', 'hey']):
            if 'You are Cascade' not in text and 'permission_denied' not in text and 'lint errors' not in text:
                print(f'\n=== Model Response Found ===')
                print(text[:500])
                sys.exit(0)

    # Check if response is growing (model still generating)
    if attempt > 0 and len(body_bytes) > 10000:
        print('Response seems complete, extracting...')
        break

print('\n=== Final Response Extraction ===')
# Save and analyze final response
with open('windsurf_final_response.bin', 'wb') as f:
    f.write(body_bytes)

# Extract all text segments
for match in matches[:20]:
    text = match.decode('utf-8', errors='ignore').strip()
    if len(text) > 100 and 'You are Cascade' not in text:
        print(f'\n--- Segment ({len(text)} chars) ---')
        print(text[:300])
