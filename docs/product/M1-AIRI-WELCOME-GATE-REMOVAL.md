# M1 — Remoção do gate Welcome/Auth do AIRI da experiência Lia

**Commit: `5a1a63f`** (branch `arena/01a07b6d-lia-project`, enviada).

Nada foi apagado do fluxo de auth upstream. Foi adicionada uma policy da Lia que
desliga apenas o disparo **automático**.

---

## 1. Componente e guard responsáveis

| Peça | Onde |
| --- | --- |
| Janela "Welcome to AIRI" | `apps/stage-tamagotchi/src/main/windows/onboarding/index.ts:42` — `BrowserWindow` própria, `title: 'Welcome to AIRI'`, rota `/onboarding` |
| Página renderizada | `apps/stage-tamagotchi/src/renderer/pages/onboarding.vue` |
| Serviço que abre | `src/main/services/airi/onboarding/index.ts` — **só reage** ao invoke `electronOpenOnboarding`, nunca abre sozinho |
| **Guard (a condição)** | `packages/stage-ui/src/stores/onboarding.ts` → `needsOnboarding` |
| **Disparo (a causa)** | `apps/stage-tamagotchi/src/renderer/pages/index.vue:746` → `onMounted` |

A condição exata:

```ts
const needsOnboarding = computed(() =>
  !authStore.isAuthenticated
  && !authStore.token
  && !hasSkippedSetup.value
  && !hasCompletedSetup.value
  && !skipOnboardingPath.includes(document.location.pathname),
)
```

## 2. Por que aparecia

A cadeia completa, verificada:

1. A janela principal carrega **`/home`** (Lia Home) —
   `src/main/windows/main/index.ts:181`, com o comentário *"M1 Phase 2 (Lia):
   launcher-first"*.
2. `goConversar()` (`home.vue:172`) faz `setMainWindowContext({ mode: 'stage' })`
   e **`router.push('/')`**.
3. `/` é `index.vue`, cujo `onMounted` chamava `openOnboarding()`
   incondicionalmente quando `needsOnboarding`.
4. `needsOnboarding` é verdadeira sempre que não há sessão AIRI **e** os flags
   `onboarding/completed` / `onboarding/skipped` não estão no localStorage.

Então: **usuário anônimo + nenhum dos dois flags** — ou seja, todo fresh install,
e todo install seguinte até alguém completar ou pular o setup upstream. Não é
first-run no sentido de "uma vez só": é ausência de conta.

Não havia nenhum outro disparo automático. `createOnboardingService` só registra
o handler; `shell.openExternal` aparece em dois lugares
(`services/airi/auth.ts:92` e `windows/shared/window.ts:58`), ambos acionados por
clique do usuário — nenhum site AIRI abria sozinho.

## 3. Dependências reais do auth

Auditado o que consome `useAuthStore`:

| Consumidor | Depende de conta? | Impacto de não ter sessão |
| --- | --- | --- |
| `stores/chat/session-store.ts` | **Não** | `userId` cai em `'local'` (`auth.ts:87`) e o socket WS é construído lazy — *"anonymous (`userId === 'local'`) users never open a socket"*. Cloud sync é pulado, chat local funciona |
| `composables/use-local-first.ts` | **Não** | `local()` **sempre** roda; `remote()` só entra se `isAuthenticated`. Degrada, não quebra |
| LLM/chat da Lia | **Não** | Vem de `liaProviderStore.activateConfiguredProvider()` com chave resolvida do vault — independente da sessão AIRI |
| `stores/voice-packs.ts` | Sim | Catálogo remoto de voice packs indisponível |
| Provider `official` | Sim | `configuredBy: 'authentication'` — já reporta "configure este provedor" |
| `hologram/holo-coupon.vue` | Sim | Cupom indisponível |
| `libs/analytics` | Não | Só identity do PostHog |
| `App.vue:264` | Não | `removeAuthenticationProviderConfiguration()` — **remove** config de provider de auth quando não autenticado; comportamento desejado |

**Conclusão:** memória local, TTS, avatar e o chat da Lia **não** dependem da
sessão AIRI. Só sync de sessão em nuvem, voice packs remotos, o provider
`official` e cupons dependem — e todos continuam atrás do botão de sign-in na
controls island (`controls-island-auth-button.vue` → `electronAuthStartLogin`).

## 4. Estratégia escolhida

Policy da Lia, como preferido — **não** remoção do auth:

- **Novo:** `stores/lia/airi-onboarding-policy.ts` com `mayAutoOpenAiriWelcome()`
  (a regra de produto) e `shouldAutoOpenAiriWelcome(needsOnboarding)` (a decisão
  combinada, para o teste exercer a expressão real em vez de reimplementá-la).
