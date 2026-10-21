# Skills do agente — Lia

Estado: inventário levantado e skills validadas estruturalmente em 21/10/2026.
Escopo: **infraestrutura do agente**. Nenhuma funcionalidade da Lia foi alterada.

> **O que este documento não afirma.** Não houve execução no Codex: não existe
> binário do Codex neste ambiente. O que está provado é estrutura, frontmatter,
> descoberta simulada pela regra oficial e conteúdo factual. O comportamento
> real de ativação por `description` **não foi observado**. Ver §7.

---

## 1. Skills próprias da Lia (versionadas em `.agents/skills/`)

| Skill | Linhas | Categoria | Pergunta que responde |
| --- | --- | --- | --- |
| `lia-release-gate` | 97 | releases | "podemos publicar?" |
| `lia-test-discipline` | 87 | testes | "qual suíte, de onde, com qual comando?" |
| `lia-regression-investigation` | 105 | bugs | "por que isso quebra?" |
| `lia-agent-evaluation` | 106 | agentes/modelos | "o modelo está errado ou o caminho está errado?" |
| `stage-runtime-debugging` | 108 | Electron/Stage | "por que o Stage não sobe?" |
| `airi-upstream-integration` | 100 | integração | "esse patch do AIRI deve entrar?" |

Todas só com `SKILL.md` — sem `scripts/`, `references/` ou `assets/`. Não criei
arquivo vazio nem helper sem uso real.

### Escopo entre elas, para não duplicar

- `lia-release-gate` **não** lista comandos: eles vivem em `lia-test-discipline`.
- `lia-release-gate` §4 **não** repete o método de investigação: aponta para
  `lia-regression-investigation`.
- `lia-agent-evaluation` **não** decide aprovação: entrega a rodada ao gate.
- O método genérico de depuração pertence ao Superpowers
  (`systematic-debugging`); a camada Lia é a refutação e o modelo reduzido.

### Skills avaliadas e **não** criadas

| Candidata | Decisão | Justificativa |
| --- | --- | --- |
| `lia-design-implementation` | **rejeitada** | `docs/design/LIA-UI-DESIGN-SYSTEM.md` tem **1247 linhas** e é a autoridade. Uma skill seria cópia que diverge na primeira edição do documento. O agente deve ler o documento, não um resumo. |
| `lia-security-audit` | **rejeitada** | Coberta por `security-best-practices` (OpenAI, Apache-2.0) sem manutenção nossa. |
| skill de i18n | **rejeitada** | Não existe no AIRI vendado nem fonte verificável; inventar seria pior que não ter. |

---

## 2. Inventário com prioridade

Notação: **P0** segurança/confiabilidade do trabalho · **P1** impacto imediato ·
**P2** área específica · **P3** opcional.

### 2.1 Externas — adotáveis

| Skill | Origem / URL | Licença | Manutenção | Codex | Prior. | Decisão |
| --- | --- | --- | --- | --- | --- | --- |
| `verification-before-completion` | `obra/superpowers` · `skills/verification-before-completion/SKILL.md` | **MIT** | push 21/10/2026, 303k★ | via plugin oficial | **P0** | **instalar** (pessoal, plugin) |
| `systematic-debugging` | `obra/superpowers` · idem | MIT | idem | via plugin | **P1** | **instalar** |
| `test-driven-development` | `obra/superpowers` · idem | MIT | idem | via plugin | **P1** | **instalar** |
| `security-best-practices` | `openai/skills` · `skills/.curated/security-best-practices/SKILL.md` | Apache-2.0 (`LICENSE.txt` no diretório) | catálogo **deprecado**, push 08/09/2026 | `$skill-installer` | **P1** | **instalar** |
| `gh-fix-ci` | `openai/skills` · `skills/.curated/gh-fix-ci/SKILL.md` | Apache-2.0 | idem | `$skill-installer` | **P2** | instalar |
| `requesting-code-review` | `obra/superpowers` | MIT | 21/10/2026 | via plugin | P2 | instalar — **exige subagente** |
| `receiving-code-review` | `obra/superpowers` | MIT | idem | via plugin | P2 | instalar |
| `writing-plans` / `executing-plans` | `obra/superpowers` | MIT | idem | via plugin | P2 | consultar — sobrepõe `PLANO-FINALIZACAO-LIA.md` |
| `frontend-design-review` | `microsoft/skills` · `.github/skills/frontend-design-review/SKILL.md` | **MIT** | push 21/10/2026 | qualquer | P2 | **consultar**, não vendorizar |
| `skill-creator` | `openai/skills` `.system` (368 linhas + `scripts/quick_validate.py`) e `anthropics/skills` | Apache-2.0 | — | embutida no Codex | P2 | **consultar** |
| `writing-skills` | `obra/superpowers` (681 linhas) | MIT | 21/10/2026 | via plugin | P2 | **consultar** |

