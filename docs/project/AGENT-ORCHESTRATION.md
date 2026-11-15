# Orquestração de agentes — política da Lia

Estado: escrito em 30/10/2026. Escopo: **como o trabalho é dividido entre agentes**.
Nenhuma funcionalidade da Lia é descrita aqui; para produto, a autoridade continua
`AGENTS.md` e `docs/project/CURRENT-STATE.md`.

> **O que este documento não afirma.** Nenhuma economia de tokens é declarada como
> comprovada. O que existe é uma medição de linha de base (§7) feita com a mesma
> régua antes e depois, e um conjunto de regras de comportamento. Ganho de tempo
> ou de consumo só pode ser afirmado quando houver duas execuções comparáveis.

Este arquivo é carregado **sob demanda**. Não é obrigatório para uma tarefa pequena
de um arquivo só — nesse caso, execute direto e ignore o resto.

---

## 1. O que o repositório controla e o que não controla

A pergunta que evita promessa falsa: **quem decide isso?** Quatro donos diferentes,
e confundi-los produz relatório que mente.

### A. Controlado pelo repositório

| Item | Onde | Alterável | Como verificar |
| --- | --- | --- | --- |
| Instruções sempre carregadas | `AGENTS.md` | sim | `node tools/agents-docs/measure.mjs AGENTS.md` |
| Estado lido no início | `docs/project/CURRENT-STATE.md` §0 | sim | idem, `--lines 1-N` |
| Skills e seus gatilhos | `.agents/skills/*/SKILL.md` | sim | `cd tools && python3 -m unittest test_agent_skills -v` |
| Contrato de delegação | este arquivo, §3–§5 | sim | revisão do brief antes de despachar |
| Validações de CI | `.github/workflows/devflow-ci.yml` | sim | o workflow roda em `push` de `arena/**` |
| Estratégia de testes | `.agents/skills/lia-test-discipline/SKILL.md` + §5 | sim | comando citado no relatório de cada rodada |

### B. Controlado pelo runner (Codex)

| Item | Onde vive | Podemos alterar? |
| --- | --- | --- |
| Modelo de cada agente/subagente | configuração do Codex (`~/.codex/config.toml`, flags da CLI) | **não pelo repositório** |
| Nível de raciocínio | idem | **não pelo repositório** |
| Janela de contexto e compactação | runner | **não pelo repositório** |
| Paralelismo, timeouts, regras de delegação | runner | **não pelo repositório** |
| Descoberta de skills | varredura de `.agents/skills` a partir do CWD | **sim, pelo conteúdo e pelo nome** |

Consequência prática: §2 é uma **política orientativa**. O repositório pode
escrever qual capacidade cada tarefa pede; ele não consegue impor o modelo.

### C. Controlado pela plataforma Arena

Modelo por turno, esforço, compactação, sandbox e paralelismo pertencem à
plataforma. O agente **não lê a própria configuração** de dentro da sessão. Não há
arquivo neste repositório que altere isso; quem configura é o usuário, na
interface. O único controle indireto daqui é reduzir o que entra (§7).

### D. Controlado pela conta ou pelo provedor

Cotas, créditos, limites por minuto e bloqueios. Sinais já observados e
classificados em `.agents/skills/lia-agent-evaluation/SKILL.md` §5 (429, 413, 401).
Nada disso é configuração do repositório, e nenhum desses códigos é FAIL de produto.

---

## 2. Modelo e esforço por tipo de tarefa

Política orientativa. A capacidade concreta depende do que o runner oferece —
**não invente um modelo que não existe** nem afirme que um parâmetro foi aplicado
sem conseguir verificar.

| Faixa | Tarefa | Capacidade pedida | Nunca usar para |
| --- | --- | --- | --- |
| T0 | Inventário, listagem, leitura de arquivos | econômica, esforço baixo | — |
| T1 | Busca de referência, análise localizada | econômica/intermediária | decisão de arquitetura |
| T2 | Teste pontual, reprodução, diagnóstico de causa | intermediária | — |
| T3 | Implementação comum, com critério claro | intermediária | segurança |
| T4 | Arquitetura, desenho de fronteira, decisão técnica | avançada | tarefa mecânica |
| T5 | Segurança, revisão crítica, análise de falha difícil | avançada, raciocínio alto | trabalho repetitivo |

**Regra de escalada.** Sobe-se de faixa por evidência, não por precaução:
(a) a tentativa da faixa anterior falhou e a causa foi identificada; (b) o
problema é ambíguo e decidir errado custa mais que decidir devagar; (c) há
segredo, permissão ou perda de dados em jogo. "É importante" não é motivo.

