# Lia — Reconciliação de Research (transferência e classificação documental)

**Data:** 16/11/2026
**Origem (leitura):** `arena/826a33f1-lia-project` @ `b345355f75` (base `7cb8172`)
**Destino:** `arena/7fa837f0-lia-project` @ `971d309074` → `docs/research/` (documentos copiados nesta rodada)
**Natureza:** consolidação documental. **Nenhum modelo foi baixado, executado, medido ou promovido.**

---

## 0. Veredicto

| Pergunta | Resposta |
|---|---|
| Os documentos foram transferidos? | **Sim**, como **cópia byte-a-byte**, classificados como **Research reference**. |
| Algum documento se tornou normativo? | **Não.** O catálogo canônico continua sendo `docs/research/lia-capability-catalog/`. |
| Algum modelo virou padrão de produto? | **Não.** O catálogo executável (`lia/core/src/providers/catalog.ts`) não foi tocado: segue Groq `openai/gpt-oss-120b` (chat) e `qwen/qwen3.8-27b` (visão) + OpenAI-compatível. |
| Algum peso foi baixado/empacotado? | **Não.** Nenhum download, nenhuma dependência nova. |
| Distinção teórico × teste local × benchmark real preservada? | **Sim** — cada documento declara seu próprio status; a classificação abaixo reforça. |

**Nota sobre a recomendação de origem:** o `LIA-RESEARCH-DOCUMENT-TRANSFER-REVIEW.md` (14/11) recomendava **não copiar** sem aprovação. A rodada 19 **autoriza expressamente** a consolidação documental e pede a classificação de cada documento. A cópia é, portanto, **ato autorizado desta rodada**, e **não** promove conteúdo: a classificação `Research reference` mantém o status probatório em N0 (documento), nunca em prova de implementação.

---

## 1. Classificação (taxonomia pedida)

| Documento (novo caminho) | Classe | Por quê | Destino normativo |
|---|---|---|---|
| `docs/research/lia-capability-catalog/*` (já na Principal) | **Canonical** | catálogo mestre com schema, matrizes, plano de testes e dados JSON | permanece canônico |
| `docs/research/LIA-WINDOWS-AMD-MODEL-COMPATIBILITY.md` | **Research reference** | separa suporte oficial de possibilidade técnica para RX 580/gfx803; nenhum benchmark | consulta; não é matriz de suporte |
| `docs/research/LIA-LFM3-EVALUATION.md` | **Research reference** | avaliação especializada por variante; sem download/inferência | consulta; licença exige reverificação |
| `docs/research/2026-11-14-runtime-resource-research.md` | **Research reference** | custo do segundo Electron, orçamento, EcoQoS/PAVISE — hipóteses, não medições | consulta; alinhar com ADR-0001/auditoria |
| `docs/research/LIA-ORNITH-WEIGHTS-RESEARCH.md` | **Research reference** (novo) | pesquisa de pesos Ornith; candidato experimental B/C; sem benchmark RX 580 | consulta; **não** é padrão |
| `docs/research/LIA-MODEL-PROVIDER-CATALOG.md` | **Pending transfer** | sobrepõe o catálogo canônico; só o delta deve entrar | reconciliar com `lia-capability-catalog/` |
| `docs/research/LIA-MODEL-PROVIDER-ARCHITECTURE.md` | **Pending transfer** | proposta conceitual; não é ADR | extrair delta para ADR |
| `docs/research/LIA-MODEL-PROVIDER-RECOMMENDATIONS.md` | **Pending transfer** | matriz de experimentos; parcialmente redundante | extrair para plano de testes |
| `docs/reports/LIA-RESEARCH-DOCUMENT-TRANSFER-REVIEW.md` | **Historical** | registro do processo de revisão de 14/11 | arquivo |
| `DOCS_VERSION`, `docs/PROJECT-OVERVIEW.md`, `docs/PROJECT-STATUS.md`, `docs/DECISIONS.md`, `docs/BRANCH-STRATEGY.md`, `docs/AGENT-WORKFLOW.md`, `.agents/skills/**` | **Superseded / MANTER NA ORIGEM** | esquema documental concorrente ao canônico (`docs/project/CURRENT-STATE.md`, `docs/architecture/decisions/`, `docs/product/`, `docs/reports/`) | não portar |

