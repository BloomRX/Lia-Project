# Modelos livres e descoberta dinâmica — 29/10/2026

## Entrega

O catálogo agora é uma fonte de sugestões, nunca uma lista de permissão. A tela
aceita um ID editável para modelo principal e reserva, mantém sugestões locais,
acrescenta sugestões descobertas e preserva IDs desconhecidos ao editar, salvar,
reabrir e trocar de serviço. Valor vazio é recusado explicitamente ao salvar;
não há substituição automática por recomendado.

A descoberta acompanha serviço, endereço e chave em edição, com debounce de
300 ms, deduplicação de chamadas concorrentes equivalentes e descarte de respostas
obsoletas. Apresenta carregamento, sucesso, vazio, indisponibilidade e falha em
pt-BR/en. Uma falha nunca bloqueia o campo manual nem prova inexistência do ID.

O botão de conexão faz uma requisição de texto com **o modelo escolhido**, usando
endereço efetivo e chave transitória. Não depende de `/models`, não aprova corpo
vazio e não devolve texto bruto de exceções. A confirmação esclarece: **somente
texto; ferramentas e imagens não verificadas**. Não é gate de compatibilidade
de ferramentas. A requisição tem cancelamento em 15 s; não força um parâmetro de
tokens cujo nome pode variar entre serviços.

Salvar aplica o alvo pelo `activatePreferred()` existente. O schema de produto
não mudou; nenhuma migração foi necessária. Corrigida também perda preexistente
de campos opcionais no handler principal: salvar o serviço agora preserva `brain`
e `setup`, além das demais preferências existentes.

## Estado inicial e proteção

- Raiz: `J:\Lia-Project`; branch `arena/01a10290-lia-project`.
- HEAD inicial e remoto: `0493b1b43c501b5d26d6095bade5d9d9800b7470` (E3).
- E3 presente no HEAD/história; remoto alinhado no preflight.
- `main` permaneceu `db99c709059a6d074b18361bfb32c9f144620632`.
- Seis arquivos Core preexistentes preservados byte a byte por SHA-256 e excluídos
  do staging. Nenhum reset/clean/rebase/merge/force push ou mudança de branch.
- Sem mudança no runtime compartilhado `airi/packages/stage-ui`, dependências,
  lockfile, Persona, secrets, TTS, política de fallback ou scripts de entrada.
- Baseline funcional Windows continua `3ef6d11618f787dae6d197645d440a5775a60ad6`.

## Fluxo verificado no código e nos testes

1. `LiaProviderConfig.vue` carrega `provider.chat` pelo store Lia. Os dois campos
   guardam o ID exato, sem `coerceModel()` ou guarda de catálogo.
2. `persistConfig()` reconstrói dados clonáveis para o IPC; o handler principal
   grava `provider.chat.preferred/fallback` sem transformar `modelId`.
3. `activatePreferred()` usa o mecanismo existente: descarta a instância antiga,
   assegura o registro e atribui primeiro `activeProvider`, depois `activeModel`.
4. O chat compartilhado usa esses valores em `executeSendAttempt()` e passa o
   `modelId` a `runtime.ingest`. Um `routeOverride` explícito continua tendo
   precedência: a política Brain existente não foi reescrita por esta entrega.
5. O teste anterior recebia `modelId`, mas chamava apenas os validadores do E3.
   Esses validadores podem listar/pingar outro modelo; não provavam o escolhido.
   O port de validação histórico foi preservado, com seus testes de conformidade.
   A nova sonda usa `provider.chat(modelId)` e `generateText`, sem listar primeiro.

## Decisão de fronteira e segurança

Ampliada somente a fronteira existente `provider-runtime.ts` com operações de
rascunho (`discover`/`probe`). Ela acessa a definição no mesmo import já existente,
aplica o schema do serviço e cria uma instância temporária, descartada ao final.
Usa `extraMethods.listModels` ou o `model()` do adaptador com `@xsai/model`.
Sem método, retorna `unsupported`; sem resposta útil, mantém entrada manual.

Não foi usado `fetchModelsForProvider()`: ele consulta configuração salva, escreve
cache compartilhado e registra exceções brutas. Isso não atende a rascunhos com
chaves transitórias nem ao tratamento seguro de erros desta tela. As APIs SDK
utilizadas já eram dependências instaladas; nenhuma biblioteca nova foi adotada.
Não há import novo do Stage nos módulos de interface ou um port genérico novo.

