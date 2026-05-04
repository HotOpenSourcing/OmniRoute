#!/usr/bin/env python3
"""
Parse SetUserSettings protobuf data to extract complete Windsurf model list
"""

import re
import json

# Raw protobuf data from SetUserSettings endpoint
PROTOBUF_HEX = """
0a 28 0a 26 0a 24 63 6c 61 75 64 65 2d 6f 70 75
73 2d 34 2d 37 2d 6d 65 64 69 75 6d 2d 32 30 32
36 30 34 32 34 0a 28 0a 26 0a 24 63 6c 61 75 64
65 2d 6f 70 75 73 2d 34 2d 36 2d 74 68 69 6e 6b
69 6e 67 2d 32 30 32 36 30 34 32 34 0a 1a 0a 18
0a 16 67 70 74 2d 35 2d 35 2d 6c 6f 77 2d 32 30
32 36 30 34 32 34 0a 2a 0a 28 0a 26 63 6c 61 75
64 65 2d 73 6f 6e 6e 65 74 2d 34 2d 36 2d 74 68
69 6e 6b 69 6e 67 2d 32 30 32 36 30 34 32 34 0a
18 0a 16 0a 14 6b 69 6d 69 2d 6b 32 2d 36 2d 32
30 32 36 30 34 32 34 0a 16 0a 14 0a 12 73 77 65
2d 31 2d 36 2d 32 30 32 36 30 34 32 34 0a 1b 0a
19 0a 17 73 77 65 2d 31 2d 36 2d 66 61 73 74 2d
32 30 32 36 30 34 32 34 0a 1a 0a 18 0a 16 64 65
65 70 73 65 65 6b 2d 76 34 2d 32 30 32 36 30 34
32 34
"""

def parse_protobuf_models():
    """Extract model UIDs from protobuf hex data"""

    # Remove whitespace and convert to bytes
    hex_clean = PROTOBUF_HEX.replace('\n', '').replace(' ', '')
    data = bytes.fromhex(hex_clean)

    # Decode to text (ignore errors for binary parts)
    text = data.decode('utf-8', errors='ignore')

    print("Raw decoded text:")
    print(text)
    print("\n" + "="*70 + "\n")

    # Extract model patterns
    # Models follow pattern: [model-name]-20260424
    model_pattern = r'([a-z0-9-]+)-20260424'
    matches = re.findall(model_pattern, text)

    # Deduplicate and sort
    models = sorted(set(matches))

    print(f"Found {len(models)} unique models:\n")

    model_list = []
    for i, model in enumerate(models, 1):
        # Reconstruct full model UID with date suffix
        full_uid = f"{model}-20260424"

        # Extract base model name (without date)
        base_name = model

        print(f"{i}. {base_name}")
        print(f"   Full UID: {full_uid}")

        model_list.append({
            'base_name': base_name,
            'full_uid': full_uid,
            'discovered_from': 'SetUserSettings protobuf'
        })
        print()

    return model_list

def categorize_models(models):
    """Categorize models by provider"""

    categories = {
        'Claude': [],
        'GPT': [],
        'DeepSeek': [],
        'Chinese': [],
        'SWE': []
    }

    for model in models:
        name = model['base_name']

        if name.startswith('claude-'):
            categories['Claude'].append(model)
        elif name.startswith('gpt-'):
            categories['GPT'].append(model)
        elif name.startswith('deepseek-'):
            categories['DeepSeek'].append(model)
        elif name.startswith('kimi-') or name.startswith('glm-'):
            categories['Chinese'].append(model)
        elif name.startswith('swe-'):
            categories['SWE'].append(model)

    return categories

def main():
    print("="*70)
    print("WINDSURF SETUSERSETTINGS PROTOBUF PARSER")
    print("="*70)
    print()

    # Parse models
    models = parse_protobuf_models()

    # Categorize
    categories = categorize_models(models)

    print("="*70)
    print("MODELS BY CATEGORY")
    print("="*70)
    print()

    for category, model_list in categories.items():
        if model_list:
            print(f"{category} Models ({len(model_list)}):")
            for model in model_list:
                print(f"  - {model['base_name']}")
            print()

    # Save to JSON
    output = {
        'timestamp': '2026-05-04T13:06:00Z',
        'source': 'SetUserSettings protobuf capture',
        'total_models': len(models),
        'models': models,
        'categories': {k: [m['base_name'] for m in v] for k, v in categories.items() if v}
    }

    output_file = 'windsurf_models_from_setusersettings.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Results saved to: {output_file}")
    print()

    # Key findings
    print("="*70)
    print("KEY FINDINGS")
    print("="*70)
    print()
    print("✅ GPT-5.5 EXISTS: gpt-5-5-low-20260424")
    print("✅ Claude Opus 4.7: claude-opus-4-7-medium-20260424")
    print("✅ Claude Opus 4.6: claude-opus-4-6-thinking-20260424")
    print("✅ Claude Sonnet 4.6: claude-sonnet-4-6-thinking-20260424")
    print("✅ DeepSeek V4: deepseek-v4-20260424")
    print()
    print("All models include date suffix: -20260424")
    print("This is the ACTUAL model list from Windsurf Pro subscription")
    print()

if __name__ == '__main__':
    main()