**Nenhum documento foi classificado como Canonical nesta rodada.** Promover a canonical exigiria decisão editorial explícita e reconciliação com o catálogo existente.

---

## 2. Revisão substantiva por tema

### 2.1 Catálogo de modelos e providers

- O catálogo canônico da Principal (`lia-capability-catalog/`, 11/11) tem inventário estruturado, schema, matrizes e errata.
- O catálogo de Research (14/11) acrescenta curadoria por **capability**, fontes e notas de licença. É **complemento**, não substituto.
- **Risco de duplicação:** dois catálogos com prioridades diferentes geram decisões contraditórias. O destino correto é **delta**, com data e fonte por afirmação.
- **Estado executável (verificado hoje):** `lia/core/src/providers/catalog.ts` lista Groq (`openai/gpt-oss-120b` recomendado; `qwen/qwen3.8-27b` visão) e OpenAI-compatível. **Nenhum modelo local** de Research é oferecido ao usuário.

### 2.2 Arquitetura neutra de providers

- A proposta (manifestos, capability negotiation, consentimento, fallback sem cloud automático) é **coerente** com o desenho D+ e com o princípio "host confiável guarda credenciais; Renderer não vê token".
- **Não é ADR**, não é contrato e não foi implementada. O documento reconhece que gateways/seleção já existem no snapshot consultado.
- **Decisão:** manter como **Pending transfer**; qualquer delta vai para `docs/architecture/decisions/`, não para um segundo documento normativo.

### 2.3 LFM3

- Família com variantes distintas; **não** é um modelo universal. `LFM3-1.7B` é candidato leve de texto/tool calling; `VL-2B`, `Audio-2B` e `Omni-2B` têm limites declarados (áudio voice-chat/LiveASR English-only; Omni não é raciocínio habilitado).
- **Licença:** LFM Open License v1.0 — **não** é MIT/Apache; uso comercial acima do threshold (US$ 10 M de receita anual) não é autorizado pelo acordo.
- **Nenhum download, inferência ou benchmark.** "Portuguese" no card **não** prova pt-BR.
- **Decisão:** Research reference; prioridade A apenas para **avaliação** de texto; **não** padrão, **não** dependência.

### 2.4 Windows + AMD RX 580

- **CPU** é o baseline obrigatório.
- **Vulkan** é a primeira opção prática (`llama.cpp`), mas compatibilidade oficial do backend **não** é benchmark da RX 580; referências são comunitárias.
- **ROCm/HIP:** não suportado oficialmente para gfx803 no Windows; workarounds experimentais **não** podem ser base de produto.
- **DirectML:** em *sustained engineering*; recomenda-se WinML para projetos novos; compatibilidade de export ONNX específico é desconhecida até smoke test.
- **CUDA:** indisponível; futuro, nunca requisito estrutural.
- **Decisão:** Research reference; **nenhuma** conclusão de "funciona na RX 580" sem medição.

### 2.5 Recursos em jogos / desktop sempre ativo

- O documento levanta o custo do **segundo Electron** (Stage) e hipóteses de orçamento (`presence.set-budget`), EcoQoS/PAVISE.
- **Nenhum benchmark** executado; nenhuma comparação Tauri/Electron medida.
- **Decisão:** Research reference; alinhado ao **ADR-0001** (D+, Electron nos dois processos) e ao gate de arquitetura **ABERTO**. Não reabre a decisão de framework.

### 2.6 Ornith (novo nesta rodada)

