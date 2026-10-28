# Validação local da Alethe — 28/10/2026

## Resultado executivo

**PASS operacional limitado:** runner v19 descobriu CLIs, validou plano, produziu
dry-run, lançou um Codex externo em leitura, recuperou a resposta correta e
gerou relatório JSON/HTML e diagrama. Isso não valida todos os providers,
isolamento de writers, retomada, stop ou execução de trabalho de produto.
Nenhum app Alethe, dashboard, CLI adicional ou configuração permanente foi instalado.

O runner de CLIs é distinto dos subagentes nativos disponibilizados nesta sessão.
Sua presença não demonstra que o Arena ofereça subagentes nativos.

## Proveniência

Integração já presente no HEAD inicial `a0e56fa8a343e524f1c41f89f32dc04fe46be8a3`;
não foi reaplicada. Comparação por bytes dos blobs desse commit com
[upstream](https://github.com/Kc1t/alethe-orchestrate-skill/tree/c36c341c34360f970a07fe3e2d2600ca2bba8ed2/skills/alethe),
main observado `c36c341c34360f970a07fe3e2d2600ca2bba8ed2`:

- 22 arquivos idênticos, incluindo scripts, schema, referências, assets e playbooks;
- `LICENSE` corresponde ao arquivo da raiz upstream;
- `UPSTREAM.md` é o registro local adicional;
- após essa comparação do baseline, a auditoria principal moveu `argument-hint`
  para `metadata` no SKILL local. Esse é um delta deliberado, não igualdade atual
  com upstream nem atualização de versão.

A primeira tentativa de comparação usou incorretamente `skills/alethe/LICENSE`
e recebeu 404. Foi corrigida para a localização real da licença, sem alterar arquivos.
Manifesto com SHA-256 por arquivo foi preservado no diretório temporário da auditoria.

## Conteúdo e confiança

Lidos SKILL integral e as oito referências: briefs, diagram, manual, onboarding,
operations, playbooks, providers e routing. Foram conferidos os recursos citados:
29 links Markdown locais resolvem; nenhum ausente. Schema e preços são JSON
válido. Os dois scripts Python passam por análise sintática AST sem execução
de módulos externos. Playbooks foram validados pelo próprio doctor.

Revisão estática dos caminhos de execução do runner:

| Fronteira | Evidência e limite |
| --- | --- |
| Subprocessos | `start_process` usa arrays, `shell=False`, cwd explícito e ambiente de worker; não compõe shell com tarefa |
| Windows | Shims npm reconhecidos são resolvidos para Node/executável real; shim desconhecido rejeita argumentos com aspas, quebras e metacaracteres |
| Permissões | Codex recebe sandbox read-only/workspace-write; Claude usa plan/acceptEdits; flags unsafe conhecidas exigem allowUnsafe explícito no custom |
| Delegação | Features de agentes Codex desabilitadas quando existem; Claude nega Agent/Workflow; flag de ambiente bloqueia nova orquestração Alethe no worker |
| MCP | Configuração de worker pede MCP desligado; não foi testado um servidor externo para demonstrar ausência de toda configuração possível |
| Isolamento | Writers isolados usam detached worktree de HEAD; seed seletivo rejeita symlinks e caminhos externos; altera `.git/info/exclude` quando necessário. NÃO EXECUTADO nesta auditoria |
| Arquivos | Resultados, prompts e logs ficam no run-dir; políticas/usage/current têm caminhos próprios. Todos os artefatos desta execução foram direcionados ao TEMP |
| Tempo/processos | Deadline e idle monitorados; Windows usa Job Object com kill-on-close quando disponível, fallback taskkill por PID/árvore; NÃO foi testada interrupção forçada |
| Read-only tripwire | Compara checkout Git antes/depois; é detecção posterior, não sandbox. Fora de Git, readOnlyViolation fica null |
| Templates | Relatório escapa fechamento de script; diagrama escapa texto/XML e incorpora marcas locais. Editor tem ponto de atenção descrito abaixo |

Não se executaram caminhos de instalação, alteração de credenciais, criação de
worktree, publicação, exclusão ou bypass de permissões.

## Ambiente e diagnósticos executados

Windows, raiz `J:/Lia-Project`. `python3`/`py`: 3.14.7; `python`: 3.14.3.

| Verificação | Resultado |
| --- | --- |
| `python3 .../orchestrate.py --version` | PASS, v19, exit 0 |
| `probe` | PASS, Codex CLI 0.164.0 e Claude Code 2.1.302; agy/kimi ausentes |
| `doctor` | PASS, Python compatível, ambos CLIs informam loggedIn true; política global inexistente/não configurada; playbooks válidos |
| Quota | Leituras ausentes, não equivalem a quota disponível; não foi feito refresh com chamada Claude |
| `scaffold economy --workers 1` | PASS, estrutura de plano v1 |
| `validate` e `dry-run` | PASS, versão, limites e avisos recuperáveis |
| AST dos dois scripts / JSON schema e preços / links locais | PASS estático |
| `report --format json --write ...` | PASS, exit 0 |
| `report --format html --no-open --write ...` | PASS, exit 0, sem abrir navegador |
| `diagram.py preview.json preview.svg` | PASS geração, exit 0; aparência não revisada |

`--policy` pertence aos subcomandos que o aceitam, não ao parser global. Uma
invocação inicial antes de `doctor` falhou no parser; a forma `doctor --policy
<arquivo>` passou. Não foi defeito do diagnóstico.

## Smoke real de uma chamada

Plano temporário v1, strategy economy, uma chamada Codex, maxConcurrent 1,
timeout/maxWallSeconds 90, maxEstimatedPromptTokens 2000,
maxReportedTokens 3000. Diretório sintético fora do repositório com
`alpha.txt = 2` e `beta.txt = 3`. Leitura desses dois arquivos era a única tarefa.
Modelo default da CLI existente mantido: dry-run advertiu que o preço poderia
ser maior; não foi inventado modelo, preço ou custo. Forecast de quota desconhecido.

Comandos: `new`, `run plan.json --in current --detach`, `wait --timeout 30`,
depois `report`. Política/home temporários foram fornecidos apenas ao processo
por `ALETHE_ORCHESTRATE_POLICY`/`ALETHE_ORCHESTRATE_HOME`; não houve `mode on`,
`always`, onboarding ou edição global.

Resultado observado:

- status succeeded/done, workerStatus DONE; resultado **soma 5**;
- 30,127 s de parede, uma chamada; result.md, state.json e outcome.json recuperáveis;
- PIDs registrados do runner e do worker já ausentes após conclusão; failureKind null;
- somente alpha.txt/beta.txt permanecem na fixture; não se criou arquivo de produto;
- leitura relativa falhou no worker e foi recuperada por caminho absoluto;
  portanto a semântica de cwd das ferramentas do Codex não foi aprovada em geral;
- readOnlyViolation null, pois a fixture não é Git. Isso não comprova ausência
  de toda escrita possível fora da fixture nem teste adversarial do sandbox;
- 11.370 tokens não cache e 42.112 de cache relatados pela CLI; custo USD não
  informado, não estimado como cobrança;
- **limite de tokens não é hard cap por chamada:** 11.370 excederam os 3.000 do
  plano e o worker ainda terminou com sucesso. O runner só consegue impedir
  chamadas posteriores a partir dos consumos recebidos. maxCalls/tempo foram respeitados.

Artefatos locais (não incluir logs brutos no Git):
`%TEMP%/lia-alethe-audit-f2aeffe7a33f4aa085f69a9ef146b538/`.
Run: `orchestrations/20261028-085946-smoke-local-de-auditoria/01-wave`.

## Pendências e limites

- **Médio, inspeção estática:** `assets/editor.html:2051` interpola título,
  modelo e razões em innerHTML. Um playbook importado não confiável pode injetar
  HTML; exploit não executado. Não abrir editor com conteúdo não confiável até
  revisão/escape desses campos. Isso não afeta o smoke CLI nem o report HTML testado.
- Guardas de unsafe, parsing de argumentos, seed/worktrees, resume, timeout e stop
  foram inspecionados, mas não submetidos a uma suíte adversarial completa.
- O smoke não prova que Claude, Agy, Kimi, custom adapters ou proxies funcionam.
- Uma CLI descoberta/autenticada não demonstra disponibilidade de todo modelo,
  quota ou ausência de servidores MCP em todas as configurações.
- `/alethe setup/status` são intenções traduzidas pela skill/integração; não
  novos subcomandos `codex` comprovados por esta validação.

Classificação: **manter, dependente de ambiente**, com correção local de
frontmatter pela auditoria principal e limites de orçamento/HTML documentados.
