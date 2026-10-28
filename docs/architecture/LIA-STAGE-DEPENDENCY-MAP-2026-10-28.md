# B0 — Mapa de dependências funcionais do Stage

**Data:** 28/10/2026 · **Natureza:** investigação. **Nada foi alterado.**
Base: HEAD `069c5f5`, árvore limpa, `airi/` intocado.

Etapa **B0** de [`AIRI-DECOUPLING-PLAN-2026-10-28.md`](AIRI-DECOUPLING-PLAN-2026-10-28.md),
sob a autoridade de [`AGENTS.md`](../../AGENTS.md) §99.

Método: resolução de imports transitivos a partir dos pontos de entrada reais,
executada sobre a árvore local. Nenhum build, nenhuma instalação.

**Legenda de confiança:** **[C]** confirmado no código · **[I]** inferido ·
**[P]** pendente de validação.

---

## 1. Resumo executivo

**O Stage não é "usado" pela Lia: o Stage *é* a Lia na tela.** A Lia não tem uma
interface própria sobreposta ao AIRI — ela tem 27 arquivos de configuração e
orquestração (5 224 linhas) que dirigem os stores do AIRI, mais uma Home que
renderiza a cena de avatar do AIRI.

Os três números que definem o problema:

| Medida | Valor | Confiança |
| --- | --- | --- |
| Código da Lia no renderer | **27 arquivos, 5 224 linhas** | [C] |
| Alcançado por `pages/index.vue` (a Home da Lia) | **675 arquivos locais, 31 pacotes `@proj-airi`** | [C] |
| Código da Lia no processo principal | **38 entradas → 46 arquivos** | [C] |

**A assimetria é a descoberta principal:** no processo principal, a Lia é quase
independente. No renderer, ela é uma camada fina sobre 675 arquivos de AIRI.

O que isso significa na prática:

1. **O `main` da Lia é portátil com pouco trabalho.** Sua dependência real de
   runtime no AIRI é de **dois** pontos: um re-export de `@proj-airi/electron-eventa`
   e uma função utilitária de `@proj-airi/stage-shared`. Todo o resto que aparece
   na varredura são imports **só de tipo**, que desaparecem na compilação.
2. **O renderer é o problema.** A Home, o chat e as configurações passam todos
   por ~600–675 arquivos. Não existe um "subconjunto pequeno" natural: os stores
   da Lia importam os stores do AIRI, que importam o resto.
3. **O avatar não é opcional nem separável hoje.** `WidgetStage` é
   `stage-ui/src/components/scenes/Stage.vue` (1 353 linhas) com cinco
   renderizadores; é o componente central da Home.

Uma boa notícia estrutural: a **superfície IPC é pequena e bem delimitada** —
26 eventos da Lia num contrato de 85. Esse é o contrato que uma interface própria
precisaria reimplementar, e ele é finito.

---

## 2. Inventário funcional

Verificado por leitura de código. Cada linha aponta o arquivo real.

| # | Funcionalidade | Existe? | Onde | Depende do AIRI? |
| --- | --- | --- | --- | --- |
| F1 | Avatar, animação, expressão, presença | **sim** | `renderer/pages/index.vue` → `WidgetStage` (`components/scenes/Stage.vue`) | **sim, integralmente** |
| F2 | Janela, transparência, posicionamento | **sim** | `main/windows/main/index.ts` + `main/windows/main/window-sizing.ts` e `window-size-settings.ts` | **sim** (`transparentWindowConfig`, presets) |
| F3 | Chat, histórico, apresentação | **sim** | `renderer/pages/index.vue` → `useChatStore`, `useChatSessionStore`; `pages/chat.vue` | **sim, integralmente** |
| F4 | Voz de entrada (STT), estado de fala | **sim** | `stores/lia/hearing.ts` → `useHearingStore`; `useHearingSpeechInputPipeline` | **sim** |
| F5 | Voz de saída (TTS), interrupção | **sim** | `stores/lia/voice.ts` → `useSpeechStore`; `@proj-airi/pipelines-audio` | **sim** |
| F6 | Seleção e configuração de provedores | **sim** | `stores/lia/provider.ts` → `useProviderStore`, `useProviderConfigStore` | **sim** |
| F7 | Configurações, segredos, persistência | **sim** | `main/configs/lia*.ts`, `main/services/lia/secrets-service.ts` | **não** — `@lia/core` + Electron |
| F8 | Estado de conversação e IPC | **sim** | `shared/eventa/index.ts` (26 eventos Lia) | **parcial** (tipos) |
| F9 | Notificações / Home stop | **sim** | `a978943` — encerrar conversa pela Home | **sim** (usa `stopStage` do launcher) |
| F10 | Perfis de voz, voz customizada | **sim** | `stores/lia/voice-profiles.ts`, `voice-editor.ts` | **parcial** |
| F11 | Brain / roteamento de decisão | **sim** | `main/services/lia/brain-*` (70 arquivos) | **não** — `@lia/core` |
| F12 | Ferramentas / MCP | **não confirmado para a Lia** | existe no AIRI (`stores/ai/chat-llm/tools.ts`) | [P] |
| F13 | Vision, gaming-minecraft, artistry, web-search | **aparecem no fecho, sem uso da Lia** | `stores/modules/vision/*`, `gaming-minecraft.ts` | ver §3.3 |

