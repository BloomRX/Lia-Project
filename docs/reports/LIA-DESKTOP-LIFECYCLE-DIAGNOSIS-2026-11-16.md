# Diagnóstico histórico do ciclo de vida desktop

**Data:** 16/11/2026 · **Base:** `b09848d` · **Branch:** `arena/7fa837f0-lia-project`
**Escopo:** por que o Launcher e o Runtime estão acoplados hoje, com evidência de commit —
nenhuma afirmação de regressão sem prova no histórico.

---

## 1. Método

`git log --follow`, `git log -S` (pickaxe) sobre os símbolos que materializam cada
comportamento — `taskkill`, `LIA_CREDENTIAL_OWNER_PIPE`, `resolveMainCredential`,
`before-quit`, `LIA_VAULT_FILE`, `launcher-profile` — e leitura do conteúdo do arquivo
em cada commit, não apenas da mensagem. Mensagem de commit é indício; o arquivo é prova.

---

## 2. Linha do tempo

| Data | Commit | O que mudou |
|---|---|---|
| 17/09 | `2f231c7` | Lia Core sai do Stage. **`LIA_VAULT_FILE` é declarado** como contrato de ambiente. |
| 17/09 | `72f6d25` | Primeiro Launcher + `AiriStageManager`. `taskkill /T /F` já é o caminho de parada. O índice traz a nota: *"the managed stage SHOULD follow the launcher down in a later iteration; **v1 keeps the child readable from the OS task manager**"*. |
| 17/09 | `c450fe5` | **Phase 7.1 — "launcher owns the lifecycle"**. `ShutdownCoordinator`, `before-quit` sempre preventDefault, e a mensagem registra: *"the old v1 NOTE about the stage outliving the launcher is gone — **the stage follows Lia down**"*. |
| 18/09 | `761c334` | Handoff gerenciado; corrige a mentira de posse do wrapper (`pnpm → cmd → … → electron`), mantém o `taskkill`. |
| 11/10 | `c65de97` | Portão de build antes do spawn. |
| 08/11 | `779010b` | **Canal de credenciais** (`owner-channel.ts`, 255 linhas): pipe + token, o Launcher decifra e o Stage pede. |
| 08/11 | `0aa998e` | Credenciais integradas no Main do Launcher; `credential-owner-access.ts` no Stage. |
| 08/11 | `dcd0b05` | `launcher-profile`: o perfil do Launcher sai da pasta do produto. |
| 10/11 | `038a0fe` | Escritas do cofre passam a exigir revisão (rollback sem decifrar). |
| 28/10 | `de843b9` | Contratos (`@lia/contracts`) nascem com `lifecycle`, `protocol`, `host`. **Sem consumidor até hoje.** |
| 16/11 | `8558c2c` → `b09848d` | Auditoria e decisões formais (D-01…D-08). |
| 16/11 | `b7b3899`, `a0c2e18` | **Esta rodada**: canal de controle, Runtime independente, F2, isolamento de dados. |

---

## 3. Achados

### 3.1 Fechar o Launcher encerra o Runtime — `PRODUCT REQUIREMENT GAP`, não regressão

**Evidência:** `72f6d25` (v1) **não** matava o Stage ao fechar — a nota do próprio autor diz
que o filho ficava "readable from the OS task manager". `c450fe5` removeu esse
comportamento **de propósito**, no mesmo dia, e escreveu isso na mensagem.

Portanto o acoplamento atual não é um acidente: é uma decisão de produto de 17/09,
tomada antes de existir um canal de controle ou um registro de instância que tornassem
a independência segura. A rodada 18 reverte a decisão, não uma regressão.

**Consequência que a decisão antiga não previa:** com `taskkill /T /F` como primeiro gesto
e o coordenador no `before-quit`, fechar a janela do Launcher matava a conversa em
andamento — exatamente o que D-04 agora proíbe.

### 3.2 `taskkill /T /F` como primeiro gesto — `ARCHITECTURAL DEBT` desde o primeiro dia

**Evidência:** o `taskkill` aparece em `72f6d25`, o commit que **cria** o gerenciador do
Stage. Não houve uma versão anterior com encerramento cooperativo que tenha sido
quebrada: a sequência correta nunca existiu.

O que existia era o inverso: o Stage **tinha** hooks (`emitAppBeforeQuit`, `handleAppExit`,
flush de log) e o caminho do Launcher **nunca os acionava** — ele matava a árvore.

### 3.3 `resolveMainCredential` depende do processo do Launcher — `INCOMPLETE IMPLEMENTATION`

**Evidência:** `779010b` cria `owner-channel.ts`; `0aa998e` liga o cliente no Stage
(`credential-owner-access.ts:74`). O canal é um **pipe + token passados por ambiente no
spawn**, servidos pelo Main do Launcher.

