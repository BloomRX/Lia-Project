# Registro formal de decisões — arquitetura do desktop

**Data:** 16/11/2026 · **Base:** `8558c2c` · **Branch:** `arena/7fa837f0-lia-project`
**Escopo:** decisões **D-01…D-08** e questões abertas **Q-01…Q-06**.
**Autoridade:** parecer técnico desta rodada. As decisões marcadas **sign-off pendente** só
passam a vincular implementação quando o dono do produto confirmar (§10).

---

## 0. Regra de classificação

| Status | O que significa aqui |
|---|---|
| **APPROVED** | Decisão técnica tomada e fundamentada; não altera comportamento de produto sem plano próprio |
| **APPROVED WITH CONDITIONS** | Decisão tomada, mas **vigente apenas com as condições listadas**; omitir uma condição é violar a decisão |
| **REJECTED** | Proposta recusada com motivo e data |
| **OPEN** | Sem decisão; nada pode ser implementado |

Toda decisão traz: **evidência**, **condições**, **consequências** e **como reverter**. Uma
decisão sem consequência registrada não é uma decisão — é uma intenção.

---

## D-01 — Adotar **D+**: Electron nos dois processos, com fronteiras fechadas

| Campo | Valor |
|---|---|
| **Status** | **APPROVED WITH CONDITIONS** — sign-off do dono pendente (§10) |
| **Substitui** | A decisão provisória "Cenário C" de 12/11 (que já retinha Electron, sem as fronteiras) |
| **ADR** | [`ADR-0001`](ADR-0001-desktop-runtime-d-plus.md) |

**Decisão.** O Launcher e o Runtime permanecem aplicações Electron **separadas**, cada uma com
seu processo, seu perfil e seu ciclo de vida. O que muda não é o framework: é o **fechamento das
fronteiras** — superfície pública do Core (D-05), ciclo de vida independente (D-04), dados e
perfis separados e um único dono de política por capacidade.

**Evidência (CÓDIGO/MEDIDO).**

- O Launcher é **2% código e 98% runtime**: `out/` = 2,28 MB, dos quais 1,77 MB é um PNG; o
  runtime Electron 43.4.1 x64 publicado é **143,2 MiB** (150.154.788 B, `api.github.com`).
  Trocar o framework do Launcher não reduz o peso do produto — reduz uma fração do runtime.
- O Stage tem **25.388 LOC** de main, **66 arquivos** que importam Electron (55 com API em
  runtime) e **15** construções de `BrowserWindow` em 15 módulos. Não é migrável sem reescrita.
- O Core **já é livre de Electron** (teste `runtime-boundary`), e `@lia/contracts` tem zero
  dependências — a separação de camadas já existe; falta o contrato de pacote.
- Tauri exigiria **sidecar Node** para manter o Core em TypeScript: sai um Chromium, entra um
  Node (e Rust). Ganho líquido menor do que o discurso sugere.

**Condições (todas obrigatórias).**

| ID | Condição | Onde é provada |
|---|---|---|
| D01-C1 | Nenhuma fase de implementação começa sem sign-off (§10) | este documento |
| D01-C2 | As invariantes I-1…I-10 do ADR são testadas, não presumidas | ADR §5 |
| D01-C3 | O gate G-4 (benchmark C0) continua **ABERTO** e pode reabrir A/B/C | §D-07 e BENCHMARK §6 |
| D01-C4 | O Stage não é reescrito, portado nem trocado de host nesta decisão | restrição da rodada |
| D01-C5 | Nenhuma dependência é removida antes de mapear consumidores | `PLAN-core-public-surface` §2 |
| D01-C6 | AIRI continua **referência**, não dependência permanente do produto | `@lia/core` não importa `@proj-airi/*` (verificado) |

**Consequências.**

- Positivas: preserva 52.069 LOC de renderer do Stage, 15 janelas, transparência, `uiohook` e
  multimonitor; mantém um único toolchain (Vue/TS); permite entregar valor (D-04, D-05) sem
  risco de plataforma.
- Negativas: o pacote continua com **dois runtimes Electron** (a menos que D-06 aprove); o
  upgrade de Electron (3 majors / 8 semanas) vira tarefa recorrente em dois apps; a percepção
  "Launcher leve" depende de medir e reduzir, não de trocar framework.