Chaves vêm do campo transitório ou do vault existente, nunca do catálogo nem de
um log. Rascunhos e chaves não entram no estado Pinia, no IPC de configuração ou
em armazenamento persistente. O mapa de deduplicação existe apenas durante a
requisição e é removido em `finally`. URLs com credenciais embutidas ou protocolo
fora de HTTP(S) são recusadas na preparação. Falhas de descarte não aprovam sucesso.

## Comandos e resultados

Ambiente: Windows local, PowerShell, Node 26.8.1, data da rodada 29/10/2026.
`pnpm` abaixo foi invocado pelo Corepack já instalado:
`& "$env:LOCALAPPDATA/Lia-DevTools/node_modules/.bin/corepack.cmd" pnpm ...`.

| Diretório | Comando | Resultado |
| --- | --- | --- |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node src/renderer/stores/lia` | **PASS automatizado**, baseline 346; final 365 em 30 arquivos, saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project browser LiaProviderConfig.browser.test.ts` | **PASS automatizado**, 11 testes Chromium, saída 0 |
| `airi` | `./node_modules/.bin/vitest run --config apps/stage-tamagotchi/vitest.config.ts --project node src/main/services/lia/provider-config-service.test.ts src/main/lia-brain-lifecycle.test.ts` | **PASS automatizado**, 11 testes, saída 0 |
| `airi` | `pnpm -F @proj-airi/i18n run build` | **PASS automatizado**, saída 0 |
| `airi/apps/stage-tamagotchi` | `./node_modules/.bin/vue-tsc.cmd --noEmit` | **PASS automatizado**, saída 0, repetido após correção de persistência |
| `airi/apps/stage-tamagotchi` | `pnpm run build` | **PASS automatizado**, main/preload/renderer, saída 0, repetido após correção de persistência |
| `airi` | `./node_modules/.bin/moeru-lint` com os 13 arquivos abaixo | **PASS automatizado**, saída 0, sem warnings finais |
| Raiz | `git diff --check` | **PASS automatizado**, saída 0 |

Comando de lint executado (diretório `airi`):

```powershell
./node_modules/.bin/moeru-lint apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.vue apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.browser.test.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider-validation.ts apps/stage-tamagotchi/src/renderer/stores/lia/model-discovery.ts apps/stage-tamagotchi/src/renderer/stores/lia/model-discovery.test.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider-models.test.ts apps/stage-tamagotchi/src/renderer/stores/lia/provider-validation.test.ts apps/stage-tamagotchi/src/main/services/lia/provider-config-service.ts apps/stage-tamagotchi/src/main/services/lia/provider-config-service.test.ts packages/i18n/src/locales/en/tamagotchi/home.yaml packages/i18n/src/locales/pt-BR/home.yaml
```

Build manteve avisos de configuração/plugin (`inlineDynamicImports` depreciado,
tempos de plugins); não houve erro de compilação. Não se alterou bundler por isso.

Os 365 incluem os testes solicitados de facade, runtime, runtime-semantics,
validation, activation, conformance, auth-policy e scanner de imports. A sonda
isolada com as definições reais, vault/IPC simulado e fetch determinístico passou
16 casos. Não houve requisição a serviço/modelo externo durante esta rodada.

Falhas intermediárias preservadas nos logs locais:

- **RED funcional:** 2 testes browser falharam antes da implementação (campo
  manual ausente e nenhum estado de descoberta).
- **RED persistência:** salvar descartou `brain`; teste real do handler + schema
  falhou antes da correção de uma linha, passou depois.
- Duas falhas de corrida no composable levaram à observação profunda e ao
  snapshot do rascunho; três casos de lifecycle passaram após a correção.
- Expectativas antigas que aprovavam conexão sem modelo e devolviam texto de
  validadores foram atualizadas para o novo contrato seguro, sem remover os
  testes de delegação E3 ou enfraquecer o scanner arquitetural.
- Lint apontou formatação e typecheck apontou tipagem de YAML/captura. Corrigidos
  usando o bundle público i18n existente e a API tipada de screenshot.
- Captura fora da raiz permitida pelo Vite foi recusada. Gerada dentro do cache
  permitido e copiada para `Tests/artifacts`; configuração de segurança intacta.

## Cobertura dos requisitos

