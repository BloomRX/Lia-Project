# 5. Plano de testes, segurança, licenças, lacunas e riscos

**Data:** 11/11/2026 · **Base:** `29999aff`

## 5.1 Plano de testes reproduzível

### 5.1.1 Três níveis de evidência — nunca misturados

| Nível | O que é | Como aparece no relatório |
|---|---|---|
| **Publicado por terceiro** | benchmark de outrem | "segundo `<fonte>`, em `<data>`" |
| **Oficial do fornecedor** | número do model card | "o fornecedor declara" |
| **Medido por nós** | execução nesta máquina | tabela com hardware, versão, data, comando |

**Nenhum nível 2 vira nível 3 por repetição.** Um número do fornecedor nunca
entra na coluna "medido".

### 5.1.2 Bancada mínima

Antes de qualquer modelo: registrar **hardware, SO, versão do runtime, versão dos
pesos (hash), comando exato, duração e custo**. Sem isso o resultado não é
reproduzível e não deve ser usado para decidir nada.

```yaml
# ficha de execução — preencher sempre
data: 2026-11-11
maquina: "Ryzen 7 5800X / RX 6700 XT 12GB / Windows 11 26200"
runtime: "llama.cpp b6000 (Vulkan)"
modelo: "Qwen3.5-9B"
pesos: "Q4_K_M, sha256=…"
comando: "llama-server -m … -ngl 99 -c 8192"
medido:
  first_token_ms: 0
  tokens_per_second: 0
  vram_peak_mb: 0
observacoes: ""
```

### 5.1.3 Testes por capacidade

| Capacidade | Métricas | Conjunto de teste | Critério de aceite sugerido |
|---|---|---|---|
| **TTS** | naturalidade (MOS próprio 1–5), pronúncia PT-BR, latência ao 1º áudio, RTF, estabilidade em texto longo | 30 frases PT-BR com números, siglas, nomes próprios, emoção | RTF < 1 em tempo real; nenhuma falha em 30/30 |
| **TTS clonagem** | similaridade de timbre, consentimento | 5 vozes sintéticas, 3 durações de referência | sem artefato audível; consentimento registrado |
| **STT** | WER, WER em ruído, pontuação, timestamps | 20 min de áudio PT-BR: limpo, ruído, sotaque, telefone | WER < 15 % limpo; < 35 % ruído |
| **STT streaming** | latência parcial, estabilidade | leitura contínua de 5 min | parcial < 500 ms |
| **VLM** | acerto de descrição, OCR exato, grounding (IoU) | 100 screenshots do Windows + 50 fotos | grounding@0.5 > 80 % |
| **Screen understanding** | janela correta, elemento correto, mudança detectada | 30 tarefas em apps reais | 27/30 |
| **Computer use** | taxa de sucesso, ações erradas, recuperação | 20 tarefas com aprovação | 0 ação destrutiva não aprovada |
| **LLM** | qualidade subjetiva, tool calling, JSON válido, custo | 50 prompts PT-BR + 30 com tools | JSON válido > 98 % |
| **Memória** | precisão@k, **falsas lembranças** | 100 fatos + 30 perguntas negativas | nenhuma memória inventada |
| **Orquestração** | sucesso, custo, paralelismo, retomada | 10 fluxos com falha injetada | retoma sem repetir efeito colateral |
| **Imagem** | qualidade, consistência de personagem, tempo | 20 prompts + 10 com referência | — |
| **Vídeo** | qualidade, tempo, VRAM | 5 clipes curtos | — |
| **Execução local** | RAM pico, VRAM pico, CPU, latência, consumo | por perfil de máquina | não exceder 80 % da VRAM |

### 5.1.4 Ordem de execução (o que testar primeiro)

1. `speech.stt` faster-whisper × sherpa-onnx **em PT-BR** — é o que mais afeta a
   sensação de qualidade da Lia.
2. `speech.tts` Kokoro × CosyVoice 2 em PT-BR.
3. `chat.conversation` Qwen3.5-4B vs 9B vs Gemma 3 12B em Vulkan.
4. `memory.embed` BGE-M3 + sqlite-vec contra a busca lexical atual.
5. `vision.grounding` Qwen3-VL-4B vs 8B em screenshots do próprio app.
6. Só depois: `computer.control`.

## 5.2 Segurança e privacidade — regras que o catálogo deve carregar

| Regra | Onde se aplica |
|---|---|
| **API key nunca no Renderer** | todo provider hospedado; usar o cofre existente |
| **Consentimento por capacidade** | tela, microfone, arquivos, execução de ação |
| **Nada de log de prompt/segredo** | telemetria, artefatos, relatórios |
| **Aprovação humana** | `computer.control`, comandos destrutivos, gasto acima do teto |
| **Allowlist de ferramentas** | toda tool exposta a modelo |
| **Isolamento de execução** | Open Interpreter e afins sempre em sandbox |
| **Retenção** | provedor hospedado só recebe o necessário; sem histórico inteiro por padrão |
| **Direitos de voz** | clonagem exige consentimento verificável e reversível |

