# Auditoria da branch de desenvolvimento — 14/11/2026

**Papel:** agente principal de desenvolvimento (coordenação técnica).
**Branch auditada:** `arena/01a10290-lia-project`
**HEAD auditado:** `7cb8172` (`docs(validation): enumerate preserved worktree changes`)
**Remoto:** `origin/arena/01a10290-lia-project` = `7cb8172` — sincronizado
**Base de comparação documental:** `docs/project/CURRENT-STATE.md` §0, relatórios
`LIA-*` de 12–13/11, `LIA-BETA-READINESS-2026-11-08.md` e `QUANTO-FALTA.md`.
**Natureza:** auditoria read-only. Nenhum código de produto foi alterado nesta rodada.
Nenhuma credencial foi lida, criada ou usada. Nenhum gate Windows foi executado aqui.

> Regra aplicada: **documentação não é prova**. Cada item abaixo foi conferido no código,
> nos testes ou no relatório que contém a evidência; o que não pôde ser reconferido está
> marcado com o motivo.

---

## 1. Estado real do projeto

### 1.1 Repositório

| Item | Estado verificado |
|---|---|
| Branch | `arena/01a10290-lia-project` |
| HEAD local = remoto | `7cb8172` (confirmado por `ls-remote`) |
| Upstream | configurado para `origin/arena/01a10290-lia-project` |
| Worktree | limpo, exceto `?? tools/stt-bench/RX580-GPU-FEASIBILITY.md` (md5 `de29ede227a082f880559c38e1b54360`, não rastrear) |
| Commits à frente de `main` | **199** |
| `origin/main` | `9c7ac18` — 1 commit documental à frente do ponto de ramificação (`db99c70`); **nenhum merge da branch** |
| Clone | raso (`.git/shallow`); a ancestralidade local não é demonstrável sem `fetch --unshallow` |
| CI | `DevFlow CI` verde em `7cb8172`; cobre **somente** as suítes Python de DevFlow, não `vitest`, typecheck ou build |

### 1.2 Onde está o código validado de verdade

O `CURRENT-STATE.md` fixa o último commit funcional validado em Windows: **`3ef6d11`**.
Desde então a branch acumulou **193 commits**, dos quais **153 não documentais**, com
**418 arquivos de código** alterados (`+44.431 / −1.369`). Ou seja: **o baseline funcional
comprovado está muito atrás do tip**. As validações mais recentes (PROMPT-37/39/40/43/44)
são parciais e, em vários casos, foram feitas sobre **worktrees sujos**, não sobre o commit
publicado.

### 1.3 Verificação executada nesta auditoria

| Verificação | Resultado | Comando/limite |
|---|---|---|
| `lia/core` | **PASS** — 105/105 | `node --experimental-strip-types --test test/*.test.ts` |
| `@lia/lia-app` | **PASS** — 353 passed, 2 skipped, 36 arquivos | `pnpm -F @lia/lia-app test` |
| `@lia/lia-app` typecheck | **PASS** — 0 erros | `tsc --noEmit` |
| Launcher build | **PASS** — main/preload/renderer | `electron-vite build` |
| Stage — testes direcionados (afetados pelas mudanças recentes) | **PASS** — 10/10 em 4 arquivos | `provider-config-service`, `secure-web-preferences`, `window-contract`, `ipc-channel-policy` |
| Stage — suíte completa | **NOT RUN neste ambiente** | 87 suítes falharam na *resolução* de pacotes de workspace não buildados (`@proj-airi/electron-eventa`, `i18n`, `stream-kit`, `electron-vueuse`); não é falha de código. Evidência Windows anterior: PROMPT-44, 2.557 passed / 4 skips em worktree sujo |
| Stage — typecheck (`vue-tsc`) | **NOT RUN neste ambiente** | binário ausente no install filtrado |
| Windows / runtime real | **NOT RUN** | sandbox Linux, sem display |

Os 2 skips do Launcher são ambientais (`entry-convention` sem `out/main` e um `skipIf` de
manifesto real); não são PASS.

### 1.4 Documentação × código

| Documento | O que afirma | O que o código diz |
|---|---|---|
| `CURRENT-STATE.md` §1 | `main = db99c70` | `origin/main = 9c7ac18` (1 commit doc depois) — **desatualizado** |
| `CURRENT-STATE.md` §0 | Launcher 345/323 testes em rodadas anteriores | 353 neste HEAD — histórico, não erro |
| `QUANTO-FALTA.md` | pendências de 08/11 | parcialmente obsoleto; o próprio arquivo declara que o `CURRENT-STATE` vence |
| Relatório PROMPT-37 (chat real) | conversa real com 5 turnos | **não está no repositório** (era untracked na máquina Windows) |
| OIDC | portas Main preparadas | `oidc-ipc`, `oidc-resources`, serviço de renderer e scripts existem **só no worktree Windows**, não no HEAD |
| Sandbox | `sandbox:true` em todas as janelas | confirmado: 17 usos de `webPreferences`, todos via `createStageWebPreferences()`/`LIA_MAIN_WEB_PREFERENCES`; zero `sandbox:false`, `nodeIntegration:true` ou `contextIsolation:false` em código de produção |