- Custo de reversão: **zero** — D+ é o estado atual mais as fronteiras; nada é descartado.

---

## D-02 — Rejeitar o runtime único (um processo Electron para Launcher e Stage)

| Campo | Valor |
|---|---|
| **Status** | **APPROVED** (rejeição firme; não requer sign-off para valer, porque mantém o comportamento atual) |
| **Data** | 16/11/2026 |

**Decisão.** Launcher e Stage **não** compartilham processo Electron. A variante "renderer do
Stage numa janela do Launcher, Stage main como módulo do host" está **rejeitada**.

**Evidência (CÓDIGO).** Ela quebra quatro invariantes que o código protege hoje:

| # | Invariante | Evidência |
|---|---|---|
| 1 | Perfil Chromium ≠ pasta de dados de produto | `lia-host.ts:378-380` **recusa** a igualdade; `launcher-profile.ts:6-9`; Stage `index.ts:97-101` |
| 2 | Sessão/permissões do Stage não valem para o Launcher | Stage `index.ts:192` (`setupPermissionHandlers(session.defaultSession, …)`) |
| 3 | Fechar o Launcher ≠ parar o Runtime | `lia-app/src/main/index.ts:241-258` |
| 4 | Isolamento de falha entre os dois mains | Stage main: 25.388 LOC com MCP, Godot, WASM, WebSocket |

**Consequências.**

- O ganho estimado (3–4 processos: GPU/utility/crashpad/main) **não inclui os renderers**, que
  são a maior parcela de memória de um app Electron. A redução total esperada é de **10–20%**
  (ESTIMATIVA), abaixo do critério de 25% proposto em 12/11.
- Qualquer pedido futuro de "runtime único" precisa **primeiro** mostrar medição que justifique
  perder os itens 1–4 — e a perda do item 3 é uma mudança de produto, não uma otimização.
- Reversão: não se aplica (nada foi feito).

---

## D-03 — Propriedade da voz: Core / Main / Stage

| Campo | Valor |
|---|---|
| **Status** | **APPROVED WITH CONDITIONS** — 6 verificações contra o código: **3 corretas**, **1 parcial**, **2 divergentes**; **4 ajustes**, sendo **2 de produto** (C e D) |
| **Requer sign-off** | Sim (§10) — é uma decisão de produto |

**Decisão registrada.** A divisão proposta pelo dono, com a redação que o código permite:

| Camada | Dono de | Não faz |
|---|---|---|
| **Core** (`@lia/core/voice/*`) | Contratos, seleção de engine, orquestração, serialização, fallback explícito, métricas sem conteúdo | Não abre dispositivo de áudio, não fala HTTP, não conhece Electron |
| **Main privilegiado** (Launcher) | Credenciais/cipher, catálogo de providers, sondagem, instalação do runtime de voz, **política** de permissões, orçamento (quando existir) | Não sintetiza, não captura áudio |
| **Stage main** | Execução da síntese (`createLiaVoiceService`), supervisão do processo de voz, **aplicação** das permissões na sessão, captura/reprodução no main | Não é dono do cipher quando gerenciado; não lê segredo por IPC de renderer |
| **Stage renderer** | UI, pipeline Web Audio, barge-in, dispositivos | Nunca recebe valor de segredo |

**Verificação contra o código (CÓDIGO).**

| Afirmação | Estado real | Ajuste |
|---|---|---|
| Core orquestra voz | ✔ `@lia/core/voice/voice-service.ts` (277 LOC), `engines/registry.ts` (175), `voice/config.ts` (139) | nenhum |
| Main (Launcher) instala e credencia | ✔ `voice-engine-service.ts`, `voice-provisioning.ts`, `secrets/vault.ts`, owner-channel | nenhum |
| Stage **sintetiza** (não o Launcher) | ✔ `stage …/services/lia/lia-voice-service.ts:122` chama `createLiaVoiceService` | **Ajuste A**: nomear o Stage main como executor, não o "Main" genérico — "Main" na proposta é ambíguo (existem dois) |
| Stage **não** acessa segredo direto | ⚠ Parcial: o Stage tem `createLiaSecretVault` próprio (`secrets-service.ts`), e `resolveMainCredential` cai no vault local quando o erro é `unreadable` (`credential-owner-access.ts:73-97`) | **Ajuste B**: definir que, em modo gerenciado, o fallback local é **somente leitura de legado** e nunca caminho de escrita (hoje já é: `change/delete` passam pelo owner) |
| Política de voz no Launcher | ✖ Hoje `voice-config-service.ts` (Stage, 195 LOC) escreve configuração de voz | **Ajuste C** (produto): decidir se a tela de voz é do Launcher ou do Stage. Recomendação: **configuração no Launcher**, aplicação no Stage. Exige mover a política, não o áudio |
| Permissões no Launcher | ✖ Hoje `setupPermissionHandlers` no Stage main | **Ajuste D**: política no Launcher; concessão na sessão do Stage. Não exige mover código de áudio |

