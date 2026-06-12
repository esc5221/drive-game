#!/bin/sh
cd "$(dirname "$0")"
echo "→ http://localhost:8741"
python3 -m http.server 8741