---

## 2. O que está concluído (com evidência no repositório)

| Área | Entrega | Evidência |
|---|---|---|
| Arquitetura | Contrato de host versionado no Core, por capacidade e sem Electron | `lia/core/src/host/contracts.ts` + `host-contract.test.ts` (7) |
| Arquitetura | Fronteiras congeladas: Core sem Electron, renderer sem Node, Main do Launcher restrito aos arquivos de host | `runtime-boundary.test.ts` |
| Decisão de runtime | Cenário C (híbrido, Electron retido), **provisório** | `LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md` |
| Seleção de IA | Autoridade única: Launcher canônico; Stage com política `decideSelectionWrite`; `ConfigView` legada também sobe `expectedPreferred` e recebe erro tipado | `selection-write-policy.ts` (Core + Stage), `ai-selection-integration.test.ts` (7), `lia-host` (policy) |
| Prontidão | `isSafeToStart()` falha fechado com seleção gerenciada sem registro/credencial | `ai-connection-service`, `lia-host.ai-interlock` |
| Segurança | IPC endurecido: 26 canais auditados, sanitizador de credenciais (8/lote, regex), nenhuma leitura de segredo no renderer | `ipc-surface.test.ts` (7), `config-update-sanitizer` (5) |
| Segurança | `sandbox:true` + `contextIsolation:true` + `nodeIntegration:false` em **todas** as janelas dos dois apps; preload como fachada de canais | `secure-web-preferences.test.ts`, `ipc-channel-policy.test.ts`, `security-baseline.test.ts` |
| AI Settings | Catálogo (Groq `ready`, OpenAI-compatible indisponível), uma conexão por provider, vault, descoberta/teste de modelo, rotação com rollback | `ai-connection-service` e testes; `AiResourcesView.vue` |
| Providers | Runtime no Main (Corte B), transporte próprio, um adapter por capability | `lia/core` 105 testes; `provider-config-service` 2 |
| Voz | Cadeia STT→Brain→Kokoro TTS validada em Windows no baseline `3ef6d11` | `CURRENT-STATE.md` §2 |
| Vault | Lock multi-processo, revisão/CAS por entrada, rollback sem decifrar chave antiga | `lia-core` + relatos de 08–10/11 |
| OIDC | Sessão, link, HTTP e sockets no Main (parte comitada) | `oidc-*.ts` no HEAD |
| Distribuição | Instalador NSIS privado já gerado; aviso de distribuição correto | `electron-builder.config.ts`, `DISTRIBUTION-NOTICE.txt` |
| CI | DevFlow em Windows + Linux verde no tip | run `43413121404` |

---

## 3. O que continua pendente

### 3.1 Funcional (produto)

1. **Rodada Windows completa sobre o tip**, em checkout limpo: `Lia.bat` → Launcher com
   sandbox → AI Settings → Stage → conversa → histórico → voz → fechamento sem órfãos.
   Nenhum commit do tip passou por isso.
2. **AI Settings — 14 dos 16 passos** do plano end-to-end: abrir a tela, cadastrar chave na
   UI, testar conexão, descobrir modelo, salvar, reabrir, consumir no Stage, conversar,
   histórico. Hoje: passos 1 e 16 PASS em rodada anterior; os demais BLOCKED/NOT RUN.
3. **Tool calling real**: `get_weather` existe e é enviado ao modelo, mas o round-trip
   (tool-call → execução → retorno → resposta → histórico) nunca foi observado no runtime.
4. **Voz/áudio na UI real** depois de todas as mudanças recentes de provider, sandbox e
   seleção (o PASS de voz é do baseline `3ef6d11`).
5. **OIDC**: decidir entre ativar (comitar os arquivos que só existem no worktree Windows e
   validar o fluxo no navegador) ou declarar explicitamente fora do escopo da beta.
6. **AF-1b**: a gravação da tela legada agora passa pela política, mas a mensagem visual e
   a recusa real pela UI continuam NOT RUN.

### 3.2 Distribuição

- Assinatura de código: **ausente** (`publish: null`, sem certificado).
- Instalação limpa, upgrade e desinstalação: **NOT RUN**.
- Canal de atualização: não existe no Launcher; o Stage tem `electron-updater` sem feed.
- Revisão de licenças para redistribuição pública: **pendente** (o notice atual bloqueia
  redistribuição explicitamente).