- **Alterado:** `pages/index.vue` — o `onMounted` agora consulta a policy.

Intactos: a janela, o `OnboardingWindowManager`, o `createOnboardingService`, o
invoke `electronOpenOnboarding`, o `useOnboardingStore` upstream, o botão de
sign-in e a página `/onboarding`. Um open explícito continua funcionando — o
fluxo upstream não foi bifurcado nem apagado.

## 5. Arquivos alterados

```
airi/apps/stage-tamagotchi/src/renderer/pages/index.vue              | 9 +-
airi/apps/stage-tamagotchi/src/renderer/stores/lia/airi-onboarding-policy.ts       (novo)
airi/apps/stage-tamagotchi/src/renderer/stores/lia/airi-onboarding-policy.test.ts  (novo)
```

Três arquivos. Nenhum em `packages/stage-ui`, nenhum no pipeline de voz, nenhum
em provider LLM.

## 6. Testes

| Verificação | Resultado |
| --- | --- |
| `stage-tamagotchi` (node) | **83 arquivos, 634 passed, 1 skipped** (+1 arquivo, +5 testes) |
| ESLint nos arquivos alterados | **0 erros** |
| `vue-tsc` tamagotchi | **3 erros = baseline exato** |
| Mutation: `mayAutoOpenAiriWelcome()` → `true` | **3 dos 5 testes falham** ✓ |

Os 5 testes novos usam o **`useOnboardingStore` upstream real**, sem mockar o
auth: um store recém-criado já está no estado anônimo. O primeiro teste afirma
que `needsOnboarding === true` nesse estado — ou seja, prova que o gate upstream
**teria** aberto a janela, e que a policy é o que impede. Sem isso o teste não
valeria nada.

### Mapeamento dos 7 testes que você pediu

| # | Teste | Status |
| --- | --- | --- |
| 1 | fresh install → Home Lia | **Código**: `main/index.ts` carrega `/home`. Não executado (sem Electron) |
| 2 | CONVERSAR → Stage direto | **Código + teste**: `router.push('/')` → gate agora `false`. Não executado |
| 3 | anônimo conversa com provider Lia | **Código**: `userId='local'`, socket lazy, `activateConfiguredProvider()` independente. Não executado |
| 4 | nenhuma janela/site AIRI abre | **Auditoria**: único caminho é o `onMounted` gateado; `openExternal` só por clique. Não executado |
| 5 | reabrir continua direto | **Teste automatizado** ✓ (flags sem set → ainda `false`) |
| 6 | auth existente não interfere | **Teste automatizado** ✓ (usuário com sessão → inalterado) |
| 7 | credits/license presentes | **Verificado**: `airi/LICENSE` (MIT, © Neko Ayaka), `docs/licenses/THIRD-PARTY-NOTICES.md:13`, About — todos intocados |

**Não declarei PASS.** Itens 1–4 exigem o app rodando; só foram confirmados por
leitura de código e por teste da decisão. Itens 5 e 6 estão cobertos por teste
executado.

## 7. Commit SHA

**`5a1a63f`** — `fix(lia): stop the AIRI welcome window from interrupting Home -> CONVERSAR`

Cadeia: `5a1a63f` ← `8961651` ← `c371cec` (diagnósticos de áudio) ← `35e529a`/`18c381f`/`8326751`/`76bd178` (docs) ← `5f44ee8` ← `efe9dec` ← `215557f`.

---

## Observações

- **About ainda menciona "AIRI"** nas mensagens de update
  (`about.vue:296,313` — "AIRI is installed in a protected Windows folder",
  "Installing this update will downgrade AIRI"). É branding, mas você pediu
  explicitamente para **manter** atribuição no About, e mexer no texto do
  updater mudaria o que o usuário entende estar sendo atualizado. Deixei como
  está — sinalizo caso queira trocar a redação em outra rodada.
- **Branding no onboarding:** a página `/onboarding` e o `step-welcome.vue` do
  stage-ui continuam com o texto "Welcome to AIRI". Eles simplesmente não abrem
  mais sozinhos na experiência Lia. Se a Lia precisar de um onboarding próprio
  com a marca Lia, isso é trabalho separado — a Home da Lia já tem o seu
  (`home.vue` → `view.value = 'onboarding'`, via `liaProviderStore`).
- **Nada foi removido do auth.** `useAuthStore`, `createAuthService`, o callback
  OAuth e o botão de sign-in seguem funcionando para quem quiser conectar conta
  AIRI.
