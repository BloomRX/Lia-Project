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
| Alcançado por `pages/index.vue` (a Home da Lia) | ~~675~~ **771 em runtime, 24 pacotes** — ver §11.2 | [C] |
| Código da Lia no processo principal | **38 entradas → 46 arquivos** | [C] |

**A assimetria é a descoberta principal:** no processo principal, a Lia é quase
independente. No renderer, ela é uma camada fina sobre ~771 arquivos de AIRI (§11.2).

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

Fecho: **675 arquivos locais, 31 pacotes `@proj-airi`** — *número superado por §11.2
(resolvedor completo: 771 em runtime); a tabela abaixo mede o mesmo alcance com
resolvedor parcial e serve como piso, não como teto.*

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

Verificadas no registro npm em 28/10/2026 **[C]** — *corrigido em §11.5: `@xsai/*` é
`0.5.0-beta.8`, e `@proj-airi/*` é publicado em parte*:
`@xsai/*` (0.5.0-beta.8, MIT) · `@moeru/eventa` (1.0.2, MIT) · `@moeru/std` (MIT) ·
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

> As seções **11** (B0.1) e **12** (B0.2) vêm depois desta e são rodadas
> posteriores: a 11 corrige números e encerra o R5; a 12 investiga as quatro
> arestas do hub de provedores. Onde houver divergência, vale a seção mais nova.

---

## 11. B0.1 — Validação dos limites da migração (28/10/2026)

Rodada **B0.1**: reexame dos limites que o B0 deixou abertos (R5) e das premissas
que ele não tinha medido em runtime. Base de trabalho: HEAD `ad5c5f7`, árvore limpa,
`airi/` intocado. Nenhum build, nenhum teste, nenhuma sincronização.

Método: resolvedor de imports próprio, que segue **todas** as packages do workspace
(`@proj-airi/<pacote>` → `packages/<pacote>/src`), distingue `import type` de import
de runtime, e permite remover arestas para medir contra-factuais. Nenhuma conclusão
desta seção depende de execução do aplicativo.

### 11.1 R5 — encerrado: não havia divergência; a base da comparação estava errada

**Resultado: o R5 não descreve um defeito da árvore `airi/`. Descreve um defeito da
comparação que o B0 fez.** [C]

Impressão digital da árvore local contra as tags do clone de referência, por hash de
blob do Git (`git ls-tree` × `git hash-object`), nas três subárvores que importam
(`apps/stage-tamagotchi/src`, `packages/stage-ui/src`, `packages/stage-shared/src`):

| Referência | Idênticos | Diferentes | Ausentes localmente | Igualdade |
| --- | --- | --- | --- | --- |
| **`v0.12.0-beta.5`** (`2c1e223`) | **1 040** | **56** | **0** | **94,9 %** |
| `v0.12.0-beta.6` | 606 | 364 | 594 | 62,5 % |
| `v0.13.0` (`3c4aca2`) | 590 | 378 | 619 | 61,0 % |
| `HEAD` do clone (`b9d0bb34a`) | 585 | 383 | 625 | 60,4 % |

A árvore local é `v0.12.0-beta.5` + as modificações da Lia: **zero arquivos ausentes**
contra essa tag, 56 modificados. Contra o `HEAD` do clone faltam 625 arquivos — e é
por isso que `FullscreenMode` e `IOTraceRecordingService` "não existem" localmente.

**Quando esses símbolos entraram:** [C]

| Símbolo | Commit | Assinatura | Data | Primeira tag que o contém |
| --- | --- | --- | --- | --- |
| `FullscreenMode` | `d79a54894` | `feat(stage-tamagotchi): add a fullscreen workspace experiment with two window modes (#2926)` | 2026-10-15 | `v0.12.0-beta.6~85` |
| `IOTraceRecordingService` | `a4da7edd7` | `refactor(stage-tamagotchi): persist local IO traces (#2774)` | 2026-10-03 | `v0.12.0-beta.6~259` |

Ambos são **posteriores** à base fixada. A base fixada tem 229 linhas nesse arquivo;
`v0.12.0-beta.6` em diante tem 467; a árvore local tem **252** — ou seja, 229 + 23
linhas de trabalho da Lia, não uma versão truncada do AIRI.

O clone `/home/user/ref-airi` não está em `v0.13.0`: está em
`v0.13.0-25-gb9d0bb34a`, **25 commits depois** da tag. O `diff -u` do B0 usou esse
`HEAD` como se fosse a base, e daí a impressão de que a árvore local "estava atrás".

**O que a árvore local realmente acrescenta nesse arquivo** (delta contra
`v0.12.0-beta.5`: 84 linhas acrescentadas, 59 removidas), todo ele atribuível à Lia: `./window-sizing`
(`createMainWindowContextSizing`, `HOME_WINDOW_PRESET`, `liaMainWindowStateSchema`,
`MAIN_WINDOW_MIN_SIZE`), `./window-size-settings`
(`createMainWindowSizeSettingsController`), `../../services/lia/initial-route`
(`initialMainWindowContext`, `initialMainWindowRoute`), `../../services/lia/lia-managed`
(`isLauncherManaged`), `../../devflow-diagnostics` (`liaDevflowMark`), e a troca da
config genérica `createConfig('app', 'config.json', …)` por
`createConfig('lia', 'main-window.json', liaMainWindowStateSchema, …)`.

**Isso afeta a precisão das comparações arquiteturais? Não, para `AIRI-COMPARISON.md`.**
Esse documento declara a própria base nas linhas 20 e 39 (`2c1e223…`, com o comando
`git checkout` explícito), e os 353/95/0 foram medidos contra ela. O erro de base
estava **dentro do B0**, na seção 3.1, não naquele relatório. [C]

Consequência prática: **nenhuma sincronização, nenhum `subtree pull`, nenhuma cópia.**
A árvore é fiel à base; o que ela não tem é o que o upstream ganhou depois — e isso é
esperado, não é corrupção. O B0 §3.1 fica corrigido por esta seção.

### 11.2 Acoplamento real do renderer — medido em runtime, não em contagem de arquivos

O B0 contou arquivos alcançáveis incluindo `import type`. A distinção que decidiu o
processo principal (9 pacotes → 2 pontos reais) **não decide o renderer**. Medido de
novo, com resolvedor completo e separando runtime de tipo: [C]

| Entrada | Runtime | Incluindo tipos | Desconto por tipo |
| --- | --- | --- | --- |
| Todo o código da Lia no renderer | **390** | 540 | 28 % |
| `stores/lia/provider.ts` | **176** | 271 | 35 % |
| `stores/lia/voice.ts` | **178** | 273 | 35 % |
| `stores/lia/hearing.ts` | **335** | 436 | 23 % |
| `stores/lia/capabilities.ts` | **336** | 437 | 23 % |
| `pages/index.vue` (Home) | **771** | 887 | 13 % |
| `pages/chat.vue` | **593** | 848 | 30 % |
| `pages/settings/system/index.vue` | **539** | 732 | 26 % |

**A conclusão do B0 se sustenta e fica mais forte:** o acoplamento do renderer é
genuinamente de runtime. O desconto por tipos fica entre 13 % e 35 %, contra ~78 % no
processo principal. Não existe "cortar os tipos e sobra pouco" no renderer.

**Correção de números:** os valores do B0 §3.2 (675 para a Home, 641 para o chat, 598
para as configurações) saíram de um fecho que **não atravessava todas as packages** —
paravam em `@proj-airi/ui`, `core-agent`, `pipelines-audio`, `i18n`, entre outras. Com
o resolvedor completo, a Home alcança **771 arquivos em 24 packages** (381 deles em
`stage-ui`). Os números do B0 eram portanto um piso, não um teto.

