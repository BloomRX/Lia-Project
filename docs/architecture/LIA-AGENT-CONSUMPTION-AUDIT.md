# Consumo e orquestração de agentes — auditoria da Lia

Data: 30/10/2026. Branch `arena/01a10290-lia-project`, base `a7a2c7b`.
Escopo: **infraestrutura de agentes** (skills, prompts, delegação, contexto,
capability por tarefa, Alethe). Nenhuma funcionalidade da Lia foi alterada e
nenhum arquivo de `lia/` ou `airi/` foi tocado.

> **Este arquivo não existia.** A missão o citou como "relatório anterior". Ele
> não estava no repositório em `a7a2c7b`; os relatórios de agente que existiam
> eram `AGENT-SKILLS-AUDIT.md`, `AGENT-SKILLS-AUDIT-LIA.md`,
> `AGENT-SKILLS-AUDIT-AIRI.md`, `AGENT-SKILLS-CATALOG.md`,
> `ALETHE-VALIDATION-2026-10-28.md` e `ALETHE-HARDENING-2026-10-28.md`. Este
> documento é o primeiro com este nome e foi escrito a partir deles, não no lugar
> deles.

> **O que este documento não afirma.** Não houve execução no Codex, no Claude
> Code, no Agy ou no Kimi: nenhum desses binários existe neste ambiente (§10).
> Tudo o que depende deles está marcado **NÃO OBSERVADO**. Nenhuma economia de
> token é declarada como ganho: o que existe é uma medição antes/depois pela mesma
> régua (§12), e ela mostra que o custo fixo **subiu** 146 tokens com esta
> entrega.

---

## 0. Nota sobre o estado do workspace (divergência encontrada)

A missão descreveu a branch como sincronizada em `a7a2c7b` **com numerosas
alterações locais não commitadas** de Transport Configuration. O checkout deste
ambiente não estava nesse estado: estava em `db99c70` (a `main` antiga), quatro
commits atrás, e os nove arquivos modificados nada tinham a ver com transporte —
eram sobras de uma rodada de diagnóstico do Brain.

O que foi feito antes de qualquer trabalho, e por quê:

1. Os nove arquivos foram copiados para fora do repositório
   (`/home/user/preserved-wip/…`, com `git-status.txt` e dois patches de
   referência).
2. Comparação por hash provou que **sete dos nove eram byte a byte idênticos ao
   conteúdo já commitado em `a7a2c7b`**, e um era o conteúdo exato de um commit
   antigo (`d819397`). Nenhum continha trabalho único, exceto `tools/roda5x.ps1`,
   que também está preservado na cópia externa.
3. Só então a branch foi avançada para `a7a2c7b` por fast-forward. Nada foi
   apagado do histórico, nada foi resetado.

**A implementação de Transport Configuration não existe neste ambiente.** Ela
está na máquina do usuário, não commitada. Este relatório não a viu, não a
avaliou e não a alterou. Por isso `docs/project/CURRENT-STATE.md` **não foi
tocado** (§11): é o arquivo em que essa implementação precisa registrar o próprio
estado, e editar a §0 aqui produziria conflito exatamente no trecho que o trabalho
em andamento usa.

---

## 1. Estado anterior

### 1.1 O que existia e funcionava

| Componente | Estado em `a7a2c7b` |
| --- | --- |
| `.agents/skills/` | 21 skills (20 da Lia + Alethe), todas com `SKILL.md`, sem scripts próprios exceto Alethe |
| `airi/.agents/skills/` | 28 skills vendadas, fora da descoberta quando a sessão abre na raiz |
| `AGENTS.md` | 3.061 linhas, **100 seções**, 12.964 tokens, carregado inteiro em toda sessão |
| `docs/project/CURRENT-STATE.md` | 1.076 linhas; a §0 ("Estado agora") ocupa as linhas 1–303 |
| `tools/test_agent_skills.py` | 5 testes estruturais: frontmatter, `name` = diretório, corpo, referências |
| `.github/workflows/devflow-ci.yml` | Roda a suíte acima em Windows e Linux a cada push em `arena/**` |
| `tools/agents-docs/` | Régua de tokens (BPE `o200k_base`), extrator de seções e contabilidade A/B/C/D |
| `.agents/skills/alethe/` | v19, `orchestrate.py` só com biblioteca padrão, `playbooks.yaml` válido |

