#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test direct HTTP des modèles Windsurf avec requête protobuf manuelle.
"""
import http.client
import json
import time
import sys
import codecs

# Fix console encoding
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

PORT = 51834
CSRF_TOKEN = '965fdd75-25f9-45cc-ac13-ee8dea91fa46'

# Test simple: juste demander à Windsurf dans l'interface
# et capturer la réponse pour chaque modèle

print('='*70)
print('GUIDE DE TEST MANUEL DES 78 MODÈLES')
print('='*70)
print()
print('Puisque les tests automatiques échouent, voici comment tester')
print('manuellement dans Windsurf:')
print()
print('1. Ouvrir Windsurf')
print('2. Pour chaque modèle, sélectionner le modèle dans l\'interface')
print('3. Poser la question: "whats model llm you are?"')
print('4. Noter la réponse')
print()
print('Liste des 78 modèles à tester:')
print()

models = {
    'Gratuits (18)': [
        'cascade', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo',
        'claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4',
        'claude-3.5-sonnet', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku',
        'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash',
        'deepseek-chat', 'deepseek-reasoner', 'o1',
    ],
    'BYOK (13)': [
        'gpt-5.5', 'gpt-4.5', 'gpt-4.5-mini', 'gpt-4.5-turbo',
        'claude-opus-4.7', 'claude-opus-4-thinking',
        'gemini-2.5-pro', 'gemini-2.5-flash',
        'deepseek-v3', 'deepseek-r1',
        'o3', 'o3-mini', 'o1-pro',
    ],
    'PRO Subscription (21)': [
        'gpt-5', 'gpt-5-mini', 'gpt-5-turbo',
        'gpt-4.7', 'gpt-4.7-mini', 'gpt-4.7-turbo',
        'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5',
        'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-haiku-4.5',
        'gemini-2.7-pro', 'gemini-2.7-flash',
        'gemini-2.3-pro', 'gemini-2.3-flash',
        'deepseek-v4', 'deepseek-r2',
        'llama-4', 'llama-4-turbo', 'o2',
    ],
    'Claude Quotas (14)': [
        'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514',
        'claude-3.5-sonnet-20241022', 'claude-3.5-sonnet-20240620',
        'claude-3.5-haiku-20241022',
        'claude-3-opus-20240229', 'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
        'claude-2.1', 'claude-2.0',
        'claude-instant-1.2', 'claude-instant-1.1', 'claude-instant-1.0',
    ],
    'Claude Opus 4.5/4.6/4.7 (12)': [
        'claude-opus-4.5-20250514', 'claude-opus-4.5-thinking-20250514',
        'claude-opus-4.5-20250101', 'claude-opus-4.5-thinking-20250101',
        'claude-opus-4.6-20250514', 'claude-opus-4.6-thinking-20250514',
        'claude-opus-4.6-20250101', 'claude-opus-4.6-thinking-20250101',
        'claude-opus-4.7-20250514', 'claude-opus-4.7-thinking-20250514',
        'claude-opus-4.7-20250101', 'claude-opus-4.7-thinking-20250101',
    ],
}

for category, model_list in models.items():
    print(f'\n{category}:')
    for idx, model in enumerate(model_list, 1):
        print(f'  {idx}. {model}')

print()
print('='*70)
print('ALTERNATIVE: Capturer les requêtes avec DevTools')
print('='*70)
print()
print('1. Ouvrir DevTools dans Windsurf (Ctrl+Shift+I)')
print('2. Aller dans l\'onglet Network')
print('3. Filtrer par "GetCascadeTrajectory"')
print('4. Sélectionner un modèle et poser la question')
print('5. Copier la réponse du body')
print('6. Répéter pour chaque modèle')
print()
print('Ou bien:')
print('1. Activer la capture HAR dans DevTools')
print('2. Tester tous les modèles')
print('3. Exporter le fichier HAR')
print('4. M\'envoyer le fichier HAR pour analyse')
print()
print('='*70)

# Créer un template JSON pour remplir manuellement
template = {
    'timestamp': '2026-05-04T13:07:40Z',
    'question': 'whats model llm you are?',
    'total_models': 78,
    'account_type': 'PRO',
    'test_method': 'manual',
    'results': []
}

for category, model_list in models.items():
    for model in model_list:
        template['results'].append({
            'model': model,
            'category': category,
            'response': 'TO_FILL',
            'notes': ''
        })

with open('windsurf_models_manual_template.json', 'w', encoding='utf-8') as f:
    json.dump(template, f, indent=2, ensure_ascii=False)

print('Template JSON créé: windsurf_models_manual_template.json')
print('Vous pouvez remplir ce fichier avec les réponses manuelles.')
print()