**Limite honesto desta medição:** alcançabilidade estática não é bundle. Os barris
`packages/ui/src/index.ts` (7 linhas de `export *`, 68 arquivos) e
`stage-shared/src/index.ts` (11 `export *`) inflam o fecho: tocar em qualquer símbolo
arrasta a biblioteca inteira na contagem, mas o Vite faz tree-shaking no artefato
final. Por isso **nenhuma decisão de corte deve ser tomada por contagem de arquivos** —
o critério útil é a aresta que cruza uma fronteira semântica, medido a seguir.

**A fronteira Lia → `stage-ui` é estreita e enumerável:** 17 módulos distintos, **15
com uso de runtime e 2 apenas de tipo**. [C]

| Módulo `stage-ui` | Usos runtime | Usos só de tipo |
| --- | --- | --- |
| `stores/providers/provider` | 4 | 0 |
| `stores/providers/config` | 4 | 0 |
| `stores/chat/chat-provider-runtime` | 4 | 3 |
| `stores/modules/speech` | 3 | 0 |
| `stores/settings` | 2 | 0 |
| `stores/modules/airi-card` | 2 | 0 |
| `libs/speech/tts-fallback`, `libs/providers/providers/custom-local-voice`, `libs/capabilities/lia-capability-port`, `libs/diagnostics/audio-probe`, `stores/modules/consciousness`, `stores/modules/hearing`, `stores/speech-runtime`, `stores/chat/provider-context`, `stores/chat/retry-content`, `stores/onboarding`, `stores/auth`, `stores/ai/chat-llm/llm`, `libs/providers/providers/registry` | 1 cada | — |
| **`stores/chat`** | **0** | **3** |
| **`types/chat`** | **0** | **2** |

Isso corrige uma implicação do B0 §3.2: `stores/chat` (o store de 173 arquivos de
fecho) é importado pela Lia **apenas como tipo**. O consumidor real de chat no runtime
é `stores/chat/chat-provider-runtime`, com 4 usos.

**Massa que a Lia carrega sem usar como produto.** Removendo as arestas de
autenticação, analytics e beat-sync do grafo e recomputando: [I, por contra-factual
estático]

| Fecho | Real | Sem auth/analytics/beat-sync | Removível |
| --- | --- | --- | --- |
| Código da Lia no renderer | 390 | 349 | **41 (11 %)** — 32 em `stage-ui`, 7 em `stage-shared` |
| `stores/lia/provider.ts` | 176 | 141 | 35 (20 %) |
| `stores/lia/voice.ts` | 178 | 143 | 35 (20 %) |
| `stores/lia/hearing.ts` | 335 | 294 | 41 (12 %) |

Os arquivos que saem são `stage-shared/src/auth/*` (OIDC, PKCE),
`stage-shared/src/beat-sync/*`, `stage-ui/src/libs/analytics/**` (21 arquivos de
telemetria) e `steam-auth-client`. **Nenhum deles é funcionalidade da Lia**; todos
entram por dois módulos-ponte: `stores/providers/provider.ts:34` (`useAuthStore`) e
`stores/providers/config.ts:10` (`client` de `composables/api` → `libs/auth-fetch`).

**O hub de providers é uma fronteira fina, apesar do fecho grande.** `provider.ts`
(1 109 linhas) tem **quatro** arestas internas para fora de si: [C]

1. `../auth` → `useAuthStore` — usado em `provider.ts:995` como
   `providerConfiguredBy(id) !== 'authentication' || authStore.isAuthenticated`
2. `../chat/chat-provider-runtime` → `getProviderCredentialResolver`
3. `./config` → `useProviderConfigStore`
4. `../../composables/api` (via `config.ts:10`) → `client` → `libs/auth-fetch`

Quatro arestas, duas delas carregando exatamente a massa de auth/analytics que a Lia
não usa. **É a fronteira semanticamente mais estreita do renderer** — o que sustenta a
prioridade do hub na migração, desde que as quatro arestas sejam resolvidas antes.

### 11.3 O avatar — o contrato existe, mas não onde parecia

**O B0 tratou `WidgetStage` como "o componente de avatar". Não é.** `Stage.vue` tem
1 353 linhas, das quais 1 228 são script, e é o **hospedeiro de runtime** da fala e do
chat: [C]

- 107 referências a `speech`/`Speech` e 35 a `tts`/`TTS` no arquivo;
- **12 linhas** de import de `../../stores/`, que trazem **13 stores** (`useChatStore`, `useSpeechStore`, `useProviderStore`,
  `useProviderConfigStore`, `useSettings`, `useSettingsDeveloper`, `useAudioContext`,
  `useSpeakingStore`, `useBackgroundStore`, `useAiriCardStore`,
  `useSpeechRuntimeStore`, `useSpeechOutputControlStore`, `useLlmStreamingControlStore`);
- **12** linhas de import de `../../libs/*`, 9 delas de fala (`tts-session`, `tts-fallback`,
  `synthesize-target`, `latency-probe`, `pipeline-tuning`, `text-for-speech`,
  `playback-speaking-state`) e ainda DuckDB (`useDuckDb`) e observabilidade
  (`useIOTraceBridge`, `initIOTracer`).

**A assinatura pública de `Stage.vue` parece limpa — e isso é uma armadilha:**

```
props: cursorPosition?, enableOrbitControls?, paused?      (3 props)
v-model:state                                             ('pending'|'loading'|'mounted')
defineExpose: canvasElement, captureFrame, readRenderTargetRegionAtClientPoint
```

Três props e três métodos sugerem um componente substituível. Mas o componente lê o
resto do mundo por **store global**, não por prop. Ou seja: um componente de avatar
independente **não pode ser obtido ligando-se nessas três props** — o corpo precisa ser
reescrito para receber por injeção o que hoje lê de 13 stores.

**Os renderizadores, ao contrário, já estão separados e têm um contrato real:** [C]

| Pacote | Arquivos | Dependências `@proj-airi` declaradas |
| --- | --- | --- |
| `stage-ui-live2d` | 32 | `stage-shared`, `ui`, `model-driver-magic-live2d` |
| `stage-ui-three` (VRM) | 37 | `stage-shared`, `ui` |
| `stage-ui-mmd` | 25 | `stage-shared`, `ui` |
| `stage-ui-spine` | 19 | `stage-shared`, `ui` |
| `stage-ui-tachie` | 12 | `stage-shared`, `ui` |

Fecho transitivo dos cinco juntos: **207 arquivos** — 111 alcançáveis a partir dos
respectivos `index.ts` (dos 125 arquivos que os cinco têm), mais
`ui` 68, `stage-shared` 21, `model-driver-magic-live2d` 4, `electron-screen-capture` 2
e **exatamente 1 arquivo de `stage-ui`**. Cada pacote define os próprios stores locais
(`useSettingsLive2d`, `model-store`, `expression-store`, `spine`, `tachie`, `mmd`). [C]

**O contrato que os renderizadores recebem de `Stage.vue`** — enumerável, e é ele que
uma interface própria precisa reproduzir: `model-src`, `model-id`, `cursor-position`,
`mouth-open-size`, `now-speaking`, `paused`, `theme-colors-hue`,
`theme-colors-hue-dynamic`, `current-audio-source`, `show-axes`, `enable-orbit-controls`,
`idle-animation`, mais afinação por renderizador (`live2d-shadow-enabled`,
`live2d-max-fps`, `live2d-render-scale`, `premultiplied-alpha`,
`default-mix-duration`, `idle-animation-enabled`, `max-fps`, `render-scale`), e os
eventos `@error`, `@vrm-interact`, `v-model:state`. [C]

**A ressalva que impede chamar isso de simples:** o único arquivo de `stage-ui` que os
renderizadores usam — `stores/audio.ts`, para `useAudioContext` no lip-sync — é
importado por **caminho relativo que atravessa a fronteira de pacote**:
`stage-ui-three/src/composables/vrm/lip-sync.ts:11` e
`stage-ui-mmd/src/composables/mmd/lip-sync.ts:21` fazem
`import { useAudioContext } from '../../../../stage-ui/src/stores/audio'`. Isso não é
dependência declarada em `package.json`: é acesso ao código-fonte do vizinho. **Quebra
em silêncio** quando `stage-ui` se move, e não aparece em nenhuma checagem de
dependências. [C]

