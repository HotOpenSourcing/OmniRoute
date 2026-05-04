#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Décode le protobuf de GetAllCascadeTrajectories pour extraire les réponses des modèles.
"""
import base64
import json
import sys
import codecs
import re

# Fix console encoding
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Protobuf response en base64 (depuis votre capture)
protobuf_b64 = """
CtIBCiQ1OWEyOTVkNy1lNTg2LTQ2ZmMtYWJmNS1lZjhhMGRiMWEyYWUSqQEKQldoYXQgaXMgeW91ciBtb2RlbCBuYW1lIGFuZCB2ZXJzaW9uPyBBbnN3ZXIgaW4gb25lIHNob3J0IHNlbnRlbmNlLhADGgwIrubfzwYQqO/P/wIiJGM2NDk2N2VhLTQzYTYtNDg0Ny1hNzI5LWY2MjM3NTM1MTI5MigBOgwIrubfzwYQ6ILx4AFSDAiu5t/PBhCYqs75AXABsAEE0gEJa2ltaS1rMi02CtIBCiQ2MzNjZDM4YS1hMGMwLTRhZDgtOWI5Zi05ODY5YjEzMzAxMmYSqQEKQldoYXQgaXMgeW91ciBtb2RlbCBuYW1lIGFuZCB2ZXJzaW9uPyBBbnN3ZXIgaW4gb25lIHNob3J0IHNlbnRlbmNlLhADGgwI/OXfzwYQuIrwgAEiJDM3MzNhMzViLWRjODMtNDNkZC1iYzEzLTM4ZmRkZjhiYWQxNygBOgwI++XfzwYQ1LnPugNSDAj75d/PBhDI0/7MA3ABsAEE0gEJa2ltaS1rMi02
"""

# Décoder le base64
try:
    protobuf_bytes = base64.b64decode(protobuf_b64.strip())

    # Convertir en texte (avec erreurs ignorées pour les bytes non-UTF8)
    protobuf_text = protobuf_bytes.decode('utf-8', errors='ignore')

    print('='*70)
    print('DÉCODAGE PROTOBUF - GetAllCascadeTrajectories')
    print('='*70)
    print()

    # Extraire les modèles (pattern: après les bytes, chercher "kimi-k2-6" ou autres noms)
    models = re.findall(r'([a-z0-9\-]+(?:k2|k3|glm|swe|cascade)[a-z0-9\-]*)', protobuf_text, re.IGNORECASE)

    print(f'Modèles détectés: {len(set(models))}')
    print()

    for model in sorted(set(models)):
        print(f'  - {model}')

    print()
    print('='*70)
    print('TEXTE BRUT DÉCODÉ (premiers 2000 caractères):')
    print('='*70)
    print(protobuf_text[:2000])

    # Sauvegarder le texte complet
    with open('protobuf_decoded.txt', 'w', encoding='utf-8', errors='ignore') as f:
        f.write(protobuf_text)

    print()
    print('='*70)
    print('Texte complet sauvegardé: protobuf_decoded.txt')
    print('='*70)

except Exception as e:
    print(f'Erreur: {e}')