### 1.2 O que existia e não funcionava

| Item | Defeito |
| --- | --- |
| `tools/agents-docs/extract.mjs --expect 99` | Reprova `AGENTS.md` correto: quando a §99 foi escrita, a contagem virou 100 e o portão passou a falhar sempre |
| `tools/agents-docs/classify.mjs` | Aborta com `secoes sem balde: 99` — a §99 nunca foi classificada, então a contabilidade A/B/C/D não roda |
| `tools/agents-docs/classify.mjs` | Classifica a §81 como dívida aberta "porque `docs/compatibility/MATRIX.md` não existe". A matriz **existe**, com 41 linhas de conteúdo |
| `docs/project/AGENT-SKILLS.md` | Afirma "6 skills" e lista 6; a raiz tem 22. Falta 15 das 22 na tabela |
| `tools/agents-docs/` | Não é citado por nenhum documento do projeto — só pelo próprio README. Ferramenta órfã |

### 1.3 O que existia, mas não estava provado

`AGENTS.md` não dizia **como dividir trabalho entre agentes**. Havia
`lia-safe-change` (preservar trabalho alheio) e `lia-test-discipline` (qual
suíte), mas nenhum lugar definia: contexto mínimo de subagente, propriedade de
arquivo, faixa de capacidade por tarefa, ou quando um teste pode ser reusado em
vez de reexecutado.

---

## 2. Problemas confirmados

Cada um abaixo foi verificado no arquivo real, não deduzido.

**P1 — O custo fixo por sessão é ~19,5 mil tokens, e 21% dele é narrativa
superada.** Medido: `AGENTS.md` 12.964 + `CURRENT-STATE.md` §0 5.387 + descrições
das skills 1.154 = **19.505 tokens** antes de qualquer trabalho. Dentro da §0,
**4.177 tokens (77%)** são rodadas de 28/10 já substituídas por rodadas de 29 e
30/10. A própria §0 se define como "Estado agora" e "registra estado, não
narrativa" — ela viola o próprio contrato.

**P2 — A descoberta de skills não tinha teto.** 21 skills somavam 5.086
caracteres de `description`, carregados em toda sessão só para o agente decidir o
que abrir. O documento de manutenção registra a consequência real: acima de ~2%
da janela, o runner **encurta descrições e pode omitir skills** — falha silenciosa,
porque nada quebra e a skill simplesmente deixa de existir. Nada no repositório
impedia a 22ª skill de empurrar o total para além disso.

**P3 — O índice canônico não era verificado.** `AGENT-SKILLS-CATALOG.md` listava
as 21 corretamente, mas nenhum teste exigia isso. Uma skill nova entrava em
`.agents/skills/` e funcionava para o agente, invisível para quem revisa. E o
documento gêmeo (`docs/project/AGENT-SKILLS.md`) já estava 15 skills atrasado —
prova de que a divergência acontece.

**P4 — A régua de medição estava quebrada.** Sem `classify.mjs`, a conta que
importa (o que é carregado sempre × o que só é carregado por caminho) não podia
ser feita. Sem ela, qualquer decisão sobre `AGENTS.md` seria por impressão.

**P5 — Nenhuma política de delegação, capacidade ou propriedade.** Ver §1.3.

**P6 — Alethe não tem worker neste ambiente.** `orchestrate.py doctor` roda
(exit 0), `installedProviders: []`, nenhum CLI instalado. A skill está íntegra,
mas aqui ela não executa nada — e nada no repositório dizia o que fazer quando o
`doctor` volta vazio.

---

## 3. O que pode ser controlado pelo repositório

Tudo nesta tabela foi alterado ou é verificável por comando no repositório.

