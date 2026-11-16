# Reconciliação de autenticação e auditoria L-02

## Decisão executiva

**NÃO aprovado para beta.** OIDC-OFF não está implementado nem demonstrado, SEC-04/05 continuam abertos e a integração de L-02 fica **bloqueada** até os gates de segurança. Esta revisão prepara reconciliação parcial, não habilita OIDC e não declara ausência de credenciais no Renderer.

Referências examinadas em 14/11/2026 (SHAs obtidos diretamente das refs; datas de commits são metadados, não prova da hora real de publicação):

| Árvore | SHA | Blob `stage-ui/src/stores/auth.ts` |
|---|---|---|
| Architecture/Security, remoto próprio | `0093de090d86c291b7a85eaeacebe0a559585359` | `cea617fccbce6c1048a34039309f2e03d36d650d` |
| Principal `arena/7fa837f0-lia-project` | `28551805e8b0da016e947ff30de28e75a936deab` | `8b3f87c16d922c51171ee690aaef617ea40b0d1e` |
| Higiene `arena/4ec8f22b-lia-project` | `be24b94f7b0127e1eb6d69adcb05a2e554555989` | `5197a0dd7a2c09803d872f2962f3288a858a577c` |
| `main` | `9c7ac183fd54b8eae0425038190a2c56ec237ff8` | `8b3f87c16d922c51171ee690aaef617ea40b0d1e` |
| UI/UX L-02 | `dd8dc0ca6d3e54d973b69749d2ee4f0e8bfc6eaa` | revisão específica dos arquivos abaixo |

Principal e `main` têm **o mesmo blob**, portanto são três variantes distintas, não quatro. A análise usou `git show`, `git diff` e `git grep`; não houve mudança de branch, rebase, merge commit ou alteração das outras refs. Para reconciliar o checkout foi executado somente fast-forward, conforme autorização explícita do usuário.

## `auth.ts`: parecer e proposta

- A variante Principal/`main` usa single-flight, porém não invalida respostas de refresh/sessão no logout; aguarda a rede antes de limpar e o watcher dispara `updateCredits()` sem tratar rejeição. Armazena tokens no Renderer.
- Higiene adiciona `try/catch` no crédito, porém `errorMessageFrom(error)` **não é sanitizador**: uma mensagem de fetch/servidor pode conter URL, texto ou segredo. Também não diferencia 401/403 de erro de rede, deixa saldo antigo sem indicar falha e não corrige refresh concorrente. **Não integrar o patch tal como está.**
- Architecture/Security adiciona geração local, invalidação e limpeza antes da rede; mantém single-flight, rejeita refresh obsoleto e usa mensagens fixas. Remove o import de `errorMessageFrom`. Isso mitiga SEC-02 no store, mas não é isolamento Main-only nem OIDC-OFF. Aplicar as alterações mecanicamente poderia deixar referência a um import removido ou reintroduzir logs sensíveis.

**Reconciliação parcial, commit `b67929c5c69a360653b09b0e2015a84ed722de02`:** `airi/packages/stage-ui/src/stores/auth.ts` e `auth.test.ts`, por cima de `0093de0`. Preserva geração e single-flight; substitui identidade anterior antes de validar sessão substituta; falha de sessão corrente limpa estado e emite rótulo fixo; resposta obsoleta não apaga login novo. `updateCredits()` captura falhas sem imprimir erro, classifica `auth-error` (401/403) versus `error` em `creditsStatus`, valida valor numérico, descarta respostas anteriores ou posteriores ao logout, preserva saldo anterior em erro mas não o apresenta como atualizado; limpar estado zera saldo/status imediatamente. O getter/status novo precisa ser adotado pelos consumidores: quem usa apenas `credits` ainda pode interpretar saldo antigo/zero incorretamente. 401 é normalmente tratado antes por `authedFetch`, que pode invalidar o store; nesses casos o estado de créditos pode voltar a `idle` em vez de `auth-error`. Não transformar 403 ou indisponibilidade em logout sem política de produto. Loga somente classes fixas, não erro, URL, status text ou corpo; `errorMessageFrom` não deve ser reintroduzido nesses pontos sem uma política de redaction comprovada.

