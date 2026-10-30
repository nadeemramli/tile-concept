#!/usr/bin/env bash
# Read-only smoke test: the image has Tesseract with English data, and the
# worker can reach the project with its secret. Claims no job, writes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --env-file .env config --quiet
docker compose --env-file .env run --rm --no-deps worker --check
echo "OCR worker smoke test passed"
