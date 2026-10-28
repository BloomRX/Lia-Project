# Auditoria operacional de skills — 28/10/2026

## Resumo executivo

Auditadas **49 skills: 21 na raiz e 28 no AIRI**. A leitura individual,
classificação, dependências, referências e limites estão em:

- [20 skills Lia](AGENT-SKILLS-AUDIT-LIA.md).
- [28 skills AIRI](AGENT-SKILLS-AUDIT-AIRI.md).
- [Alethe 19: segurança, comparação e execução](ALETHE-VALIDATION-2026-10-28.md).

Alethe passou um smoke operacional com **um worker Codex read-only** fora do
repositório, resultado esperado 5 e processo encerrado em 30,127 s. Isso não
aprova todos os provedores, sandbox Windows contra agente hostil, editor HTML,
preços ou quotas. Não instalamos o app Alethe/dashboard, CLIs ou modo permanente.

Preflight local/remoto: `a0e56fa8a343e524f1c41f89f32dc04fe46be8a3`, branch
`arena/01a10290-lia-project`, origin `BloomRX/Lia-Project`. Integração Alethe
já presente, sem reaplicação. Seis arquivos Core estavam modificados antes da
tarefa: preservados byte a byte, fora dos commits da auditoria.

## Problemas e correções realizadas

1. Teste estrutural inicial: cinco métodos, dez subcasos FAIL (exit 1).
   Nove descriptions não tinham o gatilho da convenção local; foram tornadas
   explícitas. Isso não era falha comprovada de descoberta. `argument-hint`
   do Alethe foi preservado sob metadata, sem campo top-level não portátil.
   Não afrouxamos o validador. Execução final: cinco métodos PASS, exit 0.
2. Proveniência AIRI corrigida na skill: base conhecida `2c1e223c…`, registro
   de 27/10, sem repetir investigação encerrada. Comparação apenas por nome
   agora é explicitamente insuficiente para conteúdo/caminhos.
3. Avaliação de modelos: saída de fixture sintética separada de dados reais;
   payloads privados e credenciais não entram em evidência.
4. Gates: automação de runtime Windows real pode provar critérios observáveis;
   mocks/unitários não substituem essa execução nem audição humana.
5. Testes: documentada a reconstrução do Core real pelo teste `j` do Launcher.
   Não concorrer com Stage aberto, consumidores de dist ou typecheck.
6. Wrappers Lia rejeitam chaves em localStorage e `close --all` em sessões
   compartilhadas. Skills AIRI permanecem intactas, subordinadas às regras Lia.
7. AGENTS.md agora exige commit/push normal na branch acordada, revisão,
   verificações pertinentes e conferência remota; sem main, force push,
   descarte, inclusão de trabalho alheio ou aprovação fictícia de release.
   A skill de mudanças seguras referencia essa autorização permanente.
8. Alethe ganhou ressalvas locais explícitas: budget de tokens reportados
   não interrompe a chamada corrente; editor não deve abrir playbook não confiável.

## Alethe: resultados e pendências

Origem comparada por arquivos contra upstream `c36c341c34360f970a07fe3e2d2600ca2bba8ed2`:
22 arquivos idênticos na integração inicial; UPSTREAM.md é registro local.
Alteração intencional atual somente em SKILL.md: metadata e ressalvas acima.
Scripts não foram atualizados cegamente. Referências, scripts e schemas foram
inspecionados antes de executar diagnósticos/dry-run/worker.

- PASS: probe/doctor, validação/dry-run, worker real, recuperação de outcome e
  resultado, relatório JSON/HTML sem abrir navegador e diagrama SVG.
- Limite observado: 11370 tokens não cache e 42112 de cache, acima do budget
  reportado 3000; uma chamada e prazo 90 s respeitados. Não é teto por chamada.
- Custo USD e previsão de quota: desconhecidos. Não equivalem a zero ou sobra.
- `readOnlyViolation=null`: fixture fora do Git sem tripwire. Nenhum arquivo
  novo observado na fixture; isso não prova ausência de toda escrita no sistema.
