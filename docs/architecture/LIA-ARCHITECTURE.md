# LIA-ARCHITECTURE — Proposta de arquitetura futura

> **Fase 0 · Proposta técnica** (sem código de produção nesta fase)
> **Base:** AIRI `v0.12.0-beta.5` (fork white-label) + camada de produto **Lia**.
> **Marca:** `[PROPOSTA]` = decisão/desenho da Lia (não existe no AIRI); `[AIRI]` = capacidade existente do AIRI a reutilizar; `[UNKNOWN]` = a validar no código real.

---

## 1. Princípio organizador

> **AIRI é o runtime/órgão. Lia é o produto/orquestrador.**
> Reutilizar > adaptar > encapsular > estender > implementar do zero.

Toda lógica que o AIRI **já faz** (LLM streaming, providers, STT/TTS, memória, avatar, MCP, Discord, chat, personagem CCv3) permanece nele. A Lia **não duplica** — ela **seleciona, configura, encadeia, perfila e esconde**.

A arquitetura **não impõe** o diagrama linear `Lia App → Orchestrator → Runtime → Providers` de forma rígida. A leitura do AIRI mostra que o runtime já é **modular por "órgãos"** (`modules/`) com stores de configuração e provider ativo. Portanto o **Lia Orchestrator** é desenhado como uma camada **fina de orquestração/configuração** em cima desses módulos — não um "super-serviço" que reimplementa conversa.

```
                  LIA APP  (fork do stage-tamagotchi: Electron main/preload/renderer)
                      │  (UI launcher/wizard/home, idioma pt-BR, identidade Lia)
                      ▼
             LIA ORCHESTRATOR   ← camada fina: profiles, hardware→recommended,
                      │            provider/task routing, voice abstraction,
                      │            permissions/kill-switch, logs, repair
      ┌───────────────┼───────────────────────────────┐
      ▼               ▼                               ▼
 CHARACTER        AI SYSTEM (órgãos AIRI)         LIA SERVICES
 (cards CCv3,   modules/: consciousness(LLM)      (component/voice/model
  Lia default,   speech(TTS) hearing(STT+STT)     managers, updates,
  skins)         vision artistry memory tools)     diagnostics)
      │               │                               │
      └───────────────┴──────────┬────────────────────┘
                                 ▼
                 AIRI runtime + providers (LLM/TTS/STT/Vision)
                   + Voice Conversion layer (substituível)
                   Local / Hybrid / Cloud  (execution profiles)
```

> O AIRI já mantém `Character`, `LLM`, `Voice`, `Memory`, `Vision`, `Tools` **desacoplados entre si** por design (órgãos separados). A maior parte do "não acoplar" **já existe**; a Lia só precisa **preservar e expor**, não recriar.

---

## 2. Respostas às 20 perguntas de arquitetura

### 1. O que pertence à Lia (produto)?
- **Shell desktop + identidade:** nome/ícone/appId `LIA`, janelas/tray/overlay re-identificadas, locale **pt-BR**.
- **UX de produto:** Home-launcher, Setup Wizard, estados de UI amigáveis, progresso/downloads, erro humano, Safe Mode, crash recovery, logs colapsáveis, Advanced/Diagnostics.
- **Configuração versionada do usuário** (`schemaVersion` + migrações) + separação config/secrets/userData.
- **Orquestração:** execution profiles (Recommended/Local/Hybrid/Cloud/Custom), hardware detection → recomendação, task routing, gerenciadores de componente (AI/Voice/Character/Plugin/Runtime), sistema de update próprio, instalador `LiaSetup.exe`.
- **Política de segurança de produto:** permissões computer use, kill switch, visão consentida, privacy, export sem secrets.
- **Camada de voz de produto** (escolha/fallback/engines) e futura **Lia Voice Studio** (separada).
- **Personagem padrão Lia** como *pack/card* (não hardcode).

### 2. O que permanece AIRI?
`[AIRI]`
- Órgãos e pipelines: `consciousness` (LLM), `speech` (TTS), `hearing` (STT), `vision`, `artistry`, `web-search`, `gaming`, `discord`.
- Providers e catálogo (`stores/providers/`), xsai, MCP (`mcp` + `mcp-tool-bridge`), computer-use MCP, server channel, renderers de avatar (Live2D/VRM/MMD/Spine/Tachie), memória (DuckDB-WASM/pgvector), core-agent/core-character, personagem CCv3, integrações.
- Server-runtime embutido no desktop (espinha dorsal).