- Identidade de release: Launcher em `0.0.1`, Stage em `0.12.0-beta.5`.

### 3.3 Arquitetura

- Gate **ABERTO**: 4 das 7 evidências providas, 2 parciais (sem medição comparável) e o
  protótipo da finalista **NOT RUN**.
- C0–C4 (RAM/CPU/FPS/início/energia) nunca medidos de forma comparável.
- Experimento de runtime único (renderer do Stage no processo do Launcher) não iniciado.

### 3.4 Higiene e coordenação

- Evidências vivem fora do repositório (PROMPT-37; IPC OIDC) → risco de perda e de
  inconsistência entre sessões.
- `QUANTO-FALTA.md` desatualizado; `CURRENT-STATE` com hash de `main` antigo.
- O worktree Windows acumula mudanças não comitadas de OIDC/chat; qualquer edição do Arena
  nessas áreas corre risco de conflito.

---

## 4. Achados da auditoria

### A-1 — `defaultActive: false` não impede o envio de ferramentas ao modelo

O inventário anterior afirmava "ativação por ferramenta no store". No código atual:

- `built-in.ts` registra `stage_widgets`, `get_weather` e `image_journal` com
  `defaultActive: false`;
- `pages/index.vue` e `spotlight.vue` enviam `artistryToolReferences` (os três nomes) em
  **toda** mensagem;
- `chat.ts` resolve as ferramentas por `getToolsByNames(...)`, que **ignora**
  `defaultActive` (esse filtro só alimenta `activeTools`, usado por outro caminho).

Consequência: o modelo recebe ferramentas com efeitos reais (gerar imagem, abrir/alterar
janelas, consultar rede) sem que o usuário as tenha habilitado. Não é necessariamente um
defeito de UX, mas **contradiz a política de autorização documentada** e precisa de decisão
explícita antes da beta: aceitar e documentar, ou fazer o caminho de chat respeitar
`activeTools`/uma lista de referências autorizada. **Não alterado nesta rodada** (é mudança
de produto/comportamento, não de auditoria).

### A-2 — Evidência de runtime fora do repositório

O relatório PROMPT-37 (conversa real) e os arquivos de IPC/recursos OIDC existem apenas no
worktree da máquina Windows. Isso quebra a regra "repositório é a fonte de verdade" e
impede outra sessão de reproduzir ou revisar. Ação: o Codex deve comitar (ou descartar de
forma consciente, nunca apagar) antes da próxima rodada.

### A-3 — Baseline funcional distante do tip

`3ef6d11` é o último commit validado ponta a ponta. Desde então: 153 commits de código e
418 arquivos. Qualquer declaração de beta precisa de uma rodada limpa no tip.

### A-4 — Hash de `main` desatualizado no `CURRENT-STATE`

`CURRENT-STATE.md` §1 registra `db99c70`; `origin/main` está em `9c7ac18`. Correção
aplicada nesta rodada.

### A-5 — Identidade de release indefinida

Versão `0.0.1`, sem assinatura, sem feed de atualização e sem canal. Não é bloqueador de
código, mas é bloqueador de distribuição: não há como um usuário distinguir builds.

---

## 5. Bloqueadores para beta

Em ordem de impacto:

| # | Bloqueador | Por que bloqueia | Quem resolve |
|---|---|---|---|
| B1 | Nenhum E2E no tip | A beta exige o fluxo real funcionando; a última prova é de 193 commits atrás | **Codex** (Windows) |
| B2 | AI Settings sem gate funcional | Sem chave na UI não há conversa; 14/16 passos não executados | **Codex + usuário** (interação e chave) |
| B3 | Tool calling não provado | É um dos gates declarados do produto | **Codex** (Windows) |
| B4 | Distribuição sem assinatura, instalação limpa e licença revisada | Não há como entregar a terceiros legalmente ou com confiança | **Arena** prepara; **Codex** executa; decisão humana para assinatura/licença |
| B5 | Gate de arquitetura aberto | Decisão de runtime é provisória; sem C0–C4 não há como sustentar "Electron é suficiente" | **Codex** mede; **Arena** analisa |
| B6 | Evidência fora do repo / worktree sujo | Risco de perda e de conflito entre agentes | **Codex** comita; **Arena** revisa |
| B7 | OIDC indefinido | Meia implementação gera expectativa e risco; precisa entrar ou sair do escopo | **Decisão humana** + Codex |

---

## 6. Próximas prioridades

1. **P0 — Rodada Windows limpa no tip** com roteiro único: boot do Launcher (sandbox),
   AI Settings 16 passos, Stage, conversa, histórico, voz, encerramento sem órfãos.
   Registrar commit, logs, PIDs e screenshots sanitizados.
