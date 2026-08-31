#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analyse la capture mitmproxy pour trouver les appels API avant le chat completion
"""

import re
import json
import sys

# Force UTF-8 output
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

def analyze_mitm_capture(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            data = f.read()
        
        # Extraire tous les paths d'API
        paths = re.findall(r'4:path;[0-9]+:([^,]+),', data)
        
        print("[*] API Endpoints appeles (ordre chronologique):\n")
        
        seen = set()
        for i, path in enumerate(paths[:50], 1):
            if path not in seen:
                print(f"{i}. {path}")
                seen.add(path)
        
        # Chercher spécifiquement les patterns liés à run/session
        print("\n\n[*] Recherche de patterns run/session:\n")
        
        run_patterns = [
            r'/api/v[0-9]+/runs',
            r'/api/v[0-9]+/sessions',
            r'/api/v[0-9]+/agent',
            r'run[_-]?id',
            r'session[_-]?id',
            r'trace[_-]?session[_-]?id',
        ]
        
        for pattern in run_patterns:
            matches = re.findall(pattern, data, re.IGNORECASE)
            if matches:
                print(f"  Pattern '{pattern}': {len(matches)} occurrences")
                print(f"    Premiers matches: {matches[:5]}")
        
        # Chercher les métadonnées codebuff
        print("\n\n[*] Metadonnees codebuff trouvees:\n")
        
        metadata_patterns = [
            r'"codebuff_metadata":\{([^}]+)\}',
            r'freebuff_instance_id["\s:]+([a-f0-9-]+)',
            r'trace_session_id["\s:]+([a-f0-9-]+)',
            r'run_id["\s:]+([a-f0-9-]+)',
            r'client_id["\s:]+([a-zA-Z0-9]+)',
        ]
        
        for pattern in metadata_patterns:
            matches = re.findall(pattern, data)
            if matches:
                print(f"  {pattern}: {len(matches)} occurrences")
                if len(matches) <= 5:
                    for match in matches:
                        print(f"    -> {match}")
        
    except Exception as e:
        print(f"[ERROR] Erreur: {e}")

if __name__ == "__main__":
    print("Analyse de la capture mitmproxy\n")
    print("="*60 + "\n")
    analyze_mitm_capture("C:/Users/amine/mimtalls2.txt")
