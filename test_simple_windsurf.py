#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test simple d'un modèle Windsurf avec requête HTTP directe.
"""
import http.client
import json
import time
import sys
import codecs

# Fix console encoding for Windows
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Configuration depuis les informations fournies
PORT = 51834  # Port l.localhost actif
CSRF_TOKEN = '965fdd75-25f9-45cc-ac13-ee8dea91fa46'
USER_ID = 'user-a0877fa492bb4eb3b0697a7c72bbb97b'
SESSION_ID = 'windsurf-session-b38ff51bac374d2e8c2267d33840bd22'

print('Test simple Windsurf')
print(f'Port: {PORT}')
print(f'CSRF: {CSRF_TOKEN[:20]}...')
print()

try:
    # Tester GetModelStatuses (endpoint de métadonnées)
    print('Test GetModelStatuses...')
    conn = http.client.HTTPConnection('127.0.0.1', PORT, timeout=10)

    headers = {
        'Content-Type': 'application/proto',
        'x-codeium-csrf-token': CSRF_TOKEN,
    }

    # Payload vide pour GetModelStatuses
    payload = b''

    conn.request('POST', '/exa.language_server_pb.LanguageServerService/GetModelStatuses',
                payload, headers)

    response = conn.getresponse()
    body = response.read()

    print(f'Status: {response.status}')
    print(f'Body length: {len(body)} bytes')

    if response.status == 200:
        print('✅ Connexion réussie!')
        print(f'Body (hex): {body.hex()[:200]}...')
    else:
        print(f'❌ Erreur: {response.status}')
        print(f'Body: {body[:500]}')

    conn.close()

except Exception as e:
    print(f'❌ Exception: {e}')

print()
print('Test terminé')