A motivação técnica é real e continua válida: o cofre é cifrado por `safeStorage`, que é
**escopado por aplicação** em algumas plataformas (Linux/libsecret, macOS/Keychain). Dois
apps Electron diferentes podem não decifrar o blob um do outro, mesmo usuário, mesma
máquina. O pipe resolvia isso fazendo **um** processo decifrar por todos.

O que ficou incompleto: **a propriedade nunca foi movida**. O dono continuou sendo o
processo que pode ir embora. Quando ele vai, o pipe cai e `resolveMainCredential` converte
a falha em `ProviderError('credentials')` (`credential-owner-access.ts:95`) — o Runtime
continua aberto e perde todos os provedores.

### 3.4 Nenhuma descoberta ou controle de Runtime — `INCOMPLETE IMPLEMENTATION`

**Evidência:** `de843b9` cria `lia/core/src/lifecycle.ts`, `protocol.ts` e `host/contracts.ts`
com 105 testes verdes e **zero importadores** em produção (`grep '"@lia/contracts"'` = 0).
O `AiriStageManager` só conhece o filho que ele mesmo criou (`holdsOwnedStage`); um Stage
que sobreviveu a um crash do Launcher é invisível para ele — é o buraco P-02 da auditoria.

### 3.5 `LIA_VAULT_FILE` ignorado pelo Stage — `INCOMPLETE IMPLEMENTATION`

**Evidência:** a variável é declarada em `2f231c7` e passada pelo Launcher desde `72f6d25`
(`stageEnvFor`), mas o Stage criava o cofre em `join(app.getPath('userData'), 'lia-secrets.json')`
sem lê-la. Funcionava **por coincidência de caminho**: `APP_USER_DATA_PATH` apontava para a
pasta do produto, onde o Launcher gravava o mesmo arquivo.

Qualquer isolamento de perfil — que é requisito de D-04/§6 — quebraria as credenciais
silenciosamente. Corrigido nesta rodada (`secrets.ts`).

### 3.6 Perfil do Stage dentro da pasta do produto — `ARCHITECTURAL DEBT`

**Evidência:** `hostStageEnv()` (`lia-host.ts`) define `APP_USER_DATA_PATH: paths.userDataDir`
desde `72f6d25`. Consequência: cache Chromium, `Local Storage`, `configs/` e `product.json`
do Stage convivem com `lia-product.json` e `lia-secrets.json` na mesma pasta.

A separação agora é: `<produto>/stage-profile` para o processo; `<produto>` permanece a
casa canônica de config, cofre e vozes. Migração **copia** `product.json` e `configs/` e
**nunca** toca no cofre.

### 3.7 `@lia/contracts` sem superfície — `ARCHITECTURAL DEBT`

**Evidência:** o pacote nasce em `de843b9`; em `8558c2c` havia **44 declarações**
(41 `import` + 3 `export … from`) em **23 arquivos** alcançando `lia/core/src` por caminho
relativo. Não é regressão de um estado bom: nunca houve `exports`, nem consumidor por nome.
Corrigido nesta rodada (42 arquivos migrados, guardas S1–S5).

---

## 4. O que esta rodada mudou (e o que ela não prova)

| Achado | Estado |
|---|---|
| 3.1 fechar ≠ encerrar | Implementado: Launcher não registra mais o Stage no coordenador; Runtime sobrevive. |
| 3.2 `taskkill` primeiro | Implementado: pedido autenticado → hooks → logs → prazo 15 s → força. |
| 3.3 credenciais | Implementado: o cofre é do Runtime; o Launcher não abre mais o pipe. |
| 3.4 descoberta | Implementado: registro + canal autenticado + adoção ao reabrir. |
| 3.5 `LIA_VAULT_FILE` | Implementado no Stage. |
| 3.6 perfil | Implementado com migração não destrutiva. |
| 3.7 superfície | Implementado com guardas. |

**Não provado:** o comportamento em Windows. Tudo o que foi executado rodou em Linux,
com processos Node reais (não mocks) — inclusive o teste de integração de dois processos.
Named pipe, DPAPI e `taskkill` **não** foram exercitados aqui; a matriz Windows está em
`BENCHMARK-C0-C8-windows.md` e continua `NÃO EXECUTADO`.

**Risco residual registrado:** em plataformas onde `safeStorage` é escopado por aplicação,
entradas antigas escritas pelo Launcher podem não ser decifráveis pelo Stage. No Windows
(DPAPI, escopo de usuário) isso não ocorre; a mitigação para os demais é o comando
`credentials.*` do canal de controle, que já existe.
