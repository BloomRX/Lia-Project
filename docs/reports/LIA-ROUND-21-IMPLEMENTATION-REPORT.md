# Rodada 21 — implementação, segurança e desbloqueio do beta

**Branch:** `arena/7fa837f0-lia-project`
**Base:** `005a3247` (tip da rodada 20) → commits desta rodada `908e35e5`, `3fc7856a`, `63a9a6e3`, `ca82ef07`
**Data:** 17/11/2026
**Escopo executado:** remoção do arquivo sensível, autenticação de remetente do cofre, contratos de
provider (Anthropic/embeddings), auditoria de fronteira OIDC, auditoria de STT/consentimento.
**Escopo não executado:** SEC-05 (vínculo credencial↔destino), G-ARCH (medição Windows), emissor OIDC real.

> Regra desta rodada: nenhum veredicto foi convertido. O que não rodou está **NOT RUN**; o que
> depende de decisão do proprietário ou de hardware Windows está **BLOCKED** com o procedimento.

---

## 1. Commits publicados

| Commit | Conteúdo | Verificação |
|---|---|---|
| `908e35e5` | P0: remove `LIA-AGENT-CONSUMPTION-AUDIT.local.md` do estado atual, `*.local.md` no `.gitignore`, caminho `C:/Users/lucas` sanitizado, relatório de remediação | `git log`, varredura de segredos: 0 credenciais |
| `3fc7856a` | SEC-04 (escrita/leitura do cofre): policy de remetente obrigatória no bridge | 23 testes focados PASS + 2 mutações |
| `63a9a6e3` | Provider: declaração da Anthropic corrigida, auditoria de embeddings | 3 testes PASS |
| `ca82ef07` | Segunda prova da Anthropic (id curado executado no Main) | — |

Push normal (`005a3247..ca82ef07`), sem force, sem tocar em outra branch.

---

## 2. P0 — arquivo sensível

Executado e **PASS** no que era possível sem reescrever histórico:

- presente em **7 branches**, ausente de `main`; repositório **público**; 27.812 B acessíveis por `gh api`;
- conteúdo classificado: 4 caminhos `C:/Users/lucas`, 16 UUIDs, 11 caminhos `/root/...`, **0 credenciais**;
- removido do estado atual e do `.gitignore` impede reincidência;
- **purga histórica BLOCKED**: exige reescrita de histórico em 7 branches, o que o modo atual proíbe.
  Procedimento e decisão em `docs/reports/LIA-SENSITIVE-FILE-REMEDIATION-2026-11-17.md`.
- rotação de credenciais: **não aplicável** (nenhum segredo no arquivo).

---

## 3. SEC-04 — cofre

### 3.1 Remetente (corrigido, PASS)

Antes: qualquer `WebContents` que carregasse o preload alcançava `get/has/set/adopt/delete` do cofre,
porque o Eventa entrega todo invoke `eventa-message` ao `ipcMain` e o filtro do preload só cobria canais
OIDC. Legendas, widgets, beat-sync, about e overlay podiam ler ou sobrescrever chaves de API.

Depois:

- `isLiaSecretSenderAllowed(event, stage, settings)` — **somente** frame de topo da janela principal do
  Stage ou da janela de ajustes; nega subframe, janela desconhecida, `senderFrame` nulo, WebContents
  destruído e contexto sem janela;
- `registerLiaSecretsBridge` **exige** `isAllowedSender` — omitir não compila;
- todos os handlers recusam antes de tocar o cofre; exceção na policy = recusa;
- respostas de recusa: `get`→`undefined`, `has/set/delete`→`false`, `adopt`→`'unavailable'`,
  `encryptionAvailable`→`false`.

Prova: 23/23 testes (17 bridge + 6 policy). Mutação "policy sempre true" derruba 4/6; remover a guarda
de `get`/`delete` derruba 3. Rodado de novo no HEAD final: **23 PASS**.

**Limite declarado:** o harness de medição (`scripts/provider-runtime-electron/main.ts`) usa
`() => true` porque tem janela única; é ferramenta de medição, não o app.

### 3.2 Leitura legada (BLOCKED)

O caminho de leitura continua existindo para **provedor não curado**, e é isso que impede declarar
SEC-04 fechado:

```
Renderer: resolveApiKey()  (provider.ts:549)
  → IPC lia:secret:get
    → Main: senderAllowed()  [agora: top frame]
      → canRendererReadLegacySecret(scope)  (transport-config-service.ts:49)
        → nega id curado, speech/transcription do Main, escopo coberto por transpor te/registro/tombstone
        → libera apenas provedor fora da curadoria
```

- `RENDERER_CREDENTIAL_TASKS` = `chat`, `speech-to-text`, `asr`, `stt` (`provider.ts:517`); TTS,
  imagem e embeddings já são recusados antes de ler o cofre.