2. **P1 — Tool calling** na mesma sessão, com `get_weather` (read-only), capturando
   `tool-call`/`tool-result` e a resposta final.
3. **P2 — Distribuição**: decidir assinatura, definir versão da beta, testar instalação
   limpa/upgrade/desinstalação, fechar a revisão de licenças.
4. **P3 — OIDC**: comitar o trabalho existente e validar, ou remover do escopo da beta
   com registro explícito.
5. **P4 — C0–C4** para fechar (ou manter aberto com números) o gate de arquitetura.
6. **P5 — Higiene**: comitar evidências pendentes, atualizar `QUANTO-FALTA` ou marcá-lo
   como histórico, índice de evidências.

Não repetir: pesquisa de engines, PROMPT-39 (implementado), auditoria de AF-1/SEC-1
(resolvidas offline), contrato de host (publicado).

---

## 7. Divisão de trabalho: Arena × Codex

### 7.1 Arena (Linux, sem display, com testes automatizados)

| Tarefa | Entregável |
|---|---|
| Revisão de código e arquitetura dos commits do Codex | parecer + correções pequenas com teste |
| Suítes automatizadas e typecheck do Launcher/Core | resultado por comando, sem agregar |
| Auditorias estáticas (IPC, sandbox, fronteiras, permissões) | relatório + testes anti-regressão |
| Políticas puras (seleção, capacidades, sanitização) | código + testes unitários/integração |
| Inventário de dependências, licenças e tamanho do pacote | documento atualizado |
| Preparo de roteiros PowerShell/checklists e scripts de coleta | arquivo + instruções |
| Triagem de CI e correções multiplataforma | commits pequenos |
| Consolidação documental e índice de evidências | `docs/reports` e `CURRENT-STATE` |

### 7.2 Codex (Windows, runtime real)

| Tarefa | Entregável obrigatório |
|---|---|
| Boot `Lia.bat` + introspecção de sandbox/preload na janela real | log + `webPreferences` efetivas |
| AI Settings 16 passos, chave digitada **na UI** | resultado por passo + screenshot sanitizado |
| Abrir Stage pelo fluxo normal; avatar, janelas, áudio | evidência visual e logs |
| Conversa real, 5 turnos, reabrir histórico | transcrição sanitizada + confirmação de persistência |
| Tool calling `get_weather` | captura de `tool-call`, `tool-result`, resposta |
| Fechamento e ausência de órfãos | lista de PIDs antes/depois |
| Instalação limpa, upgrade, desinstalação | logs do instalador + PIDs |
| C0–C4 (RAM/CPU/início/FPS) | planilha/JSON por processo e árvore |
| OIDC: comitar IPC/recursos ou descartar formalmente | commit + relatório |

### 7.3 Protocolo de coordenação

1. **Um escritor por vez.** Antes de começar, cada agente confere `git status`, `HEAD` e
   upstream; se houver trabalho não comitado do outro, **para e sincroniza por commit**.
2. **Codex comita antes de o Arena editar** as áreas que ele tocou (hoje: OIDC e chat).
3. **Arena nunca faz force push, reset, clean ou stash**; usa o método de recuperação
   `fetch → read-tree → checkout-index → update-ref` quando o checkout regride.
4. **Evidência entra no repositório** (texto, logs sanitizados, resultados), nunca só na
   máquina.
5. **Credenciais**: chave só na UI/vault; nunca em chat, arquivo ou variável usada como
   atalho.
6. **Gate só fecha com execução real no tip.** Documento, teste offline ou harness não
   promovem gate.

---

## 8. Matriz de gates (estado honesto)

| Gate | Estado | Base |
|---|---|---|
| Arquitetura | **ABERTO** | 4/7 evidências providas, 2 parciais, protótipo NOT RUN |
| Migração | **N/A** | não autorizada |
| Launcher | **PARCIAL** | boot + `renderer-ready +1311 ms` em `0818305`; tip atual NOT RUN |
| AI Settings | **BLOCKED** | 14/16 passos sem execução |
| Provider | **PASS offline** | 105 testes Core + integração; runtime parcial (PROMPT-37 não comitado) |
| Tool Calling | **NOT RUN** | inventário existe; round-trip não observado |
| Histórico | **NOT RUN** | sem conversa real no tip |
| Visual | **NOT RUN** | sem display |
| Segurança | **PASS offline** | sandbox + IPC + testes; janela real NOT RUN |
| Distribuição | **NOT RUN** | sem assinatura, instalação limpa ou licença fechada |

**Conclusão:** a Lia **não está aprovada ponta a ponta** e a beta continua bloqueada.
O código está em estado avançado e testável offline; o que falta é prova de runtime no tip
e decisões de distribuição.
