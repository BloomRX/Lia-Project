# Auditoria e redesenho da arquitetura desktop da Lia

**Data:** 16/11/2026 · **Commit de referência:** `2855180` · **Branch:** `arena/7fa837f0-lia-project`
**Natureza:** auditoria e projeto. **Nenhuma linha de código de produto foi alterada nesta rodada.**
**Relação com o documento anterior:** complementa
[`LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`](LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md)
(12/11/2026, decisão provisória = Cenário C, gate **ABERTO**). Não o substitui, não o revoga e
não declara o gate fechado. Onde os dois divergem, este documento corrige o anterior com
evidência de código e a correção está listada em §13.

---

## 0. Método, vocabulário de evidência e limites desta rodada

### 0.1 Vocabulário

Toda afirmação quantitativa deste documento carrega uma etiqueta. A etiqueta não é decorativa:
ela define o que pode ser usado como prova e o que não pode.

| Etiqueta | Significado | Pode fundamentar decisão? |
|---|---|---|
| **MEDIDO** | Executado nesta rodada, com comando reproduzível no Anexo A | Sim, para o que foi medido |
| **CÓDIGO** | Lido no repositório em `2855180`, com `arquivo:linha` | Sim |
| **DOCUMENTAL** | Fonte primária externa declarada no Anexo B | Sim, para o fato citado |
| **ESTIMATIVA** | Raciocínio sobre fatos MEDIDOS/CÓDIGO, com base declarada | Sim, como ordem de grandeza |
| **HIPÓTESE** | Afirmação ainda não verificada; exige experimento | **Não** |
| **NÃO EXECUTADO** | Não foi possível medir neste ambiente | **Não** — e não pode ser preenchido por analogia |

### 0.2 O que esta rodada conseguiu executar

| Execução | Resultado | Onde |
|---|---|---|
| Build de produção do Launcher (`electron-vite build`, alvo Electron 43.4.1) | **sucesso** | §2.2, Anexo A |
| Build de `@lia/core` (`tsc`/build do pacote) | **sucesso** | Anexo A |
| Contagens de código, dependências, canais IPC, janelas, imports | **executado** | §2 |
| Metadados oficiais do runtime Electron 43.4.1 (`api.github.com`) | **executado** | §2.7 |
| Qualquer janela Electron, RAM, CPU, GPU, FPS, boot, shutdown | **NÃO EXECUTADO** | §9.2 |

**Limite do ambiente:** o sandbox é Linux, sem `Xvfb`, sem GTK (`ldconfig` não encontra
`libgtk-3`), 2 vCPU e 3.939 MB de RAM. Electron não abre janela aqui. O Stage **não builda**
aqui (o `unplugin-live2d-sdk` baixa de `dist.ayaka.moe`, fora da allowlist de rede). Portanto
**nenhum número de memória, CPU, GPU, FPS, boot ou encerramento foi produzido nesta rodada** —
os existentes são citados com a data em que foram coletados, no Windows.

### 0.3 Por que esta rodada existe

A decisão de produto de 16/11 separa responsabilidades: **Launcher leve** (instalação/reparo,
providers/modelos/credenciais, orçamento, voz/STT/TTS/permissões, gestão do Runtime,
diagnóstico) e **Stage/Runtime** (personagem, animação, voz, multimonitor, jogos), com
**Core independente de interfaces**. A pergunta é se a arquitetura atual entrega essa
separação, e a que custo — não se um framework é moderno.

---

## 1. Resultado em uma frase

> A Lia já tem a separação certa de **processos** e a separação errada de **contratos**: o
> Launcher é leve em código (8.831 LOC, 2,28 MB de build) e pesado em runtime (um Electron
> completo, 143,2 MiB só o runtime publicado); o Stage é o oposto (25.388 LOC de main, 15
> janelas, 66 arquivos que importam Electron — 55 deles com chamada de API em runtime).
> Trocar o framework do Launcher **não** move essa agulha, porque o peso não está no código
> do Launcher; e juntar os dois em um processo
> **quebra quatro invariantes** que o código hoje protege. O caminho de menor risco é: manter
> Electron nos dois processos, **corrigir o ciclo de vida** (hoje fechar o Launcher mata o
> Runtime — o oposto do decidido), **fechar a superfície pública do Core** (44 declarações
> atravessam a fronteira do pacote), **separar perfil Chromium de dados de produto** e
> **deduplicar o binário Electron** — cada um com teste e rollback — antes de qualquer troca
> de host, que fica atrás de um gate medido no Windows (§9).

**Tradução para o pedido:** a alternativa recomendada é **D+ (Electron atual, otimizado e com
fronteiras fechadas)**. **E (runtime único) é rejeitada** por violar a decisão de produto e
quatro invariantes de código, com ganho estimado que **não** inclui a memória dos renderers
(que é a maior parcela). **A, B e C** são viáveis apenas como host do *Launcher* (nunca do
Stage) e ficam condicionadas ao gate G-4 (§9.7).

---

## 2. Estado real no código

Tudo nesta seção é **CÓDIGO** (lido em `2855180`) ou **MEDIDO** (Anexo A). Nada foi inferido de
documentação anterior.

### 2.1 Inventário dos pacotes

| Pacote | Caminho | Arquivos | LOC (sem teste) | Dependências | Papel |
|---|---|---:|---:|---|---|
| `@lia/lia-app` (Launcher) | `airi/apps/lia-app` | 73 | main **4.344** · renderer **4.487** · testes 5.965 | runtime: **2** (`@lia/core`, `vue`) | Controle |
| `@proj-airi/stage-tamagotchi` (Stage) | `airi/apps/stage-tamagotchi` | 594 (13 MB) | main **25.388** · renderer **52.069** | **110** deps + 68 dev | Runtime |
| `@lia/core` | `airi/packages/lia-core` | 36 | **6.027** | **3** (`@moeru/std`, `destr`, `yauzl`) | Regras de produto |
| `@lia/contracts` | `lia/core` | 16 | **1.944** | **0** | Contratos do protocolo |
| Contrato de host (não ligado) | `lia/launcher`, `lia/stage` | 4 | **299** | 0 | Contrato testável, **sem consumidor** |

**Correção de números anteriores:** o relatório de 12/11 citava "Launcher Main 4.088 LOC" —
hoje são **4.344** (cresceu 256 linhas). Citava "Stage Main 25.345 LOC / 74 arquivos Electron" —
hoje são **25.388 LOC** e **66 arquivos não-teste** (o 74 incluía testes). O main do Launcher
tem ainda **5.965 LOC de teste** — qualquer contagem que os some produz um número que não
descreve o processo em produção.

### 2.2 O Launcher, medido

Build de produção executado nesta rodada (`electron-vite build`, Electron 43.4.1):

| Artefato | Tamanho |
|---|---:|
| `out/main/index.js` | **220,73 kB** |
| `out/preload/index.cjs` | **2,42 kB** |
| `out/renderer/assets/index-*.js` | **260,92 kB** |
| `out/renderer/assets/index-*.css` | **23,10 kB** |
| `out/renderer/assets/LiaHeroImage-*.png` | **1.771,35 kB** |
| **Total de `out/`** | **≈ 2,28 MB** |

O build mostra a proporção real: **78% do payload do Launcher é uma única imagem PNG**
(1.771 kB de 2.278 kB). O código JavaScript inteiro — main + renderer + preload — soma
**≈ 507 kB**. Para comparação, **o runtime Electron publicado (43.4.1, x64, zip oficial) tem
143,2 MiB** (150.154.788 bytes, `api.github.com`, MEDIDO em metadados oficiais).

> **Consequência direta:** o Launcher é 98% runtime e 2% produto. Qualquer estratégia de
> "deixar o Launcher leve" que não toque no runtime é cosmética; e qualquer estratégia que
> troque o runtime precisa provar ganho **medido**, porque o código já é pequeno.

**Superfície do processo principal (CÓDIGO):**