**Condições e riscos:** as mudanças são uma proposta parcial de store compartilhado, não validação do produto. O `fetchSession` em falha de rede agora limpa estado corrente: impacto intencional de fail-closed, exige validação de UX. Refresh e sessão ainda ocorrem no Renderer. Geração é por instância e não prova coordenação de janelas; `authedFetch` (`libs/auth-fetch.ts:39–59,70–72`) pode receber 401 de uma requisição anterior e chamar `clearAllAuthState()` ou refresh depois de login substituto: falta proteção de geração nessa camada e teste com barreira, sem alegar exploração observada. Duas consultas de sessão na mesma geração podem concluir fora de ordem. Callback de login em voo, remote logout com cookie/timeout, revogação e propagação entre janelas seguem abertos. `dispatchHooks` passa a registrar só rótulo fixo, sem o objeto de erro; um teste usa canário sintético. Necessário redesenho Main-only antes de qualquer reativação.

## L-02 e SEC-04/05

A branch UI/UX declara base `1d2bbc5`; commit `cb2f418` implementou Fase 1. `docs/product/LIA-PHASE1-UI-UX-2026-11-14.md` §L-02, `lia-app/.../views/ConfigView.vue` e `App.vue` adicionam navegação para IA & Recursos e disclosure técnico legado; `stage-tamagotchi/.../lia-config/sections/AiSection.vue` passa `liaManaged` ao `LiaProviderConfig.vue`, que mostra resumo gerenciado e no mount evita `loadExisting`, ao passo que o modo não gerenciado mantém editor. O save legado do Launcher ainda existe, inclusive caminho de segredo, com políticas existentes. UI oculta **não é** autorização; bridge permanece acessível conforme suas próprias políticas. Teste browser do resumo foi escrito mas o relatório de origem o marca **BLOCKED**, não resultado novo desta revisão. A comparação de código com `407300b` não mostra alterações dos bridges `transport-config-service.ts`, `secrets-service.ts` ou `transport-execution-service.ts` nem do runtime Core na branch UI.

SEC-04: `secrets-service.ts` admite leitura para escopos legados quando a policy permite; o corte completo da leitura ainda não foi demonstrado. SEC-05: em `0093de0` a proteção nova rejeita envio de credencial por HTTP não loopback no runtime Core, mas não vincula credencial ao host HTTPS autorizado nem resolve mutação de destino no Stage. A prova anterior é uma bancada sintética, não exfiltração real. Essas condições **não estão satisfeitas**; o Launcher tem controles diferentes e não se deve generalizar um caminho para o outro.

O plano rev.2 em `2855180` §0 e §6.3 determina explicitamente **S-E não implementar L-02 antes de T-07/T-08**, não somente bloquear distribuição. Pelos metadados, o commit rev.2 `0bf0629` antecede `cb2f418`, mas não sabemos quando a sessão UI recebeu o plano. Conclusão: o resultado publicado está **fora da ordem prescrita**; isso não prova que o agente conhecia a regra no momento nem prova vulnerabilidade nova. A afirmação de que disclosure não escreve, por si só, não cancela a dependência formal ou fecha SEC-04/05. **Bloquear a integração/uso de L-02 na Principal**, não fazer merge seletivo como solução de segurança. Depois de T-07/08, revisar ameaça e compatibilidade de scopes legados, endpoint e CAS, testar acessos IPC forjados e executar browser/Windows no SHA integrado. Outras partes da Fase 1 requerem avaliação independente, sem dependência automática de L-02.

## OIDC-OFF: revisão dos critérios