**Regra de descida.** Tarefa mecânica — renomear, mover documentação, listar
arquivos, atualizar número — em faixa alta é desperdício puro. Divida em unidades
mecânicas e mande na faixa baixa.

**O que o repositório pode fazer:** escrever a faixa no brief da delegação (§3,
campo 8). O runner pode ignorar. Quando ignorar, o relatório registra "faixa
pedida X, não verificável".

---

## 3. Contrato de delegação

Um subagente **não herda histórico por padrão**. Quem delega copia o que o
trabalho precisa, não o que a conversa tem. O brief abaixo é o mínimo; um brief
sem qualquer um dos oito campos volta para quem escreveu.

1. **Objetivo** — uma frase, verificável. "Investigar por que X falha", não "dar uma
   olhada em X".
2. **Contexto indispensável** — fatos que o agente não descobre sozinho: decisão já
   tomada, armadilha conhecida, caminho errado já descartado. Sem narrativa da
   conversa.
3. **Arquivos e diretórios** — caminhos exatos, marcados **leitura** ou **escrita**.
   "O repositório" não é escopo.
4. **Restrições** — o que não pode ser tocado, o que não pode ser instalado, o que
   exige autorização.
5. **Critério de conclusão** — o que precisa ser verdade para a tarefa acabar.
6. **Testes exigidos** — comando exato, diretório de execução e o que conta como
   evidência (ver §5).
7. **Formato de retorno** — os seis campos de §3.1, sempre.
8. **Faixa de capacidade** (§2) — pedido explícito, sabidamente não garantido.

### 3.1 Retorno obrigatório

O subagente devolve **só isto**, e curto:

- o que investigou ou implementou;
- arquivos alterados (caminhos, e o que mudou em cada um);
- decisões tomadas, com o motivo em uma linha;
- testes: comando → resultado → código de saída (ou "não executado", com o motivo);
- problemas e limites encontrados;
- próximo passo proposto.

Proibido no retorno: despejo de log, transcrição de raciocínio, "tudo certo" sem
comando, e conclusão que o próprio subagente não verificou.

### 3.2 Isolamento de investigação

Investigação é **read-only**. Um agente que investiga não escreve; um agente que
escreve recebe o resultado da investigação e não repete a busca. Misturar os dois
no mesmo despacho é o que produz edição concorrente e retrabalho.

---

## 4. Propriedade de arquivos

Regra única: **um escritor por caminho, por rodada.**

- Antes de despachar dois escritores, liste os caminhos de cada um. Interseção não
  vazia significa que **um** deles não é despachado — não que "vai dar certo".
- Quem precisa escrever fora do próprio conjunto **para e reporta**. Não amplia o
  escopo por conta própria, não reformata arquivo alheio, não usa `--fix` global.
- Arquivos de governança (`AGENTS.md`, `docs/project/`, `.github/`) têm um dono
  único: o agente principal. Nenhum subagente escreve neles.
- Leitura é livre e simultânea; escrita não.
- Se dois trabalhos legítimos disputam o mesmo arquivo, o segundo espera o primeiro
  publicar e relê o diff. Edição concorrente no mesmo arquivo é conflito garantido.

Antes de commitar: `git status --short` e `git diff --stat` por caminho. Um caminho
que não estava no escopo é uma decisão a explicar, não um detalhe.

---

## 5. Economia de testes

Nível de teste proporcional ao risco, não ao hábito.

| Nível | Quando | Exemplo |
| --- | --- | --- |
| L1 | sempre, durante a edição | o arquivo de teste que cobre o que mudou |
| L2 | mudança atravessa módulo | a suíte do pacote (`stores/lia/`, `tools/`) |
| L3 | ponto de validação: antes de commit amplo, antes de release, ou quando o usuário pede | suíte completa + typecheck + lint |

**Reaproveitamento.** Um resultado vale enquanto não mudar nenhuma entrada dele:
mesmo commit, mesmo comando, mesmo diretório, mesma árvore de trabalho. Qualquer
edição que o comando importe invalida — na dúvida, reexecute o L1 e diga por quê.

**Proibições que já custaram caro neste projeto.**

- Rodar `discover` da raiz e aceitar `Ran 0 tests` com saída 0 como aprovação.
- Aumentar timeout para o teste passar.
- `| tail` escondendo o código de saída (use `PIPESTATUS` ou redirecione e leia `$?`).
- Declarar PASS sem comando, sem saída e sem código de saída na mesma mensagem.
- Rodar lint com correção automática global enquanto outro agente escreve.

O detalhe de suítes, diretórios e armadilhas fica em
`.agents/skills/lia-test-discipline/SKILL.md` — este documento não o repete.

---

## 6. Alethe: quando faz sentido