**Veredito sobre o avatar:** existe contrato viável, e ele é pequeno — mas para os
**renderizadores**, não para `Stage.vue`. O trabalho não é "extrair o avatar": é
(a) declarar o contrato dos renderizadores como pacote próprio, (b) resolver o
`useAudioContext` por injeção em vez de caminho relativo, e (c) **reescrever a
orquestração** que hoje vive em `Stage.vue` — o que é a maior parte das 1 353 linhas.
Tratar isso como extração de componente subestima o trabalho em uma ordem de grandeza.

### 11.4 Sequência incremental — o que a evidência sustenta e o que não

**A premissa "hub de providers primeiro" resiste**, mas não pelo motivo do B0. Não é
porque o hub seja pequeno em arquivos (o fecho é 176) — é porque a **fronteira
semântica é de quatro arestas** (§11.2). O que precisa ser feito antes de mover o hub
é resolver essas quatro, e duas delas são justamente os portadores de auth.

**Precedente real do padrão de porta, já funcionando neste código:** [C]
`stage-ui/src/libs/capabilities/lia-capability-port.ts` — 65 linhas, **zero imports**,
snapshot de dados sem campo para vazar detalhe interno, injetado pelo host
(`stores/lia/capabilities.ts`, 5 referências) e consumido por `stage-ui`
(`stores/chat/context-providers/lia-capabilities.ts` e `Stage.vue`). A direção é
invertida — o AIRI hospeda a porta da Lia — mas a mecânica está provada e é o modelo a
repetir.

Sequência proposta, com a propriedade de reversibilidade de cada passo:

| # | Corte | Por que é reversível | Evidência |
| --- | --- | --- | --- |
| 1 | **Contrato IPC** (`shared/eventa`, 26 eventos `electronLia*` de 85) | é superfície declarativa; nada executa sem os dois lados | B0 §3.1 [C] |
| 2 | **Extrair o `main` da Lia** (46 arquivos, 2 pontos de AIRI: `eventa/index.ts:961-962`, `voice-profile-picker.ts:23`) | o processo principal já é quase independente; a Lia pode continuar usando o renderer do Stage | B0 §3.1 [C] |
| 3 | **Janela própria** (~50 linhas de `BrowserWindow`) | não toca em store nem em fluxo | B0 §8 [C] |
| 4 | **Hub de providers** — resolver as 4 arestas (`auth`, `chat-provider-runtime`, `config`, `composables/api`) | o hub não importa nenhuma package AIRI diretamente; a troca é de 4 símbolos | §11.2 [C] |
| 5 | **Porta de chat** (`LiaChatPort`, molde do `lia-capability-port`) | porta de dados puros; falha fechada sem snapshot | §11.4 [C] |
| 6 | **Voz** — só depois de medir `pipelines-audio` (17 arquivos no fecho) e os 3 stores de fala | `speech`/`tts` é o maior bloco de `Stage.vue` | §11.3 [C] |
| 7 | **Avatar** — contrato dos renderizadores, depois orquestração | 207 arquivos, mas só 1 ponto de `stage-ui`, hoje por caminho relativo | §11.3 [C] |

**O que a evidência NÃO sustenta:**

- **Avatar primeiro.** É o item de menor risco conceitual e maior custo real: 111
  arquivos próprios + a reescrita da orquestração de 1 228 linhas de script. Fica por
  último.
- **`hearing` antes de `speech`.** `hearing.ts` é o maior fecho (335) e ainda carrega
  `audio-probe`, `streaming-transcription-consumers` e consumidores de fala. Não é
  passo inicial.
- **`settings` como corte.** O store de settings é atravessado por quase tudo
  (`stores:settings` tem 12 arestas de saída no grafo de clusters). Cortá-lo cedo
  quebra os outros passos.
- **Ordem "ideal" garantida.** Os passos 1–4 são seguros por serem declarativos ou de
  fronteira fina; 5–7 não têm evidência de execução — nenhum foi rodado. A ordem é
  uma hipótese fundamentada, não um resultado medido. [P]

### 11.5 Licenças — o que fecha e o que continua aberto

Escopo: **apenas** os itens que o B0 §3.5 deixou pendentes, mais o que apareceu no
caminho por ser dependência direta dos renderizadores. Não é auditoria geral.

| Item | Versão | Licença identificada | Fonte | Restrição de redistribuição | Estado |
| --- | --- | --- | --- | --- | --- |
| `@xsai/*` | **`0.5.0-beta.8`** | MIT | `registry.npmjs.org`, campo `license` | nenhuma | **[C]** |
| `@moeru/eventa` | `1.0.0` (catálogo) | MIT | registry; `1.0.0` e `1.0.2` conferidos | nenhuma | **[C]** |
| `@pixiv/three-vrm` | `^3.5.5` → `3.5.5` | MIT | registry | nenhuma na lib | **[C]** |
| `pixi-live2d-display` | `^0.4.0` → `0.4.0` | MIT (o wrapper) | registry | **patch local de 198 linhas** (`patches/pixi-live2d-display.patch`) que remove `core/` e `cubism/` do pacote | **[C]** |
| **Live2D Cubism Core** | `CubismSdkForWeb-5-r.3` | **termos Live2D — não é MIT** | `index.html:18` carrega `/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js`; o arquivo **não está no repositório**, é baixado no build por `DownloadLive2DSDK` (`@proj-airi/unplugin-live2d-sdk`) | o binário **é redistribuído dentro do artefato construído**; uso e redistribuição regidos pelo contrato Live2D | mecanismo **[C]**, texto dos termos **[P]** |
| **Spine Runtimes** | `~4.2.0`, `~4.0.31`, `~4.1.56` | **Spine Runtimes License Agreement — não é MIT** | `packages/stage-ui-spine/LICENSE.md:34-53`, declaração do próprio repositório | **exige licença do Spine Editor para integrar em produto**; proíbe sublicenciar (inclusive sob MIT); redistribuição deve incluir o acordo e o copyright | **[C]** |
| `@proj-airi/ui` | workspace `0.12.0-beta.5` · npm `0.13.0` | MIT | registry + `packages/ui/package.json` | disponível publicamente, **mas a versão publicada é outra** | **[C]** |
| `@proj-airi/stage-shared` | — | — | **404 no registry** | precisa ser carregado ou reimplementado | **[C]** |
| Modelos de avatar (VRM/Live2D) | — | — | **nenhum modelo versionado** no repositório | — | **[C]** |

**Duas correções ao B0 §3.5:**

1. `@xsai/*` é **`0.5.0-beta.8`**, não `0.5.1`. O catálogo está em
   `pnpm-workspace.yaml:237-247`. O B0 afirmou "[C] verificado no registro" para um
   número de versão que não existe no projeto.
2. `@proj-airi/*` **não é uniformemente 404**. `@proj-airi/ui` (0.13.0) e
   `@proj-airi/unplugin-live2d-sdk` (0.1.7) **estão publicados, ambos MIT**.
   Confirmados como 404: `stage-shared`, `electron-eventa`, `core-agent`, `stage-ui`,
   `i18n`, `pipelines-audio`, `stage-ui-three`, `stage-ui-live2d`. A regra correta é
   "verificar por pacote", não "assumir não publicado".

**O achado que muda o cálculo de migração:** o renderizador **Spine não é livre de
licença**. `packages/stage-ui-spine/LICENSE.md` separa explicitamente o código MIT do
projeto das Spine Runtimes, que *"NOT covered by the MIT License"*, exigem licença
paga do Spine Editor para integração em produto e proíbem sublicenciamento. Um dos
cinco renderizadores do avatar, portanto, **carrega obrigação comercial** que os outros
quatro não carregam. O B0 tratou os cinco como equivalentes — não são.

O mesmo raciocínio, em menor grau, vale para o Live2D: o Core não está versionado
(nenhum risco de licença no Git), mas é baixado e **embutido no artefato final**. Quem
distribuir o instalador da Lia distribui código Live2D sob o contrato da Live2D.