| Critério DP-4 | Estado nesta árvore |
|---|---|
| Entradas indisponíveis | **FAIL por inspeção:** serviço Main `services/airi/auth.ts` registra `electronAuthStartLogin` para janelas Main/settings/onboarding; componentes de conta/onboarding/controles invocam login. |
| Zero requests quando OFF | **NOT DEMONSTRATED:** não há guarda OFF comprovada nos pontos de entrada; fluxos de auth, refresh, sessão e logout continuam presentes. Não se mediu rede nem se fez teste de dez minutos. |
| Tokens legados limpos no boot | **FAIL por inspeção:** `initialize()` lê os cinco campos `auth/v1/*`, programa refresh e pode restaurar sessão; limpeza ocorre em condições específicas, não por política OFF. |
| `updateCredits()` não disparado indevidamente | **PARCIAL:** teste isolado prova apenas que uma store não autenticada não faz chamada; `isAuthenticated` pode se tornar verdadeiro via estado legado/callback e o watcher chama créditos. Não é prova de OFF. |
| Credenciais inacessíveis ao Renderer | **FAIL por inspeção:** callback Main legado emite tokens ao Renderer, que armazena access/refresh/id em `localStorage` e expõe refs. A alteração proposta não elimina isso. |

Implementar em tarefa isolada guard fail-closed do perfil Lia beta no Main e em todos os pontos Renderer relevantes, sem remover código nem ativar OIDC, invalidar fluxos pendentes e limpar credenciais legadas com segurança; não confundir `isStageTamagotchi()` com perfil Lia. Testar IPC forjado em todas janelas, callbacks e refresh atrasados, boot com perfil legado, múltiplas janelas, rede e canários no DOM/storage/logs, bem como voz/STT. A decisão de produto sobre futura ativação segue pendente.

## Validação desta rodada

- `docs/reports/evidence/lia-beta-security-2026-11-14/run-isolated-vitest.sh`: exit 0, **106/106** em seis arquivos, incluindo `auth.test.ts` **13/13**. Node `v22.22.3`. Usa cópias de módulos reais com fixtures para API/auth/network/timers, e versões temporárias npm; não é suíte AIRI oficial, Electron ou issuer. Cobre refresh single-flight, logout em voo, falha obsoleta após login novo, sessão substituta falha, créditos sem sessão, classificação com mock, logs sem canário e respostas atrasadas.
- `(cd lia/core && node --experimental-strip-types --test test/*.test.ts)`: exit 0, **107/107**. Não prova transporte real Stage nem SEC-04/05.
- `docs/reports/evidence/lia-auth-reconciliation/check-scoped-types-lint.sh`: exit 0. TypeScript 6.0.3 em cópia temporária dos dois arquivos com dependências Pinia/Vue/Better Auth reais e **stubs** para módulos internos e tipo de sucesso Hono (`tsc -p tsconfig.json`). Não substitui o typecheck do workspace nem verifica tipos efetivos do servidor.
- Mesmo script: ESLint 10.9.0 em cópia temporária dos dois arquivos, com config do repositório e plugin `perfectionist` explicitamente injetado (a cópia não modificada da config falhou por plugin ausente), exit 0. A primeira execução após adicionar o teste de hook detectou `style/max-statements-per-line`; ajustado e script reexecutado com exit 0. Não é lint oficial integral. Sem `airi/node_modules`, não se executou pnpm/typecheck/lint oficiais.
- `git diff --check` e inspeção por `git diff` do patch de `auth.ts` contra `0093de0`: sem erros de whitespace. E2E Electron/Windows, Chromium, rede de dez minutos, issuer e testes Main-only: **NOT RUN**.

## Integração e preservação

O ambiente restaurou inicialmente o checkout no HEAD `7cb81720552a822a03f36ac6ce5f2e20b009f84c`, com remoto próprio em `0093de0` (descendente, 10 commits à frente). Os dois arquivos de auth coincidiam com `0093de0` antes desta rodada; o patch foi aplicado sobre eles. A pedido explícito, o usuário autorizou exclusivamente `git merge --ff-only`: após comparar blobs remotos e preparar o índice com os 29 blobs correspondentes, o checkout avançou para `0093de0` sem merge commit. Foram verificados hashes de 31 arquivos modificados/não rastreados antes e depois: **zero divergências**. O relatório independente permaneceu não rastreado e fora dos commits. Não foi feito rebase, reset ou force push. A Principal deve integrar somente depois de revisão, OIDC-OFF/SEC-04/05 e testes nativos; não incorporar esta documentação como atestado de segurança.
