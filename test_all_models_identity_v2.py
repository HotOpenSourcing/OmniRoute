#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test tous les 78 modèles Windsurf avec la question "whats model llm you are?"
et collecte les réponses en JSON.
Version 2: Utilise windsurf_direct_probe.py
"""
import json
import sys
import os
import time
from pathlib import Path
from datetime import datetime

# Fix console encoding for Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Import windsurf_direct_probe
sys.path.insert(0, str(Path(__file__).parent / 'scripts'))
import windsurf_direct_probe as p

def test_model(model_name, token):
    """Teste un modèle avec la question "whats model llm you are?"."""

    result = {
        'model': model_name,
        'status': 'unknown',
        'response': None,
        'error': None,
        'time_ms': 0,
        'cascade_id': None,
    }

    try:
        start_time = time.time()

        # StartCascade
        start_req, _ = p.build_start_cascade_probe_request(token)
        _, start_result = p.run_request(start_req)
        cascade_id = p.extract_cascade_id_from_start_result(start_result)

        if not cascade_id:
            result['status'] = 'failed'
            result['error'] = 'Failed to create cascade'
            return result

        result['cascade_id'] = cascade_id

        # SendUserCascadeMessage
        os.environ['WINDSURF_CHAT_TEXT'] = 'whats model llm you are?'
        send_req, _ = p.build_send_user_cascade_message_probe_request(token, cascade_id)
        _, send_result = p.run_request(send_req)

        if send_result.get('status') != 200:
            result['status'] = 'failed'
            result['error'] = f"SendMessage failed: {send_result.get('status')}"
            return result

        # Attendre la réponse
        time.sleep(8)

        # GetCascadeTrajectory
        traj_req, _ = p.build_get_cascade_trajectory_probe_request(token, cascade_id)
        _, traj_result = p.run_request(traj_req)

        end_time = time.time()
        result['time_ms'] = int((end_time - start_time) * 1000)

        # Extraire la réponse
        body_hex = traj_result.get('bodyHex', '')
        if body_hex:
            try:
                body_bytes = bytes.fromhex(body_hex)
                body_text = body_bytes.decode('utf-8', errors='ignore')

                # Chercher le texte de réponse
                import re
                text_match = re.search(r'"text"\s*:\s*"([^"]+)"', body_text)
                if text_match:
                    result['response'] = text_match.group(1)
                    result['status'] = 'success'
                else:
                    result['response'] = body_text[:500]
                    result['status'] = 'partial'
            except Exception as e:
                result['status'] = 'failed'
                result['error'] = f'Response parsing error: {str(e)}'
        else:
            result['status'] = 'failed'
            result['error'] = 'No response body'

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

    # Token CSRF actuel (2026-05-04)
    token = '965fdd75-25f9-45cc-ac13-ee8dea91fa46'

    print(f'✅ Token CSRF: {token[:20]}...')
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

        result = test_model(model, token)
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
        time.sleep(1)

    # Sauvegarder les résultats
    output = {
        'timestamp': datetime.now().isoformat(),
        'question': 'whats model llm you are?',
        'total_models': len(all_models),
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