**Continua pendente [P]:** o texto integral do contrato Live2D (não foi buscado nesta
rodada, por disciplina de escopo); se o Spine Editor já está licenciado para o dono do
produto; e se o uso pretendido se enquadra nas faixas de isenção de cada fornecedor.
Nenhuma dessas três perguntas se responde lendo código.

### 11.6 Decisões ainda abertas

| # | Decisão | Por que não foi tomada aqui |
| --- | --- | --- |
| D1 | **Spine entra no produto?** | depende de licença comercial; é decisão do dono, não de arquitetura |
| D2 | **Live2D entra no produto?** | idem, e depende de o Core ser embutido ou servido |
| D3 | Os 4 renderizadores livres (VRM, MMD, Tachie, Live2D) cobrem a necessidade de avatar? | só o dono sabe qual formato o produto exige |
| D4 | O hub de providers corta `auth` ou mantém um adaptador? | exige decidir se a Lia terá conta de usuário |
| D5 | A ordem 5–7 (chat, voz, avatar) se confirma? | nenhum passo foi executado; a ordem é hipótese |
| D6 | `@proj-airi/ui`: usar do npm (0.13.0) ou carregar o do workspace? | versões divergem; escolha afeta os 5 renderizadores |
| D7 | `stage-shared` (404): carregar ou reimplementar? | 21 arquivos no fecho dos renderizadores; reimplementar é trabalho real |

### 11.7 O que mudou em relação ao B0

| Item do B0 | Antes | Depois desta seção |
| --- | --- | --- |
| **R5** (divergência da árvore) | "divergência não explicada" [P] | **encerrado**: árvore fiel a `v0.12.0-beta.5` (94,9 %); erro era a base da comparação (§11.1) |
| Home alcança | 675 arquivos | **771 em runtime** / 887 com tipos; 24 packages (§11.2) |
| Acoplamento do renderer | contagem de arquivos | **runtime separado de tipo**; desconto de 13–35 %, não 78 % (§11.2) |
| `stores/chat` | implicado como acoplamento de runtime | **apenas tipo** (0 usos runtime) (§11.2) |
| `WidgetStage` = componente de avatar | tratado como o avatar | **é hospedeiro de runtime** (13 stores, 1228 linhas de script); o contrato está nos renderizadores (§11.3) |
| Renderizadores | "cinco renderizadores" | **5 pacotes separados, 207 arquivos, 1 ponto de `stage-ui` via caminho relativo** (§11.3) |
| Ordem de implementação | hub de providers primeiro | **mantida**, mas justificada por 4 arestas, não por tamanho; avatar explicitamente por último (§11.4) |
| `@xsai/*` | `0.5.1` | **`0.5.0-beta.8`** (§11.5) |
| `@proj-airi/*` | "não publicado" | **publicado em parte**: `ui`, `unplugin-live2d-sdk` (§11.5) |
| Licença dos renderizadores | tratados como equivalentes | **Spine não é MIT**; Live2D Core embutido no artefato (§11.5) |

**O que esta seção não fez:** não alterou código, dependência, build ou instalador;
não sincronizou nem copiou nada de `airi/`; não executou build nem teste; não buscou o
texto integral das licenças de terceiros. Todas as medições são estáticas, sobre a
árvore local, e nenhuma afirma que um fluxo funciona — apenas o que ele alcança.

---

## 12. B0.2 — Preparação do desacoplamento do hub de providers (28/10/2026)

Terceira rodada. Escopo: **apenas as quatro arestas** que o B0.1 nomeou em
`stores/providers/provider.ts`. Nenhum código alterado, nada movido ou copiado,
`airi/` intocado. Nenhum build, nenhum teste executado nesta rodada.

> **Nota de recuperação de ambiente.** O workspace foi reinicializado antes desta
> rodada e `/home/user/lw` não existia mais. O trabalho sobreviveu porque estava
> comitado e enviado (`1ba42a3`); a árvore foi reobtida por `git clone` da branch
> e o HEAD conferido contra o remoto antes de qualquer leitura. Nada foi perdido.

### 12.1 Resultado que muda a decisão

O B0.1 recomendou resolver as quatro arestas "antes de mover o hub", tratando-as
como quatro problemas do mesmo tipo. **Não são.** Três medições mudam a leitura:

**1. A aresta 2 não é uma dependência — é uma porta.** `chat-provider-runtime.ts`
tem **um único import, e é `import type`** (`@proj-airi/core-agent`, apagado na
compilação). Fecho de runtime: **1 arquivo** — ela própria. É um registro de cinco
pares `register*/get*` sem estado persistido, sem I/O e sem semântica de chat. O
nome no caminho é o que induz ao erro. [C]

**2. A aresta 1 é morta em runtime para os provedores da Lia.** O uso é uma
expressão booleana em `provider.ts:995`:

```
providerConfiguredBy(providerId) !== 'authentication' || authStore.isAuthenticated
```

`providerConfiguredBy` devolve `definition.configuredBy ?? 'user'`. Só quatro
definições declaram `'authentication'` — as quatro `official-*`
(`libs/providers/providers/official/index.ts:67,105,223,348`). Os dez provedores
que a Lia oferece (`LIA_CHAT_PROVIDER_OPTIONS`, `stores/lia/provider.ts:44-55`) não
declaram nada, logo são `'user'`, logo o lado esquerdo do `||` é `true` e
`authStore.isAuthenticated` **nunca é lido** — curto-circuito. [C]

O que a Lia *realmente* carrega pela aresta 1 é a **instanciação do store** em
`provider.ts:116` (`const authStore = useAuthStore()`), que existe só para
satisfazer essa leitura que nunca acontece. É isso que arrasta o grafo de auth.

**3. A aresta 4 nunca é executada pela Lia.** `client` só é usado em
`createProvidersQueryOptions` (`config.ts:28-37`) e nas três mutações remotas.
O único chamador de `fetchProviders` em todo o repositório é
`packages/stage-pages/src/pages/v2/settings/providers.vue:18` — a página de
configurações do AIRI, que não é a da Lia. O painel da Lia monta
`LiaProviderConfig.vue`, que lê `LIA_CHAT_PROVIDER_OPTIONS` de uma lista curada
local. [C]

**Consequência:** a aresta 4 é peso morto — mas peso morto **carregado no grafo de
módulos**, porque importar `config.ts` importa `composables/api.ts`, que importa
`auth-fetch`, que importa `analytics`. Não executar não é não carregar.

### 12.2 Medições

Fecho de runtime de `stores/providers/provider.ts`, com o resolvedor que segue
todas as packages do workspace: [C]

| Cenário | Arquivos |
| --- | --- |
| Real | **151** |
| Sem as arestas 1 e 4 (`auth` + `api`) | 148 |
| Só sem os provedores `official` | 140 |
| **Sem as arestas 1 e 4 e sem `official`** | **28** |

Os 123 arquivos que caem (81 %) vêm de dois portadores, e só dois:

- `auth.ts` → `composables/api.ts` → `auth-fetch.ts` → `libs/analytics/index.ts`
  (21 arquivos) → `airi-card` → `vision` → `server-sdk` → `better-ws`;
- `libs/providers` (barril) → `official/index.ts` → `official/shared.ts` →
  `chat/session-store.ts` → `core-agent` (20 arquivos) + `database` (2).

Composição dos 151: `stage-ui` 95 · `core-agent` 20 · `stage-shared` 18 ·
`server-sdk` 4 · `better-ws` 4 · `server-shared` 5 · demais 5. Preocupações
estranhas à configuração de provedores: **analytics 21, auth 5, database 2 — 28
arquivos, 18,5 %**. [C]