**Como instalar os do Superpowers no Codex:** marketplace oficial de plugins
(`openai/plugins`) — no app, *Plugins* na barra lateral; na CLI, `/plugins` →
buscar `superpowers` → *Install Plugin*. Não é cópia de pasta: o plugin traz as
**15** skills juntas, não dá para escolher uma.

**Limitação real dessa via:** não existe instalação individual. Quem quiser só
`verification-before-completion` precisa copiar o `SKILL.md` (MIT permite) e
levar o `LICENSE` — o que cria manutenção e risco de divergência. Recomendo o
plugin inteiro e a leitura seletiva.

### 2.2 Do AIRI vendado — **reaproveitar, não recriar**

`airi/.agents/skills/` tem **28** skills. As relevantes para a Lia:

| Skill | Linhas | Prior. | Decisão | Por quê |
| --- | --- | --- | --- | --- |
| `enforce-rules-for-vitest` | 51 | **P1** | **reusar** | regras de vitest do AIRI, mock de IPC sem Electron real; vale para `lia-app` e `lia-core` |
| `xsai` | 74 | **P1** | **reusar** | Lia usa `@xsai/*` em `core-agent` (agentes spark-notify e contratos) |
| `eventa` | 263 | **P2** | **reusar** | `@moeru/eventa` é a biblioteca de eventos/IPC entre processos |
| `vue-best-practices` | 154 | P2 | reusar | UI da Lia é Vue 3 |
| `vue-testing-best-practices` | 29 | P2 | reusar | testes de componente |
| `pinia` | 59 | P2 | reusar | estado |
| `unocss` + `enforce-rules-for-unocss` | 64 + 43 | P2 | reusar | estilos |
| `pnpm` | 45 | P2 | reusar | workspace, catálogos, overrides |
| `use-vishot-with-electron` + `use-vishot` | 102 + 42 | P2 | reusar | `@vishot/cli` **está** em `airi/package.json` |
| `web-design-guidelines` | 39 | P3 | reusar com cautela | exige buscar a guideline na rede a cada uso |
| `agent-browser` + `agent-browser-electron` | 51 + 225 | P3 | só se instalado | `agent-browser` **não** está declarado em `airi/package.json` |

**Não achadas** (a missão as pressupunha no AIRI vendado):
`enforce-rules-for-typescript`, `enforce-rules-for-pinia`, `analyze-io-traces`,
`i18n`, `documentation`, `typescript`. Não existem nesta cópia — não inventei
equivalentes. `pinia` e `vue` cobrem parte da intenção.

**Trap técnico:** `eventa` e `stage-tamagotchi-godot-csharp` usam `description: >-`
(bloco YAML) e `simple-english` usa `description: |`. São válidos em YAML, mas um
parser ingênuo lê o literal `>-`. Meu `tools/test_agent_skills.py` só valida
`.agents/skills/` da raiz justamente por isso; **não** aponte-o para `airi/`
sem antes tratar bloco escalar.

### 2.3 Rejeitadas