**Sobre F12/F13:** esses módulos entram no fecho porque são importados pelo
`useChatStore`/`ai/chat-llm`, não porque a Lia os invoque. Não encontrei chamada
da Lia para eles. **[I]**

---

## 3. Grafo de dependências

### 3.1 Processo principal — a Lia é quase independente

Entradas: `main/services/lia/**` (38 arquivos não-teste) + `main/configs/lia.ts` + `lia-schema.ts`.
(*Não existe `lia-product.ts`: o arquivo `configs/lia-product.md` é documentação, e
`createLiaProductConfig` está definido em `configs/lia.ts:15`.*)
Fecho: **46 arquivos locais**.

Dependências de runtime no AIRI — **completas**:

| Ponto | Arquivo | O que é | Substituível? |
| --- | --- | --- | --- |
| `export { electron } from '@proj-airi/electron-eventa'` | `shared/eventa/index.ts:961` | re-export de helpers Electron | **sim** — `electron` direto |
| `export * from '@proj-airi/electron-eventa/electron-updater'` | `shared/eventa/index.ts:962` | tipos/utilitários de updater | **sim** |
| `errorMessageFromUnknown` | `main/services/lia/voice-profile-picker.ts:23` | formatação de mensagem de erro | **sim** — `@moeru/std` já é usado no renderer |

Todo o resto que a varredura encontra em `shared/eventa/index.ts` é **`import type`**
(linhas 1–40): `plugin-sdk-tamagotchi/gamelet`, `server-runtime/server`,
`stage-shared/{global-shortcut,godot-stage,server-channel-qr}`,
`stage-ui-three/trace`. **Zero custo de runtime.** **[C]**

> **Consequência importante:** o `main` da Lia poderia hoje ser extraído com
> **três** substituições e nenhuma reescrita de lógica. O acoplamento que existe
> é declarativo, não executável.

O resto do `main/index.ts` (147 arquivos) inclui plugins, MCP, godot-stage,
widgets, captura de tela — features do AIRI que a Lia não chama.

### 3.2 Renderer — a Lia é uma camada fina

**Entrada real:** `renderer/pages/index.vue` (1 029 linhas, modificado pela Lia).

Fecho: **675 arquivos locais, 31 pacotes `@proj-airi`**:

```
stage-shared 73 · ui 66 · stage-ui 53 · core-agent 25 · electron-vueuse 13
server-sdk 13 · pipelines-audio 12 · stage-ui-live2d 11 · stage-ui-three 8
stage-ui-tachie 8 · server-shared 7 · (demais ≤ 4)
```

As outras entradas medem o mesmo:

| Entrada | Arquivos | Pacotes |
| --- | --- | --- |
| `pages/index.vue` (Home) | 675 | 31 |
| `pages/chat.vue` | 641 | 28 |
| `pages/settings/system/index.vue` | 598 | 22 |
| `renderer/main.ts` | 674 | 28 |
| `App.vue` | 662 | 28 |

Não há um recorte pequeno: **o renderer é um único aplicativo acoplado**.