| Item | Onde | Alterável | Como verificar que entrou em vigor |
| --- | --- | --- | --- |
| Instruções sempre carregadas | `AGENTS.md` | sim | `node tools/agents-docs/measure.mjs AGENTS.md` |
| Ordem de leitura obrigatória | `AGENTS.md` §0 | sim | revisão do arquivo |
| Estado lido no início | `docs/project/CURRENT-STATE.md` §0 | sim | `measure.mjs … --lines 1-303` |
| Skill e gatilho de descoberta | `.agents/skills/*/SKILL.md` | sim | `cd tools && python3 -m unittest test_agent_skills -v` |
| Orçamento de descoberta | `.agents/skills/*` (soma) | sim | o teste acima reprova acima de 6.500 caracteres |
| Índice canônico de skills | `docs/architecture/AGENT-SKILLS-CATALOG.md` | sim | o teste acima reprova skill fora do índice |
| Contrato de delegação | `docs/project/AGENT-ORCHESTRATION.md` §3 | sim | revisão do brief antes de despachar |
| Propriedade de arquivos | idem §4 | sim | `git diff --stat` por caminho antes do commit |
| Faixa de capacidade | idem §2 | **orientativa** | não é verificável: o runner decide |
| Economia de testes | idem §5 + `lia-test-discipline` | sim | o relatório de cada rodada cita comando e saída |
| Portão estrutural do `AGENTS.md` | `tools/agents-docs/extract.mjs` | sim | `node extract.mjs` (exit 1 se a estrutura quebrar) |
| Contabilidade de contexto | `tools/agents-docs/classify.mjs` | sim | `node classify.mjs` |
| CI dos testes acima | `.github/workflows/devflow-ci.yml` | sim | o workflow roda em push de `arena/**` |

---

## 4. O que depende do runner (Codex)

Não é configurável por arquivo deste repositório. **Não foi observado nesta
rodada** — não há binário do Codex neste ambiente (`command -v codex` → ausente).

| Item | Onde vive | Consequência |
| --- | --- | --- |
| Modelo de cada agente/subagente | configuração do Codex / flag da CLI | §2 da política pede a faixa; o runner pode ignorar |
| Nível de raciocínio | idem | idem |
| Janela de contexto e compactação | runner | só se reduz **entrando menos** (§12) |
| Paralelismo, timeouts, limites de delegação | runner | a política não controla |
| Descoberta de skills | varredura de `.agents/skills` a partir do CWD | **controlável** pelo nome e pela `description` |

Registrado no próprio repositório (`docs/project/AGENT-SKILLS.md` §4, auditoria de
21/10): o Codex varre `.agents/skills` de cada diretório do CWD até a raiz,
incluindo `$HOME/.agents/skills`, e a **contagem de skills visíveis muda com o CWD**
(6 na raiz da época, 34 em `airi/`). Por isso a regra de abrir a sessão na raiz.

---

## 5. O que depende da interface Arena

| Item | Situação |
| --- | --- |
| Modelo por turno | escolhido na plataforma; o agente não lê a própria configuração de dentro da sessão |
| Nível de raciocínio | idem |
| Compactação de contexto | plataforma |
| Paralelismo e sandbox | plataforma |
| Delegação entre agentes nativos | plataforma; a skill Alethe **não** cria subagentes do Arena |

Não existe arquivo neste repositório que altere nenhum destes. O único controle
indireto é o tamanho do que entra (§12). Nada aqui foi alterado, e nada foi
afirmado sobre parâmetros da plataforma que não são visíveis.

---

## 6. O que depende da conta ou do serviço externo

Cotas, créditos, limites por minuto e bloqueios do provedor. Sinais já
classificados em `.agents/skills/lia-agent-evaluation/SKILL.md` §5:

| Código | Significado | Veredito correto |
| --- | --- | --- |
| 429 | quota de tokens de saída | BLOCKED, não FAIL |
| 413 | limite de tokens de entrada | BLOCKED; reduzir o caso |
| 401 | credencial inválida | BLOCKED; problema de acesso |

Nada disso é configuração do repositório e nada disso foi alterado.

---

## 7. Arquivos modificados e motivo