- **Por que resta:** provedor não curado constrói o cliente HTTP **no Renderer**, por arquitetura atual.
  Fechar isso exige mover a execução desses provedores para o Main — não é mudança de policy, é
  refatoração de caminho de execução.
- **Mitigação já em vigor:** ids curados (10, incluindo `anthropic`) e todo escopo com registro de
  transporte nunca são legíveis pelo Renderer; `canRendererReadLegacySecret` falha fechada em erro de
  leitura do repositório e quando a proteção de credencial está incompleta.
- **Veredicto:** **BLOCKED**. Justificativa arquitetural existe e está escrita; **aprovação de revisão
  não existe** — e o critério da rodada exige as duas. Não foi promovido a PASS.
- Próximo corte proposto: (1) inventariar quais ids não curados ainda têm segredo no cofre; (2) executar
  cada um pelo `ProviderRuntime` do Main; (3) só então remover `allowRendererRead` do tipo, para que a
  remoção quebre a compilação em vez de passar silenciosa.

---

## 4. SEC-05 — vínculo credencial ↔ destino (BLOCKED, não iniciado)

Estado verificado no HEAD: `isTransportRecord` valida `credentialRef.scope === providerId` e
`credentialRef.key === 'apiKey'` (`lia/core/src/transports/validation.ts:60-75`), e `endpoint()` aceita
`http:` e `https:`. **Não existe** vínculo entre a credencial e o host para o qual ela foi autorizada:
mudar `baseUrl` de um registro reaproveita a mesma chave no novo destino, desde que a mutação passe na
validação (que não olha host).

- **Veredicto:** **BLOCKED / NOT RUN** nesta rodada. Nenhuma prova nova; a benchada anterior continua
  sendo sintética e assim está registrada.
- Desenho mínimo para o próximo corte (não implementado): guardar no registro o **host autorizado**
  (hash, não URL completa), exigir reconfirmação explícita quando o host mudar, e recusar execução com
  credencial quando `host(record.baseUrl) ≠ host autorizado`. Isso é mudança de schema
  (`schemaVersion`), migração e UI — não cabe num corte silencioso.

---

## 5. OIDC — fronteira de token

### 5.1 Caminho Lia (`lia:oidc:*`) — tokens ficam no Main

`oidc-session.ts` guarda `accessToken/refreshToken/idToken` no processo principal (`:12-14`, `:39-41`);
a superfície IPC exposta ao Renderer é `account`, `link`, `logout`, `cancel`, `http-*` e não devolve
tokens — a única resposta com conteúdo é a conta (metadados) e o resultado de link/logout. O preload
restringe `invoke` a esses nove canais (`ipc-channel-policy.ts:1-11`).

### 5.2 Caminho legado AIRI ainda entrega tokens ao Renderer (achado novo)

Enquanto o caminho acima é correto, **o caminho antigo continua montado**:

- `services/airi/auth.ts:168` — após trocar o código, faz `context.emit(electronAuthCallback, tokens)`
  com `accessToken`, `refreshToken`, `idToken`;
- `renderer/bridges/electron-auth-callback.ts:19-31` recebe e chama `useAuthStore().completeSignIn`;
- `stores/auth.ts:315-333` grava **os três tokens em `localStorage`**
  (`auth/v1/token`, `auth/v1/refresh-token`, `auth/v1/oidc-id-token`, `:17-22`);
- o bridge é instalado no `App.vue:202` e o botão de login está na ilha de controles
  (`controls-island-auth-button.vue`), alcançável no Stage.

**Gate atual:** `electronAuthStartLogin` recusa quando `!isStageOidcEnabled()`
(`services/airi/auth.ts:90-91`), e a flag é `VITE_LIA_ENABLE_OIDC === '1'`
(`shared/lia/oidc-policy.ts:3`), exposta ao Renderer em `preload/shared.ts:59`.

**Consequência exata:**

| Estado do build | Caminho Lia | Caminho legado | Veredicto de fronteira |
|---|---|---|---|
| OIDC desligado (padrão) | inerte | **recusa antes de abrir o navegador** | **PASS** (nenhum token no Renderer) |
| OIDC ligado | tokens só no Main | **entrega tokens ao Renderer e persiste em localStorage** | **FAIL** |

Ou seja: a mesma flag que liga o OIDC da Lia liga o fluxo legado que escreve token no Renderer. Isso
viola o critério da rodada no estado em que o OIDC é usado. Não foi corrigido agora porque a correção
certa depende de decisão de produto (remover o fluxo legado do Stage, ou separá-lo em flag própria) e
mexe em autenticação — o modo atual proíbe declarar pronto com prova parcial.