**Só os stores da Lia**, sem a Home: 25 arquivos → fecho de 214 arquivos, 186 em
`stage-ui`. Os imports de `stage-ui` e seu custo:

| Import direto da Lia | Arquivos no fecho | Tipo |
| --- | --- | --- |
| `stores/chat` | 171 | **só tipo** |
| `stores/chat/retry-content` | 171 | misto (`cloneRetryAttachments` é runtime) |
| `stores/settings` | 132 | runtime (`useSettingsStageModel`, `useSettingsAudioDevice`) |
| `stores/modules/hearing` | 116 | runtime |
| `stores/providers/provider` | 99 | runtime |
| `stores/providers/config` | 99 | runtime |
| `stores/modules/speech` | 99 | runtime |
| `stores/modules/consciousness` | 99 | runtime |
| `stores/modules/airi-card` | 99 | runtime |
| `stores/chat/chat-provider-runtime` | 1 | runtime (registradores de observador) |
| `libs/speech/tts-fallback`, `libs/diagnostics/audio-probe`, `libs/capabilities/lia-capability-port` | 1 cada | runtime |

Os nove stores de 99 arquivos formam **um único bloco**: todos convergem no mesmo
núcleo (`useProviderStore` → `@xsai/model`; `useSpeechStore` → `pipelines-audio`).

**Observação decisiva [C]:** `stores/providers/provider.ts` (1 109 linhas — o hub)
importa apenas `@moeru/std`, `@proj-airi/stage-shared`, `@vueuse/core`,
`@xsai/model`, `es-toolkit`, `pinia`, `vue`, `vue-i18n`. **Não importa nenhum
outro pacote AIRI.** O peso não vem do hub; vem dos módulos que ele alcança.

### 3.3 Dependência apenas disponível, sem uso confirmado

Presentes no fecho por transitividade, sem chamada identificável da Lia **[I]**:
`stores/modules/vision/*` (5 arquivos), `gaming-minecraft.ts`, `artistry*.ts`,
`web-search.ts`, `devtools/*`, `stores/auth.ts`, `api-server`/`better-auth`.

### 3.4 Dependências exclusivas do AIRI

O que **não** pode ser simplesmente trocado por biblioteca pública:

| Item | Por que não substituível direto | Confiança |
| --- | --- | --- |
| `WidgetStage` (`Stage.vue`) | orquestra 5 renderizadores e o pipeline de TTS/emoção num só componente; não há equivalente empacotado | [C] |
| `useChatStore` + `chat-provider-runtime` | contém as correções que o dono validou (perda de espaço, resposta vazia, recusa de imagens) | [C] |
| `useSpeechStore` / `hearing` | política de fallback e estado de fala integrados ao chat | [C] |
| `@proj-airi/core-agent` | não publicado no npm (HTTP 404, verificado) | [C] |
| `stage-shared` | tipos e helpers internos, 35 arquivos / 2 438 linhas | [C] |

### 3.5 Bibliotecas que funcionam sem o AIRI

Verificadas no registro npm em 28/10/2026 **[C]**:
`@xsai/*` (0.5.1, MIT) · `@moeru/eventa` (1.0.2, MIT) · `@moeru/std` (MIT) ·
`pinia`, `vue`, `@vueuse/core`, `es-toolkit`, `valibot`, `destr` · `kokoro-js` ·
`@pixiv/three-vrm` e `pixi-live2d-display` (usados pelo AIRI, publicados).

---

## 4. Matriz de migração

Uma linha por grupo funcional. **Nenhuma estratégia foi escolhida por conveniência
de arquitetura** — cada uma decorre do que o código mostra.

