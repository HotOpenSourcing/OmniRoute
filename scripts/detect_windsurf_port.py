#!/usr/bin/env python3
"""
Detect the current Windsurf local server port dynamically
"""

import json
import os
import re
import glob

def find_windsurf_port():
    """Find the current Windsurf local server port"""

    # Method 1: Check HAR files in winsurftiwtest
    har_dirs = [
        r"C:\Users\amine\AppData\Local\Programs\Windsurf\winsurftiwtest",
        r"C:\Users\amine\AppData\Roaming\Windsurf",
        r"C:\Users\amine\AppData\Local\Windsurf"
    ]

    for har_dir in har_dirs:
        if not os.path.exists(har_dir):
            continue

        # Find most recent HAR file
        har_files = glob.glob(os.path.join(har_dir, "*.har"))
        if not har_files:
            continue

        # Sort by modification time, most recent first
        har_files.sort(key=os.path.getmtime, reverse=True)

        for har_file in har_files[:3]:  # Check 3 most recent
            try:
                with open(har_file, 'r', encoding='utf-8') as f:
                    content = f.read(10000)  # Read first 10KB

                    # Look for localhost URLs
                    matches = re.findall(r'http://[a-z]\.localhost:(\d+)', content)
                    if matches:
                        port = matches[0]
                        print(f"Found port {port} in {os.path.basename(har_file)}")
                        return int(port)
            except:
                continue

    # Method 2: Default ports to try
    default_ports = [51834, 53302, 53740, 53741, 53742]

    print("No HAR files found, trying default ports...")
    return default_ports

if __name__ == '__main__':
    result = find_windsurf_port()

    if isinstance(result, int):
        print(f"\nWindsurf port: {result}")
        print(f"URL: http://127.0.0.1:{result}")
    else:
        print(f"\nPorts to try: {result}")