### 3. O que deve ser adapter/wrapper?
- **Lia Orchestrator** sobre os módulos AIRI (seleção/encadeamento sem tocar core).
- **Voice Engine adapter** (`speech` TTS) e **Voice Conversion layer** (RVC/XTTS/F5/AllTalk/Piper/Edge) como `VoiceEngine`/`VoiceConverter` substituíveis sobre `speech-runtime`/`pipelines-audio`.
- **Provider registrar** da Lia que *estende* o catálogo do AIRI (novos OpenAI-compatible etc.) sem modificar core — via `stores/providers/` (assíncrono).
- **Cloud/local/hybrid profile resolver** que traduz um perfil em conjunto de providers ativos.
- **Hardware detection** (main process) alimentando o profile resolver.
- **Character pack (Lia)** como card CCv3 + assets + voz, no formato nativo (`.zip`).

### 4. Que código pode ser reutilizado? (ver AIRI-ANALYSIS §Existing Capabilities)
LLM (40+ providers), TTS/STT (incl. Kokoro local, VOICEVOX/AivisSpeech, transformers local), visão, avatar/skins + lip-sync, memória local, MCP/tools, Discord (texto+voz), Character Card V3 + import/export `.zip`, server channel, catálogo assíncrono de providers, i18n framework, renderer Vue/Pinia/UnoCSS, electron-builder base, pipelines de áudio, streaming xsai.

### 5. Que código precisará ser criado pela Lia?
- Shell/identidade nova (appId, ícones, pt-BR) e UI launcher/wizard/home/advanced.
- **Orchestrator** (profiles, routing, health) — fino.
- **Hardware detection** → `SystemCapabilities` (CPU/RAM/GPU/VRAM/acceleration/disk/audio/mic) no main.
- **Config schema versionado + migrações** + armazenamento segregado (config/secrets/userData/models/cache/logs).
- **Component/Model/Voice Manager** (baixar/verificar/instalar/reparar/remover, checksum, progress).
- **Permission layer + kill switch** computer use/vision/actions.
- **Log system amigável + Diagnostics + Repair + Safe Mode**.
- **Voice abstraction + Voice Studio** (futuro, separado).
- **Update system próprio + instalador `LiaSetup.exe`** (fase de distribuição).
- **Profile presets + export/import sem secrets**.

### 6. Como separar UI de backend?
- Aproveitar o **modelo Electron AIRI**: `main` (backend/processos/DI) + `preload` (ponte mínima) + `renderer` (UI Vue) + `shared` (contratos IPC tipados `@moeru/eventa`). `[AIRI]`
- **UI nunca acessa internals do runtime**; tudo via **contratos IPC** (`shared`) e **stores** (`stage-ui`/Lia stores) que chamam essas APIs. Toda lógica de negócio fora de componentes (`[PROPOSTA]` reforça a regra "No AI Spaghetti" do AGENTS).
- Logs/telemetria de erro saem do renderer para o main via IPC; UI recebe estados prontos.

### 7. Como separar Character de LLM?
- **Character = dados (card CCv3)**; **LLM = órgão `consciousness`**; ambos já separados no AIRI. `[AIRI]`
- A Lia mantém a separação: personalidade/prompt ficam no **card + prompt-base** (dados), nunca hardcoded na infra; o Orchestrator apenas vincula "card ativo" ↔ "provider/módulo LLM ativo". Multi-personagem é natural (vários cards coexistem).

### 8. Como separar Voice de LLM?
- Já separados: `speech` (TTS) e `hearing` (STT) são módulos próprios, independentes de `consciousness`. `[AIRI]`
- Lia expõe **Voice = produto** (escolha de voz + fallback) e mantém STT/VAD/barge-in como partes do **Voice System** (AGENTS §87), todas trocáveis sem tocar no LLM. Fala é pós-LLM (TTS) e pré-LLM (STT), nunca acoplada.