| Skill | Motivo |
| --- | --- |
| `subagent-driven-development`, `dispatching-parallel-agents` | dependem de subagentes; o ambiente da Lia não os garante. Tornar obrigatório quebraria o fluxo. |
| `using-git-worktrees` | o projeto trabalha em **uma** branch (`arena/01a10290-lia-project`); worktrees criam branches paralelas, proibidas aqui. |
| `finishing-a-development-branch` | inclui fluxo de merge/PR — proibido sem autorização explícita. |
| `create-pr`, `release-note-writer` | publicam/abrem PR; mesma restrição. |
| `define-goal` | o projeto já tem `PLANO-FINALIZACAO-LIA.md` e `CURRENT-STATE`; duplicaria planejamento. |
| `webapp-testing` (Anthropic, Playwright) | testa web app em HTTP; o Stage é Electron empacotado; traria dependência nova. |
| `brainstorming`, `using-superpowers`, `diagnosing-superpowers` | meta-skills do framework; custo de contexto sem ganho para a Lia. |
| 212 skills de `microsoft/skills` | quase todas Azure SDK; nenhuma cobre a stack da Lia além de `frontend-design-review`. |
| `upload-github-attachment`, `simple-english`, `stage-tamagotchi-godot-csharp`, `tsdown` | fora do escopo da Lia. |

---

## 3. Por que não copiei nada para dentro do repositório

1. **Licença por skill.** `openai/skills` e `anthropics/skills` **não têm
   `LICENSE` na raiz** (a API devolve `null`). A licença está em `LICENSE.txt`
   *dentro de cada diretório* — Apache-2.0 nas que inspecionei. Copiar sem
   levar o arquivo seria violação.
2. **Manutenção.** Cópia local diverge da origem e ninguém percebe.
3. **Contexto.** Com CWD em `airi/` já entram **32** skills. O Codex lista
   nome+descrição de todas e, se passar do orçamento (~2% da janela), **encurta
   descrições e pode omitir skills**. Somar catálogos externos degrada a
   ativação das que importam.

O que fiz foi escrever as 6 da Lia com o conteúdo **deste** repositório, e
apontar para as externas.

---

## 4. Descoberta: a regra real e o buraco medido

Fonte: `developers.openai.com/codex/skills` (redireciona para
`learn.chatgpt.com/docs/build-skills`), consultada em 21/10/2026.

- O Codex varre `.agents/skills` **de cada diretório do CWD até a raiz do
  repositório**. A busca sobe; **não desce**.
- Escopos: `REPO` (`$CWD`, `$CWD/../`, `$REPO_ROOT`), `USER`
  (`$HOME/.agents/skills`), `ADMIN` (`/etc/codex/skills`), `SYSTEM`.
- Symlinks de pasta são seguidos.
- Desativar sem apagar: `[[skills.config]]` em `~/.codex/config.toml`.

**Consequência medida neste checkout:**

| CWD | Skills visíveis |
| --- | --- |
| raiz do repositório | **6** (as desta entrega) |
| `airi/` | **34** (28 do AIRI + as 6 da raiz) |
| `airi/.agents/skills`, fora da busca | **0** |

`QUANTO-FALTA.md` instrui abrir a sessão **na raiz, nunca dentro de `airi/`**.
Fazendo isso, as 28 skills do AIRI — inclusive `enforce-rules-for-vitest` e
`xsai` — **ficam invisíveis**. Foi por isso que `lia-test-discipline` cita esses
arquivos **pelo caminho relativo**: a regra de teste do AIRI continua acessível
sem depender da descoberta.

Não criei junction/symlink na raiz: o Git veria a pasta como comum e commitária
as skills duplicadas — é exatamente o que `airi/.gitignore:25` já registra como
armadilha. E junction é estado de máquina, não versionado.

**Claude Code não lê `.agents/skills`.** Precisaria de junction para
`.claude/skills/`. Não criada, por ser estado local.

---

## 5. Validações executadas

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Validador oficial | `npx --yes skills-ref@0.1.5 validate .agents/skills/<nome>/` | **6/6 `Valid skill`** |
| Validador é capaz de reprovar | mesma ferramenta em 3 skills inválidas | **3/3 rejeitadas** (name ≠ dir, `description` ausente, maiúscula + `--`) |
| Contrato local | `cd tools; python -m unittest test_agent_skills -v` | 5 testes, OK |
| Mutação: `name` inválido | alterado para `LiaReleaseGate` | teste **falha**; restaurado, `md5sum -c` OK |
| Mutação: doc inexistente | referência trocada por `NAO-EXISTE.md` | teste **falha**; restaurado, `md5sum -c` OK |
| Suíte Python completa | `cd tools; python -m unittest discover -s . -p "test_*.py" -t .` | **495 testes, OK (skipped=12), exit 0** |
| Harness Node | `node --test "Tests/tools/*.test.mjs"` | **267 pass, exit 0** |
| Runner de CI com o arquivo novo | `python tools/ci_run_suite.py tools/test_agent_skills.py` | 5 testes, OK, exit 0 |

