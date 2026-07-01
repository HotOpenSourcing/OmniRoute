#!/usr/bin/env python3
"""Get full model response to see assigned model name."""
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
os.environ['WINDSURF_CSRF_TOKEN'] = '91e3d9fc-7277-4618-81ee-b72bc0adda38'
os.environ['WINDSURF_CHAT_TEXT'] = 'What model are you?'

token = p.resolve_auth_context_for_mode('ls_emulator')['token']

print('=== DEMANDE AU MODELE SON IDENTITE ===\n')

# Start cascade
start_req, _ = p.build_start_cascade_probe_request(token)
_, start_result = p.run_request(start_req)
cascade_id = p.extract_cascade_id_from_start_result(start_result)

print(f'Cascade ID: {cascade_id}')

# Send message asking for model identity
send_req, _ = p.build_send_user_cascade_message_probe_request(token, cascade_id)
_, send_result = p.run_request(send_req)
print(f'Message envoye: {send_result.get("status")}')

# Wait for response
print('\nAttente reponse (10 secondes)...')
time.sleep(10)

traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
_, traj_result = p.run_request(traj_req)

body_hex = traj_result.get('bodyHex', '')
if not body_hex:
    print('Pas de reponse')
    sys.exit(1)

body_bytes = bytes.fromhex(body_hex)
print(f'Reponse recue: {len(body_bytes)} bytes\n')

# Save for analysis
with open('model_identity_response.bin', 'wb') as f:
    f.write(body_bytes)

print('=== RECHERCHE NOM DU MODELE ===\n')

# Look for model names in response
model_patterns = [
    rb'claude-[a-z0-9.-]+',
    rb'gpt-[a-z0-9.-]+',
    rb'gemini-[a-z0-9.-]+',
    rb'kimi-[a-z0-9.-]+',
    rb'sonnet[- ][a-z0-9.-]*',
    rb'opus[- ][a-z0-9.-]*',
    rb'haiku[- ][a-z0-9.-]*',
]

found_models = set()
for pattern in model_patterns:
    matches = re.findall(pattern, body_bytes, re.IGNORECASE)
    for match in matches:
        model_name = match.decode('utf-8', errors='ignore')
        found_models.add(model_name)

if found_models:
    print('Modeles mentionnes dans la reponse:')
    for model in sorted(found_models):
        print(f'  - {model}')

print('\n=== REPONSE DU MODELE ===\n')

# Extract readable text
text_pattern = rb'[\x20-\x7e\s]{50,500}'
matches = re.findall(text_pattern, body_bytes)

for match in matches:
    text = match.decode('utf-8', errors='ignore').strip()
    # Look for model identity statements
    if any(word in text.lower() for word in ['i am', 'i\'m', 'model', 'claude', 'assistant', 'cascade']):
        if 'You are Cascade' not in text and len(text) < 400:
            print(f'{text}\n')

print('\n=== EXTRACTION MODELROUTERUID ===\n')

model_router_uid = p.extract_model_router_uid_from_trajectory_body(body_bytes)
print(f'Model Router UID: {model_router_uid}')

# Try to find model identifier near the modelRouterUid
if model_router_uid:
    # Find position of modelRouterUid in bytes
    uid_bytes = model_router_uid.encode('utf-8')
    uid_pos = body_bytes.find(uid_bytes)

    if uid_pos > 0:
        # Look 200 bytes before and after
        context = body_bytes[max(0, uid_pos-200):uid_pos+200]

        # Extract model identifiers from context
        model_ids = re.findall(rb'[a-z][a-z0-9_-]{5,40}', context, re.IGNORECASE)

        print('\nIdentifiants proches du modelRouterUid:')
        for model_id in model_ids[:10]:
            text = model_id.decode('utf-8', errors='ignore')
            if text != model_router_uid and len(text) > 5:
                print(f'  - {text}')
