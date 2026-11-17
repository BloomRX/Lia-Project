# Lia — Reconciliação de segurança (Architecture/Security × Principal)

**Atualização da Rodada 20:** as correções de ferramentas, HTTP,
concorrência de sessão, créditos, logs STT e OIDC-OFF foram integradas
com evidência no [relatório Windows](LIA-ROUND-20-IMPLEMENTATION-REPORT.md).
SEC-04/05 e a autorização de envio de STT permanecem abertos.

**Data:** 16/11/2026
**Branch analisada (leitura):** `arena/c6b02f64-lia-project` @ `a1f5b83195` (base de código `407300b`)
**Branch de destino:** `arena/7fa837f0-lia-project` @ `971d309074`
**Natureza:** revisão documental e estática. **Nenhum código foi portado nesta rodada.** Nenhum teste de produto foi executado.
**Regra:** os relatórios da própria branch (`LIA-BETA-SECURITY-FIXES`, `LIA-STT-SECURITY-AUDIT`, `LIA-AUTH-RECONCILIATION`) são tratados como **evidência de origem**, não como aprovação.

---

## 0. Veredicto

| Afirmação | Estado | Base |
|---|---|---|
| O conjunto de segurança de `c6b02f64` está **aprovado** para o beta | **NÃO** | `LIA-AUTH-RECONCILIATION` §0: "NÃO aprovado para beta"; OIDC-OFF "não implementado nem demonstrado" |
| O port é tecnicamente limpo | **SIM** | 6 arquivos-chave byte-idênticos ao HEAD; base `407300b` |
| Pode ser descartado sem justificativa | **NÃO** | Ver §6 — duas proteções são barreiras reais contra classes de falha demonstradas |
| `L-02` pode integrar | **NÃO** | SEC-04/05 abertos; T-07/T-08 pendentes |
| OIDC-OFF existe | **NÃO** | Nenhuma implementação em nenhuma branch |

**Decisão da rodada:** **ADAPTAR por item** — 3 PORTAR (SEC-R-01, SEC-R-02 e a implementação de STT-01), 2 ADAPTAR (SEC-R-03/04), 3 BLOQUEADO (SEC-R-06/07/08). Nenhum merge do conjunto.

---

## 1. Mapa de SHAs e prova de identidade

| Arquivo | Blob em `c6b02f64` (= `407300b`) | Blob no HEAD `971d309` | Veredicto |
|---|---|---|---|
| `airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts` | idêntico | idêntico | port limpo |
| `airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts` | idêntico | idêntico | port limpo |
| `airi/packages/stage-ui/src/stores/ai/chat-llm/llm.ts` | idêntico | idêntico | port limpo |
| `airi/packages/core-agent/src/runtime/llm-service.ts` | idêntico | idêntico | port limpo |
| `airi/packages/core-agent/src/types/llm.ts` | idêntico | idêntico | port limpo |
| `lia/core/src/providers/runtime.ts` | idêntico | idêntico | port limpo |
| `airi/packages/stage-ui/src/stores/auth.ts` | variante `0093de0` (`cea617f…`) | variante base `8b3f87c1` | **reaplicar por diff**, não `cherry-pick` |
| `airi/apps/stage-tamagotchi/src/main/services/lia/secrets-service.ts` | base `407300b` | **mais novo** (CAS `secretRevision`) | comparar de novo |

> O HEAD atual **não** é o mesmo de `407300b` em todos os arquivos. Onde houve avanço (ex.: CAS de segredo), a avaliação abaixo considera o **HEAD**, não o relatório antigo.

---

## 2. Resumo das decisões