| Arquivo | Mudança | Motivo |
| --- | --- | --- |
| `docs/project/AGENT-ORCHESTRATION.md` | **novo**, 9 seções | Política central: matriz de controle, faixas de capacidade, contrato de delegação, propriedade, economia de testes, Alethe, medição |
| `.agents/skills/lia-agent-orchestration/SKILL.md` | **novo**, 764 tok | Contrato operacional curto e descobrível; carregado só quando a tarefa envolve delegar |
| `tools/test_agent_skills.py` | +2 testes, +1 constante, +1 skill em `REQUIRED` | Teto de descoberta e cobertura do índice; fecha P2 e P3 |
| `docs/architecture/AGENT-SKILLS-CATALOG.md` | 21 → 22 skills; nota de verificação | Índice canônico tem que listar a skill nova |
| `docs/project/AGENT-SKILLS.md` | nota de atualização no topo | O documento afirmava 6 skills; hoje são 22. Histórico preservado, não reescrito |
| `AGENTS.md` | +5 linhas na §0 | Sem isso, ninguém é mandado ler a política. +77 tokens, medido |
| `tools/agents-docs/extract.mjs` | portão intrínseco | Fecha P4: a contagem deixa de ser número fixo |
| `tools/agents-docs/classify.mjs` | §99 no balde B, §81 no C, balde E vazio | Fecha P4: a contabilidade volta a rodar |

**Não modificados de propósito:** `docs/project/CURRENT-STATE.md` (§11),
`AGENTS.md` §1–§98, qualquer skill existente, qualquer arquivo de `lia/` ou
`airi/`, credenciais, `.git/` e o workflow de CI.

---

## 8. Skills adicionadas, ajustadas ou removidas

**Adicionada: 1.** `lia-agent-orchestration`.

Justificativa: é o único ponto que faltava entre skills que já existem.
`lia-safe-change` diz como não destruir trabalho alheio; `lia-test-discipline` diz
qual suíte rodar; nenhuma diz **como dividir**, **quanto contexto passar** ou
**que capacidade pedir**. A `description` tem 310 caracteres (68 tokens) e o
gatilho está nas primeiras palavras.

**Ajustadas: 0.** Nenhuma skill existente foi alterada. Isso é deliberado: o
`CATALOG` documenta que `environment-rules-for-vitest`, `pinia`, `pnpm`, `vue`,
`unocss` e `xsai` já foram consolidadas dentro das skills da Lia, e uma segunda
consolidação sem consumidor comprovado seria mudança sem prova.

**Removidas: 0.** Nenhuma skill foi removida, e nenhuma foi demonstrada
redundante a ponto de justificar remoção. Alethe continua, com o limite do `doctor`
documentado na política.

**Rejeitadas: 3.**

| Candidata | Por quê não | Avaliada |
| --- | --- | --- |
| skill separada de "seleção de modelo" | o runner controla o modelo; uma skill própria prometeria um controle que não existe | sim |
| skill separada de "propriedade de arquivos" | 12 linhas; sozinha não justifica entrada na descoberta | sim |
| skill de "subagentes nativos do Arena" | não há API no repositório para isso; Alethe explicitamente não é isso | sim |

---

## 9. Configurações efetivamente alteradas

| Configuração | Antes | Depois | Como foi verificado |
| --- | --- | --- | --- |
| Portão de estrutura do `AGENTS.md` | número fixo 99 | invariantes (estrito=tolerante, sem duplicata, sem lacuna, 0..N) | `node extract.mjs` → exit 0 com 100 seções |
| Orçamento de descoberta de skills | inexistente | 6.500 caracteres somados | mutação para 3.000 → teste reprova |
| Cobertura do índice de skills | inexistente | toda skill tem que estar no catálogo | mutação com skill não indexada → teste reprova |
| `REQUIRED` de skills | 6 nomes | 7 nomes (+ `lia-agent-orchestration`) | `python3 -m unittest test_agent_skills` → 7/7 |
| Baldes de contexto | §99 sem balde, §81 em "dívida" | §99 em B, §81 em C, E vazio e preservado | `node classify.mjs` → 100 seções classificadas |

Nenhuma configuração de modelo, raciocínio, cota ou conta foi alterada — nenhuma
delas é acessível daqui.

---

## 10. Testes realizados e resultados

