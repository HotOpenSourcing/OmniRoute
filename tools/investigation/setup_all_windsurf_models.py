#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Configuration script to enable ALL Windsurf models (free + pro).
This script helps you configure API keys and test model availability.
"""
import sys
import os
import json
from pathlib import Path

# Fix console encoding for Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

print('='*70)
print('WINDSURF MODELS CONFIGURATION SETUP')
print('='*70)
print()

# Configuration file path
CONFIG_FILE = Path('windsurf_api_keys.json')

# Model providers and their required API keys
PROVIDERS = {
    'anthropic': {
        'name': 'Anthropic (Claude)',
        'env_var': 'ANTHROPIC_API_KEY',
        'key_format': 'sk-ant-api03-...',
        'url': 'https://console.anthropic.com',
        'models': [
            'claude-opus-4-byok-beta',
            'claude-opus-4-thinking-byok-beta',
            'claude-sonnet-4-byok',
            'claude-sonnet-4-thinking-byok',
        ]
    },
    'openai': {
        'name': 'OpenAI (GPT)',
        'env_var': 'OPENAI_API_KEY',
        'key_format': 'sk-...',
        'url': 'https://platform.openai.com',
        'models': [
            'gpt-5-2-low-thinking',
        ]
    },
    'google': {
        'name': 'Google (Gemini)',
        'env_var': 'GOOGLE_API_KEY',
        'key_format': 'AIzaSy...',
        'url': 'https://makersuite.google.com/app/apikey',
        'models': [
            'gemini-3-flash-low',
        ]
    },
    'zhipu': {
        'name': 'Zhipu AI (GLM)',
        'env_var': 'ZHIPU_API_KEY',
        'key_format': '...',
        'url': 'https://open.bigmodel.cn',
        'models': [
            'glm-4-7-beta',
            'glm-5',
            'glm-5-1',
        ]
    }
}

def load_config():
    """Load existing API keys configuration."""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_config(config):
    """Save API keys configuration."""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, indent=2, ensure_ascii=False, fp=f)
    print(f'\n✓ Configuration saved to: {CONFIG_FILE}')

def configure_provider(provider_id, provider_info, existing_config):
    """Configure API key for a provider."""
    print(f'\n{"="*70}')
    print(f'CONFIGURE: {provider_info["name"]}')
    print(f'{"="*70}')
    print(f'Models: {", ".join(provider_info["models"])}')
    print(f'Get API key from: {provider_info["url"]}')
    print(f'Key format: {provider_info["key_format"]}')
    print()

    # Check if already configured
    if provider_id in existing_config and existing_config[provider_id]:
        current_key = existing_config[provider_id]
        masked_key = current_key[:10] + '...' + current_key[-4:] if len(current_key) > 14 else '***'
        print(f'Current key: {masked_key}')
        print()
        choice = input('Keep current key? (y/n): ').strip().lower()
        if choice == 'y':
            return existing_config[provider_id]

    # Get new API key
    print()
    print('Options:')
    print('  1. Enter API key now')
    print('  2. Skip (configure later)')
    print()
    choice = input('Choice (1/2): ').strip()

    if choice == '1':
        api_key = input(f'Enter {provider_info["name"]} API key: ').strip()
        if api_key:
            return api_key
        else:
            print('⚠ No key entered, skipping.')
            return None
    else:
        print('⚠ Skipped.')
        return None

def main():
    print('This script helps you configure API keys for all Windsurf models.')
    print('You will need API keys from each provider to enable their models.')
    print()

    # Load existing configuration
    config = load_config()
    if config:
        print(f'✓ Loaded existing configuration from {CONFIG_FILE}')
    else:
        print('No existing configuration found. Starting fresh.')

    print()
    print('Configure API keys for each provider:')
    print()

    # Configure each provider
    updated = False
    for provider_id, provider_info in PROVIDERS.items():
        api_key = configure_provider(provider_id, provider_info, config)
        if api_key:
            config[provider_id] = api_key
            updated = True

    # Save configuration
    if updated:
        save_config(config)
        print()
        print('='*70)
        print('CONFIGURATION COMPLETE')
        print('='*70)
        print()
        print('Configured providers:')
        for provider_id, api_key in config.items():
            if api_key:
                provider_name = PROVIDERS[provider_id]['name']
                masked_key = api_key[:10] + '...' + api_key[-4:] if len(api_key) > 14 else '***'
                print(f'  ✓ {provider_name}: {masked_key}')
        print()
        print('Next steps:')
        print('  1. Run: python test_all_models_with_keys.py')
        print('  2. This will test all configured models')
    else:
        print()
        print('⚠ No configuration changes made.')

    print()
    print('='*70)
    print('NOTES')
    print('='*70)
    print()
    print('• API keys are stored in windsurf_api_keys.json')
    print('• Keep this file secure (add to .gitignore)')
    print('• Free models (Kimi K2.6) work without API keys')
    print('• Pro models require valid API keys and credits')
    print()

if __name__ == '__main__':
    main()