| Funcionalidade | Dependência atual | Evidência | Estratégia candidata | Trabalho necessário | Risco | Teste de equivalência |
| --- | --- | --- | --- | --- | --- | --- |
| **F7** Config, segredos, persistência | `@lia/core`, Electron | `main/configs/lia*.ts`, `services/lia/secrets-service.ts` | **Extrair** (já é nosso) | trocar `catalog:` por versões do catálogo próprio | baixo | `lia-product.json` lido/gravado igual; cofre recusa sem chave |
| **F11** Brain / roteamento | `@lia/core` | `main/services/lia/brain-*` | **Extrair** | idem | baixo | 34 testes existentes do main |
| **F8** IPC (26 eventos) | `@moeru/eventa` + tipos AIRI | `shared/eventa/index.ts` | **Extrair contrato próprio** | substituir `import type` por `@lia/contracts`; só 3 pontos de runtime | **baixo** | os 26 eventos respondem com o mesmo payload |
| **F2** Janela / transparência | `transparentWindowConfig` de `windows/shared` | `windows/main/index.ts:91` | **Implementar componente próprio** | ~50 linhas de `BrowserWindow` | baixo | janela abre transparente, posiciona, arrasta, fecha |
| **F6** Provedores | `useProviderStore`, `useProviderConfigStore` | `stores/lia/provider.ts:7-8` | **Extrair interface própria sobre `@xsai/model`** | o hub é quase independente; a Lia precisa do registry + config | **médio** | listar modelos de um provedor real; chave inválida recusa |
| **F4/F5** Voz | `useSpeechStore`, `useHearingStore`, `pipelines-audio` | `stores/lia/voice.ts:8`, `hearing.ts:2` | **Investigar antes de decidir** | falta medir quanto de `pipelines-audio` (2 993 linhas) a Lia exercita | **alto** | falar, ouvir, interromper, sem travar |
| **F3** Chat | `useChatStore`, `session-store`, `chat-provider-runtime` | `pages/index.vue:28-29` | **Investigar antes de decidir** | é onde vivem as correções caras; exige a porta `LiaChatPort` (B1) | **alto** | teste de granularidade do dono continua verde |
| **F1** Avatar | `WidgetStage` → 5 renderizadores | `pages/index.vue:24` | **Substituir por biblioteca independente** | escolher renderizador; decidir se mantém os 5 | **alto** | personagem carrega, anima, expressa, fecha sem vazar |
| **F10** Perfis de voz | `@lia/core/voices` + store | `stores/lia/voice-profiles.ts` | **Manter e adaptar** | já quase todo próprio | baixo | importar, listar, remover perfil |
| **F9** Home stop | launcher IPC | commit `a978943` | **Manter** | nenhuma — já é da Lia | baixo | parar pela Home sem duplicar instância |
| **F13** Vision, minecraft, artistry | AIRI | fecho transitivo | **Não replicar** | nenhuma ação | — | — |

---

## 5. Escopo mínimo de uma interface própria

**Aviso de leitura:** isto é o **menor protótipo funcional**, não o produto final.
Nada aqui autoriza remover funcionalidade existente.

### Nível 1 — essencial para iniciar e conversar

1. **Janela** (`BrowserWindow` + transparência + posicionamento) — F2.
2. **Contrato IPC** próprio com os 26 eventos — F8.
3. **Config e segredos** — F7 (já é nosso).
4. **Chat**: enviar mensagem, exibir resposta, histórico de sessão — F3.
5. **Provedor**: selecionar, configurar, listar modelos — F6.
6. **Launcher**: subir e encerrar o Stage sem órfão.

**Estimativa de escopo [I]:** é o maior item do projeto. Depende de B1
(`LiaChatPort`) e de uma decisão sobre o `useChatStore`.

### Nível 2 — necessário para voz, avatar e configuração

7. **TTS** (Kokoro já está em `@lia/core`) e **STT** — F4/F5.
8. **Avatar** com pelo menos um renderizador — F1.
9. **Painel de configurações** — as 5 seções de `components/lia-config/sections/`.

### Nível 3 — opcional, migrável depois

10. Perfis de voz e voz customizada — F10.
11. Voz de inicialização (`startup-greeting.ts`, 247 linhas).
12. Diagnóstico do Brain (70 arquivos no main) — já portátil, pode ir a qualquer momento.

### Nível 4 — AIRI sem uso comprovado pela Lia

Vision, gaming-minecraft, artistry, web-search, devtools, auth, api-server,
godot-stage, plugins/MCP, io-trace, captura de tela, widgets, janelas
`about`/`caption`/`editor`/`notice`/`onboarding`/`spotlight`/`widgets`/`workspace`/`beat-sync`/`desktop-overlay`.

> Não recomendo remover nada disso do AIRI. A conclusão é apenas que **a interface
> própria não precisa reimplementar esses módulos** para atingir paridade com o
> que a Lia usa hoje.