### 9. Como separar Memory de LLM?
- Memória no AIRI já é própria (DuckDB-WASM local / pgvector) e entra no contexto como dado. `[AIRI]`
- Lia adiciona **controles de usuário** (ativar/desativar/visualizar/apagar/limpar) e define tipos (short/episodic/semantic/relationship/character) como **configuração + pipeline de contexto**, independentes do provider LLM.

### 10. Como suportar Local/Hybrid/Cloud?
- **Execution profiles** como *configuração declarativa* que o Orchestrator resolve em um conjunto de providers por órgão (`[PROPOSTA]`, sobre o catálogo do AIRI).
- Ex.: `Cloud` → LLM cloud + TTS cloud; `Local` → Ollama/llama.cpp + Kokoro/local; `Hybrid` → LLM cloud + voz local; `Recommended` → hardware detection decide; `Custom` → usuário escolhe por componente.
- Cada capacidade tem **fallback** (ver AGENTS §80) — a camada de runtime do AIRI já permite trocar provider por módulo.

### 11. Como detectar hardware?
- **Nova camada `system-capabilities` no processo main** (`[PROPOSTA]`): coleta CPU (model/cores/threads), RAM total, GPU (vendor/model/VRAM), discos (espaço), áudio/mic, SO/arquitetura → `SystemCapabilities`.
- **Não assumir** CUDA/ROCm/Vulkan/Metal/WebGPU disponíveis; cada acelerador reportado como *possibilidade*, testada por capability probe/backend, não por presunção.
- Alimenta o **profile resolver** (Recommended) e o Diagnostics. Roda no main (fora do renderer) e não é exposta na Home.

### 12. Como futuramente gerar `LiaSetup.exe`?
- Reusar **electron-builder** já usado pelo AIRI (`[AIRI]` base) configurado para `appId`/`productName`/ícones da Lia.
- **NSIS** (Windows) para `LiaSetup.exe`; DMG para macOS; AppImage/deb/rpm/flatpak para Linux. Auto-update via `electron-updater` sobre assinatura própria (decisão de Fase 4).
- **Dependências externas (runtime Python/Node/lama) não entram no `.exe`**: são **Components** baixados/instalados pelo Component Manager na primeira execução (Setup Wizard), sob `app.getPath('userData')`/diretórios próprios — nunca exigindo o usuário instalar nada manualmente.

### 13. Como instalar dependências automaticamente?
- **Component Manager** (`[PROPOSTA]`): catálogo de *components* (LLM local engine, voice engine, STT, modelos GGUF/ONNX, voice packs, runtime auxiliar) com versão/status/tamanho/deps/checksum/reparo.
- Baixa com **Download Manager** (progress, pause/resume/retry, checksum, espaço livre); instala no diretório de **Models/Components** (fora do Git e fora dos binários da app).
- Setup Wizard orquestra "detectar → sugerir → baixar → testar", tudo com linguagem de produto e estado de progresso. **O usuário nunca abre terminal.**

### 14. Como manter logs técnicos fora da UI principal?
- **Log system** separado (`[PROPOSTA]`): escrito no main (arquivo no diretório de Logs), categorias General/AI/Voice/System/Network/Debug, com timestamp/severity/contexto, **sem secrets**.
- Renderer só recebe **estados amigáveis**; "Mostrar logs" é uma ação opcional que abre um painel **colapsável**; detalhe técnico fica em **Advanced → Logs/Diagnostics**. UI Home nunca mostra stack/porta/endpoint.

### 15. Como implementar Advanced/Diagnostics?
- **Advanced mode** é um nível de UI (opcional) que expõe provider/endpoint/model/backend/aceleração/logs/runtime/paths/ports/debug/experimental — reutilizando os dados já coletados pelo Orchestrator + capabilities + log system. `[PROPOSTA]`
- **Diagnostics** agrupa System/CPU/RAM/GPU/Storage/Audio · AI (LLM/TTS/STT/Vision) · Runtime (AIRI/Lia) · Integrations (Discord/Computer Use), com estados READY/STARTING/OFFLINE/DEGRADED/ERROR/STOPPING e botão **Repair**.

### 16. Como permitir múltiplos personagens?
- **Character = card CCv3 (+ pack com voz/skin)** — já é multi-character no AIRI (vários cards, perfil ativo, import/export `.zip`). `[AIRI]`
- Lia mantém uma **biblioteca de personagens** com a "Lia" como pack padrão, e voz/skin por personagem. Nada hardcoded a uma única personagem.