| ID | Item | Decisão | Arquivo:linha (origem) | Risco |
|---|---|---|---|---|
| **SEC-R-01** | Ferramenta desabilitada após resolução (TOOL-01/02) | **PORTAR** | `tool-resolver.ts:68–83,173,175`; `tools.ts:87,102–111,126,134–145`; `llm.ts:34`; `llm-service.ts:152,196` | Médio |
| **SEC-R-02** | Credencial em destino HTTP não-loopback (SEC-05 parcial) | **PORTAR** | `lia/core/src/providers/runtime.ts:225–232` | Baixo-médio |
| **SEC-R-03** | Refresh concorrente, gerações, limpeza antes da rede (SEC-02) | **ADAPTAR** | `stage-ui/src/stores/auth.ts:95,155–201,260` | Alto |
| **SEC-R-04** | `updateCredits()`: status, validação, erros (SEC-02 parcial) | **ADAPTAR** | `auth.ts:95` + `updateCredits` | Alto sem adoção |
| **SEC-R-05** | STT-01: transcrição em log | **PORTAR (implementar)** | `voice-input-session.ts:390–394` | Baixo |
| **SEC-R-06** | OIDC-OFF (SEC-01/02/03) | **BLOQUEADO** | proposta em `LIA-AUTH-RECONCILIATION` §OIDC-OFF | Crítico |
| **SEC-R-07** | SEC-04/05: scopes legados + vínculo destino–credencial | **BLOQUEADO** | `secrets-service.ts:139–145`; `transport-config-service.ts:85–95` | Crítico |
| **SEC-R-08** | Consentimento e envio de áudio (STT-02/03/06/08) | **BLOQUEADO** | `media-permissions.ts:126–160`; `hearing.ts:388–423`; `transcription-service.ts:277–312` | Crítico |

---

## 3. Análise item a item

### 3.1 SEC-R-01 — Ferramenta desabilitada após resolução (TOOL-01/02)

**Achado na origem.** A resolução de ferramentas é assíncrona. Entre o `resolveTools()` e o `streamText()`, o estado do store pode mudar (usuário desabilita uma ferramenta), e o schema já resolvido podia ser entregue depois. Além disso, duas fontes diferentes com o **mesmo nome** podiam sobreviver ao filtro A-1: a desabilitada era filtrada, mas a homônima não.

**Correção da branch (`7ea61cac`).**

| Mecanismo | Linha | Comportamento |
|---|---|---|
| `guardedSources: WeakMap<Tool, Tool>` | `tool-resolver.ts:68` | mapeia wrapper → ferramenta original |
| `isResolvedToolAllowed(tool)` | `tool-resolver.ts:70–71` | resolve a origem e delega ao store |
| `guardResolvedTool(tool)` | `tool-resolver.ts:74–83` | no `execute`: recheca e **lança** `Tool "x" is disabled or unavailable.` |
| Filtro final síncrono | `tool-resolver.ts:173` | `.filter(tool => useLlmToolsStore().isToolAllowed(tool))` antes do `toReversed()` |
| Retorno guardado | `tool-resolver.ts:175` | `.map(guardResolvedTool)` |
| `resolvedIds: WeakMap<Tool,string>` | `tools.ts:87` | proveniência por objeto resolvido |
| `isNameBlocked(name)` | `tools.ts:102` | qualquer registro **explicitamente desabilitado** com o nome bloqueia todas as fontes |
| `isToolAllowed(tool)` | `tools.ts:134–145` | fail-closed em colisão e em objeto capturado |
| Filtro em `activeTools` | `tools.ts:145` | `defaultActive` continua só inclusão automática; enablement A-1 preservado |
| Uso em `llm.ts` | `llm.ts:34` | `isToolAllowed: isResolvedToolAllowed` |
| Uso em `llm-service.ts` | `llm-service.ts:152,196` | `mergedTools.filter(isToolAllowed)` |

**Comparação com a Principal.** Nenhum desses símbolos existe no HEAD atual: `grep -rn "guardResolvedTool\|isResolvedToolAllowed\|isNameBlocked" airi` = 0. O gate A-1 existe, mas é aplicado **antes** da resolução e sem rechecagem em `execute`.

**Validação da correção.** É correta para a classe de falha: (a) fecha a janela temporal (rechecagem síncrona imediatamente antes do uso e no `execute`); (b) fecha a colisão de nomes. É **deliberadamente conservadora**: bloqueia ferramenta independente de mesmo nome, e reabilitação explícita continua permitida. Testes da origem: 68 linhas novas em `tool-resolver.test.ts`, 13 em `llm-service.test.ts`, 24 em `llm.test.ts`; suite isolada 99/99.

**Regressões/dependências.** Nenhuma estrutural. Ajuste de comportamento esperado: ferramentas de mesmo nome de uma desabilitada deixam de funcionar. **Não** depende de OIDC/SEC-04.