Todos executados neste checkout, em `a7a2c7b` + as mudanças desta entrega.

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Contrato estrutural das skills | `cd tools && python3 -m unittest test_agent_skills -v` | **7/7 OK**, exit 0 |
| Suíte Python completa | `cd tools && python3 -m unittest discover -s . -p "test_*.py" -t .` | **498 testes, OK (skipped=12)**, exit 0, 122 s |
| Harness Node | `node --test "Tests/tools/*.test.mjs"` | **267 pass**, exit 0 |
| Portão de estrutura | `node tools/agents-docs/extract.mjs` | exit 0, 100 seções, numeração 0..99 |
| Contabilidade de contexto | `node tools/agents-docs/classify.mjs` | exit 0, 100 seções classificadas |
| Alethe: ambiente | `python3 .agents/skills/alethe/scripts/orchestrate.py doctor` | exit 0; `installedProviders: []`; os quatro CLIs ausentes |

### 10.1 Prova de que os portões novos discriminam

Verde não prova nada; o projeto já pagou por isso. As duas regras novas foram
forçadas a falhar:

| Mutação | Resultado |
| --- | --- |
| Skill `zz-mutation-probe` criada sem linha no catálogo | `test_every_skill_is_in_the_catalog` **FAIL**; diretório removido; md5 do catálogo idêntico antes e depois (`977fe376…`) |
| `DESCRIPTION_BUDGET_CHARS` forçado a 3.000 (total real 5.396) | `test_discovery_budget_is_respected` **FAIL** com o total no erro; constante restaurada |
| `extract.mjs --expect 99` com arquivo de 100 seções | **FAIL** com mensagem de `--expect`, exit 1 — o portão antigo ainda funciona como asserção extra |

### 10.2 Delegação de teste

**NÃO EXECUTADA.** Não há runner de subagente neste ambiente: nenhum CLI
(`codex`, `claude`, `agy`, `kimi`) está instalado, e o mecanismo de delegação do
Arena não é acessível por arquivo. A política de §3 foi revisada por leitura, não
por execução. Não é possível afirmar que ela reduz contexto na prática — só que
ela existe, é descobrível e é verificável pela suíte.

---

## 11. Limitações que continuam existindo

1. **Nenhum runner foi observado.** Descrição de skill, seleção de modelo e
   herança de contexto não foram vistas funcionando no Codex nem no Arena.
2. **Transport Configuration não foi vista.** Está na máquina do usuário, não
   commitada. Não foi avaliada nem alterada.
3. **`CURRENT-STATE.md` §0 não foi compactado**, apesar de ser a maior redução
   medida (§12). O arquivo é onde o trabalho em andamento registra estado;
   editá-lo aqui produziria conflito no trecho exato em uso. A ordem do usuário
   foi explícita: documentar e evitar interferir.
4. **`git diff --check` acusa "trailing whitespace" nas 5 linhas novas do
   `AGENTS.md`.** O arquivo inteiro está em CRLF e o repositório não tem
   `.gitattributes`; qualquer linha CRLF acrescentada produz o aviso. Gravar as
   linhas em LF calaria o aviso e criaria arquivo de EOL misto, que o
   `extract.mjs` (`split('\r\n')`) leria errado. Escolhi CRLF e registro o aviso.
5. **Alethe não pode ser exercitada aqui.** Sem CLI, `doctor` roda e acusa zero
   providers. O que o relatório de 28/10 provou — um worker Codex read-only,
   30,1 s, 11.370 tokens fora de cache contra orçamento reportado de 3.000 —
   continua valendo e continua sem repetição neste ambiente.
6. **`airi/node_modules` ausente:** nenhuma suíte Vitest, lint ou typecheck do
   Stage foi executado nesta rodada.
7. **`docs/project/AGENT-SKILLS.md` continua com as tabelas antigas.** Corrigi a
   afirmação de contagem no topo, não reescrevi o histórico (§7).

---

## 12. Comparação de consumo antes/depois

Régua: BPE `o200k_base` via `tools/agents-docs/` (js-tiktoken, offline). É
**proxy**: o Claude não usa esse tokenizador. Vale a comparação pela mesma régua,
não o número absoluto.

### 12.1 O que mudou de fato (medido)

| Componente | Antes | Depois | Δ |
| --- | --- | --- | --- |
| `AGENTS.md` inteiro | 12.964 | 13.041 | **+77** |
| `CURRENT-STATE.md` §0 | 5.387 | 5.387 | 0 |
| Descrições das skills | 1.154 (21) | 1.222 (22) | **+68** |
| **Custo fixo por sessão** | **19.505** | **19.650** | **+145** |
| Corpo da skill nova | — | 764 | 0 até ser ativada |