### 17. Como permitir múltiplos providers?
- **Catálogo assíncrono de providers do AIRI** é o mecanismo (adicionar definição de provider sem tocar core). `[AIRI]`
- Lia adiciona **task routing** (`[PROPOSTA]`, AGENTS §18-19): "normal chat → X, tarefa complexa → Y, visão → vision provider, offline → local, econômico → Z". Provider é **endpoint+auth+catálogo+modelo selecionado**; catálogo consultado dinamicamente, **sem hardcode de modelos**.

### 18. Como permitir Voice Studio separado?
- O **Lia App** expõe um botão "Lia Voice Studio" (`[PROPOSTA]`) que instala/detecta/repara/abre o **Voice Studio** como **aplicação auxiliar separada**, conversando com o runtime via **server channel** (`server-sdk` ⇄ `server-runtime`). `[AIRI]` para o canal.
- O Voice Studio (treino de voz pesado — AllTalk/XTTS/F5/RVC) **não é carregado** pelo App principal (performance, AGENTS §71). Intercâmbio por **export/import de voz** em formato de pacote versionado. Treino pode usar Colab como auxiliar, sem virar infraestrutura permanente.

### 19. Como atualizar o AIRI no futuro?
- Manter `remote upstream = moeru-ai/airi` e rebasar com disciplina; customizações **concentradas e marcadas**; documentar diffs em `docs/upstream/` (INTEGRATION / UPGRADE / PATCHES). `[VERIFICADO]` no plano.
- **Separação de atualização** (AGENTS §75): Lia App / AIRI Runtime / Models / Voice / Components têm versões e ciclos independentes. Adicionar o AIRI como um "component/engine" **fixado por commit/tag** e absorver evoluções em janelas controladas — nunca em correção de produto urgente.
- Limitar patchs no core; subir melhorias úteis **upstream** (ex.: locale pt-BR) quando possível.

### 20. Quais partes devem permanecer desacopladas? (mapa de acoplamento-alvo)
| Relação | Deve ser | Mecanismo |
|---|---|---|
| Character ↔ LLM | desacoplado | character = dados (card) |
| Voice ↔ LLM | desacoplado | órgãos speech/hearing independentes |
| Memory ↔ LLM/provider | desacoplado | memória própria + contexto como dado |
| Vision ↔ LLM | desacoplado | vision module + capability gates |
| Tools/ComputerUse ↔ LLM | acoplado via contrato seguro | MCP + Permission layer + Kill Switch |
| Provider ↔ Model | separar conceitos | Model/Backend/Provider/Hardware distintos (AGENTS §51) |
| UI ↔ runtime | desacoplado | IPC tipado + stores |
| Personality ↔ infra | desacoplado | personality = configuration/data |

---

## 3. Perfis, execução e setup (UX leiga)

**Setup Wizard (1º uso):** Welcome → Hardware Detection → Execution Mode (Recommended / Privacidade-Local / Nuvem / Avançado) → Personagem → Voz → IA → Teste → Concluir. Linguagem simples, nunca termos técnicos na Home.

**Execution profiles:** `[PROPOSTA]` Recommended (auto-decide) · Local · Hybrid · Cloud · Custom — resolvidos pelo Orchestrator em providers por órgão, com fallbacks (GPU→CPU→cloud).

**Ferramentas de robustez (todas `[PROPOSTA]`):** Progress UI reutilizável · Download/Component/Model Manager · friendly errors ("Não foi possível iniciar o serviço de IA" + [Tentar novamente][Corrigir][Detalhes]) · Repair · Safe Mode (sem plugins/automations/computer use/Discord/experimental) · Crash recovery (degradação graciosa) · logs colapsáveis · Advanced/Diagnostics · Offline first · privacy/security/telemetry opt-in.

---

## 4. Áudio/Voice System (estrutura-alvo)

```
Voice System
├── STT  (módulo hearing — providers existentes + local)
├── VAD  (@ricky0123/vad-web / equivalente)
├── Barge-in  (interromper TTS e voltar a ouvir)
├── TTS  (módulo speech — providers + fallback; Edge TTS = "voz online")
└── Voice Conversion layer (SUBSTITUÍVEL: off | RVC | XTTS | F5 | outro)
```
- Voz customizada é **requisito futuro, não bloqueia Fase 1** (AGENTS §87). Primeiro voz padrão/fallback + pipeline; depois customização; depois Voice Studio. AllTalk/XTTS/RVC testados no hardware real (RX 580 8 GB) **posteriormente**, documentando compatibilidade.