**Decisão: PORTAR** (ordem 1.1), com teste no SHA integrado e mutação.

**Por que não pode ser descartado.** Sem a rechecagem, a promessa do A-1 ("desabilitada nunca é apresentada/executada") fica dependente de timing do store, o que é uma corrida real documentada por reprodução sintética. A guarda custa uma consulta a `Map` por execução de ferramenta.

---

### 3.2 SEC-R-02 — Credencial em destino HTTP (SEC-05, correção parcial)

**Achado.** O runtime Core anexava `Authorization: Bearer <credential>` a qualquer destino configurado, inclusive `http://` remoto/LAN. Quem conseguisse alterar o endpoint (via bridge, config corrompida ou provider não curado) poderia receber a chave em texto claro.

**Correção (`e25b7d47`).** `lia/core/src/providers/runtime.ts:225–232`:

```ts
// Never attach a stored credential to cleartext traffic outside the
// loopback fixture/local-provider boundary. Keyless LAN use is unchanged.
if (credential && destination.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(destination.hostname))
  throw new ProviderError('configuration')
```

**Comparação com a Principal.** O HEAD atual **não** tem esse bloco (`grep -n "Never attach a stored credential" lia/core/src/providers/runtime.ts` = 0). O arquivo é idêntico ao de `407300b`, então o port não conflita.

**Validação.** Fecha a transmissão em claro de credencial. **Não** fecha SEC-05: HTTPS em host atacante continua permitido se o endpoint for mutado; loopback não protege contra processo local malicioso. A limitação está declarada pelo próprio autor.

**Regressões.** Serviços LAN **com chave** deixam de funcionar (intencional). HTTP sem credencial segue permitido. Nenhuma dependência de outro item.

**Decisão: PORTAR** (ordem 1.2). **Não pode ser descartado:** é a única barreira de runtime que impede a chave de sair em claro quando o destino é mutável por outro processo — exatamente a ameaça descrita em SEC-05.

---

### 3.3 SEC-R-03 — `auth.ts`: refresh concorrente, geração, logout

**Achado.** Na variante da Principal (`8b3f87c1`):

| Problema | Efeito |
|---|---|
| `logout()` aguarda a rede antes de limpar | janela em que o estado ainda autenticado sobrevive ao logout |
| `inflightRefresh` sem validação de identidade | resposta de refresh antigo pode sobrescrever login novo |
| `fetchSession` sem geração | resposta de sessão obsoleta reautentica |
| `updateCredits()` sem `try/catch` | unhandled rejection no watcher |
| logs com `errorMessageFrom(error)` | texto arbitrário do erro no log |

**Correção (`013e4fdc` + `b67929c5`).** `auth.ts:155` `inflightRefresh`; `:157` `authGeneration`; `:160–161` single-flight; `:166–190` captura de geração, descarte de refreshes e sessões obsoletos, `clearAuthState()` em falha de sessão corrente; `:195–201` limpeza condicional da tentativa; `:260` `clearAuthState()` no logout; logs de **classe fixa**, sem `errorMessageFrom`.

**Comparação com a Principal.** O HEAD está na variante base — nada disso existe. A variante da **higiene** (`4ec8f22b`) aplica `try/catch` com `errorMessageFrom`, que a auditoria rejeita como sanitizador. As duas variantes não são compatíveis entre si: a de segurança é superconjunto e melhor.

**Validação.** A correção é adequada **no escopo do store**: elimina a corrida de refresh e a reautenticação tardia; limpa antes da rede. **Não** é OIDC-OFF: tokens continuam no Renderer; `authedFetch` (`libs/auth-fetch.ts:39–72`) ainda pode chamar `clearAllAuthState()`/refresh após login substituto (risco aberto, declarado); geração é por instância e não coordena janelas; callback de login em voo após logout não é cancelado.

**Regressões.** (a) `fetchSession` em falha de rede passa a limpar estado (fail-closed) — exige validação de UX; (b) aplicar mecanicamente pode deixar import órfão de `errorMessageFrom`; (c) sem adoção de `creditsStatus`, ver SEC-R-04.

**Decisão: ADAPTAR** (ordem 1.3) — reaplicar por diff revisado sobre `8b3f87c1`, **nunca** `cherry-pick`.