**Veredicto:** **BLOCKED** (com FAIL comprovado no sub-caso "OIDC ligado"). Correção mínima proposta:
uma flag própria para o fluxo legado (default `0`), `electronAuthCallback` deixando de carregar tokens
(carry only `expiresIn`/`account`), e teste que falhe se um token aparecer no payload do evento. Não
declarar OIDC pronto: **emissor externo real nunca foi usado** — todos os testes são locais.

---

## 6. STT e voz — o que foi verificado e o que não existe

### 6.1 Verificado em código (não é teste de áudio real)

| Requisito | Estado | Evidência |
|---|---|---|
| Áudio sai da máquina só por caminho identificável | **PASS parcial** | Renderer grava e envia por `electronLiaTranscriptionRun`; o Main resolve endpoint e credencial do registro de transporte — o chamador não escolhe destino (`transcription-service.ts:26-33`) |
| Cancelamento | **PASS** | `AbortController` + `abortable()` + evento `electronLiaTranscriptionCancel` |
| Logs sem conteúdo | **PASS** | o serviço não loga áudio nem texto; falhas são códigos (`ProviderError`) |
| Remetente | **PASS** | `isLiaTranscriptionSenderAllowed`: top frame do Stage; na janela de ajustes, só `/settings/modules/hearing` ou página de provedor de transcrição suportado |
| Caminho local preservado | **PARCIAL** | existem provedores locais (`apple-speech`, `local-audio`, `official/unspeech`); nada foi removido |
| **Consentimento explícito e aviso de que o áudio sai da máquina** | **FAIL — não existe** | varredura em `renderer/` e `packages/stage-*` por *consent/privacy/leaves/sent*: nenhum aviso no fluxo de hearing. O único texto de privacidade do produto é o da memória (`MemorySection.vue:36`) |
| Provider/destino identificáveis no momento do envio | **FAIL parcial** | o provedor é escolhido em ajustes, mas não há indicação junto ao microfone nem confirmação de primeira vez |

**Conclusão:** o requisito de consentimento **não está implementado**. G-AUD permanece **BLOCKED** —
esta rodada documentou o caminho, não realizou auditoria de áudio com captura real (sem dispositivo de
áudio e sem Windows neste ambiente). Kokoro continua sendo candidato local, nunca motor oficial.

### 6.2 Testes de STT executados

`src/main/services/lia/speech-config-service.test.ts` e `transcription-*` **não carregam** neste
sandbox: dependem do binário do Electron (falha de `@electron/get`, `fetch failed`). Isso é limitação
de ambiente, não veredicto de código. **NOT RUN** para essas suítes.

---

## 7. Providers — Anthropic e embeddings

Detalhe completo em `docs/reports/LIA-PROVIDER-CONTRACTS-AUDIT-2026-11-17.md`.

- **Anthropic:** o transporte é `POST {baseURL}/chat/completions`
  (`@xsai/shared-chat/dist/index.js:3`); a API nativa só expõe `/v1/messages`. A entrada do catálogo
  prometia `api.anthropic.com/v1/` direto → 404 na primeira mensagem. **FAIL antes**; agora a descrição
  diz que exige gateway compatível com OpenAI, com teste (3 casos) contra regressão. **Nenhum adaptador
  nativo foi escrito.** O protocolo do produto só conhece `chat-completions`, `audio-speech` e
  `audio-transcription` (`lia/core/src/transports/contracts.ts:9`).
- **Embeddings:** existe fábrica no pacote vendado e em 5 providers, mas **nenhum provider declara a
  task** (contagem do catálogo: `chat` 34, TTS 17, STT 6+4, geração 1, `embed` **0**), **nenhum
  consumidor** chama `.embed()` (só bloco comentado em `Stage.vue:1072`) e a memória do produto é
  lexical por declaração (`shared/lia/memory-context.ts:10`). Não há teste de contrato. O produto não
  anuncia embeddings — **e continua sem anunciar**. **NOT SUPPORTED**, corretamente.

### 7.1 Isolamento entre providers (verificação rápida)

- o escopo da credencial é o **id do provedor** (`credentialRef.scope === providerId`, imposto em
  `lia/core/src/transports/validation.ts`), então um registro não aponta para o segredo de outro;
- existe **um** alias, `lia-groq-transcription → groq` (`provider.ts:177-179`), deliberado para o alvo
  derivado de transcrição — e esse id é resolvido no **Main**, não pelo leitor do Renderer
  (`provider.ts:1128` recusa antes de ler);
- nenhum caminho encontrado em que um provedor leia o escopo de outro. **Não testado** com dois
  provedores reais configurados no Windows — permanece como verificação de código, não de runtime.

---

## 8. G-ARCH — C0–C8