---

## 6. Testes e critérios de equivalência

### 6.1 Testes existentes (não executados nesta rodada)

| Área | Arquivos | Local |
| --- | --- | --- |
| Main da Lia | **34** | `apps/stage-tamagotchi/src/main/services/lia/*.test.ts` |
| Stores da Lia | **18** | `renderer/stores/lia/*.test.ts` |
| Serviços da Lia | **7** | `renderer/services/lia/*.test.ts` |
| Config da Lia | **5** | `renderer/components/lia-config/**` |
| Launcher | **18** | `apps/lia-app/src/main/*.test.ts` |
| `@lia/core` | **28** | `packages/lia-core/src/**/*.test.ts` |
| `lia/` (contratos novos) | **3** | `lia/{core,stage,launcher}/test/` |

**Estado: existentes, NÃO executados.** Não rodei `vitest` nem build nesta
tarefa: exigiria instalar dependências, o que está fora do escopo.

### 6.2 Lacunas de cobertura observadas

- **Nenhum teste de janela real** (`BrowserWindow`) — os testes do launcher usam
  dublês de `spawn`.
- **Nenhum teste de equivalência de contrato IPC** — os 26 eventos não têm teste
  que verifique payload de ponta a ponta.
- **Nenhum teste do avatar** — `Stage.vue` não tem teste de renderização com
  modelo real.
- **Nenhum teste de empacotamento** — o instalador nunca é validado por teste.

### 6.3 Testes propostos para provar equivalência

Todos **apenas propostos**, nenhum escrito.

| # | Fluxo | Teste observável | Como saber que passou |
| --- | --- | --- | --- |
| T1 | Inicialização e encerramento | subir o Stage, esperar `running`, encerrar, conferir lista de processos | nenhum processo do Stage sobra |
| T2 | Abrir/fechar janela | abrir, medir `isVisible()`, fechar, contar janelas | 1 janela, 0 depois de fechar |
| T3 | IPC | invocar cada um dos 26 eventos com payload válido e um inválido | válido responde; inválido recusa sem derrubar |
| T4 | Enviar mensagem e exibir | enviar e observar o nó de texto do DOM | a resposta aparece; espaço entre palavras preservado |
| T5 | Voz de saída | sintetizar um texto, medir tempo até primeiro áudio | áudio sai; interrupção para |
| T6 | Voz de entrada | injetar áudio conhecido, ler transcrição | transcrição não vazia e plausível |
| T7 | Avatar | carregar modelo, checar canvas não vazio, trocar expressão | canvas renderiza; expressão muda |
| T8 | Persistência | gravar config, reiniciar, reler | valor idêntico; `schemaVersion` preservado |
| T9 | Empacotamento | gerar `.exe`, instalar, abrir, conversar, fechar | app instalado funciona |

**T1, T2, T5, T6, T7, T9 exigem Windows real.** Teste unitário verde não é PASS
de runtime — `CURRENT-STATE.md` §6.

---

## 7. Riscos e dependências ainda desconhecidas

| # | Risco | Tipo | Confiança |
| --- | --- | --- | --- |
| R1 | O chat é onde vivem as correções caras; migrá-lo pode reintroduzir bugs já pagos | **alto** | [C] |
| R2 | `pipelines-audio` (2 993 linhas) — não medi quanto a Lia exercita | **desconhecido** | [P] |
| R3 | O avatar exige escolher entre 5 renderizadores; nenhum tem equivalente empacotado equivalente ao `Stage.vue` | médio | [C] |
| R4 | 604 arquivos em `stage-ui` (77 874 linhas) — não medi quais são realmente exercitados em runtime, só os alcançáveis por import | **desconhecido** | [P] |
| R5 | A versão de `airi/` parece anterior à base fixada em alguns arquivos (ex.: `windows/main/index.ts` não tem `FullscreenMode`/`IOTraceRecordingService` que a base tem) | **divergência não explicada** | [P] — registrado como L2 em `AIRI-COMPARISON.md` |
| R6 | Nenhum build foi executado; todas as conclusões vêm de análise estática | limite | [C] |
| R7 | Type-only × runtime foi determinado por sintaxe, não por bundle real | limite | [I] |

