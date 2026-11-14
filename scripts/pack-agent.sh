#!/usr/bin/env bash
# Mengemas gateway-agent menjadi dist/downloads/gateway-agent.tar.gz (disajikan backend di /downloads/).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/downloads
tar --exclude='__pycache__' --exclude='tests' --exclude='*.pyc' -czf dist/downloads/gateway-agent.tar.gz gateway-agent
echo "dist/downloads/gateway-agent.tar.gz dibuat"