**A ressalva que impede vender isso como redução de pegada.** Aplicando os mesmos
cortes ao fecho do código da Lia no renderer, o ganho é de **6 %** (390 → 367), não
81 %. Motivo: `stores/lia/voice.ts` e `hearing.ts` alcançam `stores/modules/speech.ts`,
que importa `OFFICIAL_SPEECH_PROVIDER_ID` e `setupOfficialSpeechAutoPick`
(`speech.ts:17`) e tem ramos explícitos para o provedor oficial (`:208`, `:213`,
`:302`), além de chegar a `analytics` por caminhos próprios. **O corte libera o hub
para ser movido; não reduz a pegada total da Lia**, que só cai quando ela deixar de
usar o runtime de fala e chat do Stage. [C]

Também medido: trocar o barril `libs/providers` por um import direto de
`providers/registry.ts` (onde vive `getDefinedProvider`) economiza **6 arquivos**
(151 → 145). É ganho real mas pequeno; o grosso do fecho é a **máquina de
provedores**, que é intrínseca ao hub, não uma aresta. [C]

### 12.3 As quatro arestas

#### Aresta 1 — `../auth`

| | |
| --- | --- |
| **Arquivo / símbolo** | `stores/providers/provider.ts:34` importa `useAuthStore` de `stores/auth.ts`; usado em `:116` (instanciação) e `:995` (única leitura, `.isAuthenticated`) |
| **Comportamento atual** | Um provedor só conta como configurado para um módulo se estiver em `configuredProviders` **e** (não for `configuredBy: 'authentication'` **ou** houver sessão) |
| **O que a Lia usa** | **Nada em runtime.** Para os dez provedores dela o lado esquerdo do `||` é sempre `true`; o booleano nunca é avaliado. A Lia funciona sem conta hoje — não por desenho, por curto-circuito |
| **Dependências transitivas** | `auth.ts` (434 linhas) → `composables/api.ts` → `auth-fetch` → `analytics` (21) → `airi-card` → `vision` → `server-sdk` → `better-ws`. Total com `auth` como entrada: **151 arquivos**; sem `analytics`: **24** |
| **Contrato mínimo a preservar** | "Um provedor de propriedade da autenticação só está configurado se houver sessão." Para a Lia, nenhum provedor é dessa classe |
| **Alternativa proposta** | Trocar o **store** por uma **porta de uma função**: `isAuthenticationOwnedProvider(id) => boolean` (ou um `isSessionPresent: () => boolean` injetado, com padrão `false`). O hub fica sem `useAuthStore` e sem instanciar auth |
| **Riscos** | Se o produto passar a usar os provedores `official-*`, a porta precisa virar real. Enquanto a Lia não os usa, `false` é fiel ao comportamento observado — mas é uma **escolha**, não uma equivalência com a sessão real |
| **Testes existentes** | `provider.test.ts` (8 testes) já injeta sessão via `useAuthStore().$patch({ user, session })` (`:150`) — cobre o ramo de auth |
| **Testes necessários** | (a) provedor `user` listado com sessão ausente; (b) provedor `authentication` **não** listado sem sessão e listado com ela; (c) o hub não instancia o store de auth |

#### Aresta 2 — `../chat/chat-provider-runtime`

| | |
| --- | --- |
| **Arquivo / símbolo** | `provider.ts:35` importa `getProviderCredentialResolver`; usado em `withResolvedCredential` (`:97-107`) |
| **Comportamento atual** | Ao construir a instância do provedor, funde em memória as credenciais que o host registrou. Sem resolver, devolve a config intacta. O valor fundido **nunca é persistido nem logado** |
| **O que a Lia usa** | **Tudo.** `stores/lia/provider.ts:519` registra o resolver que lê do cofre da Lia; é assim que a `apiKey` chega ao provedor sem tocar localStorage |
| **Dependências transitivas** | **1 arquivo** (ela própria). Import único é `import type`. Cinco pares `register*/get*` sobre variáveis de módulo |
| **Contrato mínimo** | `(providerId) => Promise<Record<string, unknown> \| undefined>`, fundido na config só no build da instância |
| **Alternativa proposta** | **Nenhuma.** Esta aresta já é o que o B0.2 quer construir: uma porta sem dependências, com o host injetando. O erro seria movê-la para dentro de um "módulo de chat" da Lia — o lugar dela é um módulo de portas do host |
| **Riscos** | O nome do arquivo sugere acoplamento com chat e convida a "extrair de chat", o que arrastaria `core-agent` junto. Manter o módulo como está e apenas reconhecê-lo como porta é o caminho de menor custo |
| **Testes existentes** | `chat-provider-runtime.test.ts`, `send-error.test.ts` (usa `LIA_VAULT_KEY`), `provider-schema-defaults.test.ts` (4 usos) e, do lado Lia, `runtime-wiring.test.ts` — 9 testes, incluindo *"builds the chat provider instance with the vault credential"* e *"keeps the secret out of the provider record, the product config and the logs"* |
| **Testes necessários** | Nenhum novo para mover. Falta apenas um teste que prove a **ausência de dependência de runtime** do módulo (ex.: que o fecho seja ele mesmo) |

#### Aresta 3 — `./config`

| | |
| --- | --- |
| **Arquivo / símbolo** | `stores/providers/config.ts:10` importa `client`; `provider.ts:36` importa `useProviderConfigStore` |
| **Comportamento atual** | Store de 276 linhas que **possui o estado persistido** dos provedores, sincroniza entre janelas (`pinia-plugin-synced`, `state: true`, 9 ações sincronizadas) e replica cada mutação no backend |
| **O que a Lia usa** | **6 membros**: `getProvider`, `getProviderConfig`, `ensureProvider`, `updateProviderConfig`, `providers`, `configuredProviders` |
| **Dependências transitivas** | 151 arquivos; sem `analytics`, 127; sem `official`, 140 |
| **Contrato mínimo** | O registro `Record<id, InferenceServiceProvider>` com `{ id, definitionId, config, status, configuredBy }`, persistido, mais as duas derivadas |
| **Alternativa proposta** | Manter o store (o estado é dele e é bem modelado) e **remover dele a replicação remota**. A Lia precisa do registro local, não do backend |
| **Riscos** | (a) `pinia-plugin-synced` é a **única** via de propagação entre janelas desta store (`listenToStorageChanges: false`, comentário em `config.ts:16-19`); uma implementação própria teria de reproduzir isso; (b) há uma **migração legada** que roda na construção do store (`config.ts:52-68`), copiando `settings/credentials/providers` para `settings/providers/configured` — precisa ser preservada ou descartada conscientemente |
| **Testes existentes** | `config.test.ts` (5 testes), `provider-schema-defaults.test.ts` (8) |
| **Testes necessários** | (a) migração legada roda uma única vez; (b) o registro sobrevive a recarregar sem backend disponível; (c) sincronização entre duas instâncias Pinia |

#### Aresta 4 — `../../composables/api`

| | |
| --- | --- |
| **Arquivo / símbolo** | `config.ts:10` importa `client`; consumido apenas em `createProvidersQueryOptions` (`:28-37`) e nas três mutações (`:85-98`) |
| **Comportamento atual** | Cliente Hono tipado contra `SERVER_URL`, com `authedFetch` que injeta Bearer, renova em 401 e anexa cabeçalhos de analytics |
| **O que a Lia usa** | **Nada.** `fetchProviders` nunca é chamado pela Lia. **Mas `updateProviderConfig` é** — e ele dispara `patchConfigRemote` **sempre**, em `config.ts:224`, dentro de `try/catch`: a falha é silenciosa, a requisição acontece |
| **Dependências transitivas** | 151; com `analytics` bloqueado, 24. É o portador do maior bloco |
| **Contrato mínimo** | Nenhum. A Lia não tem contrato com o backend do AIRI |
| **Alternativa proposta** | Remover a replicação remota da store. A Lia mantém só o snapshot local |
| **Riscos** | **Este é o achado mais sério da rodada** — ver §12.4 |
| **Testes existentes** | `config.test.ts` mocka `patchConfigRemote` (`:17`) e **afirma o envio de `{ apiKey: 'sk-test' }`** para o serviço (`:105-121`) |
| **Testes necessários** | (a) `updateProviderConfig` **não** faz rede quando a replicação está desligada; (b) nenhuma config com campo de segredo sai do processo |