**Condições.**

- **Ajuste A** é documental e entra junto com a SPEC.
- **Ajuste B** já é verdade para escrita; falta **teste** que impeça um caminho de escrita local em
  modo gerenciado.
- **Ajustes C e D** são decisões de produto e **não** podem ser implementados nesta rodada.
- **Nada** desta decisão toca `codex/lia-multi-provider-voice` (regra da rodada).

**Consequências.** A matriz de responsabilidades fica sem capacidade órfã. Se C e D forem
recusados, o Launcher deixa de ser "dono da voz" e a decisão de produto de 16/11 precisa ser
corrigida — não pode ficar ambígua.

---

## D-04 — Fechar o Launcher não encerra o Runtime

| Campo | Valor |
|---|---|
| **Status** | **APPROVED WITH CONDITIONS** — comportamento desejado aprovado; implementação depende de 4 condições |
| **Requer sign-off** | Sim — muda comportamento observável e o modelo de ameaça |

**Decisão.** Separar explicitamente quatro ações:

| Ação do usuário | Launcher | Runtime | Como |
|---|---|---|---|
| **Fechar** a janela do Launcher | processo **encerra** | **continua** | não envia parada; deixa `runtime.json` |
| **Minimizar** | processo continua | continua | `BrowserWindow.minimize()` |
| **Parar o Runtime** | continua | encerra graciosamente | comando `runtime.shutdown` |
| **Sair completamente** | encerra | encerra | `runtime.shutdown` + confirmação + saída |

> **Por que "fechar" encerra o processo do Launcher** e não o mantém em tray: o Launcher não tem
> tray hoje, e criar um tray só para manter um processo invisível de 143 MiB contraria o objetivo
> "Launcher leve". Quem permanece visível é o Runtime, que **já tem tray**
> (`stage-tamagotchi/src/main/tray/index.ts:243` — "Quit" chama `app.quit()`).

**Condições (bloqueantes).**

| ID | Condição | Por quê |
|---|---|---|
| **D04-B1** | **Canal de controle + descoberta** (SPEC §5) | sem ele, "Runtime sobrevive" = Runtime órfão e incontrolável |
| **D04-B2** | **Sobrevivência de credencial** (SPEC §6) | **hoje o Stage perde as chaves quando o Launcher sai**: o owner vive no processo do Launcher e o cliente mapeia a queda para `unavailable` → `ProviderError('credentials')` (`credential-owner-access.ts:73-97`; `owner-channel.ts:182-243`) |
| **D04-B3** | **Encerramento cooperativo** (D-04 + SPEC §7) | senão "fechar o Launcher" já mata por `taskkill` — o oposto do decidido |
| **D04-B4** | **Invariante do stdout** (SPEC §6.4) | o Stage escreve no stdout do pai; com o pai morto, um EPIPE não pode derrubar o Runtime |

**Consequências.**

- O usuário passa a ter dois processos independentes: fechar o Launcher **não** economiza a
  memória do Runtime. Isso é intencional (é o que o produto pediu) e precisa aparecer na UI:
  "Lia continua em execução".
- Se o Runtime reiniciar com o Launcher fechado, **as credenciais gerenciadas não voltam** até o
  Launcher abrir (limite honesto do modelo de dono único). O Runtime deve degradar para voz local
  e informar, nunca falhar em silêncio.
- O comportamento atual (fechar mata tudo) continua disponível como **opção explícita**
  ("fechar encerra a Lia"), nunca como padrão silencioso.
- Reversão: flag `LIA_RUNTIME_SURVIVES_LAUNCHER=0` restaura o comportamento atual em um restart.

