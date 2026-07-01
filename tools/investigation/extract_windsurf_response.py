#!/usr/bin/env python3
"""Extract model response from Windsurf trajectory."""
import sys
import os
import time
import json
sys.path.insert(0, 'scripts')
import windsurf_direct_probe as p

os.environ['WINDSURF_USER_ID'] = 'user-a0877fa492bb4eb3b0697a7c72bbb97b'
os.environ['WINDSURF_TEAM_ID'] = 'devin-team$account-2a2bd7ac9a4e47ee83140eace192c9be'
os.environ['WINDSURF_METADATA_F'] = '000103'
os.environ['WINDSURF_SESSION_ID'] = '20924'
os.environ['WINDSURF_SWE_VERSION'] = 'swe-1-6'
os.environ['WINDSURF_CSRF_TOKEN'] = 'd1dfed32-5615-4751-9a46-f08c30e9700b'
os.environ['WINDSURF_CHAT_TEXT'] = 'hello'

token = p.resolve_auth_context_for_mode('ls_emulator')['token']

# Start cascade
start_req, _ = p.build_start_cascade_probe_request(token)
_, start_result = p.run_request(start_req)
cascade_id = p.extract_cascade_id_from_start_result(start_result)

# Send message
send_req, _ = p.build_send_user_cascade_message_probe_request(token, cascade_id)
p.run_request(send_req)

# Wait for response
time.sleep(3)
traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
_, traj_result = p.run_request(traj_req)

# Save to file to avoid encoding issues
body_hex = traj_result.get('bodyHex', '')
body_bytes = bytes.fromhex(body_hex)

with open('windsurf_model_response.bin', 'wb') as f:
    f.write(body_bytes)

# Try to extract text
import re
body_text = body_bytes.decode('utf-8', errors='replace')

# Find text content (look for common response patterns)
text_pattern = rb'(?:Hello|Hi|Greetings)[^\\x00-\\x1f]{50,500}'
matches = re.findall(text_pattern, body_bytes, re.IGNORECASE)

result = {
    'cascadeId': cascade_id,
    'bodyLength': len(body_bytes),
    'textMatches': [m.decode('utf-8', errors='replace') for m in matches[:3]],
    'savedTo': 'windsurf_model_response.bin'
}

print(json.dumps(result, indent=2, ensure_ascii=False))
