#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analyse du fichier HAR NEW2.har pour extraire les informations Windsurf.
"""
import json
import sys
from collections import defaultdict
from datetime import datetime

# Fix console encoding for Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

def analyze_har(har_file):
    """Analyse le fichier HAR et extrait les informations importantes."""

    print('='*70)
    print('ANALYSE DU FICHIER HAR NEW2.har')
    print('='*70)
    print()

    # Charger le fichier HAR
    with open(har_file, 'r', encoding='utf-8') as f:
        har_data = json.load(f)

    entries = har_data['log']['entries']

    print(f'Total des requêtes: {len(entries)}')
    print()

    # Statistiques par type de requête
    request_types = defaultdict(int)
    endpoints = defaultdict(int)
    methods = defaultdict(int)
    status_codes = defaultdict(int)

    # Requêtes importantes
    important_requests = []

    for entry in entries:
        request = entry['request']
        response = entry['response']

        # Type de requête
        url = request['url']
        method = request['method']
        status = response['status']

        methods[method] += 1
        status_codes[status] += 1

        # Extraire l'endpoint
        if 'LanguageServerService' in url:
            endpoint = url.split('/')[-1]
            endpoints[endpoint] += 1

            # Collecter les requêtes importantes
            important_requests.append({
                'method': method,
                'endpoint': endpoint,
                'status': status,
                'url': url,
                'headers': request.get('headers', []),
                'postData': request.get('postData', {}),
                'response': response
            })

    # Afficher les statistiques
    print('='*70)
    print('STATISTIQUES GLOBALES')
    print('='*70)
    print()

    print('Méthodes HTTP:')
    for method, count in sorted(methods.items(), key=lambda x: x[1], reverse=True):
        print(f'  {method}: {count}')
    print()

    print('Codes de statut:')
    for status, count in sorted(status_codes.items(), key=lambda x: x[1], reverse=True):
        print(f'  {status}: {count}')
    print()

    print('='*70)
    print('ENDPOINTS LANGUAGE SERVER')
    print('='*70)
    print()

    for endpoint, count in sorted(endpoints.items(), key=lambda x: x[1], reverse=True):
        print(f'  {endpoint}: {count} requêtes')
    print()

    # Analyser les requêtes importantes
    print('='*70)
    print('REQUÊTES IMPORTANTES')
    print('='*70)
    print()

    # Chercher les requêtes avec des modèles
    model_requests = []
    cascade_requests = []
    assign_model_requests = []

    for req in important_requests:
        endpoint = req['endpoint']

        if 'Cascade' in endpoint:
            cascade_requests.append(req)

        if 'AssignModel' in endpoint:
            assign_model_requests.append(req)

        # Chercher dans les données POST
        post_data = req.get('postData', {})
        if post_data:
            content = post_data.get('text', '')
            if 'model' in content.lower() or 'claude' in content.lower():
                model_requests.append(req)

    print(f'Requêtes Cascade: {len(cascade_requests)}')
    print(f'Requêtes AssignModel: {len(assign_model_requests)}')
    print(f'Requêtes avec modèles: {len(model_requests)}')
    print()

    # Détails des requêtes Cascade
    if cascade_requests:
        print('='*70)
        print('DÉTAILS DES REQUÊTES CASCADE')
        print('='*70)
        print()

        for idx, req in enumerate(cascade_requests[:5], 1):  # Limiter à 5
            print(f'[{idx}] {req["method"]} {req["endpoint"]} - Status: {req["status"]}')
            print(f'    URL: {req["url"]}')

            # Headers importants
            headers = req.get('headers', [])
            for header in headers:
                name = header.get('name', '')
                if name.lower() in ['x-csrf-token', 'authorization', 'content-type']:
                    value = header.get('value', '')
                    if name.lower() == 'x-csrf-token':
                        value = value[:20] + '...' if len(value) > 20 else value
                    print(f'    {name}: {value}')

            print()

    # Détails des requêtes AssignModel
    if assign_model_requests:
        print('='*70)
        print('DÉTAILS DES REQUÊTES ASSIGNMODEL')
        print('='*70)
        print()

        for idx, req in enumerate(assign_model_requests[:5], 1):
            print(f'[{idx}] {req["method"]} {req["endpoint"]} - Status: {req["status"]}')
            print(f'    URL: {req["url"]}')

            # POST data
            post_data = req.get('postData', {})
            if post_data:
                text = post_data.get('text', '')
                if text:
                    print(f'    POST Data (premiers 200 chars):')
                    print(f'    {text[:200]}...')

            # Response
            response = req.get('response', {})
            content = response.get('content', {})
            if content:
                text = content.get('text', '')
                if text:
                    print(f'    Response (premiers 200 chars):')
                    print(f'    {text[:200]}...')

            print()

    # Chercher les tokens CSRF
    print('='*70)
    print('TOKENS CSRF TROUVÉS')
    print('='*70)
    print()

    csrf_tokens = set()
    for req in important_requests:
        headers = req.get('headers', [])
        for header in headers:
            if header.get('name', '').lower() == 'x-csrf-token':
                token = header.get('value', '')
                if token:
                    csrf_tokens.add(token)

    for token in csrf_tokens:
        print(f'  {token[:40]}...')
    print()

    # Chercher les ports
    print('='*70)
    print('PORTS DÉTECTÉS')
    print('='*70)
    print()

    ports = set()
    for req in important_requests:
        url = req['url']
        if ':' in url:
            parts = url.split(':')
            if len(parts) >= 3:
                port_part = parts[2].split('/')[0]
                if port_part.isdigit():
                    ports.add(int(port_part))

    for port in sorted(ports):
        print(f'  Port: {port}')
    print()

    # Sauvegarder les résultats
    output = {
        'timestamp': datetime.now().isoformat(),
        'total_requests': len(entries),
        'statistics': {
            'methods': dict(methods),
            'status_codes': dict(status_codes),
            'endpoints': dict(endpoints),
        },
        'counts': {
            'cascade_requests': len(cascade_requests),
            'assign_model_requests': len(assign_model_requests),
            'model_requests': len(model_requests),
        },
        'csrf_tokens': list(csrf_tokens),
        'ports': sorted(list(ports)),
        'important_requests': important_requests[:10],  # Limiter à 10
    }

    output_file = 'NEW2_har_analysis.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print('='*70)
    print(f'Résultats sauvegardés: {output_file}')
    print('='*70)

if __name__ == '__main__':
    har_file = r'C:\Users\amine\AppData\Local\Programs\Windsurf\winsurftiwtest\NEW2.har'
    analyze_har(har_file)
