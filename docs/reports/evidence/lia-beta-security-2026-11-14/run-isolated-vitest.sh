#!/usr/bin/env bash
# Isolated node fixtures, not the native AIRI/Vite/Electron test environment.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/lia-beta-security-XXXXXX")
trap 'rm -rf "$tmp"' EXIT
printf '{"type":"module","private":true}\n' > "$tmp/package.json"
npm install --prefix "$tmp" --ignore-scripts --no-audit --no-fund --package-lock=false vitest@3.2.4 pinia@4.0.3 vue@3.5.26 es-toolkit@1.39.10
mkdir -p "$tmp/stage/ai/chat-llm" "$tmp/core/runtime" "$tmp/core/types"
cp "$root"/airi/packages/stage-ui/src/stores/ai/chat-llm/{tools.ts,tools.test.ts,tool-name.ts,tool-resolver.ts,tool-resolver.test.ts,llm.ts,llm.test.ts} "$tmp/stage/ai/chat-llm/"
cp "$root"/airi/packages/stage-ui/src/stores/{tool-call-rerun.ts,tool-call-rerun.test.ts,auth.ts,auth.test.ts} "$tmp/stage/"
cp "$root"/airi/packages/core-agent/src/runtime/{llm-service.ts,llm-service.test.ts} "$tmp/core/runtime/"
cp "$root"/airi/packages/core-agent/src/types/llm.ts "$tmp/core/types/"
cp "$root/docs/reports/evidence/lia-beta-security-2026-11-14/vitest.config.mjs" "$tmp/"
cd "$tmp"
./node_modules/.bin/vitest run stage/ai/chat-llm/llm.test.ts stage/ai/chat-llm/tools.test.ts stage/ai/chat-llm/tool-resolver.test.ts stage/tool-call-rerun.test.ts stage/auth.test.ts core/runtime/llm-service.test.ts
