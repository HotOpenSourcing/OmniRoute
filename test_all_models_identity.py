#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test tous les 78 modèles Windsurf avec la question "whats model llm you are?"
et collecte les réponses en JSON.
"""
import json
import sys
import subprocess
import re
import time
from pathlib import Path
from datetime import datetime

# Fix console encoding for Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def find_active_ls_port():
    """Trouve le port actif du Language Server Windsurf."""
    try:
        result = subprocess.run(['netstat', '-ano'], capture_output=True,
                              text=True, timeout=5, encoding='utf-8', errors='ignore')

        for line in result.stdout.split('\n'):
            if '127.0.0.1:' in line and 'LISTENING' in line:
                match = re.search(r'127\.0\.0\.1:(\d+)', line)
                if match:
                    port = int(match.group(1))
                    if 50000 <= port <= 60000:
                        return port
        return None
    except Exception as e:
        print(f'Erreur lors de la recherche du port: {e}')
        return None

def find_csrf_token_in_files():
    """Cherche le token CSRF dans les fichiers de configuration."""
    # Token actuel fourni par l'utilisateur (2026-05-04)
    return '965fdd75-25f9-45cc-ac13-ee8dea91fa46'

def load_credentials():
    """Charge les credentials depuis le fichier .env ou credentials.json."""
    search_paths = [
        Path('.'),
        Path('C:/Users/amine/OmniRoute'),
        Path('C:/Users/amine/AppData/Local/Programs/Windsurf/winsurftiwtest'),
    ]

    # Credentials par défaut (hardcodés depuis le script précédent)
    credentials = {
        'user_id': 'user-a0877fa492bb4eb3b0697a7c72bbb97b',
        'session_id': '20924',
    }

    for base_path in search_paths:
        try:
            env_file = base_path / '.env.windsurf.local'
            if env_file.exists():
                content = env_file.read_text(encoding='utf-8')

                user_match = re.search(r'WINDSURF_USER_ID=([^\s]+)', content)
                if user_match:
                    credentials['user_id'] = user_match.group(1)

                session_match = re.search(r'WINDSURF_SESSION_ID=([^\s]+)', content)
                if session_match:
                    credentials['session_id'] = session_match.group(1)
        except Exception:
            pass

    return credentials['user_id'], credentials['session_id']

def test_model(model_name, port, csrf_token, user_id, session_id):
    """Teste un modèle avec la question "whats model llm you are?"."""
    import http.client

    result = {
        'model': model_name,
        'status': 'unknown',
        'response': None,
        'error': None,
        'time_ms': 0,
    }

    try:
        start_time = time.time()

        # StartCascade
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=30)

        start_payload = {
            'userId': user_id,
            'sessionId': session_id,
            'workspaceFolder': r'C:\Users\amine\AppData\Local\Programs\Windsurf\winsurftiwtest',
        }

        headers = {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf_token,
        }

        conn.request('POST', '/exa.language_server_pb.LanguageServerService/StartCascade',
                    json.dumps(start_payload).encode('utf-8'), headers)

        response = conn.getresponse()
        body = response.read()

        if response.status != 200:
            result['status'] = 'failed'
            result['error'] = f'StartCascade failed: {response.status}'
            conn.close()
            return result

        start_data = json.loads(body.decode('utf-8'))
        cascade_id = start_data.get('cascadeId')

        if not cascade_id:
            result['status'] = 'failed'
            result['error'] = 'No cascadeId returned'
            conn.close()
            return result

        # SendUserCascadeMessage
        message_payload = {
            'cascadeId': cascade_id,
            'message': 'whats model llm you are?',
        }

        conn.request('POST', '/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage',
                    json.dumps(message_payload).encode('utf-8'), headers)

        response = conn.getresponse()
        body = response.read()

        if response.status != 200:
            result['status'] = 'failed'
            result['error'] = f'SendUserCascadeMessage failed: {response.status}'
            conn.close()
            return result

        # Extraire la réponse
        try:
            body_text = body.decode('utf-8', errors='ignore')

            # Chercher la réponse dans le texte
            # Format typique: "text":"I am ..."
            text_match = re.search(r'"text"\s*:\s*"([^"]+)"', body_text)
            if text_match:
                result['response'] = text_match.group(1)
                result['status'] = 'success'
            else:
                # Essayer de parser comme JSON
                try:
                    data = json.loads(body_text)
                    if 'text' in data:
                        result['response'] = data['text']
                        result['status'] = 'success'
                    elif 'message' in data:
                        result['response'] = data['message']
                        result['status'] = 'success'
                    else:
                        result['response'] = body_text[:500]
                        result['status'] = 'partial'
                except:
                    result['response'] = body_text[:500]
                    result['status'] = 'partial'
        except Exception as e:
            result['status'] = 'failed'
            result['error'] = f'Response parsing error: {str(e)}'

        end_time = time.time()
        result['time_ms'] = int((end_time - start_time) * 1000)

        conn.close()

    except Exception as e:
        result['status'] = 'failed'
        result['error'] = str(e)

    return result

def main():
    """Teste tous les 78 modèles."""

    print('='*70)
    print('TEST DE TOUS LES MODÈLES WINDSURF')
    print('Question: "whats model llm you are?"')
    print('='*70)
    print()

    # Auto-détection
    print('Auto-détection...')
    port = find_active_ls_port()
    csrf_token = find_csrf_token_in_files()
    user_id, session_id = load_credentials()

    if not port:
        print('❌ Port Windsurf non trouvé')
        return

    if not csrf_token:
        print('❌ Token CSRF non trouvé')
        return

    if not user_id or not session_id:
        print('❌ Credentials non trouvés')
        return

    print(f'✅ Port: {port}')
    print(f'✅ CSRF Token: {csrf_token[:20]}...')
    print(f'✅ User ID: {user_id[:20]}...')
    print(f'✅ Session ID: {session_id[:20]}...')
    print()

    # Liste complète des 78 modèles
    all_models = [
        # Gratuits (18)
        'cascade', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
        'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
        'claude-3.5-sonnet', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
        'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash',
        'deepseek-chat', 'deepseek-reasoner',
        'o1',

        # BYOK (13)
        'gpt-5.5', 'gpt-4.5', 'gpt-4.5-mini', 'gpt-4.5-turbo',
        'claude-opus-4.7', 'claude-opus-4-thinking',
        'gemini-2.5-pro', 'gemini-2.5-flash',
        'deepseek-v3', 'deepseek-r1',
        'o3', 'o3-mini', 'o1-pro',

        # PRO Subscription (21)
        'gpt-5', 'gpt-5-mini', 'gpt-5-turbo',
        'gpt-4.7', 'gpt-4.7-mini', 'gpt-4.7-turbo',
        'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5',
        'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-haiku-4.5',
        'gemini-2.7-pro', 'gemini-2.7-flash',
        'gemini-2.3-pro', 'gemini-2.3-flash',
        'deepseek-v4', 'deepseek-r2',
        'llama-4', 'llama-4-turbo',
        'o2',

        # Claude Quotas (14)
        'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514',
        'claude-3.5-sonnet-20241022', 'claude-3.5-sonnet-20240620',
        'claude-3.5-haiku-20241022',
        'claude-3-opus-20240229', 'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-2.1', 'claude-2.0',
        'claude-instant-1.2',
        'claude-instant-1.1', 'claude-instant-1.0',

        # Claude Opus 4.5/4.6/4.7 variants (12)
        'claude-opus-4.5-20250514', 'claude-opus-4.5-thinking-20250514',
        'claude-opus-4.5-20250101', 'claude-opus-4.5-thinking-20250101',
        'claude-opus-4.6-20250514', 'claude-opus-4.6-thinking-20250514',
        'claude-opus-4.6-20250101', 'claude-opus-4.6-thinking-20250101',
        'claude-opus-4.7-20250514', 'claude-opus-4.7-thinking-20250514',
        'claude-opus-4.7-20250101', 'claude-opus-4.7-thinking-20250101',
    ]

    print(f'Total de modèles à tester: {len(all_models)}')
    print()

    results = []

    for idx, model in enumerate(all_models, 1):
        print(f'[{idx}/{len(all_models)}] Test de {model}...', end=' ', flush=True)

        result = test_model(model, port, csrf_token, user_id, session_id)
        results.append(result)

        if result['status'] == 'success':
            print(f'✅ ({result["time_ms"]}ms)')
            print(f'    Réponse: {result["response"][:100]}...')
        elif result['status'] == 'partial':
            print(f'⚠️  ({result["time_ms"]}ms)')
            print(f'    Réponse partielle: {result["response"][:100]}...')
        else:
            print(f'❌')
            print(f'    Erreur: {result["error"]}')

        # Pause entre les requêtes
        time.sleep(0.5)

    # Sauvegarder les résultats
    output = {
        'timestamp': datetime.now().isoformat(),
        'question': 'whats model llm you are?',
        'total_models': len(all_models),
        'port': port,
        'results': results,
        'summary': {
            'success': sum(1 for r in results if r['status'] == 'success'),
            'partial': sum(1 for r in results if r['status'] == 'partial'),
            'failed': sum(1 for r in results if r['status'] == 'failed'),
        }
    }

    output_file = 'windsurf_all_models_identity_test.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print()
    print('='*70)
    print('RÉSUMÉ')
    print('='*70)
    print(f'Total: {len(all_models)} modèles')
    print(f'✅ Succès: {output["summary"]["success"]}')
    print(f'⚠️  Partiel: {output["summary"]["partial"]}')
    print(f'❌ Échec: {output["summary"]["failed"]}')
    print()
    print(f'Résultats sauvegardés: {output_file}')
    print('='*70)

if __name__ == '__main__':
    main()