- Editor: fluxo estático `p.role → n.title → innerHTML` sem escape. Exploit e
  validação de browser NÃO EXECUTADOS. Não abrir editor com playbook não confiável
  até correção e teste dedicado; o smoke CLI não o aprova.
- Claude instalado/autenticação detectada, mas worker Claude NÃO EXECUTADO;
  Agy/Kimi ausentes. Não instalar para tornar um checklist artificialmente verde.

## Descoberta pelo Codex

O catálogo real desta sessão local expõe as 21 skills por caminhos em
`J:/Lia-Project/.agents/skills`, incluindo Alethe. Isso confirma descoberta no
desktop atual sem copiar a skill globalmente. `codex --version`: 0.164.0;
`codex --help` não anuncia subcomando shell `skills` ou `alethe`.

Na [documentação oficial de skills](https://learn.chatgpt.com/docs/build-skills),
o Codex procura `.agents/skills` do CWD até a raiz e também skills de usuário,
admin e sistema. Um diretório filho `airi/.agents/skills` não é ancestral de
uma sessão na raiz: suas skills exigem leitura explícita, preservando AGENTS Lia.
No CLI interativo, `/skills` e `$alethe` são seletores/invocação de instruções;
`/alethe setup/status` é convenção de linguagem da skill (e slash command no
Claude), não executável mágico do Codex. Traduzir em comandos do runner Python.
Se uma adição não aparecer, reiniciar a sessão na raiz e verificar novamente;
não editar configuração global para presumir descoberta.

## Estratégia e referências examinadas

- [Skill Alethe](https://github.com/Kc1t/alethe-orchestrate-skill): runner
  opcional de CLIs externas com ownership, orçamento e relatórios; não prova
  subagents nativos do Arena. Nesta auditoria usamos também agentes internos
  autorizados para leitura/revisão; são mecanismos distintos.
- [Cookbook](https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/CMA_plan_big_execute_small.ipynb):
  planejamento global, unidades pequenas e evidência resumida são úteis.
  Não transplantar API gerenciada, modelos/preços nem alegações de economia.
- [App Alethe](https://github.com/Kc1t/alethe-agents): workspace desktop/PTys
  separado; não é dependência da skill. Não instalado nem incorporado.
- [Dashboard](https://github.com/Kiranism/next-shadcn-dashboard-starter): template
  Next.js administrativo separado. Não é base para o Launcher Vue/Electron Lia;
  não copiar dependências, auth/billing ou estética de painel para a Home.

Lead mantém integração e validação. Pesquisadores entregam docs distintos;
writers paralelos de código devem ter ownership/worktrees isolados. Comparar
diff/testes antes de aceitar alegações; não delegar tarefa mecânica trivial.

## Pendências e limites de aprovação

Sete referências quebradas upstream e conflitos de idioma, Pinia, uploads e
armazenamento estão discriminados na tabela AIRI. Não removemos skills nem
consolidamos conteúdo à força. Futura remoção exige preservar recursos, reparar
referências e validar consumidores. Bundles genéricos extensos ficam sob demanda.

Não foram executados gates do aplicativo, instalador, microfone, Godot,
captura visual ou upload. Não há mudança de produto nem promoção do baseline
funcional `3ef6d11`. A auditoria não declara a release Lia pronta.

## Comandos de encerramento

`python3 -m unittest test_agent_skills -v` em tools/: RED inicial, GREEN final.
`git diff --check`: PASS após corrigir EOL somente das linhas acrescentadas ao
AGENTS.md. SHA-256 dos seis Core: conferido antes do staging. Comandos Alethe,
falhas de invocação e artefatos fora do repo no relatório dedicado.

Push somente dos arquivos desta auditoria, na branch acordada. A igualdade dos
HEADs é conferida após publicar e informada no encerramento; não registrar um
hash autorreferente neste documento. Alterações Core pendentes permanecem locais.
