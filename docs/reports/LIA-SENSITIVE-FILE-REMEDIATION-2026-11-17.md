# Lia — Remediação de arquivo sensível exposto no GitHub

**Data:** 17/11/2026 (UTC) · **Branch:** `arena/7fa837f0-lia-project` · **Base:** `005a3247`
**Natureza:** correção de exposição documental. **Nenhum segredo real encontrado. Nenhuma rotação necessária.**
**Regra aplicada:** não reproduzir valores sensíveis neste relatório; não reescrever histórico; não fazer force push.

---

## 0. Veredicto

| Pergunta | Resposta |
|---|---|
| O arquivo existia no repositório público? | **Sim** — `BloomRX/Lia-Project` é **público** (`private:false`) e o arquivo era acessível pela API na branch Principal. |
| Continha credenciais? | **Não.** Nenhum token, chave, senha ou cookie. |
| Continha dados pessoais/operacionais? | **Sim** — caminho pessoal do Windows, IDs de rollout/sessão, contagens e tempos internos de agentes. |
| O que foi feito? | **Removido do estado atual** (`git rm`), regra `*.local.md` no `.gitignore`, PII sanitizada em 2 documentos, referências atualizadas. |
| A exposição histórica terminou? | **Não.** O conteúdo permanece no histórico Git e em **7 outras branches**. Isso exige decisão do proprietário (ver §5). |
| Rotação de credenciais? | **Não aplicável** — ver §2. |

---

## 1. Escopo e localização exata

| Item | Valor |
|---|---|
| Caminho | `docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.local.md` |
| Commit de introdução | `c3d21865` (31/10/2026, `fix(lia): inclui arquivos pendentes…`) |
| Último toque | `7913c62a` (14/11, `docs(agents): add curated research-only documentation snapshot`) |
| Tamanho | 211 linhas / 27.812 bytes |
| Presente no `main`? | **Não** |
| Presente na branch Principal? | **Sim** (antes desta rodada) |

**Branches que contêm o arquivo** (verificado por `git cat-file` em cada ref):

`arena/7fa837f0-lia-project` · `arena/c6b02f64-lia-project` · `arena/18f50ae7-lia-project` · `arena/250b337a-lia-project` · `arena/4ec8f22b-lia-project` · `codex/lia-multi-provider-voice` · `codex/lia-ui-ux-fase-1` — **7 branches públicas**.

> Nenhuma branch além da Principal foi alterada nesta rodada.

---

## 2. Classificação do conteúdo (sem reproduzir valores)

| Classe | Ocorrências | Sensibilidade | Observação |
|---|---:|---|---|
| Caminho pessoal Windows com nome de usuário | 4 | **PII — média** | `C:/Users/<usuario>/.codex/sessions/...` |
| IDs de rollout/sessão (UUID) | 16 | **Interno — média** | Identificadores de execuções de agente |
| IDs de subagente (`/root/...`) | ≥ 11 | **Interno — baixa** | Nomes de tarefa + UUID |
| Tempos/contagens internas de execução | 6+ | **Interno — baixa** | Duração por rollout, proporção de cache |
| Commits SHA internos | vários | Já públicos | O Git do repo expõe os mesmos SHAs |
| **Credenciais / chaves / senhas** | **0** | — | Padrões `gsk_`, `sk-`, `ghp_`, `AKIA`: nenhum |
| E-mails | 0 | — | — |
| URLs privadas | 0 | 1 URL pública (docs OpenAI) | — |

**Varredura de segredos no HEAD inteiro:** os únicos matches de padrão de chave estão em **fixtures sintéticas de teste** (`Tests/tools/qa-security-bridge.test.mjs`, `hearing.test.ts`, `tools/test_lia_dev.py` — `FakeGit`, canários, `redact(...)`) e em documentação que cita o prefixo como exemplo. **Nenhum segredo real.** Portanto: **rotação não se aplica**.

---

## 3. Ações executadas

| # | Ação | Evidência |
|---|---|---|
| 1 | `git rm docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.local.md` | `git status` → `D` no índice; `git ls-files` não lista mais |
| 2 | Regra `*.local.md` no `.gitignore` | impede reintrodução acidental |
| 3 | Sanitização de `C:/Users/<usuario>` em `docs/product/LIA-BETA-READINESS-2026-11-08.md` (1×) e `docs/product/RELEASE-WINDOWS-2026-11-07-COMPLETION.md` (1×) | `git grep 'C:/Users/lucas'` → **0** |
| 4 | Manifesto de release atualizado: hash mantido como identificador histórico + nota de remoção | `docs/product/RELEASE-WINDOWS-2026-11-07-COMPLETION.md` §"Relatórios locais" |
| 5 | Este relatório | `docs/reports/LIA-SENSITIVE-FILE-REMEDIATION-2026-11-17.md` |

**Conteúdo necessário preservado:** a auditoria canônica e sanitizada continua versionada em
`docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.md` (424 linhas, **0** UUIDs, **0** tempos internos,
**0** caminhos pessoais) e é a referência citada por `docs/project/AGENT-ORCHESTRATION.md` §9.
Nada de valor normativo foi perdido com a remoção da variante local.

---

## 4. Verificação

```bash
# 1. não está mais no estado atual
git ls-files | grep -E '\.local\.md$' || echo "nenhum .local.md rastreado"
# 2. nenhuma PII de usuário nos docs
git grep -n 'C:/Users/lucas' HEAD -- docs || echo "nenhuma ocorrência"
# 3. regra ativa
git check-ignore -v docs/architecture/qualquer.local.md
# 4. conteúdo canônico intacto
git cat-file -e HEAD:docs/architecture/LIA-AGENT-CONSUMPTION-AUDIT.md && echo "canônico presente"
```

**Resultado esperado:** (1) nenhum; (2) nenhuma; (3) regra `*.local.md`; (4) presente.

---

## 5. Risco residual — o que a remoção NÃO resolve

| Risco | Estado | Mitigação necessária |
|---|---|---|
| **Histórico Git** | O arquivo continua recuperável em `c3d21865` e posteriores. Em repo público, `git rm` **não apaga**. | Purga de histórico (`git filter-repo`/BFG) + force push — **exige autorização explícita do proprietário**; não executado. |
| **7 branches públicas** | O arquivo segue em cada uma delas. | Remoção por branch, respeitando a propriedade de cada sessão; não executado. |
| **Cópias externas** | Não detectadas: 0 issues/PRs mencionam o arquivo; 0 duplicações no repo; Drive sem artefatos relevantes (rodada 19). | Se houver clone/fork público, a exposição persiste fora do controle do repo. |
| **PII já vista** | Nome de usuário e IDs de sessão. | Baixo impacto (sem credencial); monitorar uso indevido. |

**Recomendação objetiva:** tratar o conteúdo como **já público** e **não sensível a credencial**. A purga de histórico é **opcional** e só deve ocorrer com autorização escrita do proprietário, por implicar reescrita e invalidação de clones — o que colide com as regras desta rodada.

---

## 6. Conclusão

- **PASS** para a remoção do estado atual, sanitização da PII e bloqueio de reintrodução por `.gitignore`.
- **BLOCKED** para a eliminação da exposição histórica: depende de autorização do proprietário para reescrever histórico e tocar outras branches.
- **N/A** para rotação de credenciais: nenhum segredo foi encontrado.
- **Nenhum resultado desta rodada foi promovido a PASS de segurança do produto** — esta correção não altera os gates SEC-04/SEC-05/OIDC.