#### A quinta coisa que não é aresta

`setProviderAvailabilityOverride` (`provider.ts:201`) é exposto na store (`:1071`) e
na lista de ações sincronizadas (`:1102`), mas **não tem nenhum chamador no
repositório** — nem em testes. O comentário em `provider.ts:192-194` afirma que é
"escrito pela cola de auth-sync depois de sondar o servidor"; essa cola não existe.
Um seam morto, com comentário obsoleto. Para a Lia, o mapa de overrides é sempre
`{}` e não tem efeito. **Não remover** — é código do upstream e a remoção seria uma
alteração não autorizada; apenas registrar que ele não é dependência. [C]

### 12.4 Configurações e segredos — o que a evidência mostra

O desenho é correto **no caminho da Lia** e permissivo **na store**. As duas coisas
são verdadeiras ao mesmo tempo.

**O que a Lia garante, com teste.** `ensureProviderRecord`
(`stores/lia/provider.ts:346-358`) grava apenas `{ baseUrl }`; o comentário declara
que a `apiKey` fica no cofre e o resolver a injeta em memória. `testConnection`
monta `config.apiKey` **transitoriamente** e o passa a `validateProviderConfig`,
que valida sem persistir (`provider.ts:240-300`). O teste
*"keeps the secret out of the provider record, the product config and the logs"*
(`runtime-wiring.test.ts:257`) verifica que o segredo não aparece em
`settings/providers/configured`, no config do produto nem nos logs. [C]

**O que a store permite.** A invariante "config não contém segredo" é **convenção
por chamador**, não tipo nem validação:

1. `patchConfigRemote` (`services/inference-service-providers.ts:181-206`) envia
   `json: { config }` **sem redação**.
2. `updateProviderConfig` chama a mutação **incondicionalmente** (`config.ts:224`),
   dentro de `try/catch`.
3. A página de edição do AIRI escreve `apiKey` **dentro** de `config`:
   `setFieldValue` (`pages/v2/settings/providers/edit/[providerId]/index.vue:192-198`)
   grava `config[key] = value`, e `commitEditedConfig` (`:375`) envia
   `updateProviderConfig(id, { ...config }, status)`.
4. `config.test.ts:105-121` **afirma** que `{ apiKey: 'sk-test' }` chega a
   `patchConfigRemote`.

Somando 1–4: **pelo caminho do AIRI, uma chave de API digitada pelo usuário é
persistida em localStorage e enviada ao backend em `SERVER_URL`.** [C]

`SERVER_URL` (`libs/server.ts:1`) é
`import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'` — um domínio de
fornecedor **fixo no código**, alcançável a partir do grafo do hub via aresta 4.
O B0.1 já registrou a regra de marca; aqui aparece o mecanismo concreto. Se a
constante sobrevive ao empacotamento depende de tree-shaking do `client`, que
**não foi medido** — a árvore de módulos incluí-la é fato; o bundle final não foi
verificado. [P para o bundle, C para o grafo]

**O que isso significa para a Lia, sem exagero.** A Lia hoje não vaza nada: ela não
chama `updateProviderConfig` com chave e não monta a página de edição do AIRI. O
risco é de **fronteira compartilhada**: enquanto a Lia usar a mesma store, a
garantia dependerá de nenhum outro chamador fazer o que a página do AIRI faz. Uma
store própria da Lia, sem replicação remota, converte a convenção em estrutura.

**Não examinado nesta rodada, e assim declarado:** o cofre (implementação, onde
grava, como cifra) e o formato real do `lia-product.json`. Lê-los exigiria tocar
em arquivos do usuário; ficou fora por decisão de escopo. Nenhum valor de segredo
foi lido, impresso ou copiado.

### 12.5 Conta da Lia × autenticação de provedor

A decisão de produto é que a Lia funcione **sem conta própria obrigatória**. A
evidência mostra que as duas coisas já estão separadas no código, e que só uma
delas existe hoje:

| Conceito | Existe? | Onde | Precisa para configurar provedor? |
| --- | --- | --- | --- |
| **Autenticação de provedor** (a `apiKey` do usuário para OpenAI, Groq, etc.) | **sim** | cofre da Lia + resolver registrado em `stores/lia/provider.ts:519` | **sim** |
| **Conta do AIRI** (sessão OIDC, `useAuthStore`) | **sim**, mas só serve aos provedores `official-*` | `stores/auth.ts`, `libs/auth-oidc.ts` | **não** — os dez provedores da Lia são `'user'` |
| **Conta da Lia** | **não existe** | — | não |

Ou seja: "funcionar sem conta" não exige apagar autenticação nenhuma. Exige
apenas que a fronteira da Lia **não pergunte** por sessão. A forma é a da aresta 1:
uma porta `isAuthenticationOwnedProvider(id)` que a Lia responde com `false`, e o
Stage responde com a consulta real à sessão. Nenhuma linha de `stores/auth.ts`
precisa mudar, e o Stage continua funcionando com os provedores `official-*`. [I,
quanto à forma; C, quanto à separação atual]

**Decisão pendente D-A:** o produto terá conta própria? Se sim, ela é outro
conceito, com outra porta — e não deve reutilizar `useAuthStore`, cujo modelo é a
sessão do AIRI.

### 12.6 Fronteira própria proposta

O que a Lia consome hoje do hub são **13 membros** em quatro arquivos: [C]

| Store | Membros usados | Onde |
| --- | --- | --- |
| `providerConfigStore` | `getProvider`, `getProviderConfig`, `ensureProvider`, `updateProviderConfig`, `providers`, `configuredProviders` | `stores/lia/provider.ts`, `stores/lia/hearing.ts`, `stores/lia/voice-editor.ts` |
| `providersStore` | `validateProviderConfig`, `disposeProviderInstance`, `initializeProvider`, `forceProviderConfigured`, `getModelsForProvider`, `supportsModelListing`, `getProviderInstance` | `stores/lia/provider.ts`, `voice-editor.ts`, `voice-preview.ts` |

Treze é pouco o bastante para uma interface própria. O contrato conceitual, sem
depender de store global:

```
LiaProviderRegistry                      // o que a Lia precisa saber e gravar
  list(): LiaProviderRecord[]            // { id, definitionId, config, status, configuredBy }
  get(id): LiaProviderRecord | undefined
  ensure(id, definitionId, config): void // cria registro sem segredo
  updateConfig(id, config, status): void // config NUNCA contém segredo (tipo sem campo livre)

LiaProviderRuntime                       // o que a Lia precisa executar
  validate(id, transientConfig): { valid, reason }
  initialize(id): void
  dispose(id): Promise<void>
  markConfigured(id): void
  listModels(id): Promise<ModelInfo[]>
  supportsModelListing(id): boolean
  instance(id): ProviderInstance | undefined

LiaCredentialPort                        // já existe; é a aresta 2
  resolve(providerId): Promise<{ apiKey } | undefined>

LiaSessionPort                           // substitui a aresta 1 para a Lia
  isAuthenticationOwned(providerId): boolean   // Lia responde sempre false
```

Duas propriedades que tornam isso testável sem Electron e sem rede:

- **Nenhum membro é assíncrono por causa de rede.** `updateConfig` grava local;
  não existe caminho para `patchConfigRemote` na interface.
- **O segredo não cabe no tipo.** `updateConfig` recebe um tipo de config sem
  campo de credencial; a credencial só entra por `LiaCredentialPort`, em memória,
  no build da instância. A garantia deixa de ser comentário e passa a ser
  compilação.

**Como seria testado.** Três camadas, todas executáveis sem Electron:

1. **Contrato** — um teste de conformidade que roda a mesma bateria contra a
   implementação atual (adaptador sobre os stores do Stage) e contra a futura. Se
   as duas passarem na mesma bateria, a troca é segura.