---

## D-05 — Fechar a superfície pública do Core

| Campo | Valor |
|---|---|
| **Status** | **APPROVED** (técnica, sem mudança de comportamento) — execução em ondas, com condições |
| **Plano** | [`PLAN-core-public-surface.md`](PLAN-core-public-surface.md) |

**Decisão.** Todo consumo de `@lia/contracts` passa por **subpath declarado em `exports`**.
Import relativo para `lia/core/src/**` fica proibido fora do próprio pacote, com teste que falha.
`@lia/core` (airi) já cumpre isso e **não** é escopo desta decisão.

**Evidência corrigida (CÓDIGO, `8558c2c`).** A rodada anterior falou em "46 imports em 24
arquivos". O número exato — e o alvo certo — é outro:

| Medida | Valor |
|---|---|
| Linhas que mencionam `lia/core/src` (não-teste) | **46** |
| Dessas, **import statements** | **41** |
| Dessas, **`export … from`** (reexport) | **3** |
| Dessas, `import('…')` inline + comentário | **2** |
| Arquivos distintos (não-teste) | **23** — Launcher 3, Stage 20 |
| Incluindo testes | 61 imports em 39 arquivos |

**O alvo não é `@lia/core` — é `@lia/contracts`.** Os 44 statements apontam para
`lia/core/src/**` (o pacote `@lia/contracts`), **não** para `airi/packages/lia-core`. E
`@lia/contracts` hoje:

- tem `main: "src/index.ts"` e **nenhum campo `exports`**;
- **não é dependência de ninguém** (`grep '"@lia/contracts"'` em todos os `package.json` = 0);
- **não está no workspace** (`airi/pnpm-workspace.yaml` inclui `packages/**` e `apps/**`, e
  `lia/` está fora de `airi/`).

Ou seja: não há "superfície a fechar" no papel — há **ausência de pacote**, e 23 arquivos
contornam isso por caminho relativo. `@lia/core` (airi), esse sim, tem 16 subpaths e **zero**
violações. São dois problemas diferentes, e o relatório anterior os misturou.

| Domínio | Statements | Arquivos | Node-only? |
|---|---:|---:|---|
| `transports/contracts` | 8 | 8 | não (puro) |
| `providers/contracts` | 8 | 7 | não |
| `providers/index` | 6 | 4 | não |
| `transports/repository` | 5 | 5 | **sim** (`node:fs`) |
| `presence` | 5 | 3 | não |
| `credentials/owner-channel` | 3 | 3 | **sim** (`node:net`) |
| `providers/selection-write-policy` | 3 | 2 | não |
| `providers/catalog` | 2 | 1 | não |
| `transports/validation` | 2 | 2 | não |
| `providers/registry` | 1 | 1 | não |
| `providers/runtime` | 1 | 1 | não |

**Condições.**

- Nenhum arquivo é movido; o pacote ganha `exports` + build e os imports migram por onda.
- `transports/repository` e `credentials/owner-channel` são **node-only** e não podem ser
  importados pelo renderer (regra testada).
- `@lia/contracts` continua com **zero dependências** e sem `@proj-airi/*` (hoje: zero imports).
- **Onda 0 é um spike descartável**: provar que build + `file:` dependency funcionam nos dois apps
  antes de migrar um único import. Se falhar, cai-se no plano B (alias de TS) e a limitação é
  registrada — não se força.
- Rollback por onda: reverter o commit não muda comportamento em runtime.

**Consequências.** 23 arquivos mudam de import; nenhuma lógica muda. `@lia/contracts` passa a ser
um pacote consumível — pré-requisito de qualquer host alternativo futuro, sem compromisso de
migrar.

---

## D-06 — Autorizar o experimento do binário Electron compartilhado

| Campo | Valor |
|---|---|
| **Status** | **APPROVED** (experimento isolado, sem tocar produção) |
| **Plano** | [`PLAN-shared-electron-binary-experiment.md`](PLAN-shared-electron-binary-experiment.md) |

**Decisão.** Autorizado **experimentar** reutilizar o binário Electron entre Launcher e Stage,
mantendo processos, `userData`, sessões, preload, IPC e encerramento **separados**.