## 5.3 Licenças — o que está pendente e o que bloqueia

| Item | Situação | Ação |
|---|---|---|
| F5-TTS — pesos | provavelmente **CC-BY-NC** | confirmar no model card antes de qualquer uso |
| Fish Speech — pesos | provavelmente **CC-BY-NC-SA** | idem |
| Moonshine | repositório **sem SPDX** | ler LICENSE |
| WeKnora (Tencent) | **sem SPDX** | ler LICENSE |
| Mastra | **sem SPDX** | ler LICENSE |
| Open-LLM-VTuber | **sem SPDX** | ler LICENSE |
| Maestro | **sem SPDX** | ler LICENSE |
| AutoGen | repo `CC-BY-4.0` (docs?) vs código MIT | confirmar por diretório |
| InternVL | MIT no repo, pesos variam por tamanho | confirmar por variante |
| OmniParser | repo CC-BY-4.0, pesos ? | confirmar |
| Parakeet | NeMo Apache, pesos CC-BY-4.0 ? | confirmar |
| Modelos PT-BR (Sabiá, Tucano, Amália, Gervásio, Bode) | **licença dos pesos não confirmada** | confirmar — hoje são `license-pending` |
| HunyuanVideo / LivePortrait / MuseTalk | licença própria com restrições | revisão jurídica antes |
| Wav2Lip | sem licença | **não usar** |
| Llama 4 | cláusula de 700 M MAU | ok para Lia; registrar |

**Regra operacional:** nenhum item com `license-pending` pode passar de
`catalogued`. O catálogo mostra o modelo, a Lia não o instala.

## 5.4 Lacunas — o que ainda não sabemos

| Lacuna | Impacto | Como fechar |
|---|---|---|
| Qualidade real em **PT-BR** de Qwen/Gemma/Kokoro | alta — é o idioma do produto | teste próprio (§5.1.3) |
| Suporte **AMD/Vulkan** por modelo e quantização | alta — é o hardware do usuário | teste em máquina física |
| **Latência** de TTS/STT em CPU modesta | alta | medição |
| Preços, cotas e rate limits dos 18 provedores | média | coleta oficial com data |
| Retenção de dados e uso para treino por provedor | **alta (privacidade)** | ler termos, registrar |
| Licenças dos pesos listadas em §5.3 | **alta (distribuição)** | ler LICENSE |
| Qualidade de `Qwen3.8-27B` vs `3.5-27B` | média | teste |
| Se `UI-TARS` arquivado ainda recebe correções | média | observar releases |
| Custo real de memória de BGE-M3 em máquina de 8 GB | média | medir |
| Se `sqlite-vec` cobre o volume esperado | baixa | benchmark |

## 5.5 Riscos

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Escolher modelo por benchmark de fornecedor e ele decepcionar em PT-BR | alta | alto | teste próprio antes de promover |
| R2 | Embarcar código AGPL/GPL por conveniência | média | **muito alto** (licença do produto) | filtro de licença no catálogo + revisão |
| R3 | Clonar voz sem consentimento | baixa | **muito alto** (legal/ético) | consentimento obrigatório e revogável |
| R4 | Baixar modelo enorme e inviabilizar máquina do usuário | média | alto | perfil `low-power` + aviso de tamanho |
| R5 | Depender de um fornecedor (modelo único) | média | alto | catálogo por capacidade + fallback local |
| R6 | `computer.control` executar ação errada | média | **muito alto** | aprovação por ação + allowlist + sandbox |
| R7 | Memória automática consolidar fato falso | média | alto | memória explícita primeiro; nada de extração silenciosa |
| R8 | Provedor mudar preço/limite sem aviso | alta | médio | `cost.checkedAt` + teto de gasto |
| R9 | Catálogo virar lista de permissão | média | médio | estados de ciclo de vida explícitos |
| R10 | Modelos PT-BR com licença incerta entrarem no produto | média | alto | `license-pending` bloqueia instalação |

## 5.6 Recomendações para a próxima fase

1. **Não implementar modelo nenhum ainda.** Primeiro o **schema** e um arquivo
   de dados de pesquisa (`catalog.data.json`) — já entregues aqui.
2. **Construir a bancada de medição antes do catálogo na UI.** Sem ficha de
   execução (§5.1.2), qualquer número exibido ao usuário é chute.
3. **Começar pela memória.** É a única capacidade em que um modelo pequeno
   (BGE-M3, ~570 MB) muda a qualidade sem tocar em arquitetura.
