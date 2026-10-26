#!/usr/bin/env bash
# Local stand-in for CI: typecheck, lint and unit tests. `yarn verify`.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▶ tsc"; yarn tsc --noEmit
echo "▶ lint"; yarn lint
echo "▶ vitest"; yarn vitest run --reporter=dot
echo "✔ verify passed"