**BLOCKED.** O protocolo existe e está completo em
`docs/architecture/decisions/BENCHMARK-C0-C8-windows.md` (cenários, amostrador, invalidadores,
checklist). O que falta é **execução na máquina de referência** (Ryzen 5 5500, 16 GB, RX 580 8 GB,
Windows 11): este sandbox não tem Windows, display, GTK nem o binário do Electron. Nenhum número de
Linux foi produzido, e nenhum número de rodada anterior foi reutilizado como baseline.

Procedimento para o proprietário: §3 do protocolo (identidade do build, plano de energia, ruído),
§4 (amostrador e coleta C0–C8), §5 (tabela de resultados) — devolver os arquivos de evidência para
serem anexados em `docs/reports/`. Até lá: **sem ROCm presumido**, sem estimativa disfarçada.

---

## 9. Testes executados nesta rodada

| Suíte | Comando | Resultado |
|---|---|---|
| Cofre (bridge + policy) | `vitest run --project node src/main/services/lia/secrets-service-bridge.test.ts secrets-sender-policy.test.ts` | **23/23 PASS** |
| Declaração Anthropic | `vitest run src/libs/providers/providers/anthropic/index.test.ts` | **3/3 PASS** |
| Stage Main (completa) | `vitest run --project node src/main` | **87 arquivos PASS, 8 não carregam; 1290 testes PASS, 1 skip** |
| Core (`lia/core`) | — | **NOT RUN** nesta rodada |
| Launcher (`lia-app`) | — | **NOT RUN** nesta rodada |
| TypeScript | `tsc --noEmit` (Stage) | 415 erros, **todos** de pacote não construído/sem tipos; nenhum no código novo |
| Build de pacotes | `pnpm build:packages` (turbo) | **FAIL** — turbo não acha o binário do pnpm; construídos um a um: `i18n`, `electron-vueuse`, `plugin-sdk`, `electron-screen-capture`, `pipelines-audio`, `server-runtime`, `plugin-sdk-tamagotchi`, `stage-ui`, `better-ws`, `server-sdk`, `server-shared` |

**As 8 suítes que não carregam** (`oidc-*`, `curated-providers-local-http`, `speech-config-service`,
`transport-execution-service`, `windows/shared/window`) falham por `Electron failed to install
correctly` / `fetch failed` no download do binário — reproduzido também **sem** as mudanças desta
rodada (`git stash`), portanto é ambiente, não regressão.

---

## 10. Matriz de bloqueios

| Item | Veredicto | O que falta | Quem desbloqueia |
|---|---|---|---|
| P0 arquivo sensível (estado atual) | **PASS** | — | — |
| P0 purga histórica | **BLOCKED** | reescrever 7 branches | proprietário |
| SEC-04 remetente do cofre | **PASS** | — | — |
| SEC-04 leitura legada | **BLOCKED** | mover execução de provedor não curado para o Main; aprovação de revisão | engenharia + proprietário |
| SEC-05 vínculo de destino | **BLOCKED / NOT RUN** | schema de host autorizado + migração + UI | engenharia + proprietário |
| OIDC — caminho Lia | **PASS (código)** | emissor externo real | proprietário (ambiente) |
| OIDC — caminho legado com OIDC ligado | **FAIL → BLOCKED** | flag separada + remover tokens do evento + teste | decisão de produto |
| OIDC — emissor real | **NOT RUN** | IdP real, state/nonce/PKCE ponta a ponta | proprietário |
| STT — consentimento e aviso | **FAIL** | fluxo de consentimento + texto de destino | decisão de UX + engenharia |
| STT — cancelamento/logs/remetente | **PASS (código)** | audição real com microfone | Windows |
| G-AUD | **BLOCKED** | captura real de áudio, comparação local × remoto | Windows |
| Anthropic nativo | **FAIL (declarado)** | protocolo `messages` + adaptador + testes | só com decisão de escopo |
| Embeddings | **NOT SUPPORTED** | caminho inteiro (modelo, índice, contrato) | só com decisão de escopo |
| G-ARCH C0–C8 | **BLOCKED** | execução do protocolo no hardware | proprietário |
| L-02 (voz) | **BLOCKED** | SEC-04/05 | engenharia |

---

## 11. Arquivos alterados nesta rodada

- código: `secrets-service.ts`, `secrets-sender-policy.ts` (+ teste), `secrets-service-bridge.test.ts`,
  `main/index.ts`, `scripts/provider-runtime-electron/main.ts`,
  `providers/anthropic/index.ts` (+ teste novo);
- docs: `docs/reports/LIA-SENSITIVE-FILE-REMEDIATION-2026-11-17.md`,
  `docs/reports/LIA-PROVIDER-CONTRACTS-AUDIT-2026-11-17.md`, este relatório,
  `docs/airi-modificacoes-registro.md` (adendo datado), `.gitignore`;
- estado: `docs/project/CURRENT-STATE.md` (mesmo commit da decisão).
