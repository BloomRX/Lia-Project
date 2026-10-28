# Alethe — segurança e confiabilidade, 28/10/2026

Base local/remota inicial `32e55ca`, branch `arena/01a10290-lia-project`.
O caminho correto é `.agents/skills/alethe/`; não existe a cópia `airi/.agents/skills/alethe`
mencionada na tarefa. Nenhuma funcionalidade Lia ou baseline foi alterado.

## Editor

Fluxo inspecionado: importação/edição do playbook → normalização/buildGraph →
traceSection. Título, modelo e razões chegavam ao innerHTML. Agora a trace usa
elementos explícitos, textContent e spans/bold com classes constantes. Demais
sinks innerHTML remanescentes contêm apenas HTML/SVG fechado; atributos são
definidos via DOM. Fonte importada pb.source passa por URL validada: somente
HTTP/HTTPS, sem usuário/senha. javascript/data não criam links executáveis.

RED no Chromium real executou quatro onerror; GREEN verifica zero execução,
preservação literal de script/img/aspas/HTML malformado e protocolos rejeitados.
O teste carrega editor e YAML reais. A captura foi aprovada em revisão visual
restrita: `Tests/artifacts/captures/alethe-editor-inert.png` (fora do Git).
Foto não é a prova de XSS: a prova está nas asserções do browser.

## Orçamento e processos

- maxEstimatedPromptTokens: estimativa, não medição. Plano já verificava a soma;
  agora a admissão também reserva acumulado atomicamente sob lock, antes do start.
- maxCalls: starts de workers CLI, não chamadas API internas do agente. Lock
  impede exceder starts sob concorrência. Limite atingido recusa novos workers.
- maxReportedTokens: observado após retorno; input + cacheWrite + output.
  cacheRead permanece separado/excluído. Não é preço nem teto por geração.
- maxReportedCostUsd: soma dos valores reportados, não cobrança garantida;
  desconhecido permanece None. Valores negativos/não finitos não são somados.
  Quota desconhecida não significa sobra. Nenhum preço foi inventado.
- finish mantém resultado recuperável e expõe budgetUsage.exceededLimits em
  estado/report JSON; próximos starts são recusados quando o limite observado
  aplicável está atingido. Chamadas já em andamento podem exceder tokens.
- Concorrência/deadlines/process registry existentes foram preservados.
  Teste Windows real encerrou pai/descendente de fixture isolada; classificação
  timed_out preservou stdout parcial em teste separado. Não houve E2E de timeout
  com CLI de IA nem prova de cancelamento de geração/cobrança remota.

CLI local: codex exec --help não anuncia flag de max output tokens; configuração
genérica não prova suporte. Claude --help anuncia max-budget-usd, já suportado
pelo runner; não validamos billing real. Não adicionamos flags fictícias.

## Sete referências recuperadas

Arquivos relativos a `airi/.agents/skills/`. Cada destino oficial respondeu
GET 200 nesta tarefa. Não foram removidos/renomeados online; o pacote local
achatou o layout VueUse e omitiu a skill opcional tsdown-migrate.

| Arquivo | Referência anterior | Destino reparado | Origem |
| --- | --- | --- | --- |
| vueuse-functions/SKILL.md | ../useMediaQuery/index.md | references/useMediaQuery.md | [MQ] |
| vueuse-functions/SKILL.md | ../useBreakpoints/index.md | references/useBreakpoints.md | [BP] |
| references/useSSRWidth.md (VueUse) | ../useMediaQuery/index.md | useMediaQuery.md | [MQ] |
| references/useSSRWidth.md (VueUse) | ../useBreakpoints/index.md | useBreakpoints.md | [BP] |
| references/useMediaQuery.md (VueUse) | ../useSSRWidth/index.md | useSSRWidth.md | [SSR] |
| references/useBreakpoints.md (VueUse) | ../useSSRWidth/index.md | useSSRWidth.md | [SSR] |
| tsdown/SKILL.md | ../tsdown-migrate/SKILL.md | link oficial remoto | [MIG] |

[MQ]: https://raw.githubusercontent.com/vueuse/vueuse/main/packages/core/useMediaQuery/index.md
[BP]: https://raw.githubusercontent.com/vueuse/vueuse/main/packages/core/useBreakpoints/index.md
[SSR]: https://raw.githubusercontent.com/vueuse/vueuse/main/packages/core/useSSRWidth/index.md
[MIG]: https://github.com/rolldown/tsdown/blob/main/skills/tsdown-migrate/SKILL.md

Os três equivalentes locais VueUse existem, mas não são idênticos ao upstream
atual. Só os links foram alterados; nenhum conteúdo remoto ou skill foi instalado.

## Arquivos e validação

Código: assets/editor.html e scripts/orchestrate.py do Alethe. Instruções:
SKILL.md/UPSTREAM.md; cinco documentos upstream listados acima. Testes novos:
Tests/tools/alethe-editor.browser.mjs e Tests/tools/alethe-budget.test.py.
Relatórios: este, auditoria geral e CURRENT-STATE.

Comandos executados da raiz, todos exit 0:

```text
node --test Tests/tools/alethe-editor.browser.mjs               # 1 PASS Chromium
python3 Tests/tools/alethe-budget.test.py                      # 10 PASS
python3 -m py_compile .agents/skills/alethe/scripts/orchestrate.py
git diff --check
```

Em tools/: `python3 -m unittest test_agent_skills -v`: 5 PASS.
Os testes novos são comandos focados explícitos, não foram ligados ao CI geral;
o browser foi mantido fora do glob Node genérico para não exigir Chromium de
toda máquina. Usa Playwright existente via dependência Vitest, sem instalação.

Cobertura: limites prévios, estimativas, excedentes, cache separado, custo
desconhecido, calls concorrentes, limite externo, relógio de deadline, stdout
recuperável e encerramento Windows. Não há nova execução paga de IA.
Falhas iniciais de import/helper do harness foram corrigidas antes do RED
funcional. Codificação Windows foi conferida e alterações Unicode alheias
restauradas. Revisões de código e visual sem achados finais.

Limites restantes: não é auditoria adversarial integral, teste de todos providers,
timeout remoto, garantia financeira ou aprovação do aplicativo Lia. Tokens
reportados permanecem posteriores; o smoke anterior não foi reclassificado.
Os seis Core foram comparados por SHA-256 e ficam fora do commit.