---

## 5. Voz / LLM provider-agnostic

- **LLM provider-agnostic** (AGENTS §16-17, §90): abstração de provider (endpoint/auth/modelos/selected), catálogo dinâmico, sem hardcode de modelos. Groq/Cerebras/OpenAI-compatible/OpenRouter/Ollama/llama.cpp entram como **definições de provider**, não lógica fixa.
- **Não assumir catálogo estável** de nenhum provider.
- Voz e visão seguem o mesmo princípio (provider-agnostic).

---

## 6. Hardware / compatibilidade

- Agnóstico a **NVIDIA/AMD/Intel/CPU-only** e a níveis de RAM/VRAM (AGENTS §14, §90).
- Máquina de dev (Ryzen 5 5500 · RX 580 8 GB · 16 GB) é **um perfil de compatibilidade**, não o alvo. Backend local tem fallback; **não presumir ROCm/CUDA/Vulkan**.
- Compatibilidade por combinação (Windows NVIDIA/AMD/Intel, Linux NVIDIA/AMD, macOS Apple Silicon, CPU-only) registrada em `docs/compatibility/MATRIX.md`, estados Untested/Experimental/Supported/Recommended/Broken — nunca "Supported" sem teste real.

---

## 7. Segurança, privacidade, dados

- **Separação de diretórios** (nunca no Git): Application · Runtime · User Data · Models · Cache · Logs · Temporary (respeitando `app.getPath`/SO).
- **Config vs secrets vs userData**: secrets em local seguro fora da config exportada; **export/import sem secrets** por padrão.
- **Permission layer** (baixo/médio/alto risco) + **Kill Switch** confiável; **Vision default OFF/consentido**; **nunca capturar tela em segredo**.
- Logs/telemetria sem secrets; telemetria **opt-in**; privacy central (cloud só por configuração explícita).
- **Nunca executar comando arbitrário do LLM** sem controle.

---

## 8. Modelo de dados/estado e organização do monorepo Lia

**Layout do repositório (Fase 0 adicionará o fork AIRI como base, então a Lia empilha por cima, sem misturar pastas):**

```
<repo>  (= fork moeru-ai/airi v0.12.0-beta.5 + camada Lia)
├── apps/  packages/  plugins/  integrations/  services/ …   # AIRI (upstream)
├── apps/lia-shell            # ou fork de stage-tamagotchi rebatizado (Electron)
├── packages/lia-orchestrator # profiles/routing/health (fino)
├── packages/lia-config       # schema versionado + migrações
├── packages/lia-capabilities # hardware detection
├── packages/lia-voice        # voice abstraction/conversion
├── packages/lia-log          # log + friendly errors
├── packages/lia-components   # component/model/voice/download manager
├── packages/lia-characters   # personagens/presets (Lia default pack)
├── plugins/lia-*             # plugins próprios
├── docs/ (architecture|product|compatibility|security|upstream|licenses)
└── tools/  (DevKit existente)
```
> Os caminhos exatos de pacotes Lia serão definidos quando o fork entrar; o importante é **Lia acima de AIRI**, sem reescrever o core.

---

## 9. Milestones recomendados (ordem de implementação)

> Princípio: núcleo/robustez/config primeiro; voz customizada e distribuição ao final. Cada milestone fecha com typecheck+lint+testes+docs (DoD do AGENTS §79).

