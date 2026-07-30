#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extrait le corps exact de la requête POST /api/v1/agent-runs
"""

import re
import json
import sys

# Force UTF-8 output
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

def extract_agent_runs_request(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            data = f.read()
        
        print("[*] Recherche de POST /api/v1/agent-runs...\n")
        
        # Chercher le pattern de la requête agent-runs
        # Format dans la capture: 7:content;LENGTH:BODY,7:headers;...
        
        # Méthode 1: Chercher directement le path et extraire le contexte
        agent_runs_pattern = r'4:path;[0-9]+:/api/v1/agent-runs'
        matches = list(re.finditer(agent_runs_pattern, data))
        
        print(f"[*] Trouve {len(matches)} requetes agent-runs\n")
        
        for i, match in enumerate(matches, 1):
            print(f"=== Requete #{i} ===\n")
            
            # Extraire un contexte autour du match
            start = max(0, match.start() - 2000)
            end = min(len(data), match.end() + 5000)
            context = data[start:end]
            
            # Chercher le content dans ce contexte
            content_match = re.search(r'7:content;([0-9]+):([^,]*),', context)
            if content_match:
                content_length = int(content_match.group(1))
                content_body = content_match.group(2)
                
                print(f"Content-Length: {content_length}")
                print(f"Content:\n{content_body}\n")
                
                # Essayer de parser en JSON
                try:
                    parsed = json.loads(content_body)
                    print("JSON parse:")
                    print(json.dumps(parsed, indent=2))
                except:
                    print("(pas du JSON valide)")
            
            # Chercher aussi le method
            method_match = re.search(r'6:method;[0-9]+:([^,]+),', context)
            if method_match:
                print(f"\nMethod: {method_match.group(1)}")
            
            print("\n" + "="*60 + "\n")
        
        # Méthode 2: Chercher tous les corps de requête qui mentionnent agent
        print("\n[*] Recherche de tous les corps contenant 'agent' ou 'base2'...\n")
        
        agent_bodies = re.findall(r'7:content;[0-9]+:(\{[^}]*(?:agent|base2|freebuff)[^}]*\})', data, re.IGNORECASE)
        
        for i, body in enumerate(agent_bodies[:10], 1):
            print(f"Body #{i}:")
            try:
                parsed = json.loads(body)
                print(json.dumps(parsed, indent=2))
            except:
                print(body)
            print()
        
    except Exception as e:
        print(f"[ERROR] Erreur: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Extraction du corps de la requete agent-runs\n")
    print("="*60 + "\n")
    extract_agent_runs_request("C:/Users/amine/mimtalls2.txt")