4. **Depois STT.** Sherap-onnx para streaming + faster-whisper para precisão.
5. **TTS: manter Kokoro como padrão.** Só adicionar clonagem após resolver
   consentimento e licença (CosyVoice 2 é a única Apache com clonagem + streaming).
6. **Tela e computer use por último.** Exigem captura, grounding, executor,
   verificação e política de aprovação — cinco entregas antes da primeira ação.
7. **Rodar `promptfoo` desde o começo** para que "melhor modelo" signifique algo
   medido, não preferência.

## 5.7 O que deve ser testado primeiro (resposta curta)

| Ordem | Item | Por quê |
|---|---|---|
| 1 | faster-whisper vs sherpa-onnx — WER PT-BR | maior impacto percebido |
| 2 | Kokoro vs CosyVoice 2 — PT-BR, RTF | segunda maior |
| 3 | Qwen3.5-4B vs 9B vs Gemma 3 12B — Vulkan | decide o padrão local |
| 4 | BGE-M3 + sqlite-vec vs lexical | ganho barato |
| 5 | Qwen3-VL-4B vs 8B — grounding de UI | habilita a próxima fase |

## 5.8 Revisão independente — contradições encontradas

| Contradição | Detalhe | Resolução adotada |
|---|---|---|
| "Llama 4 lançado em 05/04/2026" (dois blogs) vs **05/04/2025** (HF e Meta) | blogs de SEO trocam o ano | usada a data do HF/Meta |
| "Qwen3.6 é o flagship atual" vs **Qwen3.8-27B** no HF (ago/2026) | blogs defasados | usada a verificação no HF (11/11/2026) |
| "Qwen3 atinge 128K nativo em 8B+" | model card do Qwen3-8B diz **32K nativo, 131K com YaRN** | usado o model card |
| "UI-TARS é referência de computer use" | repositórios **arquivados** | rebaixado para `deprecated` |
| "Kokoro fala 54 idiomas" | card marca `language: en`; vozes incluem pt/es/fr/ja/zh | registrado como **declarado**, não verificado |
| VoiceStudio "ElevenLabs alternativo" | é **AGPL-3.0** | tratado como referência, não dependência |

**Método:** onde blog e fonte primária divergiram, a fonte primária venceu. Onde
só havia blog, o item foi marcado `unverified`.


---

## 5.9 Revisão 2 — riscos adicionais identificados na revisão do Dev

Acrescentados em 11/11/2026. Não substituem R1–R10; somam-se a eles.

| ID | Risco | Evidência | Mitigação |
|---|---|---|---|
| **R11** | Tratar "aceita imagem" como "enxerga a tela" | capacidades decompostas em `03` §3.9 | cada linha da matriz §3.9.1 exige evidência própria |
| **R12** | Confundir `Base` com `Instruct` e colocar um pré-treinado como assistente | `Qwen/Qwen3.5-4B-Base` existe separado | `variant` obrigatório; validador rejeita `base` em capacidade conversacional |
| **R13** | Licença de **código** aplicada aos **pesos** (ou o contrário) | Fish Audio: código Community License, pesos NC; F5-TTS: MIT vs CC-BY-NC | `licenseScope` com dois campos + regra do mais restritivo |
| **R14** | Ler AGPL como "proibido comercial" e descartar candidato bom | texto da AGPL-3.0 | `integrationDependency`; decisão pela forma de integração |
| **R15** | Rodar híbrido DeltaNet em Vulkan com `-ub 512` e concluir "modelo ruim" | llama.cpp #27237 | ficha registra `-b`/`-ub`; testar 256/512/1024 |
| **R16** | Medir 27B em 8 GB e chamar de "desempenho do modelo" | Q4_K_M = 16,56 GB | acima do hardware não entra na bancada; é `not-applicable` |
| **R17** | Promover descoberto a instalável por entusiasmo | ~131 descobertos | regra de 9 etapas em `07` §7.5, sem atalho |
| **R18** | Driver AMD não registrado → resultado de Vulkan irreproduzível | histórico de issues | `driver` é campo obrigatório da ficha |
| **R19** | Voz PT do Kokoro declarada sem teste | card declara `en`; vozes `.pt` existem | `portugueseBr: unverified`; uma linha de teste por voz |
| **R20** | Orçamento/aprovação tratados como "do modelo" | revisão do Dev | nove componentes separados em `03` §3.10 |

### Critério de parada da bancada

A bancada para e reporta **inconclusivo** quando:

- o runtime não expõe a versão;
- o arquivo de pesos não tem hash verificável;
- o backend caiu para CPU sem registro (silent fallback);
- o resultado varia mais de 30 % entre execuções iguais;
- o teste exigiria credencial paga.

Nenhum desses casos vira "aprovado por ausência de falha".