---

### 3.4 SEC-R-04 — `updateCredits()`: status, validação e erros

**Correção (`b67929c5`).** `creditsStatus: 'idle' | 'loading' | 'ready' | 'auth-error' | 'error'` (`auth.ts:95`), contador de requisição, `typeof flux === 'number' && isFinite`, distinção 401/403, descarte de respostas fora de ordem, saldo anterior preservado em erro **sem** ser apresentado como atualizado, zero no logout.

**Validação.** Correta, com dois limites: (1) 401 costuma ser tratado antes por `authedFetch`, que pode zerar o store → `creditsStatus` volta a `idle` em vez de `auth-error`; (2) **exige adoção** — quem lê só `credits` mostra valor antigo/zero.

**Decisão: ADAPTAR** (ordem 1.4, mesmo commit de 1.3 se possível), incluindo os consumidores. **REJEITAR** a variante da higiene (HYG-R-02).

---

### 3.5 SEC-R-05 — STT-01: transcrição descartada em log

**Achado (STT-01, bloqueio para ensaio com pessoas reais).** `voice-input-session.ts:390–394` registra `{ trigger, gate, text }` quando o gate pós-ASR descarta o resultado; o consumidor (`stage-tamagotchi/src/renderer/pages/index.vue`, ~698–710) encaminha detalhes ao console.

**Estado no HEAD:** **presente** — `grep -n "recording-drop-after-asr"` → l. 390 e `text,` na l. 393. Nenhuma branch corrige.

**Correção proposta.** Remover `text`; manter `trigger`, `gate` e `length` (ou hash). Teste com canário.

**Decisão: PORTAR (implementar)** — ordem 1.5. Baixo risco, alto valor: é o achado de **bloqueio** mais barato de fechar.

---

### 3.6 SEC-R-06 — OIDC-OFF e limpeza de tokens (SEC-01/02/03)

**Estado:** **não implementado em nenhuma branch**. O documento de origem **propõe** o desenho; não o executa.

**Escopo mínimo proposto (reproduzido da origem):**
1. Guard de capacidade no Main do perfil Lia: negar `electronAuthStartLogin` e qualquer callback/token **antes** de abrir navegador/loopback ou trocar código.
2. Invalidar trabalhos pendentes; não emitir tokens ao Renderer.
3. Impedir inicialização/refresh/callback compartilhados no perfil.
4. Limpar os cinco campos legados `auth/v1/*` (token, refresh, ID, client ID, expiração) em todos os perfis/janelas relevantes, **sem ler nem logar valores**.
5. Desabilitar consumidores de sessão (não apenas esconder a UI).
6. **Não** fazer `isStageTamagotchi()` equivaler a Lia (cobre Electron em geral).

**Aceite (do documento de origem):** IPC forjado de cada janela sem abrir browser/servidor e sem emitir token; callback/refresh pendentes após OFF/logout; inicialização com storage legado em múltiplas janelas; restart e inspeção de storage/DOM/log com canários; captura de rede sem auth no uso normal; suite Electron + Windows no SHA candidato.

**Decisão: BLOQUEADO** (P-1 + T-07/T-08).

---

### 3.7 SEC-R-07 — SEC-04/05: scopes legados e vínculo credencial–destino

**Estado atualizado (HEAD, não o relatório antigo).**

| Ponto | Fato no HEAD | Avaliação |
|---|---|---|
| Leitura de segredo pelo Renderer | `secrets-service.ts:139–145`: `allowRendererRead(scope)` decide; sem ele, **qualquer** escopo é legível | **Aberto** se o bridge for registrado sem policy |
| Policy `canRendererReadLegacySecret` | `transport-config-service.ts` (após a l. 30): nega provedores **curados** e escopos cobertos por transporte/tombstone; **mantém** comportamento anterior para provider não curado | **Parcial** — SEC-04 residual |
| CAS de segredo | `secrets-service.ts:67–75, 108–130`: `secretRevision` + `conflict` + `adopt` com comparação **no Main** | **Melhoria do HEAD** sobre `407300b`; reduz corrida de escrita |
| Mutação de transporte | `transport-config-service.ts:85–95`: `electronLiaTransportsMutate` → `repository.mutate` | **Sem autorização de origem/CAS explícita no handler** |
| Vínculo credencial–host | `providers/runtime.ts` após SEC-R-02: **só** protocolo/loopback | **SEC-05 aberto** para HTTPS mutado |
| Launcher | controles diferentes do Stage | não generalizar |