### Fatos que as skills afirmam, provados por execução

| Afirmação na skill | Prova |
| --- | --- |
| `python -m unittest discover` da raiz **não** falha: `Ran 0 tests` / `OK` / **exit 0** | executado — é um **falso verde**, e a skill passou a dizer isso |
| `node --test Tests/tools` (diretório) quebra | `Cannot find module '/.../Tests/tools'`, exit 1 |
| Projeto vitest é `@proj-airi/core-agent` | `vitest.config.ts:5` |
| `@vishot/cli` existe | `airi/package.json:68` |
| Lia usa `@xsai/*` | 4 arquivos em `core-agent/src` |
| CI não roda `discover` | `.github/workflows/devflow-ci.yml` enumera arquivos |

**Correção que a validação produziu:** a primeira versão de `lia-test-discipline`
afirmava que a suíte da raiz responde `NO TESTS RAN`. É falso — ela responde
`Ran 0 tests` + `OK` + exit 0. Skill corrigida. Este é o motivo de validar
conteúdo, não só sintaxe.

### Mudança de CI

`tools/test_agent_skills.py` não rodaria nunca: o `devflow-ci.yml` **enumera
arquivos** em vez de usar `discover`. Adicionei um quarto passo. Sem isso o
teste existiria só localmente e apodreceria.

---

## 6. Casos de avaliação (definidos, **NOT RUN**)

O padrão Agent Skills recomenda comparar **com e sem** a skill
(`agentskills.io/skill-creation/evaluating-skills`). Não executei: exige o Codex
e contexto limpo por rodada. Ficam prontos para o Dev:

| # | Situação | Prompt | O que muda com a skill |
| --- | --- | --- | --- |
| 1 | Declaração prematura | "os testes passaram, pode fechar a release?" | exige comando + saída da **mesma** mensagem |
| 2 | Falha intermitente | "o teste de limpeza falha às vezes" | 5 rodadas, sem aumentar timeout, sem mascarar |
| 3 | Causa desconhecida | "a resposta veio vazia" | separa provedor/caminho; não aceita HTTP 200 |
| 4 | Comando errado | "rode os testes" | `cd tools` — evita `Ran 0 tests` verde |
| 5 | Integração AIRI | "atualize o AIRI" | exige base identificado antes de tocar |

**Como ler o resultado:** a skill ajudou só se a resposta contiver a evidência
que faltaria sem ela. Aumento de tokens conta como custo. Se o caso 1 passar
igualmente sem a skill, `verification-before-completion` não está sendo ativada
— o problema é a `description`, não o conteúdo.

---

## 7. Limitações

1. **Sem execução no Codex.** Descoberta **simulada** pela regra oficial.
   Ativação por `description` não observada. É a maior incerteza deste documento.
2. **`skills-ref` exige rede** (`npx`). O teste local é subconjunto, não substituto.
3. **Base do AIRI desconhecida** — `docs/airi-modificacoes-registro.md` §1.
   `airi-upstream-integration` trata como pré-condição.
4. **Nenhuma skill externa foi instalada.** Sem autorização, nada foi escrito em
   `$HOME/.agents/skills`.
5. **Suítes Node/vitest não rodam no CI** — só Python. `airi/node_modules`
   ausente aqui: `lia-app`, `core-agent` e lint **não foram executados** nesta
   rodada.
6. **`agent-browser` não está declarado** em `airi/package.json`; suas skills são
   inúteis até ser instalado.

---

## 8. Como validar e manter

```powershell
cd tools; python -m unittest test_agent_skills -v
npx --yes skills-ref@0.1.5 validate .agents/skills/<nome>/
```

Para adicionar skill: `.agents/skills/<nome>/SKILL.md`, `name` igual ao
diretório, `description` começando pelo gatilho; acrescentar a `REQUIRED` em
`tools/test_agent_skills.py`; rodar as duas validações; registrar aqui.

**Armadilha de manutenção:** `description` acima do orçamento faz o Codex
encurtar e omitir skills. Mantenha o gatilho nas primeiras palavras.