| Requisito | Evidência automatizada |
| --- | --- |
| Recomendação selecionável e catálogo preservado | Caso browser de sugestões recomendadas/descobertas; contratos existentes |
| ID fora do catálogo; edição; troca de serviço | Componente real em Chromium, valor exato antes/depois |
| Salvar e recarregar/reabrir | Store + IPC simulado e remontagem do editor; handler + schema de produto |
| Descoberta bem-sucedida e vazia | Store com definição real e fetch determinístico; browser |
| Sem suporte; erro sem bloquear manual | Factory de instância sem listagem; casos browser |
| Resposta atrasada; debounce; deduplicação | Lifecycle com timers controlados e requisições simultâneas no store |
| Modelo vazio/endereço inválido | Nenhuma chamada/persistência indevida nos casos negativos |
| Modelo efetivamente enviado | Corpo de `/chat/completions` contém exatamente o ID escolhido; nenhum GET prévio |
| Falha de configuração/transporte/rejeição/vazio | Códigos seguros; rejeição ambígua não é atribuída automaticamente a modelo inexistente |
| Segredos | Sentinelas ausentes de resultados, logs e estado/configuração compartilhados |
| Compatibilidade de preferências anteriores | Sem schema/migração; handler preserva `brain`, `setup` e preferências |

## Arquivos da entrega

1. `airi/apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.vue` — edição livre, sugestões, estados e ativação após salvar.
2. `airi/apps/stage-tamagotchi/src/renderer/components/LiaProviderConfig.browser.test.ts` — fluxo DOM e capturas nos dois idiomas.
3. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/model-discovery.ts` — lifecycle local das sugestões.
4. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/model-discovery.test.ts` — debounce, corrida e desmontagem.
5. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider.ts` — rascunho efetivo, resolução segura e deduplicação.
6. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-runtime.ts` — descoberta e teste de texto por instância temporária.
7. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-models.test.ts` — integração determinística do fluxo de modelos.
8. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-validation.ts` — nota documental do alcance histórico E3.
9. `airi/apps/stage-tamagotchi/src/renderer/stores/lia/provider-validation.test.ts` — alcance seguro do novo teste de conexão.
10. `airi/apps/stage-tamagotchi/src/main/services/lia/provider-config-service.ts` — preservação do restante do documento.
11. `airi/apps/stage-tamagotchi/src/main/services/lia/provider-config-service.test.ts` — regressão de persistência.
12. `airi/packages/i18n/src/locales/pt-BR/home.yaml` — estados e alcance em pt-BR.
13. `airi/packages/i18n/src/locales/en/tamagotchi/home.yaml` — equivalentes em inglês.
14. `docs/project/CURRENT-STATE.md`, `docs/project/QUANTO-FALTA.md`, `docs/design/LIA-UI-DESIGN-SYSTEM.md` e este relatório — estado, decisão e continuidade.

## Evidência visual e limites

Capturas locais: `Tests/artifacts/models-20261029-pt-BR.png` e
`Tests/artifacts/models-20261029-en.png`. Revisadas visualmente: campo, mensagens
e ações legíveis, sem sobreposição nos dois idiomas. São componente real em
Chromium com store simulado; **não são um gate de Electron/conversa em rede**.
Logs ficam sob `Tests/artifacts/models-*-20261029.log` (ignorados pelo Git);
este relatório versionado conserva resultados e limitações para outra sessão.

- **NÃO EXECUTADO:** serviço/modelo real, vault pessoal, reinício do aplicativo
  instalado, áudio, imagem, loop de ferramentas e instalação limpa.
- Compatibilidade do modelo depende do endpoint/adaptador; um ID livre não é
  suporte a execução/download universal de pesos locais.
- Serviços podem omitir modelos da lista, devolver catálogo estático ou não
  implementar listagem. Nenhum desses resultados proíbe testar/digitar um ID.
- Rejeição HTTP pode envolver endereço, autenticação, quota ou modelo; a UI não
  inventa causa específica quando o SDK não fornece evidência inequívoca.
- Hooks de listagem próprios podem não aceitar cancelamento; respostas obsoletas
  são ignoradas, sem promessa de cancelamento universal de cada hook.
- Rotas Brain explicitamente configuradas continuam tendo precedência por envio.
  Não se modificou essa política, nem se declara validação universal dos providers.
- Suítes gerais Python/Node raiz e gate Windows completo **NÃO EXECUTADOS** nesta
  entrega dirigida; baseline funcional e fase 8.0D permanecem inalterados.

Publicação: somente após os gates finais, com staging explícito e push normal
para a branch acordada. HEAD final e igualdade remoto/local são informados na
resposta da entrega; o relatório não tenta incorporar seu próprio hash.