Alethe (`.agents/skills/alethe/`) coordena **CLIs externas** — Codex, Claude Code,
Agy, Kimi — com orçamento, prazo e relatório. Ela não cria subagentes nativos do
Arena e não substitui a delegação da própria plataforma.

Antes de usar, um comando decide:

```sh
python3 .agents/skills/alethe/scripts/orchestrate.py doctor
```

Se `installedProviders` vier vazio, Alethe **não tem worker** e o caminho correto
é outro: dividir a tarefa e executar diretamente. Não instalar CLI para deixar um
checklist verde.

Quando usar: várias unidades independentes, cada uma com escopo próprio, e um lead
que integra no fim. Quando não usar: tarefa mecânica, arquivo único, ou ambiente
sem CLI.

Limite conhecido e documentado em `docs/architecture/ALETHE-HARDENING-2026-10-28.md`:
o orçamento de tokens é **contabilizado depois**, não interrompe a chamada em
curso. Limite real se faz com `--max-calls` e prazo.

---

## 7. Medição de contexto (linha de base 30/10/2026)

Régua: BPE `o200k_base` via `tools/agents-docs/` (js-tiktoken, offline). É um
proxy — o Claude não usa esse tokenizador. O que vale é comparar **antes e depois
pela mesma régua**.

Linha de base medida **antes** desta entrega, e o valor de hoje:

| Componente | Sempre carregado | Antes | Hoje |
| --- | --- | --- | --- |
| `AGENTS.md` (100 seções) | sim, inteiro | 12 964 | 13 041 |
| `CURRENT-STATE.md` §0 (linhas 1–303) | sim, por ordem da §0 | 5 387 | 5 387 |
| Descrições das skills (21 → 22) | sim, na descoberta | 1 154 | 1 222 |
| **Total antes de qualquer trabalho** | | **19 505** | **19 650** |

A entrega **subiu** 145 tokens: é o preço de tornar esta política descobrível.
Não é economia e não deve ser vendida como tal.

Dentro da §0, **4 177 tok (77%) são rodadas de 28/10 já superadas**. A §0 chama-se
"Estado agora" e virou diário. Compactá-la para a rodada vigente é a maior
redução medida disponível: de 5 387 para ≈1 200 tok, ou seja, o custo fixo de
19 650 para ≈15 473.

**Teto de descoberta.** A soma das `description` é limitada a **6 500
caracteres** (hoje 5 396) por `tools/test_agent_skills.py`. Acima do teto a
suíte reprova; o motivo não é economia de token, é que acima de ~2% da janela o
runner encurta descrições e pode omitir skills — falha silenciosa.

Remeça sempre que mexer:

```sh
cd tools/agents-docs && npm install        # só na primeira vez
node measure.mjs ../../AGENTS.md
node measure.mjs ../../docs/project/CURRENT-STATE.md --lines 1-303
node extract.mjs                            # portão estrutural das seções
node classify.mjs                           # contabilidade A/B/C/D
```

**Economia que não existe.** Mover texto do arquivo principal para regras sem
caminho não economiza nada: os dois são carregados sempre. Só há ganho quando o
conteúdo deixa de ser carregado — por caminho (Claude Code, via `.claude/rules`
com `paths:`) ou por sair do arquivo. Codex não tem regra por caminho: para ele, a
única redução real é remover ou encurtar.

---

## 8. Como saber que a política funcionou

Uma delegação foi boa quando o retorno (§3.1) permite decidir sem reabrir o
trabalho: dá para ver o que mudou, com qual comando foi provado e o que ficou em
aberto. Se o agente principal precisou reexplorar os arquivos para entender o que
o subagente fez, a delegação custou mais do que fazer direto.

Sinais de que ela falhou, e o que ajustar:

| Sintoma | Causa provável | Ajuste |
| --- | --- | --- |
| Retorno longo e sem comando | brief sem campo 5 e 6 | refazer o brief, não o agente |
| Dois agentes no mesmo arquivo | escopo não declarado | §4 |
| Retrabalho de teste | L3 cedo demais | §5 |
| Faixa alta em tarefa mecânica | brief sem campo 8 | §2 |
| "Não encontrei" sem caminhos | brief sem campo 3 | §3 |

---

## 9. Referências

- `.agents/skills/lia-safe-change/SKILL.md` — preservar o trabalho alheio.
- `.agents/skills/lia-test-discipline/SKILL.md` — suítes e armadilhas reais.
- `.agents/skills/lia-agent-evaluation/SKILL.md` — avaliar comportamento de modelo.
- `docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.md` — auditoria que produziu §1 e §7.
- `docs/project/AGENT-SKILLS.md` — inventário e manutenção das skills.
- `docs/architecture/AGENT-SKILLS-CATALOG.md` — índice canônico das 21 skills.