**Correção de premissa (importante).** "143,2 MiB × 2" é o payload **comprimido**. O instalador
NSIS contém duas cópias comprimidas e **não encolhe** só porque o disco final usa hardlink. O
ganho realista do experimento é **espaço instalado** e, possivelmente, **páginas de código
compartilhadas** — não o tamanho do instalador, a menos que se acrescente um passo de instalação
personalizado (fora do escopo).

**Condições.** Não altera a instalação de produção antes do PASS; rollback é o pacote anterior;
PASS/FAIL definidos antes da medição; se o ganho de RAM for < 5%, o experimento **falha por
mérito** e o layout atual fica.

**Consequências.** Nenhuma no produto até o PASS. Se passar, vira uma fase de empacotamento —
não uma mudança de arquitetura.

---

## D-07 — Gatilhos provisórios para reavaliar A/B/C

| Campo | Valor |
|---|---|
| **Status** | **APPROVED WITH CONDITIONS** — número aprovado como provisório; a **regra de contagem** precisa ser fixada antes da medição |
| **Protocolo** | [`BENCHMARK-C0-C8-windows.md`](BENCHMARK-C0-C8-windows.md) |

**Decisão provisória.** Reavaliar A/B/C (WinUI 3 / Tauri 2 / WebView2+.NET) se, **no cenário C0**
(Launcher sozinho, ocioso), a árvore de processos do Launcher tiver **> 350 MiB de private bytes
somados** **ou** **> 6 processos**.

**Definições que faltavam (fixadas aqui).**

- **C0** = `Lia.exe` aberto na tela inicial, **Runtime parado** (o Stage não tem auto-start,
  `airi-stage-manager.ts:22-27`), depois de 60 s de aquecimento, medido por 180 s, 5 repetições,
  mediana.
- **Árvore** = o processo raiz e todos os descendentes vivos por `ParentProcessId`, deduplicados
  por PID, **incluindo** GPU, utility e renderers.
- **Contagem de processos**: reportar **duas** contagens — (a) árvore completa; (b) árvore sem o
  `crashpad_handler` (auxiliar). O gatilho usa **(b)**, porque o crashpad é um auxiliar de
  sistema e contá-lo transforma um app Electron de uma janela em "6 processos" por construção.
  Sem essa regra, o limite de 6 dispararia em praticamente qualquer build — não por peso, mas por
  composição.
- **Memória** = soma de `PrivateMemorySize64` de cada processo da árvore. Working set é reportado
  **separadamente** e **não** serve de gatilho (soma páginas compartilhadas mais de uma vez).

**Consequências.** O gate pode disparar já na primeira medição — e isso é aceitável: ele existe
para impedir decisão sem número, não para proteger o Electron. Um disparo **abre** o protótipo
Tauri do Launcher (§9.7 do relatório), não o autoriza automaticamente.

---

## D-08 — Orçamento de recursos é funcionalidade nova

| Campo | Valor |
|---|---|
| **Status** | **APPROVED** (correção de registro) |

**Decisão.** "Orçamento" (limites de custo/recursos por sessão ou por provider) **não existe** no
código. Não é arquitetura, não é migração e **não entra** neste plano.

**Evidência.** `grep` por `budget|credits` em `lia-core/src` e `lia-app/src/main` não retorna
implementação de produto; os únicos hits são `MAX_BODY` em `transport-execution-service.ts`
(limite de payload), `shutdown-coordinator` (orçamento de **tempo** de desligamento) e
`oidc-http` (limite de corpo). Nenhum é orçamento de recursos.

**Consequências.** A matriz de responsabilidades (§7.2 do relatório) mantém a linha "orçamento"
como **capacidade futura**, marcada como tal. Qualquer trabalho de orçamento exige spec própria,
modelo de dados e decisão de produto — e **não** pode ser usado como justificativa para atrasar
D-04/D-05.

---

## 9. Quadro-resumo