**R5 merece atenção:** se a árvore `airi/` diverge da base em pontos que a Lia não
alterou, o inventário de `AIRI-COMPARISON.md` (353/95/0) pode ter imprecisão de
origem. Não investiguei a fundo — fica registrado.

---

## 8. Ordem de implementação recomendada

Deriva do que o código mostra, não de preferência:

1. **Contrato IPC próprio** (F8) — menor risco, maior clareza. Só 3 pontos de
   runtime a substituir. Pré-requisito de tudo.
2. **Extrair `main` da Lia** (F7, F11) — já é quase portátil; 46 arquivos.
3. **Janela própria** (F2) — ~50 linhas; destrava um Stage mínimo que abre.
4. **Provedores** (F6) — o hub já é quase independente.
5. **B1 — `LiaChatPort`** (ver plano) — aqui o Codex passa a ser necessário.
6. **Voz** (F4/F5) — depois de medir `pipelines-audio` (R2).
7. **Avatar** (F1) — por último entre os essenciais; maior incerteza.

Os passos 1–4 podem ser feitos pelo Arena.ai com testes claros. A partir do 5,
é trabalho de arquitetura.

---

## 9. Referências exatas

**Processo principal**
- `apps/stage-tamagotchi/src/main/index.ts` (696 linhas) — DI container, linhas 199–245; chamadas Lia: 415, 424, 434, 455, 480, 504, 528, 542
- `apps/stage-tamagotchi/src/main/services/lia/` — 70 arquivos `.ts` (38 não-teste)
- `apps/stage-tamagotchi/src/main/configs/{lia.ts, lia-schema.ts}` — `createLiaProductConfig` em `lia.ts:15`; `lia-product.md` é documentação, não código
- `apps/stage-tamagotchi/src/main/services/lia/voice-profile-picker.ts:23`

**Contratos compartilhados**
- `apps/stage-tamagotchi/src/shared/eventa/index.ts` — 962 linhas; 85 eventos; 26 `electronLia*`
- Runtime AIRI: linhas 961–962 (`electron-eventa`). Tipos: linhas 1–40.

**Renderer**
- `apps/stage-tamagotchi/src/renderer/pages/index.vue` (1 029 linhas) — imports 2–40
- `apps/stage-tamagotchi/src/renderer/{stores,services,components}/lia*` + `LiaProviderConfig.vue` — 27 arquivos não-teste, 5 224 linhas
- `apps/stage-tamagotchi/src/renderer/services/lia/` — 15 arquivos
- `apps/stage-tamagotchi/src/renderer/components/lia-config/` — `LiaConfigPanel.vue`, `sections/*`
- `apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.vue` (613 linhas)

**Pacotes do AIRI**
- `packages/stage-ui/src/components/scenes/Stage.vue` (1 353 linhas) — exportado como `WidgetStage` em `components/scenes/index.ts:1`; renderizadores em `:1248` (live2d), `:1267` (vrm), `:1282` (spine), mais tachie e mmd
- `packages/stage-ui/src/stores/providers/provider.ts` (1 109 linhas) — imports 16–23
- `packages/stage-ui/src/` — 604 arquivos não-teste, 77 874 linhas
- `packages/lia-core/src/` — 35 arquivos não-teste, 5 835 linhas

**Launcher**
- `apps/lia-app/src/main/airi-stage-manager.ts:123` (`stageDevEntrypointFor`), `:363` (`spawn`)
- `apps/lia-app/src/main/node-runtime.ts` — `ELECTRON_RUN_AS_NODE`

**Método reproduzível:** a resolução de imports foi feita por script sobre a
árvore local, seguindo `import`/`export … from` recursivamente e mapeando
`@proj-airi/<pkg>/<sub>` para `packages/<pkg>/src/<sub>`. Qualquer agente pode
repetir com o mesmo critério.

---

## 10. O que este documento não faz

- Não alterou código, dependência, build ou instalador; `airi/` intocado.
- Não executou build, `vitest` ou qualquer teste.
- Não mediu uso em runtime — apenas alcançabilidade por import.
- Não decidiu a estratégia do chat nem do avatar; ambos exigem histórico e
  julgamento do dono.