2. **Comportamento** — portar os 9 testes de `runtime-wiring.test.ts` para rodar
   contra a interface. Eles já cobrem exatamente a superfície dos 13 membros,
   incluindo *"never claims a keyed provider is configured when its secret is
   missing"*.
3. **Fronteira** — um teste que falha se a implementação da interface voltar a
   importar `stores/auth`, `composables/api` ou `libs/analytics`. É o único jeito
   de a fronteira não regredir silenciosamente.

### 12.7 Sequência mínima recomendada

Ordenada por **reversibilidade**, não por tamanho. Cada passo é um commit que
deixa o aplicativo funcionando e pode ser revertido sozinho. [I, quanto à ordem;
C, quanto aos fatos que a sustentam]

| # | Passo | Por que é o menor passo que prova algo | Reversível? |
| --- | --- | --- | --- |
| **1** | Teste de conformidade dos 13 membros contra os stores atuais | Fixa o comportamento **antes** de tocar em nada. Sem isso, qualquer passo seguinte é fé | sim — só acrescenta teste |
| **2** | Aresta 1: introduzir `isAuthenticationOwnedProvider`, responder `false` na Lia | Remove `useAuthStore` do hub sem mudar comportamento observado (o booleano já não era lido) | sim |
| **3** | Aresta 4: desligar a replicação remota em `updateProviderConfig` | A Lia nunca dependeu dela; o `try/catch` já tratava a ausência do backend. É o passo de maior ganho de grafo | sim |
| **4** | Aresta 3: extrair o adaptador que implementa a interface sobre `providerConfigStore` | Move a fronteira para o lugar certo sem mover arquivo nenhum | sim |
| **5** | Provar a fronteira: teste que falha se `auth`/`api`/`analytics` voltarem | Torna o desacoplamento verificável, não declarado | sim |
| **6** | (depois) Substituir o adaptador por uma implementação própria | Só faz sentido após 1–5 | sim |

**Por que a aresta 2 não aparece na sequência:** não há o que fazer. Já é uma
porta sem dependências; movê-la é risco sem ganho. O que falta é apenas
reconhecê-la como tal e não deixá-la ser arrastada para um "módulo de chat".

**O que a evidência NÃO sustenta:**

- **Passo 3 sem o passo 1.** Desligar a replicação remota muda o comportamento do
  Stage para usuários com backend. Precisa da bateria de conformidade antes.
- **Cortar os provedores `official` do hub.** Dá o maior número isolado (151 → 140
  sozinho, e compõe os 81 % com a aresta 4), mas `stores/modules/speech.ts` tem
  ramos de runtime para o provedor oficial de fala (`:208`, `:213`, `:302`). Cortar
  no hub sem tratar a fala quebra o caminho de voz. **Não é passo inicial.**
- **Declarar a pegada reduzida.** O corte dá 6 % no fecho total da Lia. A pegada
  cai quando ela deixar de usar o runtime de fala e chat do Stage — que é outro
  trabalho, explicitamente fora do escopo desta rodada.
- **Que os 13 membros sejam o contrato final.** São o que a Lia usa **hoje**. Se o
  painel ganhar edição de modelo por provedor ou descoberta de modelos, a interface
  cresce. [P]

### 12.8 Decisões ainda abertas

| # | Decisão | Por que não foi tomada aqui |
| --- | --- | --- |
| **D-A** | A Lia terá conta própria? | é decisão de produto; define se `LiaSessionPort` fica em `false` para sempre |
| **D-B** | A migração legada de `settings/credentials/providers` é preservada ou descartada? | depende de haver instalações em campo com o formato antigo |
| **D-C** | A sincronização entre janelas continua necessária quando a Lia tiver janela própria? | depende do desenho de janelas, que é passo posterior |
| **D-D** | O `SERVER_URL` fixo deve sair do código da Lia? | o B0.1 já fixou a regra de marca; a remoção toca código de aplicação, fora desta rodada |
| **D-E** | O passo 3 é aceitável para o Stage, ou só para a Lia? | desligar a replicação afeta o comportamento do AIRI na mesma árvore |

### 12.9 O que mudou em relação ao B0.1

| Item | B0.1 | Depois desta seção |
| --- | --- | --- |
| As quatro arestas | "quatro arestas do mesmo tipo" | **três tipos distintos**: uma porta já pronta (2), um booleano morto (1), peso morto importado (4), e a única dependência real (3) |
| Aresta 2 | dependência de chat | **porta sem dependências** — 1 arquivo, import só de tipo |
| Aresta 1 | "booleano em uma linha" | **nunca lido** para os provedores da Lia (curto-circuito) |
| Aresta 4 | "nunca invocada pela Lia" | confirmado — e **`updateProviderConfig` dispara rede sempre**, dentro de `try/catch` |
| Fecho do hub | 176 (B0.1) | **151** medido; **28** com os dois portadores cortados (81 %) |
| Ganho para a Lia | implícito | **6 %** no fecho total — o corte libera o hub, não reduz a pegada |
| Segredos | "config é não-secreto por construção" | verdade **no caminho da Lia**; **falso** no caminho do AIRI, que grava `apiKey` em `config` e o envia ao backend — afirmado por teste existente |
| `setProviderAvailabilityOverride` | não citado | **seam morto**: exposto e sincronizado, sem nenhum chamador |
| Sequência | hub primeiro, por 4 arestas | **conformidade primeiro**, depois arestas 1 e 4, adaptador, prova de fronteira; `official` explicitamente fora |

**O que esta seção não fez:** não alterou código, dependência, lockfile, build ou
instalador; não moveu nem copiou pacote; não tocou em `airi/`; não resolveu o
avatar; não tomou decisão de licenciamento. Nenhum teste foi executado — todos os
"testes existentes" foram lidos, não rodados. Nenhum valor de segredo foi lido ou
impresso, e nenhum arquivo pessoal do usuário foi aberto.

---

## 13. B0.5 — A aresta `composables/api` não pode ser removida agora (28/10/2026)

Investigação do passo que o B0.2 numerou como aresta 4. **Conclusão: não remover.**
Nenhum arquivo de código foi alterado nesta rodada. As validações abaixo foram
executadas sobre `64525a1`, sem modificação.

### 13.1 A premissa do B0.5 não se confirma

A tarefa partiu de "importada, mas não utilizada pela Lia". Metade disso é verdade
e metade é falso, e a diferença decide a remoção. O próprio B0.2 já continha as duas
afirmações em linhas vizinhas: o título dizia "O que a Lia usa: **Nada**", e a
mesma célula continuava "**Mas `updateProviderConfig` é** — e ele dispara
`patchConfigRemote` **sempre**". O título estava errado; a célula estava certa.

**A dependência é alcançada em runtime pelo caminho da Lia.** [C]

`config.ts:10` importa `client`, e ele é usado em **quatro** sítios, não um:

| Sítio | Chamado por | A Lia chama? |
| --- | --- | --- |
| `:32` `service.fetchRemote` | `fetchProviders` (`:164`), via `providersQuery` com `enabled: false` | **não** |
| `:87` `service.createRemote` | `addProvider` (`:183`) | **não** |
| `:90` `service.deleteRemote` | `removeProvider` (`:204`) | **não** |
| `:97` `service.patchConfigRemote` | `updateProviderConfig` (`:224`) | **sim** |

E a Lia chama `updateProviderConfig` em **dois** pontos de produto, não em teste:

- `stores/lia/provider.ts:354` — grava o `baseUrl` de um provedor personalizado;
- `stores/lia/hearing.ts:206` — projeta o alvo de transcrição derivado.

`updateProviderConfig` não tem guarda: se o registro existe, `mutateAsync` roda
(`config.ts:224`), dentro de `try/catch`. A falha é silenciosa; a requisição não é.