**Decisão: BLOQUEADO** (T-07/T-08). Enquanto aberto, **L-02 não integra**.

---

### 3.8 SEC-R-08 — STT, consentimento e envio de áudio

Achados da auditoria de STT (`LIA-STT-SECURITY-AUDIT-2026-11-14.md`), todos **sem correção** em qualquer branch:

| ID | Gravidade | Fato | Arquivo:linha |
|---|---|---|---|
| STT-02 | Bloqueio | Não há consentimento informado específico para captura/envio de áudio (a escolha "Completa" não detalha destino, terceiros, retenção) | `HomeView.vue:246–264`; `home-vm.ts:83–97`; `hearing.ts:388–423` |
| STT-03 | Bloqueio | Handler STT no Main verifica sender vivo/proprietário, mas **não** papel de janela, seleção ativa ou consentimento | `transcription-service.ts:277–312`; `main/index.ts:445–465` |
| STT-04 | Bloqueio (SEC-04/05) | Endpoint pode ser reescrito e depois executado com credencial | `transport-config-service.ts:85–95`; `hearing.ts:348–353`; `provider.ts:579–618` |
| STT-05 | Alto | Logs de erro brutos de captura/hearing; regex + limite **não** são allowlist | `voice-input-session.ts:245,269,304,320,373,426`; `hearing.ts:751…946`; `lia/hearing.ts:127–159` |
| STT-06 | Alto | Desligar o mic com `flushTranscript=true` **envia** texto pendente; semântica cancelar × finalizar indefinida | `index.vue:783–808`; `transcript-buffer.ts:69–82,108–116` |
| STT-07 | Alto | Analytics de uso (provider, latência, contagem) com default `true`; não auditado integralmente | `hearing.ts:485–503`; `settings/analytics.ts:5` |
| STT-08 | Alto | Texto de voz vai a caption, chat, IndexedDB e, condicionalmente, sync | `index.vue:414–419,648–719`; `chat.ts:403–419` |

**Decisão: BLOQUEADO** para ensaio com pessoas reais. STT-01 é a única correção barata e independente → SEC-R-05.

**Nota de honestidade:** o comentário em `shared/eventa/lia-transcription.ts` dizendo que áudio "não é segredo" **não** deve ser usado como política de privacidade.

---

### 3.9 Fronteira IPC / Main / Renderer / Stage

| Fronteira | O que está provado | O que **não** está |
|---|---|---|
| Renderer → Main (segredo) | leitura negada para escopos curados; escrita com CAS; valores nunca em log | escopos legados não curados (SEC-04) |
| Renderer → Main (transcrição) | validação de formato/tamanho, sem redirect, 24 MiB / 8 MiB / 30 s, cancelamento por `WebContents` | autorização por janela/consentimento (STT-03) |
| Main → provider | HTTPS ou loopback; redirect recusado | vínculo host–credencial (SEC-05) |
| Launcher ↔ Stage | registro de instância + canal autenticado (rodada 18) | **nada em Windows** — Named pipe/DPAPI/taskkill **NÃO EXECUTADOS** |
| Stage ↔ Runtime | descoberta sem PID, parada cooperativa | teste em máquina real |

---

## 4. Logs sensíveis — inventário de sinks

| Sink | Risco | Estado |
|---|---|---|
| `voice-input-session.ts:390–394` | transcrição descartada | **aberto** → SEC-R-05 |
| `voice-input-session.ts:245,269,304,320,373,426` | erro bruto de captura | aberto (STT-05) |
| `stage-ui/src/stores/modules/hearing.ts:751,774,824,857,946` | erro bruto | aberto (STT-05) |
| `lia/hearing.ts:127–159` | regex + limite, **não** allowlist | aberto (STT-05) |
| `auth.ts` (variante base) | `errorMessageFrom` | **fechado** por SEC-R-03 |
| `auth.ts` (variante higiene) | `errorMessageFrom` | **rejeitado** (HYG-R-02) |
| Main / secrets | valores nunca logados (comentário + testes) | ok na origem |