| ID | Tema | Status | Requer sign-off | Bloqueia |
|---|---|---|---|---|
| D-01 | D+ (Electron nos dois processos) | APPROVED WITH CONDITIONS | **Sim** | F1+ |
| D-02 | Rejeitar runtime único | APPROVED | Não | — |
| D-03 | Propriedade da voz | APPROVED WITH CONDITIONS | **Sim** | Roteiro de voz |
| D-04 | Fechar ≠ parar | APPROVED WITH CONDITIONS | **Sim** | F1 |
| D-05 | Superfície pública do Core | APPROVED | Não | F2 |
| D-06 | Binário compartilhado | APPROVED | Não | F4 |
| D-07 | Gatilhos A/B/C | APPROVED WITH CONDITIONS | **Sim** (números) | G-4 |
| D-08 | Orçamento é funcionalidade nova | APPROVED | Não | — |

### 9.1 Estado de implementação (16/11/2026)

Esta seção registra o que **foi construído**, separado do que **foi decidido** e do que
**foi validado** — três coisas diferentes.

| Decisão | Implementação | Validação |
|---|---|---|
| D-02 | — (decisão negativa) | n/a |
| D-04 | **Sim**: registro de instância, canal autenticado, adoção ao reabrir, parada cooperativa, `taskkill` como último recurso | Linux, processos reais: 7/7 no teste de integração. **Windows: NÃO EXECUTADO** |
| D-05 | **Sim**: 9 subpaths, 42 arquivos migrados, guardas S1–S5 com prova de mutação | `grep lia/core/src` = 0; 146 testes PASS |
| D06 | Não iniciado (experimento F4) | — |
| D-01/D-03/D-07/D-08 | Não iniciados nesta rodada | — |

O sign-off de D-04 continua **PENDENTE**: a implementação existe, mas a escolha do
comportamento padrão (fechar mantém o Runtime) e o modelo de ameaça precisam da decisão
do dono. O que está implementado é reversível por `git revert` e não altera instalação de
produção.

---

## 10. Sign-off

Nenhuma decisão com "requer sign-off" está vigente para implementação até esta tabela ser
preenchida. A classificação acima é **parecer técnico**, não aprovação do dono.

| Decisão | Sign-off | Data | Observação |
|---|---|---|---|
| D-01 | **PENDENTE** | — | condiciona todo o resto |
| D-03 | **PENDENTE** | — | ajustes C e D são de produto |
| D-04 | **PENDENTE** | — | escolha de default + modelo de ameaça |
| D-07 | **PENDENTE** | — | aprovar 350 MiB / 6 processos e a regra de contagem |

Enquanto PENDENTE, o máximo permitido é **preparar** (documento, teste de contrato, protótipo
fora do produto). Implementar comportamento de produto sem sign-off viola esta rodada.

---

## 11. Questões abertas

| ID | Questão | Por que importa | Caminho sugerido |
|---|---|---|---|
| **Q-01** | `lia/core`, `lia/launcher` e `lia/stage` (299 LOC; 105 + 8 + 9 testes PASS em 16/11) **não têm consumidor** e ficam fora do workspace pnpm. O lifecycle novo deve **reusar** esse contrato ou o `airi` deve ter a sua própria máquina de estados? | Duas máquinas de estado = arquitetura paralela, proibida nesta rodada | Decidir entre (a) promover `lia/core` a pacote do workspace e consumir de verdade; (b) manter `lia/` como especificação executável e **não** duplicar a máquina de estados, só o adaptador de plataforma |
| **Q-02** | O `runtime.json` deve ser escrito pelo Runtime (fonte da verdade) ou pelo Launcher (supervisor)? | Define quem ganha a disputa de versão depois de crash | Runtime escreve; Launcher só lê e invalida (SPEC §5) |
| **Q-03** | O Runtime standalone (aberto pelo usuário, sem Launcher) é suportado no beta? | Muda o modelo de credenciais e de adoção | Recomendação: **sim**, com modo não gerenciado igual ao de hoje |
| **Q-04** | Deve existir "fechar encerra a Lia" como opção? | O comportamento atual é o oposto do decidido; a opção preserva quem depende dele | Recomendação: opção explícita, padrão = sobreviver |
| **Q-05** | Quem exibe o erro quando o Runtime morre com o Launcher fechado? | Hoje não há ninguém para avisar | Tray do Stage + `runtime.json` com `exitReason`; Launcher reconcilia na reabertura |
| **Q-06** | O canal de controle deve ser estendido ao **Core** (`lia/core/src/protocol.ts`) ou viver só no app? | Evita segundo protocolo | Estender o protocolo existente (minor 1.1.0), ver SPEC §5.3 |