| Fato | Evidência |
|---|---|
| 1 janela `BrowserWindow` 1320×860, `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: true`** | `src/main/index.ts`, `src/main/web-preferences.ts:21-25` |
| Preload com **uma** dependência: `require("electron")`; nenhum `node:` | `src/preload/index.ts`; build de 2,42 kB |
| **27** handlers `ipcMain.handle`, todos prefixados `lia:` | `src/main/ipc.ts` |
| Perfil Chromium próprio: `%APPDATA%\Lia\launcher-profile` (ou `%APPDATA%\@lia\lia-app` legado) | `src/main/launcher-profile.ts:6-9` |
| Dados de produto: `%APPDATA%\Lia` (`lia-product.json`, `lia-secrets.json`, `lia-voices\`) | `packages/lia-core/src/paths/product-paths.ts:71-105` |
| Instância única + saída supervisionada | `src/main/single-instance.ts`, `src/main/shutdown-coordinator.ts` |
| Nenhum tray, nenhuma janela secundária, nenhum atalho global | ausência verificada em `src/main` |

### 2.3 O Stage, medido

| Fato | Valor |
|---|---|
| Arquivos não-teste no main | **157** (25.388 LOC) |
| Arquivos que importam `from 'electron'` (não-teste) | **66** — **55** com import de valor (API em runtime), **11** apenas de tipo |
| Construções de `BrowserWindow` | **15**, em **15 módulos** de janela |
| Diretórios de família de janela | `about`, `beat-sync`, `caption`, `chat`, `dashboard`, `desktop-overlay`, `devtools`, `editor`, `inlay`, `main`, `notice`, `onboarding`, `settings`, `spotlight`, `widgets` |
| `sandbox: false` | **0 ocorrências** (correção — ver §13) |
| `createStageWebPreferences` | definido em `windows/secure-web-preferences.ts:3-10`, usado por **todas** as 15 janelas |
| Renderer | 52.069 LOC (Live2D/Pixi, VRM/Three.js, Web Audio, Vue) |
| Processo | App Electron completo (`LiaStage.exe` + runtime + `app.asar`) |
| Tray próprio | `src/main/tray.ts`, ligado em `index.ts:426` |

**Famílias de API Electron usadas no main do Stage** (contagem por arquivo que menciona o
identificador; inclui uso apenas de tipo, portanto é limite superior):

| API | Arquivos | API | Arquivos |
|---|---:|---|---:|
| `app` | 38 | `protocol` | 12 |
| `BrowserWindow` | 51 | `shell` | 9 |
| `session` | 27 | `globalShortcut` | 5 |
| `ipcMain` | 22 | `systemPreferences` | 3 |
| `screen` | 20 | `powerMonitor` | 2 |
| `webContents` | 16 | `safeStorage` | 2 |
| | | `dialog` / `Menu` / `Tray` / `Notification` / `nativeImage` | 1–2 cada |

Essa distribuição é o argumento técnico central contra reescrever o Stage em outro host:
**51 arquivos criam ou manipulam janelas e 20 dependem de geometria de tela**; transparência,
clique atravessável (`setIgnoreMouseEvents`), `alwaysOnTop`, multimonitor e `focusable: false`
são semântica de `BrowserWindow`, não de HTML.

### 2.4 O Core: independente de Electron, mas não independente de *layout*

| Fato | Evidência | Leitura |
|---|---|---|
| `@lia/core` não importa `electron` | `runtime-boundary.test.ts:85-95` | **Fronteira de runtime cumprida** |
| `@lia/contracts` tem zero dependências | `lia/core/package.json` | **Fronteira cumprida** |
| `@lia/core` expõe **16 subpaths** | `packages/lia-core/package.json` | — |
| `@lia/core` **não** expõe `providers`, `transports`, `presence`, `credentials` | mesmo arquivo | esses domínios vivem em `@lia/contracts` (ver abaixo), não em `@lia/core` |
| **44 declarações relativas** (41 `import` + 3 `export … from`) atravessam para **`lia/core/src/*`** — o pacote `@lia/contracts` | 37 no Stage (20 arquivos) + 7 no Launcher (3 arquivos) | **Fronteira de pacote violada** |
| `@lia/contracts` **não tem `exports`**, não é dependência de ninguém e não está no workspace | `lia/core/package.json`; `airi/pnpm-workspace.yaml` | **Não há pacote a consumir** — por isso o caminho relativo |
| O teste de fronteira só proíbe `electron` | `runtime-boundary.test.ts:62,91,105` | **Nada impede o import relativo** |

Consequência prática: o Stage compila contra o **source TypeScript** do Core, com caminhos como
`../../../../../../../lia/core/src/transports/contracts`. Isso significa que (a) o Core não é
consumível como pacote publicado; (b) mover diretórios quebra 23 arquivos; (c) o `dist` não é a
fonte de verdade do Stage; (d) não existe teste que impeça a proliferação. O Core é
"independente de interfaces" por convenção, não por contrato executável.

**Correção de 16/11:** a leitura de que "`@lia/core` tem superfície incompleta" estava errada.
`@lia/core` (airi) tem 16 subpaths e nenhuma violação; o problema é `@lia/contracts` (`lia/core`),
que **não tem superfície nenhuma**.

### 2.5 Ciclo de vida e credenciais, como estão hoje

| Elemento | Comportamento | Evidência |
|---|---|---|
| Spawn do Stage | sempre **processo separado**; dev: `node electron-vite dev`; pacote: `LiaStage.exe` | `airi-stage-manager.ts`, `packaged-stage.ts` |
| Ready | sinal explícito no `stdout` do filho | `airi-stage-manager.ts` |
| Stop (Windows) | **primeiro gesto é `taskkill /PID /T /F`**; depois espera até 15 s, e repete uma vez | `airi-stage-manager.ts:228-256` |
| Graceful shutdown do Stage | existe (`app.on('before-quit')` → `emitAppBeforeQuit()`), mas **nunca é acionado pelo Launcher no Windows** | `stage-tamagotchi/src/main/index.ts:732` |
| Propriedade | `holdsOwnedStage()` = só o que **este** processo spawnou | `airi-stage-manager.ts:204-206` |
| Fechar o Launcher | `window-all-closed → app.quit()` → `before-quit` → `quitFlow.onBeforeQuit()` → **para o Stage e o runtime de voz** | `lia-app/src/main/index.ts:241-258` + `shutdown-coordinator.ts:1-30` |
| Vault | Launcher é dono do cipher; Stage consome por **named pipe + token + nonce**, deadline 5 s, 128 KiB | `lia/core/src/credentials/owner-channel.ts` |
| Concorrência do vault | lock **entre processos** por named pipe `lia-vault-writer-v1`, deadline 5 s | `lia/core/src/secrets/vault-lock.ts:7-32` |
| Perfil do Stage | `app.setPath('userData', APP_USER_DATA_PATH)` → **`%APPDATA%\Lia`** | `stage-tamagotchi/src/main/index.ts:97-101` |
| Proibição do Launcher | recusa iniciar se a pasta de dados do Stage **for igual** ao perfil do Launcher | `lia-host.ts:378-380` |

Duas leituras que mudam o desenho:

1. **O fechamento do Launcher contradiz a decisão de produto.** A decisão diz que o Launcher
   pode fechar sem matar o Runtime; o código faz exatamente o contrário, de forma deliberada e
   testada ("closing Lia is a supervised teardown - stop the owned stage and the owned voice
   runtime, confirm, THEN leave").
2. **A proibição de perfil compartilhado existe para o Launcher, mas não para o Stage.** O
   Stage usa o diretório de **dados de produto** como perfil Chromium: `Cache`, `Code Cache`,
   `GPUCache`, `Local Storage`, `Session Storage`, `Crashpad`, `blob_storage` ficam ao lado de
   `lia-secrets.json` e `lia-memory.json`. Não é vazamento (o ciphertext é cifrado), mas é
   mistura de ciclo de vida: limpar cache apaga/recria diretórios do produto, e a indexação de
   antivírus varre o vault.

### 2.6 Dados: quem escreve o quê

| Arquivo (em `%APPDATA%\Lia`) | Escritor hoje | Leitor hoje | Observação |
|---|---|---|---|
| `lia-product.json` | Launcher (`updateLiaProductConfig`) e Stage | ambos | Sem lock entre processos |
| `lia-secrets.json` | Launcher (dono do cipher) | Launcher; Stage via owner | Lock entre processos **existe** |
| `lia-voices\` | Stage (`createLiaVoiceProfileStore`) | ambos | — |
| `lia-memory.json` | Stage | Stage | — |
| `launcher-profile\` | Launcher (Chromium) | Launcher | Perfil separado (correto) |
| *(raiz)* = perfil Chromium do Stage | Stage | Stage | **Mistura com dados de produto** |
| `lia-transports.json` | Launcher | Launcher | Referências de credencial |

### 2.7 Empacotamento: onde nasce o segundo runtime

`electron-builder.config.ts` do Launcher copia `../stage-tamagotchi/dist/lia-windows/win-unpacked`
inteiro para `resources/stage`. Esse diretório contém `LiaStage.exe`, o runtime Electron
completo, `icudtl.dat`, `LICENSES.chromium.html`, `resources/app.asar` e `version`
(`scripts/package-windows.mjs:72-88`). O Launcher recebe **outro** runtime Electron com a
**mesma** versão, verificada em três lugares:

1. catálogo do workspace (`electron: ^43.4.1`);
2. `electron-builder.config.ts` → `electronVersion: '43.4.1'`;
3. `scripts/package-windows.mjs` → `ELECTRON_VERSION = '43.4.1'`, comparado com
   `node_modules/electron/package.json` e com o campo `version` do Stage empacotado.

**MEDIDO (metadado oficial):** `electron-v43.4.1-win32-x64.zip` = **150.154.788 bytes
(143,2 MiB)**. Dois runtimes ⇒ **286,4 MiB de payload comprimido** antes do código dos apps.
O tamanho instalado **não foi medido** (não há artefato NSIS neste checkout) — é **NÃO
EXECUTADO**, e o método está em §9.4.

### 2.8 Superfície de integração: o que o Launcher sabe do Stage

| Capacidade | Existe? | Evidência |
|---|---|---|
| Iniciar o Stage | sim | `lia:stage:start` (`ipc.ts`) |
| Parar o Stage que ele mesmo iniciou | sim | `lia:stage:stop` |
| Reiniciar | **não** como operação própria | ausência de canal; seria stop+start |
| Ler estado | sim | `lia:stage:state` |
| **Descobrir** um Stage já em execução | **não** | `holdsOwnedStage()` só conhece o próprio filho |
| Enviar comando a um Stage em execução | **não** | não há canal de controle; só o pipe de credenciais |
| Saber se o Stage morreu sozinho | só pelo evento de `exit` do filho | `airi-stage-manager.ts` |

Esse é o buraco que impede a decisão de produto de virar comportamento: sem descoberta e sem
canal de controle, "fechar o Launcher sem matar o Runtime" produziria um Runtime **órfão e
incontrolável**, que o usuário só encerraria pelo Gerenciador de Tarefas.

### 2.9 Ambiguidade de responsabilidade que o código não resolve

A decisão de produto lista "voz/STT/TTS/permissões" no Launcher e "voz" no Stage. O código
hoje tem:

| Capacidade de voz | Onde está |
|---|---|
| Instalação/provisionamento do runtime Kokoro | **Launcher** (`voice-engine-service.ts`, `voice-provisioning.ts`) |
| Configuração de voz e STT (`voice-config-service.ts`) | **Stage** |
| Permissões de captura (`setupPermissionHandlers(session.defaultSession)`) | **Stage** (`index.ts:192`) |
| Captura/reprodução, barge-in, dispositivos | **Stage** (renderer + main) |
| Engine de síntese | processo próprio `Kokoro` |

Ou seja: hoje o Launcher **instala** a voz e o Stage **possui** a voz. A decisão de produto não
diz qual dos dois é dono da **política** (permissões, seleção de dispositivo, limites). Isso não
é um detalhe de redação: define se o Launcher precisa de microfone, se o Stage precisa de
`systemPreferences`, e onde o usuário configura o quê. Vai para §12 como decisão **D-03**.

---

## 3. Diagrama atual

```
┌──────────────────────────────── Windows 11 (usuário único) ────────────────────────────────┐
│                                                                                            │
│  Lia.exe  ── Electron 43.4.1 #1 ────────────────────────────────────────────────────────┐  │
│  │ main (Node)  4.344 LOC · 27 canais IPC · dono do cipher                              │  │
│  │   ├─ @lia/core bundlado (catálogo, paths, config, vault, voz, seleção)               │  │
│  │   ├─ airi-stage-manager  ── spawn ─────────────────────────────┐                     │  │
│  │   └─ credential owner: \\.\pipe\… + token + nonce (5 s, 128 KiB)│                    │  │
│  │ renderer (Vue) 1 janela · 5 telas · 260,92 kB                    │                    │  │
│  │ GPU · utility · crashpad                                         │                    │  │
│  └──────────────────────────────────────────────────────────────────┼────────────────────┘  │
│                                                                     │ env: APP_USER_DATA_PATH│
│                                                                     │      + pipe/token      │
│  LiaStage.exe ── Electron 43.4.1 #2 (runtime COMPLETO, 143,2 MiB) ◄──┘                     │
│  │ main (Node)  25.388 LOC · 66 arq. com Electron · 15 janelas · tray                     │
│  │ renderer 52.069 LOC: Live2D/Pixi · VRM/Three · Web Audio                                │
│  │ GPU · utility · N renderers                                                             │
│  └──────────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                            │
│  Kokoro / voice server (processo próprio)   Godot (opcional)   MCP stdio servers            │
│                                                                                            │
│  %APPDATA%\Lia\                                                                            │
│    lia-product.json   lia-secrets.json (lock por pipe)   lia-voices\   lia-memory.json      │
│    Cache\  Code Cache\  GPUCache\  Local Storage\  …   ← perfil Chromium do STAGE           │
│    launcher-profile\                                    ← perfil Chromium do LAUNCHER        │
└────────────────────────────────────────────────────────────────────────────────────────────┘

Fluxo de controle:  renderer ──IPC lia:*──► main ──spawn/taskkill──► Stage
Fluxo de segredo:   Stage ──pipe+token──► main(Launcher) ──cipher──► lia-secrets.json
Fluxo de saída:     fechar a janela do Launcher ──► app.quit() ──► PARA O STAGE
```

---

## 4. Problemas e riscos encontrados

Severidade = impacto no produto **hoje**, não esforço de correção.

| ID | Problema | Evidência | Sev. |
|---|---|---|---|
| **P-01** | **Fechar o Launcher mata o Runtime.** O comportamento implementado é o oposto da decisão de produto. | `lia-app/src/main/index.ts:241-258`; `shutdown-coordinator.ts:1-30` | **Alta** |
| **P-02** | **Runtime órfão é incontrolável.** Não há descoberta nem canal de controle; `holdsOwnedStage()` só reconhece o próprio filho. Fechar o Launcher hoje é tudo-ou-nada. | `airi-stage-manager.ts:204-206` | **Alta** |
| **P-03** | **Encerramento não é gracioso no Windows.** O primeiro gesto é `taskkill /T /F`; o `before-quit` do Stage existe e nunca é chamado. Memória/voz em voo são perdidas; o file logger não é fechado. | `airi-stage-manager.ts:228-256`; `stage-tamagotchi/src/main/index.ts:732` | **Média-Alta** |
| **P-04** | **Dois runtimes Electron idênticos no pacote.** 143,2 MiB × 2 de payload comprimido, duas árvores de processo, dois GPU/utility, dois crashpad. | `electron-builder.config.ts` (`extraResources`); `package-windows.mjs`; §2.7 | **Média-Alta** |
| **P-05** | **A fronteira do Core não é executável.** 44 declarações relativas em 23 arquivos atravessam `lia/core/src` (`@lia/contracts`), que não tem `exports` e não é dependência de ninguém. | §2.4 | **Alta** |
| **P-06** | **Perfil Chromium do Stage = pasta de dados de produto.** Cache/IndexedDB/LocalStorage ao lado de `lia-secrets.json`; a proibição de mistura vale só para o Launcher. | `stage-tamagotchi/src/main/index.ts:97-101`; `lia-host.ts:378-380` | **Média** |
| **P-07** | **Existem dois donos possíveis do vault.** Gerenciado: Stage escreve via owner (só `apiKey`); não gerenciado: Stage escreve direto no mesmo arquivo. O lock impede corrupção, mas a política de revisão é por processo. | `credential-owner-access.ts:31-78`; `vault-lock.ts` | **Média** (residual) |
| **P-08** | **Electron 43.4.1 está na borda do suporte.** 3 majors suportadas, cadência de 8 semanas; a 46 empurra a 43 para fora. A versão está fixada em 3 lugares. | §2.7 | **Média** |
| **P-09** | **"Voz" tem dois donos na decisão de produto** e três no código (Launcher instala, Stage possui, Kokoro sintetiza). Sem decisão, a arquitetura-alvo não fecha. | §2.9 | **Alta** (bloqueia desenho) |
| **P-10** | **O contrato de host existe e não é usado.** `lia/launcher` + `lia/stage` (299 LOC, 4 arquivos) têm testes e **nenhum consumidor** no produto. | busca em `airi/apps` = 0 imports | **Baixa-Média** |
| **P-11** | **"Orçamento" não existe no código.** É responsabilidade atribuída ao Launcher sem implementação, modelo de dados ou contrato. | busca por `budget`/`credits` em `lia-core` e `lia-app` | **Média** (produto) |
| **P-12** | **Não existe linha de base do Launcher sozinho.** Toda a discussão "Launcher leve" é feita sem o número que a sustenta. | §9.2 | **Alta** (qualidade da decisão) |
| **P-13** | **1,77 MB de PNG no renderer** para uma imagem de herói; 78% do payload do Launcher. | §2.2 | **Baixa** |
| **P-14** | **O `@lia/core` é bundlado nos dois apps** (220,73 kB no main do Launcher; no Stage, parte dos 25.388 LOC de main). Duplicação de artefato, não de fonte — a fonte é uma só. | build do Launcher; imports do Stage | **Baixa** |

### 4.1 O que **não** é problema (verificado, para não virar lenda)

| Afirmação comum | Verificação |
|---|---|
| "As janelas do Stage rodam com `sandbox: false`" | **Falso hoje.** 0 ocorrências de `sandbox: false`; todas as 15 janelas usam `createStageWebPreferences` com `sandbox: true`. |
| "O vault pode corromper com dois processos escrevendo" | **Mitigado.** Lock cross-process por named pipe (`lia-vault-writer-v1`), deadline 5 s. |
| "O renderer do Launcher tem acesso a Node/Electron" | **Falso.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload só com `electron`. |
| "O Stage exige AIRI para funcionar" | **Falso no empacotamento.** O Stage é empacotado como app próprio; o Launcher o inicia como filho. |
| "O Launcher carrega o código do Stage" | **Falso.** O Launcher só copia o build empacotado para `resources/stage`. |

---

## 5. Alternativas

**Fato que enquadra a comparação:** o Stage **não é migrável** para nenhuma das alternativas
sem reescrita integral (§2.3). Portanto A, B, C e E são alternativas **apenas para o Launcher**
(ou para a relação entre os dois processos). Nenhuma delas muda o custo do Stage.

### 5.1 A — WinUI 3 / Windows App SDK (nativo)

| Dimensão | Avaliação |
|---|---|
| Reuso do renderer Vue | **Nenhum**: 5 telas (4.487 LOC) reescritas em XAML |
| Reuso do Core | Só com **sidecar Node** (o Core é TypeScript) — mantém um runtime Node |
| Main do Launcher | 4.344 LOC reescritos em C# (ou expostos pelo sidecar) |
| Ganho | Remove o Chromium do Launcher; mantém WebView2 fora, mas exige .NET/Windows App SDK |
| Custo novo | 2 stacks de UI (XAML + Vue), 2 toolchains, MSIX/unpackaged, assinatura |
| Licença | MIT (Windows App SDK) |
| Efeito no Stage | **Nenhum** |
| Veredito | **Descartada** para este ciclo: reescreve 100% do Launcher e não reduz o pacote (o Stage continua com Electron). |

### 5.2 B — Tauri 2

| Dimensão | Avaliação |
|---|---|
| Reuso do renderer Vue | **Alto**, mas todo `window.lia.*` (preload, 52 LOC) vira `invoke` do Tauri; 27 canais reescritos |
| Reuso do Core | Só com **sidecar Node** — e aí o Launcher passa a ter **dois** processos (Rust + Node) |
| Main do Launcher | 4.344 LOC: a maior parte é lógica de produto, não UI → migra para Rust **ou** fica no sidecar |
| Ganho | Elimina o runtime Electron do **Launcher** (~143 MiB no disco, 1 GPU process) |
| Custo | Rust + WebView2 (pré-instalado no Win11), novo updater/instalador, novo modelo IPC, `safeStorage`→keyring |
| Licença | MIT/Apache-2.0 |
| Efeito no Stage | **Nenhum** |
| Veredito | **Não autorizada agora.** É a alternativa mais defensável **se** o gate G-4 medir um Launcher caro; hoje não há número que justifique. |

**Ponto honesto:** o ganho do Tauri no Launcher é menor do que parece, porque o Core é
TypeScript. Sem reescrever o Core (proibido: arquitetura paralela), o Tauri precisa de um
sidecar Node — ou seja, **sai um Chromium e entra um Node**, além do Rust. O ganho líquido é
1 processo de GPU + disco, não "um runtime a menos" no sentido forte.

### 5.3 C — WebView2 + .NET

| Dimensão | Avaliação |
|---|---|
| Reuso do renderer Vue | Possível servir o mesmo bundle; o bridge é C# (`WebView2.CoreWebView2`) |
| Reuso do Core | Só com sidecar Node (mesmo problema de B) |
| Ganho | Sem Chromium empacotado; WebView2 vem com o Windows |
| Custo | .NET + MSIX/unpackaged, reescrita do main, novo updater, dependência do runtime WebView2 |
| Modelo de processos (DOCUMENTAL) | 1 browser + N renderers + GPU + áudio **por user-data folder**; `CoreWebView2.ProcessFailed`; múltiplos environments no mesmo folder com configurações distintas falham |
| Efeito no Stage | **Nenhum** |
| Veredito | **Descartada.** Mesmo custo de B com menos reuso (o bridge não é Vue) e uma dependência de sistema a mais. |

### 5.4 D — Electron atual, otimizado (D+)

| Dimensão | Avaliação |
|---|---|
| Reuso | **100%** do código |
| Ganho | Nenhum por si; o ganho vem das correções P-01…P-06 |
| Custo | Zero de plataforma |
| Efeito no Stage | Nenhum (preserva 15 janelas, transparência, `uiohook`, multimonitor) |
| Veredito | **Recomendada** como alvo deste ciclo, com as correções e o gate |

### 5.5 E — "Outra": duas variantes, dois vereditos

| Variante | O que é | Veredito |
|---|---|---|
| **E1 — binário compartilhado, dois processos** | Um único conjunto de DLLs/`electron.exe` no disco; o Stage carrega de `resources\stage` por hardlink/cópia única; processos continuam separados | **Recomendada para experimento** (§9.5). Preserva todas as invariantes; ganho de disco é mensurável; ganho de RAM é **hipótese** (compartilhamento de páginas de código) |
| **E2 — runtime único de verdade (um processo main com as janelas do Stage)** | Stage main como módulo do Launcher; janelas do Stage criadas pelo processo do Launcher | **Rejeitada** (§6) |

### 5.6 Matriz comparativa

| Critério | A WinUI 3 | B Tauri 2 | C WebView2/.NET | **D Electron** | E1 binário | E2 processo único |
|---|---|---|---|---|---|---|
| Reuso do renderer Vue | ✗ | ◐ | ◐ | ● | ● | ● |
| Reuso do Core sem sidecar | ✗ | ✗ | ✗ | ● | ● | ● |
| Reescreve o main do Launcher | 4.344 LOC | 4.344 LOC | 4.344 LOC | 0 | 0 | 0 |
| Remove Chromium do Launcher | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Remove 1 runtime do **pacote** | ✗ | ✗ | ✗ | ✗ | ✓ (disco) | ✓ (disco+3 proc.) |
| Preserva ciclo de vida (fechar ≠ matar) | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| Preserva isolamento de falha | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| Preserva perfil/sessão separados | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| Nova toolchain | C#/XAML | Rust | C#/.NET | — | — | — |
| Dependência de sistema | Windows App SDK | WebView2 | WebView2 + .NET | nenhuma | nenhuma | nenhuma |
| Custo de migração | alto | alto | alto | **zero** | **baixo** | médio-alto |
| Efeito no Stage | nenhum | nenhum | nenhum | nenhum | nenhum | **quebra 4 invariantes** |

● reuso integral · ◐ reuso parcial · ✗ sem reuso

---

## 6. Runtime único: viabilidade e segurança

Pergunta do dono: *"é viável e seguro colocar o renderer do Stage no processo do Launcher?"*
Resposta curta: **tecnicamente sim, na prática não.** Abaixo, o porquê com evidência.

### 6.1 O que sobrevive

Todas as 15 janelas do Stage são `BrowserWindow` com `webPreferences` de
`createStageWebPreferences` e preload do Stage. Se o processo que as cria for o do Launcher,
**a API disponível é a mesma** — transparência, `setIgnoreMouseEvents`, `alwaysOnTop`, `screen`,
`globalShortcut` continuam existindo. Não há perda de API. O preload continua isolado por janela.

### 6.2 O que quebra (evidência, não opinião)

| # | Invariante atual | O que acontece em processo único | Evidência |
|---|---|---|---|
| 1 | **Perfil Chromium separado do produto** | `app.setPath('userData')` é **único por processo**. O Launcher usa `%APPDATA%\Lia\launcher-profile`; o Stage usa `%APPDATA%\Lia`. Um dos dois perde. O código **recusa explicitamente** essa igualdade. | `lia-host.ts:378-380`; `launcher-profile.ts`; `stage …/index.ts:97-101` |
| 2 | **`session.defaultSession` com permissões do Stage** | O Stage instala handlers de permissão na sessão default; em processo único eles passam a valer **também** para a janela do Launcher. | `stage …/index.ts:192` |
| 3 | **Fechar o Launcher ≠ parar o Runtime** | `window-all-closed → app.quit()` encerraria o processo que hospeda o Stage. Em processo único, a decisão de produto é **estruturalmente impossível**. | `lia-app/src/main/index.ts:241-243` |
| 4 | **Isolamento de falha** | Hoje um crash de OOM no main do Stage (que roda WebSocket, MCP, Godot, DuckDB-wasm, 25.388 LOC) não derruba o Launcher. Em processo único, derruba. Renderers continuariam isolados; o **main** não. | arquitetura do Stage (§2.3) |

Ainda: dois `app.whenReady()`, dois `second-instance`, um `setAppUserModelId` por processo
(hoje `ai.lia.app` no Stage e `ai.lia.launcher` no pacote), e um único dono de tray. Nada disso
é impossível de resolver — mas cada item é uma alteração de comportamento observável.

### 6.3 O ganho real

| Componente | Processo único remove? |
|---|---|
| Renderers do Stage (a maior parcela de memória de um app Electron) | **Não** — continuam existindo, um por janela |
| GPU process do Stage | Sim (compartilha o do Launcher) |
| Utility/network do Stage | Sim |
| Main do Stage | Sim (vira código no main do Launcher) |
| Crashpad do Stage | Sim |
| Uma cópia das DLLs no disco | Sim (mas E1 resolve isso sem juntar processos) |

**ESTIMATIVA:** o ganho é de **3 a 4 processos** e do **main** do Stage — não dos renderers.
O documento anterior propôs como critério "redução ≥ 25% do custo do Stage no repouso". Com 15
janelas (mesmo que a maioria oculta) e um app que carrega WASM e áudio, é plausível que os
renderers dominem a conta e os 25% **não** sejam atingidos. Isso é **HIPÓTESE** e o experimento
de §9.6 é desenhado para falsificá-la, antes de qualquer promessa.

### 6.4 Veredito

**E2 (processo único): rejeitada.**
Motivos, em ordem: (1) contraria a decisão de produto de forma irreversível — não é uma
otimização, é uma mudança de produto; (2) quebra 4 invariantes que o código hoje protege
deliberadamente; (3) o ganho não inclui a maior parcela de memória; (4) junta dois domínios de
falha que hoje são independentes.

**E1 (binário compartilhado, processos separados): aprovada como experimento**, porque entrega
parte do ganho (disco, possivelmente páginas de código) **sem** tocar em nenhuma invariante.

---

## 7. Arquitetura-alvo

### 7.1 Princípios

1. **Um Core, uma fonte.** Regras de produto em `@lia/core`, consumidas por **subpath público**.
2. **Dois processos, dois donos.** Controle e Runtime são processos distintos, com ciclos de
   vida independentes e contrato explícito entre eles.
3. **Nenhuma capacidade duplicada.** Cada capacidade tem **um** dono de política e **um** dono
   de execução, declarados (§7.2).
4. **Fechar não é matar.** Encerrar o Launcher é uma escolha do usuário; encerrar o Runtime é
   outra.
5. **Falha isolada.** O Runtime pode cair sem levar o Controle; o Controle pode fechar sem
   levar o Runtime.
6. **Nada de arquitetura paralela.** O Stage não é reescrito; o Core não é portado; a UI é Vue
   nos dois lados.

### 7.2 Matriz de responsabilidades (política × execução)

| Capacidade | Política (quem decide) | Execução (quem faz) | Hoje |
|---|---|---|---|
| Providers e modelos | **Launcher** | Launcher (catálogo) / Stage (executa transporte) | parcialmente dividido |
| Credenciais | **Launcher** (dono do cipher) | Launcher escreve; Stage consome por canal | correto |
| Orçamento/limites | **Launcher** | Launcher | **não existe** (P-11) |
| Instalação/reparo do Runtime | **Launcher** | Launcher | correto |
| Voz: instalação do engine | **Launcher** | Launcher | correto |
| Voz: configuração e seleção | **Launcher** (política) | Stage (aplica no áudio) | dividido (P-09) |
| Voz: captura/reprodução/barge-in | **Stage** | Stage | correto |
| Permissões de SO (mic/câmera/tela) | **Launcher** (política) | Stage (concede na sessão) | invertido (P-09) |
| Personagem, animação, Live2D/VRM | **Stage** | Stage | correto |
| Multimonitor/DPI/overlay | **Stage** | Stage | correto |
| Jogos (Godot) | **Stage** | Stage | correto |
| Memória | **Stage** | Stage | correto |
| Diagnóstico | **Launcher** (visão) | ambos (coletam) | parcial |
| Ciclo de vida do Runtime | **Launcher** | Launcher + Runtime (contrato) | **contraditório** (P-01) |

### 7.3 Invariantes da arquitetura-alvo

| ID | Invariante | Como é provado |
|---|---|---|
| **I-1** | `@lia/core` não importa `electron` | teste existente |
| **I-2** | Nenhum código fora de `airi/packages/lia-core` importa `lia/core/src` por caminho relativo | **teste novo** (§10, F1) |
| **I-3** | Todo consumo do Core usa subpath declarado em `exports` | **teste novo** |
| **I-4** | O renderer não tem Node nem Electron | teste existente |
| **I-5** | A superfície Electron do main do Launcher está limitada aos arquivos de host | teste existente |
| **I-6** | Fechar o Launcher não encerra o Runtime; encerrar o Runtime não encerra o Launcher | **teste novo** de ciclo de vida |
| **I-7** | Um Runtime só é "adotado" após prova de identidade (HMAC) e de versão | **teste novo** |
| **I-8** | Perfil Chromium e dados de produto são diretórios distintos nos dois processos | **teste novo** |
| **I-9** | O vault tem um único dono de cipher por sessão gerenciada | teste existente + contrato |
| **I-10** | Nenhuma capacidade da §7.2 tem dois donos de política | revisão + matriz de canais |

### 7.4 Ciclo de vida-alvo

```
                 ┌──────────── Launcher (Controle) ────────────┐
                 │ aberto ──fechar janela──► encerrado          │
                 │    ▲                          │              │
                 │    └── reabrir (adoção) ──────┘              │
                 └───────┬──────────────────────────▲───────────┘
      spawn + token      │                          │ HMAC + status/stop/restart
                         ▼                          │
                 ┌──────────── Runtime (Stage) ────────────────┐
                 │ parado ─► iniciando ─► ativo ─► parando ─► parado
                 │                          └──► falhou ──► parado
                 └──────────────────────────────────────────────┘
```

Regras:

1. Fechar a janela do Launcher **não** envia parada ao Runtime. O Launcher encerra e deixa um
   registro (`runtime.json`) com PID, caminho do executável, hora de início, versão do Runtime
   e endpoint de controle.
2. Reabrir o Launcher **adota** o Runtime se: o PID existe, o caminho do executável confere, a
   hora de início confere (proteção contra reuso de PID) e o Runtime responde ao desafio HMAC.
3. "Parar" e "reiniciar" usam o canal de controle; `taskkill /T /F` passa a ser **fallback**.
4. Se o registro estiver obsoleto, o Launcher o descarta e oferece iniciar.
5. O usuário pode escolher "fechar o Launcher encerra a Lia" (comportamento atual) como opção
   explícita — mas não como padrão silencioso.

### 7.5 Canal de Controle do Runtime (CCR)

| Propriedade | Valor proposto |
|---|---|
| Transporte | named pipe do **Runtime** (o Stage é o servidor), namespace `lia-runtime-control-v1` |
| Autenticação | token de 32 bytes gerado pelo Launcher no spawn, entregue por env; cada comando leva HMAC-SHA256(token, nonce‖comando) — **o token nunca trafega** |
| Operações | `status`, `shutdown` (gracioso), `restart-request`, `ping` |
| Limites | mensagem ≤ 8 KiB, deadline 5 s, `shutdown` espera até 15 s antes do `taskkill` |
| Registro | `runtime.json` escrito pelo **Runtime** ao iniciar e apagado ao sair |
| Requisito de segurança | DACL do pipe restrita ao usuário (a **verificar no Windows**: Node não expõe DACL; se não for possível, o HMAC cobre a autenticação e o risco residual é DoS local) |

Esse canal resolve P-01, P-02 e P-03 com **um** mecanismo, e é o que torna "reiniciar o
Runtime" uma operação e não um `stop` seguido de `start` cego.

### 7.6 Separação de dados-alvo

```
%APPDATA%\Lia\                     ← dados de produto (sem cache de navegador)
  lia-product.json
  lia-secrets.json
  lia-voices\
  lia-memory.json
  lia-transports.json
  runtime.json                     ← NOVO: registro do Runtime
  profiles\
    launcher\                      ← perfil Chromium do Launcher
    stage\                         ← perfil Chromium do Stage (NOVO)
```

Migração: mover apenas os diretórios conhecidos de Chromium (`Cache`, `Code Cache`,
`GPUCache`, `Local Storage`, `Session Storage`, `IndexedDB`, `blob_storage`, `Crashpad`,
`Network`) para `profiles\stage\`; nada de dados de produto se move. Se a movimentação falhar,
o Stage inicia com perfil novo e avisa — sem perder dados de produto.

---

## 8. Diagrama-alvo

```
┌──────────────────────────────── Windows 11 (usuário único) ────────────────────────────────┐
│                                                                                            │
│  Lia.exe ── Controle (Electron 43.4.1, 1 processo) ────────────────────────────────────┐   │
│  │ main 4.344 LOC · 27 canais · dono do cipher · supervisor                             │   │
│  │   ├─ @lia/core  (subpaths públicos: providers, transports, presence, credentials…)   │   │
│  │   ├─ registry/runtime.json  ── adoção autenticada ──────────────┐                    │   │
│  │   └─ start/stop/restart  ── spawn + token ─────────────┐        │                    │   │
│  │ renderer Vue · 1 janela · 5 telas                       │        │                    │   │
│  └─────────────────────────────────────────────────────────┼────────┼────────────────────┘   │
│                                                            │        │                        │
│  LiaStage.exe ── Runtime (Electron 43.4.1, 1 processo) ◄────┘        │                        │
│  │ main 25.388 LOC · 15 janelas · tray · personagem/áudio            │                        │
│  │   └─ servidor CCR (pipe) ◄──────── HMAC(nonce, comando) ──────────┘                        │
│  │ renderer 52.069 LOC: Live2D/Pixi · VRM/Three · Web Audio                                   │
│  └───────────────────────────────────────────────────────────────────────────────────────────┘│
│                                                                                            │
│  Kokoro / voice server      Godot (opcional)      MCP stdio servers                        │
│                                                                                            │
│  Runtime compartilhado: UMA cópia das DLLs/electron.exe; dois processos, dois perfis.        │
│                                                                                            │
│  %APPDATA%\Lia\  lia-product.json · lia-secrets.json · lia-voices\ · lia-memory.json        │
│                  runtime.json · profiles\launcher\ · profiles\stage\                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘

Controle : Launcher ──CCR (pipe, HMAC)──► Runtime
Ciclo    : fechar o Launcher ──► Launcher sai ──► Runtime continua ──► tray do Stage permanece
Reabrir  : Launcher lê runtime.json ──► desafio HMAC ──► adota (status/stop/restart)
```

---

## 9. Estimativas e benchmarks

### 9.1 O que está medido (não é estimativa)

| Medida | Valor | Data | Fonte |
|---|---|---:|---|
| Build do Launcher — main | 220,73 kB | 16/11/2026 | Anexo A |
| Build do Launcher — preload | 2,42 kB | 16/11/2026 | Anexo A |
| Build do Launcher — renderer JS / CSS / PNG | 260,92 / 23,10 / 1.771,35 kB | 16/11/2026 | Anexo A |
| Runtime Electron 43.4.1 x64 (zip oficial) | 143,2 MiB (150.154.788 B) | 16/11/2026 | `api.github.com` |
| Launcher — LOC e canais | 4.344 main / 4.487 renderer / 27 canais | 16/11/2026 | §2.2 |
| Stage — LOC, arquivos, janelas | 25.388 main / 52.069 renderer / 66 arq. importam Electron (55 com API em runtime) / 15 janelas | 16/11/2026 | §2.3 |
| Declarações que atravessam `lia/core/src` | 44 (41 `import` + 3 `export`) em 23 arquivos | 16/11/2026 | §2.4, Anexo A |

### 9.2 O que continua **NÃO EXECUTADO**

| Medida | Status | Por quê |
|---|---|---|
| RAM (private bytes/working set) do Launcher sozinho | **NÃO EXECUTADO** | sem display/Electron no sandbox |
| RAM do Stage em repouso, em conversa, em animação, em voz | **NÃO EXECUTADO** | idem |
| CPU em repouso e por atividade | **NÃO EXECUTADO** | idem |
| Processos e threads por árvore | **NÃO EXECUTADO** ao vivo (existe contagem estática de 12 processos do pacote de 08/11) | idem |
| GPU/FPS/frame time | **NÃO EXECUTADO** | idem |
| Boot e encerramento desta build | **NÃO EXECUTADO** (existem marcas de 12/11: `+95 / +152 / +483 / +1311 ms`) | idem |
| Tamanho instalado e do instalador NSIS | **NÃO EXECUTADO** | build de Windows indisponível |
| Build do Stage | **NÃO EXECUTADO** | `dist.ayaka.moe` fora da allowlist |

**Regra:** nenhum destes números pode ser preenchido por analogia, por benchmark de terceiro
ou por "experiência com Electron". Um valor inventado aqui contamina todas as decisões seguintes.

### 9.3 Orçamentos propostos (decisão, não medição)

Os limites abaixo **não são metas de desempenho medidas**; são gatilhos de decisão. Precisam de
aprovação (§12) antes de serem usados como critério.

| Cenário | Métrica | Limite que mantém Electron | Limite que reabre a decisão |
|---|---|---|---|
| C0 Launcher sozinho, ocioso | private bytes somados | ≤ **250 MiB** | > **350 MiB** |
| C0 | processos | ≤ **4** | > **6** |
| C1 Launcher + Runtime ociosos | private bytes somados | ≤ **1.100 MiB** | > **1.500 MiB** |
| C2 Runtime ativo (avatar em repouso) | CPU (máquina) | ≤ **6%** | > **12%** |
| C2 | FPS do avatar | ≥ **55** | < **45** |
| C3 conversa + TTS | latência de primeira fala | ≤ **1.500 ms** | > **2.500 ms** |
| C4 jogo em primeiro plano | queda de FPS do jogo vs. baseline | ≤ **5%** | > **15%** |
| C5 encerrar e reabrir | órfãos após 10 s | **0** | ≥ **1** |
| Distribuição | instalador | ≤ **300 MB** | > **350 MB** |

### 9.4 Protocolo reproduzível (Windows 11, RX 580 8 GB, Ryzen 5 5500, 16 GB)

**Preparação (uma vez por build):**

```powershell
# Identidade da execução — registrar no CSV de resultados
$commit = (git rev-parse HEAD)
$driver = (Get-CimInstance Win32_VideoController -Filter "Name like '%Radeon%'").DriverVersion
$os     = (Get-CimInstance Win32_OperatingSystem).Version
$mons   = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams |
          Measure-Object | Select-Object -ExpandProperty Count
powercfg /getactivescheme
```

**Coleta por cenário** (60 s de aquecimento, 180 s de janela, amostragem a cada 5 s, 5
repetições, ordem alternada; registrar mediana e intervalo, não só a média):

```powershell
# $RootPid = PID do processo raiz do cenário (Lia.exe ou LiaStage.exe)
param([int]$RootPid, [int]$Reps = 5, [int]$Warmup = 60, [int]$Window = 180, [string]$Out = "c0_launcher.csv")

function Sample-Tree([int]$RootPid) {
  $all = Get-CimInstance Win32_Process
  $tree = @($RootPid)
  do {
    $children = $all | Where-Object { $tree -contains $_.ParentProcessId -and $tree -notcontains $_.ProcessId }
    $tree += $children.ProcessId
  } while ($children)
  $rows = foreach ($p in $all | Where-Object { $tree -contains $_.ProcessId }) {
    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if ($proc) {
      [pscustomobject]@{
        pid = $p.ProcessId; name = $p.Name; parent = $p.ParentProcessId
        privateMB = [math]::Round($proc.PrivateMemorySize64 / 1MB, 1)
        wsMB      = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        threads   = $proc.Threads.Count
        cpuSec    = $proc.CPU
      }
    }
  }
  $rows
}

foreach ($i in 1..$Reps) {
  Start-Sleep -Seconds $Warmup
  $t0 = Get-Date; $samples = @()
  while (((Get-Date) - $t0).TotalSeconds -lt $Window) {
    $s = Sample-Tree -RootPid $RootPid
    $samples += [pscustomobject]@{
      t = ((Get-Date) - $t0).TotalSeconds
      privateMB = ($s | Measure-Object privateMB -Sum).Sum
      wsMB      = ($s | Measure-Object wsMB -Sum).Sum
      procs     = $s.Count; threads = ($s | Measure-Object threads -Sum).Sum
      cpuSec    = ($s | Measure-Object cpuSec -Sum).Sum
    }
    Start-Sleep -Seconds 5
  }
  $samples | Export-Csv -Append -NoTypeInformation -Path $Out
}
```

**Cenários:**

| ID | Cenário | O que medir |
|---|---|---|
| C0 | Launcher aberto, Runtime parado, 5 min ocioso | RAM, processos, threads, CPU |
| C1 | Launcher + Runtime (avatar em repouso, sem conversa) | idem + FPS do avatar |
| C2 | Runtime com animação ativa | FPS, frame time, CPU, GPU |
| C3 | Conversa (STT → LLM → TTS), 10 turnos | latência por etapa, CPU, RAM de pico |
| C4 | Jogo em primeiro plano com Runtime ativo | FPS do jogo com/sem Lia (PresentMon `--process_name`) |
| C5 | Multimonitor/DPI (100% e 150%) | geometria, FPS, RAM |
| C6 | Encerrar o Launcher com Runtime ativo (comportamento atual) | órfãos, o que morre |
| C7 | Reabrir o Launcher com Runtime ativo (após F0) | tempo de adoção, órfãos |
| C8 | `stop` gracioso vs `taskkill` | tempo, estado de `lia-memory.json`, logs |

**Frame time:** `PresentMon64.exe --process_name LiaStage.exe --output_file c2.csv
--terminate_after_timed 180`, reportando p50/p95/p99 — não média.

**Tamanho instalado:** `Get-ChildItem <installdir> -Recurse -File | Measure-Object Length -Sum`
e o mesmo para `resources\stage` isolado; comparar com/sem E1.

### 9.5 Experimento E1 — binário compartilhado (antes de E2, se E2 for tentado)

**Objetivo:** medir se deduplicar o runtime no disco reduz RAM e disco **sem** tocar em
processos. É barato, reversível e não muda comportamento.

| Passo | Ação |
|---|---|
| 1 | Empacotar como hoje; medir `installdir`, `resources\stage` e C1 |
| 2 | Substituir os arquivos do runtime em `resources\stage` por **hardlinks** para os do Launcher; validar assinatura/hash |
| 3 | Repetir C1 e medir: disco instalado, private bytes, working set, número de processos |
| 4 | Critério: disco de `resources\stage` cai ≥ 80% e C1 não piora > 5% |
| 5 | Falha ou ganho irrelevante ⇒ reverter o pacote, registrar e seguir com D+ |

**HIPÓTESE a falsificar:** "páginas de código compartilhadas reduzem o working set somado".
Working set soma páginas compartilhadas por processo; a métrica correta nesse caso é
**private bytes** e **memória física livre**, não working set. O protocolo mede as três.

### 9.6 Experimento E2 — runtime único (somente se E1 e o gate permitirem)

Se, e somente se, o gate G-4 (§9.7) indicar que o Launcher isolado é caro **e** o dono aceitar
perder a separação de ciclo de vida, o protótipo deve:

1. ser um branch isolado, **sem** tocar no produto;
2. carregar o Stage main como módulo do Launcher, com `userData` único e documentado;
3. medir C0–C5 e comparar com C0–C5 do D+;
4. **falhar** se: qualquer uma das 4 invariantes de §6.2 não for reproduzida de forma
   equivalente; houver órfão; ou a redução de private bytes somados for < 25%.

**ESTIMATIVA de resultado:** redução entre **10% e 20%** do total, concentrada em GPU/utility/
main, com renderers intactos. **Não medido.** O critério de 25% do documento anterior é
provável de não ser atingido — e isso deve ser dito antes do experimento, não depois.

### 9.7 Gate G-4 (decisão sobre o host do Launcher)

| Condição | Consequência |
|---|---|
| C0 ≤ 250 MiB e ≤ 4 processos | **Manter Electron** no Launcher; encerrar a discussão de framework até um novo gatilho |
| C0 entre 250 e 350 MiB | Manter Electron; otimizar (asset, lazy load, `v8-compile-cache`) e remedir |
| C0 > 350 MiB **ou** > 6 processos | **Autorizar protótipo Tauri 2** apenas do Launcher, com sidecar Node para o Core; comparar C0 e C7 |

Um gate só se abre com número no lugar e protocolo declarado — nunca por preferência.

### 9.8 Custo de migração (unidades de trabalho, sem prazo inventado)

| Alternativa | Arquivos a tocar | LOC reescrito (ordem de grandeza) | Incerteza |
|---|---|---:|---|
| **D+ (recomendada)** | ~20 arquivos de main + 4 de teste | ~600 LOC alterados | baixa |
| E1 (binário) | 2 arquivos de empacotamento | ~80 LOC | baixa |
| E2 (processo único) | 15 janelas + main do Stage + host | ~2.000 LOC | alta |
| B (Tauri no Launcher) | 4 de main + preload + 5 telas | ~4.400 LOC (Rust/sidecar) | alta |
| A / C | tudo do Launcher | ~8.800 LOC | muito alta |

---

## 10. Plano incremental e rollback

Nenhuma fase abaixo está autorizada por este documento. Elas existem para que a decisão seja
executável quando aprovada. Cada fase é um commit (ou conjunto pequeno) com rollback próprio.

### F0 — Ciclo de vida (resolve P-01, P-02, P-03)

| Entrega | Teste | Rollback |
|---|---|---|
| CCR no Stage (`status`/`shutdown`/`ping`) + registro `runtime.json` | teste de contrato do pipe com pipe real em `mkdtemp` | remover o módulo; `stop` volta ao comportamento atual |
| `adoptStage()` no Launcher com verificação de PID + hora de início + HMAC | teste com registro forjado/obsoleto/adotável | flag `LIA_ADOPT_RUNTIME=0` restaura o comportamento antigo |
| Fechar o Launcher deixa de parar o Runtime (padrão), com opção explícita | teste de ciclo de vida sem Electron | flag/config |
| `stop` gracioso antes do `taskkill` | teste de ordem de chamadas (`shutdown` → espera → kill) | reverter ordem |

**Critério de saída:** C8 mostra `shutdown` gracioso em < 15 s; C5 mostra 0 órfãos; C7 adota em
< 2 s.

### F1 — Fronteira do Core (resolve P-05)

| Entrega | Teste |
|---|---|
| Subpaths públicos em `@lia/contracts` para `providers`, `transports`, `presence`, `credentials` | `core-build-contract` estendido |
| Migrar as 44 declarações relativas para subpaths | teste novo: nenhum `lia/core/src` fora do pacote |
| `@lia/contracts` com `exports`, `types` e build | build + `tsc` |

**Rollback:** reverter o commit; nenhum comportamento de runtime muda (é reexportação).

### F2 — Dados e perfis (resolve P-06)

| Entrega | Teste |
|---|---|
| `profiles\launcher` e `profiles\stage` | teste de resolução de caminho (sem Electron) |
| Migração de diretórios de Chromium com aviso | teste de migração em `tmpdir` |
| Guarda: dados de produto nunca são usados como perfil | teste que falha se iguais |

**Rollback:** desligar a flag e voltar ao `userData` único; dados de produto nunca se movem.

### F3 — Runtime compartilhado (resolve P-04, E1)

Empacotamento + validação de hash + medição. **Rollback:** pacote anterior.

### F4 — Gate G-4

Rodar C0–C8, publicar CSV e decisão. **Rollback:** nenhum (é medição).

### F5 — Somente se G-4 abrir: protótipo Tauri do Launcher

Branch isolado, sem tocar no produto, com sidecar Node para o Core. **Rollback:** descartar o
branch.

### F6 — Higiene

Asset de 1,77 MB, versão do Electron em um único lugar, contrato de host (`lia/launcher`,
`lia/stage`) ligado ou removido.

---

## 11. Matriz de riscos

Probabilidade e impacto em escala baixa/média/alta; exposição = combinação qualitativa.

| ID | Risco | Prob. | Impacto | Exposição | Mitigação | Evidência |
|---|---|---|---|---|---|---|
| R-01 | Implementar "fechar ≠ matar" sem adoção → Runtime órfão incontrolável | **Alta** se F0 for fatiado | Alta | **Alta** | F0 entrega CCR + adoção **no mesmo commit**; feature flag | §7.4 |
| R-02 | Adoção aceitar processo impostor | Baixa | Alta | Média | HMAC + PID + hora de início + versão; nunca confiar só no arquivo | §7.5 |
| R-03 | Pipe de controle exposto a outro usuário | Média (DACL não verificada) | Média | Média | HMAC em todo comando; verificar DACL no Windows; registrar achado | §7.5 |
| R-04 | Migração de perfil perder preferências do Stage | Média | Baixa | Baixa | mover só diretórios de Chromium; avisar; nunca mover dados de produto | §7.6 |
| R-05 | Fechar a fronteira do Core quebrar build do Stage | Média | Média | Média | F1 em dois passos: exportar → migrar imports; CI compila os dois | §10 |
| R-06 | Deduplicação por hardlink quebrar assinatura/atualização | Média | Alta | Média | validar hash e `version`; reverter o pacote se qualquer validação falhar | §9.5 |
| R-07 | Gate G-4 virar desculpa para adiar indefinidamente | Média | Média | Média | critérios numéricos aprovados antes da medição (D-07) | §9.7 |
| R-08 | Trocar o Launcher por Tauri e manter um Node sidecar → ganho nulo | Média | Média | Média | medir antes; comparar "processos + private bytes", não "framework" | §5.2 |
| R-09 | Duas arquiteturas em paralelo (protótipo virando produto) | Baixa | Alta | Média | protótipo em branch isolado; proibido mergear sem decisão | §10 |
| R-10 | `taskkill` continuar sendo o caminho real e o CCR ficar decorativo | Média | Média | Média | teste que exige `shutdown` antes do kill; log com ordem | F0 |
| R-11 | Electron 43 sair de suporte | **Alta** (a 46 chega em ~3 majors) | Média | **Alta** | plano de upgrade para 45.x com regressão Windows; versão em um só lugar | §2.7 |
| R-12 | Números de cenários diferentes serem comparados | Alta | Alta | **Alta** | todo CSV carrega commit, driver, monitores, DPI, plano de energia | §9.4 |

---

## 12. Critérios de aceitação e decisões que exigem aprovação

### 12.1 Critérios desta auditoria (o que prova que o documento cumpriu o pedido)

| ID | Critério | Status |
|---|---|---|
| AC-01 | Relatório cobre os 11 itens pedidos | **PASS** (§2–§13) |
| AC-02 | Estado real confirmado **no código**, não em documentação anterior | **PASS** (§2, §13) |
| AC-03 | Toda afirmação quantitativa etiquetada (medido/estimado/hipótese) | **PASS** (§0.1) |
| AC-04 | Nenhum benchmark inventado | **PASS** (§9.1/§9.2) |
| AC-05 | Runtime único julgado em viabilidade **e** segurança | **PASS** (§6) |
| AC-06 | Alternativas A–E comparadas | **PASS** (§5) |
| AC-07 | Arquitetura-alvo com diagrama e invariantes | **PASS** (§7, §8) |
| AC-08 | Plano incremental com rollback por fase | **PASS** (§10) |
| AC-09 | Matriz de riscos | **PASS** (§11) |
| AC-10 | Decisões que exigem aprovação, explícitas | **PASS** (§12.2) |
| AC-11 | Nenhuma alteração de código de produto, áudio, `main` ou branch Codex | **PASS** |
| AC-12 | Gate de arquitetura **não** declarado concluído | **PASS** — continua **ABERTO** |

### 12.2 Decisões que exigem aprovação do dono

| ID | Decisão | Recomendação | Se recusada |
|---|---|---|---|
| **D-01** | Adotar **D+** (Electron nos dois processos) como alvo deste ciclo | Aprovar | Volta-se a A/B/C, com o custo de §9.8 |
| **D-02** | **Rejeitar** runtime único (E2) | Aprovar | Exige aceitar perder as 4 invariantes de §6.2 e a decisão "fechar ≠ matar" |
| **D-03** | Resolver "voz": Launcher = política/instalação/permissões; Stage = execução de áudio | Aprovar (§7.2) | A matriz de responsabilidades fica ambígua e F0 não fecha |
| **D-04** | Semântica "fechar o Launcher mantém a Lia ativa" **como padrão**, com opção explícita de encerrar | Aprovar | F0 perde o objetivo; P-01 permanece |
| **D-05** | Fechar a superfície pública do Core e proibir import relativo | Aprovar | P-05 permanece; o Core continua não-publicável |
| **D-06** | Autorizar o experimento E1 (binário compartilhado) | Aprovar | Pacote continua com 2 runtimes |
| **D-07** | Aprovar os limites de §9.3 **antes** da medição | Aprovar | O gate vira negociação depois do número |
| **D-08** | Reconhecer que "orçamento" é funcionalidade nova, não arquitetura | Aprovar | A matriz de §7.2 fica com uma capacidade fantasma |

---

## 13. Correções à documentação anterior

Todas verificadas em `2855180`. Nenhuma altera a decisão de 12/11 no mérito; várias alteram a
descrição do estado.

| Afirmação anterior | Estado em 16/11 | Evidência |
|---|---|---|
| "`sandbox: false` nas janelas do Launcher e do Stage (endurecimento pendente)" | **Incorreta.** 0 ocorrências de `sandbox: false`; as 15 janelas do Stage usam `sandbox: true` | `windows/secure-web-preferences.ts`; grep |
| "74 arquivos do Stage importam Electron" | **66** arquivos não-teste (55 com import de valor, 11 só de tipo) | grep |
| "Launcher Main 4.088 LOC" | **4.344** LOC (não-teste) | Anexo A |
| "26 canais IPC" | **27** `ipcMain.handle` | `ipc.ts` |
| "Stage Main 25.345 LOC" | **25.388** LOC | Anexo A |
| "Runtime Electron 43.4.1" (sem tamanho) | zip oficial = **143,2 MiB** (150.154.788 B) | `api.github.com` |
| "Dois runtimes = custo arquitetural" | Confirmado e **quantificado no disco**; tamanho instalado segue **NÃO MEDIDO** | §2.7 |
| "Core é independente de runtime" | Verdadeiro para **Electron**; **falso** para fronteira de pacote (44 declarações relativas em 23 arquivos) | §2.4 |
| "Plano de execução Etapa 1: contrato de transporte como alvo" | O contrato existe (`lia/launcher`, `lia/stage`) e **não tem consumidor** | §2.1 |
| "Encerramento gracioso" (implícito em "supervised teardown") | No Windows o primeiro gesto é `taskkill /T /F`; o `before-quit` do Stage não é acionado | §2.5 |

---

## 14. Recomendação final

1. **Alvo: D+ — Electron nos dois processos, com quatro correções estruturais.** Não por
   preferência de framework, mas porque: (a) o Stage não é migrável sem reescrita integral;
   (b) o Launcher é 98% runtime e 2% código, então trocar o framework não resolve o peso;
   (c) Tauri exigiria um sidecar Node para manter o Core em TypeScript, trocando um Chromium
   por um Node e adicionando Rust.
2. **Rejeitar o runtime único (E2).** Ele não reduz a maior parcela (renderers), quebra quatro
   invariantes verificadas no código e torna a decisão "fechar o Launcher sem matar o Runtime"
   impossível por construção.
3. **Corrigir primeiro o que está errado hoje**, nesta ordem: ciclo de vida (F0), fronteira do
   Core (F1), dados/perfis (F2), runtime compartilhado (F3).
4. **Medir antes de decidir host.** O gate G-4 só se abre com C0 > 350 MiB ou > 6 processos,
   medidos no protocolo de §9.4 e com limites aprovados **antes** (D-07).
5. **Não declarar nada concluído.** O gate de arquitetura continua **ABERTO**: esta rodada
   produziu estado real, correções e um plano; não produziu o número que decide.

---

## 15. Documentos derivados (16/11/2026)

Esta auditoria é a base; as decisões formais, a especificação de ciclo de vida, o plano do Core, o
experimento do binário, o protocolo de benchmark e a matriz de gates vivem em
[`docs/architecture/decisions/`](../architecture/decisions/README.md).

| Documento | Papel |
|---|---|
| [Registro D-01…D-08](../architecture/decisions/DECISION-RECORD-2026-11-16.md) | status, condições e sign-off de cada decisão |
| [ADR-0001](../architecture/decisions/ADR-0001-desktop-runtime-d-plus.md) | arquitetura-alvo D+ e invariantes |
| [SPEC de lifecycle](../architecture/decisions/SPEC-launcher-runtime-lifecycle.md) | fechar ≠ parar, descoberta, canal autenticado, credencial |
| [Plano do Core](../architecture/decisions/PLAN-core-public-surface.md) | superfície pública de `@lia/contracts` |
| [Experimento do binário](../architecture/decisions/PLAN-shared-electron-binary-experiment.md) | PASS/FAIL e rollback |
| [Benchmark C0–C8](../architecture/decisions/BENCHMARK-C0-C8-windows.md) | protocolo no Windows (substitui o §9.4 desta auditoria) |
| [Riscos e gates](../architecture/decisions/RISKS-DEPENDENCIES-GATES.md) | dependências G-0…G-5 |

> **Nota de correção (16/11, rodada de decisões):** a primeira versão desta auditoria falava em
> "46 imports em 24 arquivos" e atribuía a violação a `@lia/core`. A auditoria fina mostrou:
> **46 linhas** mencionam `lia/core/src`, das quais **44 são declarações** (41 `import` + 3
> `export … from`) **em 23 arquivos**; e o alvo é **`@lia/contracts`** (`lia/core`), não
> `@lia/core` (`airi/packages/lia-core`). O §2.4, o P-05 e o Anexo A já estão corrigidos; o
> [plano do Core](../architecture/decisions/PLAN-core-public-surface.md) detalha a migração.

---

## Anexo A — Comandos executados (reproduzíveis)

```bash
# 1. Dependências e build do Launcher
cd airi && corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm -F @lia/core build
cd apps/lia-app && corepack pnpm exec electron-vite build
#    out/main/index.js 220.73 kB · out/preload/index.cjs 2.42 kB
#    renderer: index-*.js 260.92 kB · index-*.css 23.10 kB · PNG 1,771.35 kB

# 2. Contagens
find apps/lia-app/src/main -name '*.ts' -not -name '*.test.ts' | xargs cat | wc -l        # 4344
find apps/lia-app/src/renderer -name '*.ts' -o -name '*.vue' | xargs cat | wc -l          # 4487
find apps/stage-tamagotchi/src/main -name '*.ts' -not -name '*.test.ts' | xargs cat | wc -l # 25388
find apps/stage-tamagotchi/src/renderer -name '*.ts' -o -name '*.vue' | xargs cat | wc -l  # 52069
grep -rl "from 'electron'" apps/stage-tamagotchi/src/main --include=*.ts | grep -v test | wc -l # 66
# 55 têm import de valor; 11 apenas `import type`
grep -c "ipcMain.handle" apps/lia-app/src/main/ipc.ts                                      # 27

# 3. Fronteira do Core
grep -rn "lia/core/src" apps/stage-tamagotchi/src --include=*.ts | grep -v test | wc -l     # 39 / 21 arq.
grep -rn "lia/core/src" apps/lia-app/src --include=*.ts | grep -v test | wc -l             # 7 / 3 arq.
python3 -c "import json;print(len(json.load(open('packages/lia-core/package.json'))['exports']))" # 16

# 4. Runtime oficial (metadado, não download)
curl -s https://api.github.com/repos/electron/electron/releases/tags/v43.4.1 \
  | python3 -c "import json,sys;[print(a['name'],a['size']) for a in json.load(sys.stdin)['assets'] if a['name']=='electron-v43.4.1-win32-x64.zip']"
# 150154788 bytes

# 5. Janelas e sandbox no Stage
grep -rnE "new (Electron)?BrowserWindow\(|new ElectronBrowserWindow\(" \
  apps/stage-tamagotchi/src/main --include=*.ts | grep -v test | wc -l   # 16 linhas: 15 construções + 1 comentário
grep -rn "sandbox: false" apps/stage-tamagotchi/src/main --include=*.ts | grep -v test | wc -l # 0
```

**Ambiente:** Linux, sem `Xvfb`, sem GTK; 2 vCPU; 3.939 MB RAM. Nenhuma janela Electron foi
aberta; nenhuma medição de memória/CPU/GPU/boot foi produzida.

---

## Anexo B — Fontes externas usadas

| Fato | Fonte | Consulta |
|---|---|---|
| Tamanho do runtime Electron 43.4.1 x64 (150.154.788 B) | `api.github.com/repos/electron/electron/releases/tags/v43.4.1` | 16/11/2026 |
| Modelo de processos do Electron (main/renderer/preload; GPU/utility) | documentação oficial do Electron | 11–12/11/2026 |
| `safeStorage` usa DPAPI no Windows (por usuário, não por processo) | documentação oficial do Electron | 12/11/2026 |
| Modelo de processos do WebView2 (1 browser + N renderers + GPU + áudio por user-data folder; `ProcessFailed`; environments no mesmo folder) | Microsoft Learn | 12/11/2026 |
| Tauri 2: núcleo Rust, webview não empacotada, WebView2 pré-instalado no Win11 | documentação oficial do Tauri | 11–12/11/2026 |
| WinUI 3 / Windows App SDK: Win10 1809+, MSIX/unpackaged | Microsoft Learn | 12/11/2026 |
| Electron: 3 majors suportadas, cadência de 8 semanas; 45.3.1 como latest | documentação e npm | 12/11/2026 |
| Qt 6 LGPL (link dinâmico, re-link, aviso) | `doc.qt.io` | 12/11/2026 |
| Flutter Windows / Impeller por padrão desde 3.47 | documentação oficial | 12/11/2026 |

---

## Anexo C — Mapa das 15 janelas do Stage

| Módulo | Janela | Papel |
|---|---|---|
| `windows/main` | principal | personagem/cena |
| `windows/chat` | chat | conversa |
| `windows/settings` | configurações | ajustes |
| `windows/about` | sobre | informação |
| `windows/onboarding` | onboarding | primeira execução |
| `windows/spotlight` | spotlight | busca rápida |
| `windows/caption` | legenda | transcrição ao vivo |
| `windows/widgets` | widgets | painéis soltos |
| `windows/desktop-overlay` | overlay de tela | transparência + clique atravessável |
| `windows/dashboard` | dashboard | métricas |
| `windows/editor` | editor | edição de cena |
| `windows/inlay` | inlay | conteúdo embutido |
| `windows/devtools` | devtools | inspeção (dev) |
| `windows/notice` | avisos | notificações |
| `windows/beat-sync` | beat sync | sincronia musical |

Todas usam `createStageWebPreferences` (`sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`). Nenhuma usa `sandbox: false`.