**Regra:** "mensagem curta" não é sanitização. Só allowlist/código fixo conta.

---

## 5. Matriz de dependências e regressões

```
SEC-R-01 (independente)
SEC-R-02 (independente)
SEC-R-05 (independente)
SEC-R-03 ──> SEC-R-04 ──> consumidores do saldo
   └──────> SEC-R-06 (OIDC-OFF)  [P-1 + T-07/T-08]
SEC-R-07 ──> L-02 / UI-R-04  [BLOQUEADO]
```

| Regressão possível | Onde | Mitigação |
|---|---|---|
| Ferramenta homônima bloqueada | `tools.ts:102` | documentar + teste de reabilitação explícita |
| Serviço LAN HTTP com chave deixa de funcionar | `runtime.ts:228` | mensagem de configuração clara; HTTPS ou local |
| Logout offline derruba sessão | `auth.ts` fail-closed | validar UX; é intencional |
| Saldo some no logout | `auth.ts` clear | esperado |
| Import órfão de `errorMessageFrom` | `auth.ts` | revisão por diff, `tsc` limpo |

---

## 6. Por que as duas proteções exigidas não podem ser descartadas

A missão determina que "proteção de ferramentas desabilitadas e bloqueio de credencial por HTTP **não podem ser descartados sem justificativa técnica**". A justificativa para **manter** ambas:

1. **Gate de ferramenta (SEC-R-01).** A decisão A-1 é uma promessa de produto: "desabilitada nunca é apresentada/executada". Sem a rechecagem em `execute`, a promessa depende de ordem de eventos entre resolução assíncrona e `streamText` — uma corrida. A proteção é a única barreira **no ponto de uso**, e custa uma consulta a `WeakMap`.
2. **Bloqueio HTTP (SEC-R-02).** A credencial é o ativo mais sensível do app. A única forma de impedir que ela saia em claro é no cliente HTTP, no último instante antes do `fetch`. Não existe validação de UI que substitua isso (UI não é autorização — mesma lição de L-02).

Nenhuma das duas resolve o problema inteiro (SEC-05 continua aberto; TOOL-03 não coberto), mas remover qualquer uma **aumenta** a superfície sem ganho.

---

## 7. Critérios de aprovação de segurança (proposta)

| # | Critério | Estado |
|---|---|---|
| S-1 | SEC-R-01 portado e provado por mutação | NOT RUN |
| S-2 | SEC-R-02 portado e provado (fetch não ocorre) | NOT RUN |
| S-3 | SEC-R-03/04 portados, consumidores adotando `creditsStatus` | NOT RUN |
| S-4 | SEC-R-05 corrigido, canário ausente de log | NOT RUN |
| S-5 | SEC-R-06 OIDC-OFF demonstrado (IPC forjado, storage limpo, rede sem auth) | **BLOCKED** |
| S-6 | SEC-R-07 fechado (escopos legados + vínculo destino) | **BLOCKED** |
| S-7 | STT-02/03/06/08 resolvidos para ensaio | **BLOCKED** |
| S-8 | Suítes oficiais no SHA integrado (não em cópia isolada) | NOT RUN |
| S-9 | Nenhum segredo/transcrição em console/log/telemetria com canários | NOT RUN |

**Nenhum item é PASS nesta rodada.** A segurança **não está reconciliada como aprovada** — está reconciliada como **plano executável**.

---

## 8. Evidências citadas (origem, não reexecutadas)

| Evidência | Onde | Limite |
|---|---|---|
| 99/99 (gate de ferramenta) | `LIA-BETA-SECURITY-FIXES` §TOOL-01/02 | cópia isolada, não suíte oficial |
| 107/107 (Core, `b67929c`) | idem §SEC-04/05 e `LIA-AUTH-RECONCILIATION` | idem |
| 93/93 (transcrição 28 + adapters 65) | `LIA-STT-SECURITY-AUDIT` §Evidências | canários + socket local; sem Electron/rede real |
| 106/106 (auditoria `9f5ff431`) | `LIA-AUTH-RECONCILIATION` | idem |

**Nada disso é re-execução desta rodada.**