- Família majoritariamente **coding/agentes**: 9B denso, 35B MoE, 397B MoE (+122B e variantes GGUF/FP8/NVFP4/MLX).
- Para a máquina de referência (RX 580 8 GB / 16 GB RAM), **apenas** `Ornith-1.5-9B-GGUF Q4_K_M` (5,78 GB) é hipótese — e já **sem margem** para KV cache/buffers/Stage.
- **Licença não confirmada** (LICENSE do checkpoint 9B retornou 404 na consulta). Não classificar como MIT/Apache.
- **Decisão:** **Research reference**; candidato **B/C** experimental, **não** padrão, **não** baixar 35B/122B/397B.

---

## 3. Matriz de risco de transferência

| Risco | Aplicável a | Mitigação adotada |
|---|---|---|
| Duplicação de catálogo | CATALOG, ARCHITECTURE, RECOMMENDATIONS | marcados **Pending transfer**; canônico intocado |
| Referência a branch inexistente (`arena/01a10290`) | 4 documentos | registrado; não reescrevi o conteúdo (preservação) |
| Snapshot confundido com HEAD | todos | cada doc declara SHA de consulta; este relatório reforça |
| Licença lida como permissão | LFM3, Ornith, Kokoro, Piper | nenhuma adoção; licença a reverificar por revisão |
| Benchmark de fornecedor lido como medição | Ornith, LFM3 | nenhum número promovido |
| "Suportado" vs "possível" vs "testado" | AMD/Windows | hierarquia preservada; nada declarado testado |
| Esquema documental concorrente | `agents/docs` | **MANTER NA ORIGEM** |
| Documento virar norma por existir no repo | todos | `Research reference` explícito no cabeçalho desta reconciliação |

---

## 4. O que **não** fazer

1. Não substituir `lia-capability-catalog/` pelos documentos de Research.
2. Não adicionar modelos ao catálogo executável sem decisão de produto e teste local.
3. Não baixar pesos para a máquina de referência "porque cabem no papel".
4. Não citar benchmark de fornecedor como se fosse medição na RX 580.
5. Não tratar "Portuguese" como pt-BR.
6. Não reintroduzir `docs/PROJECT-STATUS.md` como fonte de estado.
7. Não usar `DOCS_VERSION` para versionar a documentação canônica.

---

## 5. Próximos passos (documentais, sem código)

| Ordem | Ação | Responsável | Critério |
|---:|---|---|---|
| 1 | Revisar `LIA-ORNITH-WEIGHTS-RESEARCH.md` quanto a licença (fixar revision HF + LICENSE) | Research | LICENSE verificada e datada |
| 2 | Extrair delta de CATALOG para `lia-capability-catalog/07-CATALOGO-ESTRUTURADO.md` | Research | diff revisado, sem duplicar |
| 3 | Extrair delta de ARCHITECTURE para ADR | Arquitetura | ADR com status `proposed` |
| 4 | Extrair matriz de experimentos de RECOMMENDATIONS para o plano de testes | QA/Research | plano com dono e prazo |
| 5 | Atualizar referências de branch/SHA nos 4 documentos | Research | nenhuma referência a branch inexistente |
| 6 | Manter EcoQoS/PAVISE como hipótese | Arquitetura | nenhuma implementação sem medição |

---

## 6. Critérios de aceite desta reconciliação

| # | Critério | Resultado |
|---|---|---|
| 1 | `LIA-ORNITH-WEIGHTS-RESEARCH.md` incluído | **PASS** (copiado) |
| 2 | Catálogo, arquitetura, LFM3, Windows/AMD e recursos em jogos classificados | **PASS** (§1) |
| 3 | Nenhum modelo experimental promovido | **PASS** (catálogo executável intocado) |
| 4 | Distinção teórico × teste local × benchmark real | **PASS** (declarada por documento) |
| 5 | Sem merge integral de Research | **PASS** (cópia documental seletiva) |
| 6 | Nenhum download/peso/dependência | **PASS** |