**Observação empírica, não leitura de código.** O teste que o B0.3 fixou —
*"replicates an update to the remote service — current Stage behaviour"* — afirma
`observed.requests.length > 0` e **passa**. Ou seja: com o `PiniaColada` instalado,
como no renderer real (`main.ts:159`), a atualização de um provedor da Lia produz um
`fetch` de verdade. Não é uma aresta morta que aparenta vida: é uma aresta viva.

### 13.2 Por que a remoção não é segura

Remover o import deixa `client` sem definição em quatro sítios. Não há como remover
"só a parte não usada": o **query** (`fetchProviders`) e as **três mutações**
compartilham a mesma importação. Tirar uma exige reescrever a outra, e é isso que
está fora de escopo:

| O que a remoção quebraria | Por que impede o passo |
| --- | --- |
| Replicação remota das três mutações | proibido alterar replicação remota |
| Bateria de conformidade B0.3 (21 testes) | precisa ser preservada; o teste de replicação passaria a falhar por desenho |
| Código do AIRI compartilhado (`config.ts`, `services/inference-service-providers.ts`) | a mudança sairia do escopo da Lia |
| `packages/stage-pages/src/pages/v2/settings/providers.vue:18`, que chama `fetchProviders` | a query não é código morto dentro do Stage |

**Não há código morto estritamente relacionado a esta dependência.** `client` tem 4
usos, `createProvidersQueryOptions` alimenta `providersQuery`, as três mutações
alimentam as três ações, e `providersQuery` alimenta `isLoading`/`error` expostos
pela store. Nada é órfão.

**Nuance que explica a confusão:** a Lia **nunca** importa `composables/api`
diretamente. Verificado: nenhuma ocorrência em `stores/lia/` nem em `services/lia/`.
A dependência entra exclusivamente por dentro de `config.ts`, um arquivo do AIRI.
Portanto "remover do provider hub da Lia" não tem onde acontecer sem tocar código
compartilhado.

### 13.3 Risco não resolvido que a remoção deixaria no lugar

Como a aresta está viva, vale registrar o que ela carrega. `authedFetch`
(`libs/auth-fetch.ts`) trata resposta diferente de 401 devolvendo-a; mas, em 401,
chama `refreshTokenNow()` e, sem token, `promptReLogin` → `clearAllAuthState()` +
`needsLogin = true`. Em Electron, `whenever(needsLogin)` retorna cedo
(`auth.ts:103-105`), então não há redirecionamento OIDC; o estado de auth da Lia é
vazio, então o `clear` é inócuo na prática.

**Não observado [P]:** se `api.airi.build` responde 401 em vez de falhar na rede.
Neste ambiente a conexão dá `ECONNRESET`, o `fetch` lança, a mutação rejeita e o
`try/catch` preserva a configuração local. Um usuário com conectividade poderia ver
outro caminho. Não afirmo qual — não foi medido.

### 13.4 Onde esta aresta deve morrer

Não é aqui. O passo correto continua sendo o **passo 4 do B0.2**: extrair o
adaptador que a Lia usa, de modo que a store da Lia leia o registro local e **não
tenha nada para replicar**. Aí a dependência cai por consequência, não por cirurgia.

Ordem sugerida para quando esse passo for autorizado:

1. Adaptador cobrindo os 13 membros, com a bateria B0.3 verde antes e depois;
2. verificação de que o adaptador não importa `composables/api`;
3. **só então** remover a replicação do caminho da Lia — e nessa altura o diff
   inclui, de propósito, a mudança do teste de replicação do B0.3, que hoje falha
   por desenho justamente para marcar essa decisão.

### 13.5 O que esta seção não fez

Não alterou código, dependência, lockfile, build ou instalador; não removeu nem
tornou lazy `useAuthStore`; não tocou em `isReadyToChat` nem na política do B0.4;
não mexeu em persistência, replicação, migração, credenciais ou sincronização; não
mexeu no seletor de voz nem no `official-provider-speech`; não leu cofre, segredo ou
`lia-product.json`. A mudança proposta pelo B0.5 **não foi aplicada**, por evidência
contrária, e o motivo está acima.

---

## 14. B0.7 — a fachada de configuração (implementada)

Esta seção registra o que o **B0.7** efetivamente entregou, para que o passo
seguinte não precise reconstruir o desenho a partir do código. O desenho
correspondente está em
[`LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md`](LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md).

### 14.1 A fronteira

`apps/stage-tamagotchi/src/renderer/stores/lia/provider-config-facade.ts` é agora o
**único** módulo de produção em `stores/lia/` que importa
`@proj-airi/stage-ui/stores/providers/config`. [C]

Cinco membros, todos delegando à store compartilhada, que continua sendo a fonte
de verdade (mesmas chaves de `localStorage`, mesma migração, mesma sincronização
entre janelas):

| Membro | Delega para | Efeito remoto |
| --- | --- | --- |
| `get` | `getProvider` | **não** |
| `getConfig` | `getProviderConfig` | **não** |
| `isConfigured` | `configuredProviders` (lido na hora, não capturado) | **não** |
| `ensure` | `ensureProvider` | **não** |
| `updateConfig` | `updateProviderConfig` | **sim** — um `PATCH`, mantido ligado |

A tabela existe também como dado (`LIA_PROVIDER_CONFIG_REMOTE_EFFECTS`) e um
teste verifica que ela cobre exatamente os membros expostos, para que um membro
novo não entre sem declarar efeito. [C]

### 14.2 Dois estreitamentos que o B0.6 propôs e a realidade recusou

O desenho do B0.6 propunha `LiaProviderConfig = Record<string, string>` e um
status de três valores. Nenhum dos dois sobreviveu ao contato com a store: [C]

- **Payload ficou `Record<string, unknown>`.** A assinatura real da store é
  `Record<string, unknown>`, e registros migrados de
  `settings/credentials/providers` são copiados literalmente. Estreitar exigiria
  um `cast` sem verificação no ponto de delegação.
- **Status ficou `'unconfigured' | 'configured'`.** São os dois únicos valores que
  algum fluxo da Lia escreve; `'bypassed'` só é lido, e `'validating'`/`'invalid'`
  pertencem ao ciclo de validação do Stage.

Também foi rejeitado, e por um motivo concreto, o guarda de runtime "config não
pode conter credencial": a chave legada de migração é literalmente
`settings/credentials/providers`, então uma instalação anterior à migração pode
carregar `apiKey` dentro de `config`. Lançar sobre isso transformaria um estado
histórico suportado em crash. [C]

### 14.3 O que continua igual de propósito

- Os dois caminhos de escrita da Lia replicam como antes: `provider.ts:356`
  (painel, com `baseUrl`) e `hearing.ts:208` (projeção de STT). Os números são os
  de **depois** do B0.7; antes da fachada eram `:354` e `:206`. [C]
- `config.ts`, `inference-service-providers.ts` e as páginas de `stage-pages`
  **não foram tocados**. [C]
- Nenhuma ordem de inicialização mudou: `useLiaProviderConfigFacade()` instancia a
  store compartilhada no mesmo ponto do setup em que a chamada direta instanciava.
  Em `voice-preview.ts` a leitura continua acontecendo na hora da chamada, não na
  construção. [C]

### 14.4 Evidência automatizada

`provider-config-facade.test.ts` (15 testes) e
`provider-config-write-paths.test.ts` (4) fixam: delegação pura, fonte de verdade
compartilhada (`configs` — o caminho que `useProviderStore` lê), zero rede em
`ensure`, **uma** requisição em `updateConfig`, URL personalizada preservada com a
rede fora, ausência de credencial no que é gravado, inventário de efeitos remotos
e a fronteira de imports. A suíte `stores/lia/` foi de 244 para 263 testes, sem
alterar nenhum teste existente. [C]

### 14.5 O que esta seção não fez

Não desativou a replicação, não criou store própria, não mudou
persistência/migração/sincronização/credenciais/autenticação, não tocou em
`lia-product.json` nem migrou `baseUrl`, e não iniciou o B0.8. Não houve execução
no Windows nem em Electron real: os resultados acima são de teste automatizado em
`node`, não gate de runtime.