**O custo fixo subiu 145 tokens.** Isso é o preço de tornar a política
descobrível; não é economia, e não será apresentado como tal. O ganho desta
entrega é comportamental (contrato de delegação) e de prevenção (dois portões que
impedem degradação silenciosa), não de contexto.

### 12.2 A redução medida que está disponível e não foi aplicada

| Oportunidade | Tokens | Situação |
| --- | --- | --- |
| Compactar a §0 para a rodada vigente | **−4.177** | medida, **não aplicada** — conflito com WIP (§11.3) |
| `AGENTS.md` §98 (i18n, 1.644) e §99 (independência, 1.223) fora do arquivo raiz | até −2.867 | depende de regra por caminho, que **só o Claude Code lê**; para o Codex economiza **zero** |

Se a §0 for compactada, o custo fixo cai para ≈15.473 tokens — 21% abaixo do
valor de hoje. É a única redução grande e real disponível, e ela não exige tocar
`AGENTS.md`.

### 12.3 O que não é economia

Mover texto do arquivo principal para "regras sem caminho" **não economiza
nada**: os dois são carregados sempre. Só há ganho quando o conteúdo deixa de ser
carregado. O `classify.mjs` mede exatamente isso: hoje, 5.779 tokens são sempre
carregados (A+B) e 7.080 só entram por caminho (C+D) — mas esse "só entram por
caminho" é uma propriedade do **Claude Code**, não do Codex. Para o Codex, o
número que conta é o total do arquivo.

---

## 13. O que depende de ação manual do usuário

Nada abaixo é executável daqui. Está na ordem em que eu faria.

**13.1 Compactar a §0 do `CURRENT-STATE.md` — a maior redução disponível.**

Regra: a §0 mantém a rodada vigente (30/10) e a anterior (29/10) com o próximo
item; os oito blocos de 28/10 (linhas 75–303) descem para a seção histórica do
mesmo arquivo, com o título da rodada. Nada é apagado. Depois:

```sh
cd tools/agents-docs
node measure.mjs ../../docs/project/CURRENT-STATE.md --lines 1-<nova-última-linha-da-§0>
```

Faça isso **depois** de commitar o trabalho de Transport Configuration: os dois
mexem na §0 e a resolução de conflito é manual.

**13.2 Configurar modelo e raciocínio no runner.**

No Codex, modelo e esforço de raciocínio vivem na configuração do runner, não
neste repositório. A tabela de faixas está em
`docs/project/AGENT-ORCHESTRATION.md` §2. Vale conferir, na versão instalada,
`codex --help` e a configuração local antes de assumir que um parâmetro existe —
não afirmo o nome da chave porque não pude verificar nesta rodada.

**13.3 No Arena.**

Modelo, esforço e compactação são escolhidos na interface. Não há nada no
repositório que os afete.

**13.4 Alethe.**

Se quiser usá-la, rode `orchestrate.py doctor` na máquina onde os CLIs existem e
verifique `installedProviders`. Vazio significa que não há worker — nesse caso a
divisão da tarefa é feita pelo agente principal, não pelo Alethe.

**13.5 Revalidar depois de qualquer mudança em skills.**

```sh
cd tools && python3 -m unittest test_agent_skills -v
cd tools/agents-docs && node extract.mjs && node classify.mjs
```

O CI roda o primeiro comando em Windows e Linux a cada push em `arena/**`; os
outros dois não estão no CI e são locais.

---

## 14. Como esta política se conecta ao resto

- `AGENTS.md` §0 manda ler `docs/project/AGENT-ORCHESTRATION.md` quando a tarefa
  envolver delegar/dividir/escolher capacidade — e diz explicitamente que tarefa
  pequena não precisa.
- `.agents/skills/lia-agent-orchestration/SKILL.md` é o gatilho de descoberta.
  Se ele divergir da política, **a política vence** e a skill é o defeito.
- `tools/test_agent_skills.py` é o que impede a descoberta de se degradar em
  silêncio: orçamento somado e índice obrigatório.
- `tools/agents-docs/` é a régua. Sem ela, a próxima decisão sobre contexto vira
  opinião.
