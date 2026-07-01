#!/usr/bin/env python3
"""Extract model names from trajectory responses."""
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
os.environ['WINDSURF_CHAT_TEXT'] = 'test'

token = p.resolve_auth_context_for_mode('ls_emulator')['token']

print('=== CREATION CASCADE POUR ANALYSE ===\n')

# Start cascade
start_req, _ = p.build_start_cascade_probe_request(token)
_, start_result = p.run_request(start_req)
cascade_id = p.extract_cascade_id_from_start_result(start_result)

print(f'Cascade ID: {cascade_id}\n')

# Get trajectory
time.sleep(2)
traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
_, traj_result = p.run_request(traj_req)

body_hex = traj_result.get('bodyHex', '')
if not body_hex:
    print('Pas de reponse')
    sys.exit(1)

body_bytes = bytes.fromhex(body_hex)

print(f'Taille reponse: {len(body_bytes)} bytes\n')

# Save for detailed analysis
with open('trajectory_for_model_analysis.bin', 'wb') as f:
    f.write(body_bytes)

print('=== RECHERCHE NOMS DE MODELES ===\n')

# Look for common model name patterns
model_patterns = [
    rb'claude-[a-z0-9-]+',
    rb'gpt-[a-z0-9-]+',
    rb'gemini-[a-z0-9-]+',
    rb'kimi-[a-z0-9-]+',
    rb'sonnet-[a-z0-9-]+',
    rb'opus-[a-z0-9-]+',
    rb'haiku-[a-z0-9-]+',
]

found_models = set()
for pattern in model_patterns:
    matches = re.findall(pattern, body_bytes, re.IGNORECASE)
    for match in matches:
        model_name = match.decode('utf-8', errors='ignore')
        found_models.add(model_name)

if found_models:
    print('Modeles trouves:')
    for model in sorted(found_models):
        print(f'  - {model}')
else:
    print('Aucun nom de modele trouve avec les patterns communs')

print('\n=== EXTRACTION TOUS LES IDENTIFIANTS ===\n')

# Extract all alphanumeric strings that could be model identifiers
identifier_pattern = rb'[a-z][a-z0-9_-]{4,40}'
identifiers = re.findall(identifier_pattern, body_bytes, re.IGNORECASE)

# Filter for likely model names
likely_models = []
for identifier in identifiers:
    text = identifier.decode('utf-8', errors='ignore')
    # Skip common non-model strings
    if any(skip in text.lower() for skip in ['github', 'exafunction', 'cortex', 'executor', 'proto', 'schema']):
        continue
    # Look for model-like patterns
    if any(pattern in text.lower() for pattern in ['claude', 'gpt', 'gemini', 'kimi', 'model', 'sonnet', 'opus', 'haiku', 'turbo']):
        likely_models.append(text)

if likely_models:
    print('Identifiants ressemblant a des modeles:')
    for model in sorted(set(likely_models)):
        print(f'  - {model}')

print('\n=== ANALYSE PROTOBUF STRUCTURE ===\n')

# Parse protobuf fields to find model assignment info
fields = p.parse_proto_fields(body_bytes)
print(f'Nombre de champs protobuf: {len(fields)}')

# Look for field 24 (model assignment info)
assignment_payloads = p.get_proto_length_delimited_values(body_bytes, 24)
if assignment_payloads:
    print(f'\nField 24 (model assignment) trouve: {len(assignment_payloads[0])} bytes')

    assignment_payload = assignment_payloads[0]
    assignment_fields = p.parse_proto_fields(assignment_payload)

    print(f'Champs dans assignment: {[f["fieldNumber"] for f in assignment_fields]}')

    # Extract all string fields from assignment
    for field_num in range(1, 20):
        values = p.get_proto_length_delimited_values(assignment_payload, field_num)
        if values:
            for value in values:
                try:
                    text = value.decode('utf-8', errors='ignore')
                    if len(text) > 5 and len(text) < 100:
                        print(f'  Field {field_num}: {text}')
                except:
                    pass

print('\n=== RECHERCHE DANS TOUT LE PAYLOAD ===\n')

# Dump all readable strings
all_strings = re.findall(rb'[\x20-\x7e]{10,60}', body_bytes)
model_related = []
for s in all_strings:
    text = s.decode('utf-8', errors='ignore')
    if any(word in text.lower() for word in ['model', 'claude', 'gpt', 'gemini', 'kimi', 'ai']):
        if text not in model_related:
            model_related.append(text)

print('Strings contenant des mots-cles de modeles:')
for text in model_related[:20]:
    print(f'  {text}')
