#!/usr/bin/env bash
# Scoped check with synthetic internal modules. Not the workspace typecheck.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/lia-auth-check-XXXXXX")
trap 'rm -rf "$tmp"' EXIT
printf '{"type":"module","private":true}\n' > "$tmp/package.json"
npm install --prefix "$tmp" --ignore-scripts --no-audit --no-fund --package-lock=false typescript@6.0.3 vitest@3.2.4 pinia@4.0.3 vue@3.5.26 @vueuse/core@14.4.0 pinia-plugin-synced@0.1.4 better-auth@1.6.25 eslint@10.9.0 @moeru/eslint-config@0.1.0-beta.19 @unocss/eslint-plugin@66.7.5 eslint-plugin-perfectionist@5.10.1
mkdir -p "$tmp/src/stores" "$tmp/src/composables" "$tmp/src/libs"
cp "$root"/airi/packages/stage-ui/src/stores/{auth.ts,auth.test.ts} "$tmp/src/stores/"
cat > "$tmp/src/composables/api.ts" <<'FIXTURE'
// Simulates a Hono success-only type; middleware may fail at runtime.
export const client = null as unknown as { api: { v1: { flux: { $get: () => Promise<{ ok: true, status: 200, json: () => Promise<{ flux: number }> }> } } } }
FIXTURE
cat > "$tmp/src/composables/use-breakpoints.ts" <<'FIXTURE'
import { ref } from 'vue'
export const useBreakpoints = () => ({ isMobile: ref(false) })
FIXTURE
cat > "$tmp/src/libs/auth.ts" <<'FIXTURE'
export async function triggerSignIn(): Promise<void> {}
FIXTURE
cat > "$tmp/src/libs/auth-client.ts" <<'FIXTURE'
import type { User, Session } from 'better-auth'
export const authClient = { listSessions: async (_params: unknown) => ({}) }
export async function requestAuthSession(_accessToken: string | null): Promise<{ user: User, session: Session } | null> { return null }
FIXTURE
cat > "$tmp/src/libs/auth-oidc.ts" <<'FIXTURE'
export interface TokenResponse { access_token: string, token_type: string, expires_in: number, refresh_token?: string, id_token?: string, scope?: string }
export async function refreshAccessToken(_id: string, _token: string): Promise<TokenResponse> { throw new Error('fixture') }
FIXTURE
printf 'export const SERVER_URL = "https://example.invalid"\n' > "$tmp/src/libs/server.ts"
printf "declare module '@proj-airi/stage-shared' { export function isStageTamagotchi(): boolean }\n" > "$tmp/src/env.d.ts"
cat > "$tmp/tsconfig.json" <<'FIXTURE'
{"compilerOptions":{"target":"ESNext","lib":["ESNext","DOM"],"module":"ESNext","moduleResolution":"Bundler","strict":true,"noUnusedLocals":true,"noEmit":true,"verbatimModuleSyntax":true,"skipLibCheck":true,"types":["vitest"]},"include":["src"]}
FIXTURE
# The repository config references perfectionist/sort-imports while setting
# perfectionist:false. Inject the missing plugin in the temporary copy only.
python3 - "$root/airi/eslint.config.ts" "$tmp/eslint.config.mjs" <<'PY'
import sys
s = open(sys.argv[1]).read()
s = "import perfectionist from 'eslint-plugin-perfectionist'\n" + s
old = "}, {\n  ignores: [\n    'cspell"
assert s.count(old) == 1
s = s.replace(old, "}, {\n  plugins: { perfectionist },\n}, {\n  ignores: [\n    'cspell", 1)
open(sys.argv[2], 'w').write(s)
PY
cd "$tmp"
./node_modules/.bin/tsc -p tsconfig.json
CI=true ./node_modules/.bin/eslint -c eslint.config.mjs src/stores/auth.ts src/stores/auth.test.ts