- **M0 — Base do fork:** adicionar o fork AIRI `v0.12.0-beta.5`, remote `upstream`, toolchain (Node 26.7.0/pnpm), build verde de `stage-web` e `stage-tamagotchi`. Revalidar todas as `[ESTUDO]`/`[UNKNOWN]` deste doc no código real.
- **M1 — Identidade Lia + fundação do produto:** appId/productName/ícones; locale pt-BR; card padrão Lia; shell launcher; config schema versionado + migrações; layout de diretórios; log system; friendly-error + estados de UI.
- **M2 — Hardware/auto-config/profiles:** `system-capabilities`; Setup Wizard; Recommended/Local/Hybrid/Cloud/Custom; fallbacks; Diagnostics/Repair/Safe Mode.
- **M3 — Character + Voz (funcional):** biblioteca multi-personagem; voice abstraction + provider + fallback; audio pipeline/VAD/STT/barge-in; visão consentida; permissões/kill-switch.
- **M4 — Habilidades/Integrações:** plugins Lia, memória/controles, MCP/tools, Discord/Telegram via server channel, task router amadurecido.
- **M5 — Component/Model/Download Manager:** auto-instalação de dependências locais (llama/Ollama/voice/models) com progress/checksum/reparo.
- **M6 — Distribuição:** instalador `LiaSetup.exe` (+macOS/Linux), auto-update, assinatura/notarização, `docs/compatibility/MATRIX.md` preenchido com testes reais.
- **M7 (pós-MVP) — Lia Voice Studio** separado + Voice Conversion (RVC/XTTS/F5) validados em hardware real.

---

## 10. Decisões que precisam ser tomadas (destaques)

1. **Confirmar base `v0.12.0-beta.5`** (já decidida no estudo) vs `v0.11.3` estável como fallback/principal.
2. **Modelo de distribuição do runtime local**: qual engine LLM local (llama.cpp/llm-rs/Ollama embarcado) e qual backend na RX 580 (Vulkan? CPU? ROCm não-garantido).
3. **Asset do avatar da Lia**: modelo Live2D/VRM **redistribuível** pronto vs importação pelo usuário (sem bundling).
4. **Voz padrão do MVP**: qual TTS (local Kokoro vs nuvem) e fallback; pt-BR.
5. **Identidade visual + nome técnico interno** dos pacotes Lia (`@lia/*`?).
6. **Estratégia de rebase/upstream** (janela fixa por release vs contínuo).
7. **Segurança de computer use/vision**: política default e níveis de confirmação.
8. **Telemetria**: opt-in e escopo.
9. **Auto-update + assinatura** e custo de notarização por plataforma.

---

## 11. Reutilizar vs Adaptar vs Criar (resumo executivo)

**Reutilizar diretamente (do AIRI):** LLM/40+ providers e streaming; TTS/STT (incl. Kokoro/VOICEVOX/AivisSpeech/local); vision; avatar/skins+lip-sync; memória local (DuckDB-WASM); MCP/tools/computer-use MCP; Discord (texto+voz); Character Card V3 + import/export `.zip`; catálogo assíncrono de providers; server channel; i18n; renderer Vue/Pinia/UnoCSS; electron-builder base; pipelines de áudio.

**Adaptar/wrapper:** Orchestrator (fino) sobre órgãos AIRI; voice engine/conversion adapter; provider registrar que estende catálogo; profile resolver; character pack Lia; server channel para apps auxiliares (Voice Studio).

**Criar pela Lia:** identidade/shell/pt-BR; UI launcher/wizard/advanced; config versionada+migrações; hardware detection; component/model/voice/download manager; permissões+kill switch; log/diagnostics/repair/safe mode; voice abstraction + Voice Studio; update system + instalador; profiles+export/import.

**Evitar (AGENTS §94):** reescrever AIRI; abstrações duplicadas; hardcode de personalidade/provider/GPU; exigir terminal; capturar tela em segredo; ações perigosas sem permissão; telemetria obrigatória; marcar suporte sem testar.

---

## 12. Riscos resumidos

1. Base analisada por estudo, não por código local (fork ainda não no repo) → revalidar na M0. **ALTO**
2. Beta + upstream veloz → disciplina de rebase/diff. **ALTO**
3. Toolchain/build pesados e específicos (Node 26/pnpm) + máquina 16 GB. **MÉDIO**
4. Licenças de assets/modelos/voz. **MÉDIO**
5. Hardware AMD antigo (RX 580) para local → fallback necessário. **MÉDIO**
6. pt-BR inexistente (personagem/STT/TTS/UI). **MÉDIO**
7. Segurança (secrets, visão, computer use, ações LLM). **MÉDIO**
8. Dependências não-empacotáveis (runtime local/voice) exigem Component Manager confiável. **MÉDIO**

*Fim do documento LIA-ARCHITECTURE.md.*
