# Launcher — encerrar conversa pela Home — 28/10/2026

## Entrega e escopo

A Home agora permite **Encerrar conversa** sem fechar o Launcher. Reutiliza o
IPC `stopStage()` e o gerenciador existentes: não cria outro controlador de
processos. Mostra **Encerrando…**, desabilita ações concorrentes, exige resposta
`phase: stopped` para **Conversa encerrada.** e oferece retry com erro seguro.
Uma falha com PID histórico não bloqueia `conversar()`: o gerenciador decide se
há instância válida. Novos textos seguem pt-BR/en e feedback acessível.

HEAD inicial local e remoto: `80e5e1281d66bd9a0a31f26a6b48fba0e4d1c0d9`.
Branch: `arena/01a10290-lia-project`; origin: `https://github.com/BloomRX/Lia-Project`.
Baseline Windows continua `3ef6d11618f787dae6d197645d440a5775a60ad6`.
Os seis arquivos Core preexistentes não pertencem a esta entrega e foram
preservados, conferidos por SHA-256 e excluídos do staging.

## Arquivos da entrega

| Arquivo | Mudança |
| --- | --- |
| `airi/apps/lia-app/src/renderer/src/views/HomeView.vue` | Botão, chamada IPC, estados e feedback |
| `airi/apps/lia-app/src/renderer/src/views/home-vm.ts` | Visibilidade, estado e mensagens puras |
| `airi/apps/lia-app/src/renderer/src/views/home.test.ts` | Contratos existentes atualizados para a parada |
| `airi/apps/lia-app/src/renderer/src/views/home.browser.case.ts` | Sete casos montando o SFC real no Chromium |
| `airi/apps/lia-app/vitest.home.browser.config.ts` | Execução browser isolada com dependências existentes |
| `docs/project/CURRENT-STATE.md`, `docs/project/QUANTO-FALTA.md` | Estado, limites e continuidade |
| Este relatório | Evidências e roteiro reproduzível |

Sem alterações em dependências, lockfile, runtime TTS, Persona, secrets,
fallback, discovery, `Lia.bat` ou `DevKit.bat`.

## Verificações automatizadas

Ambiente: Windows local, PowerShell, Node 26.8.1, 28/10/2026.
`pnpm` foi invocado pelo Corepack já instalado em
`$env:LOCALAPPDATA/Lia-DevTools/node_modules/.bin/corepack.cmd`.
Todos os comandos finais abaixo terminaram com código **0**.

| Diretório | Comando | Resultado |
| --- | --- | --- |
| Raiz | `node --test Tests/tools/alethe-editor.browser.mjs` | **PASS automatizado**, 1 teste em Chromium real |
| Raiz | `python3 Tests/tools/alethe-budget.test.py` | **PASS automatizado**, 10 testes |
| `airi` | `pnpm --filter @lia/core run build` | **PASS automatizado**, antes do baseline Launcher |
| `airi/apps/lia-app` | `../../node_modules/.bin/vitest run` | **PASS automatizado**, 247 / 2 skips, 23 arquivos; antes e depois da implementação |
| `airi/apps/lia-app` | `../../node_modules/.bin/vitest run --config vitest.home.browser.config.ts` | **PASS automatizado**, 7 casos finais em Chromium |
| `airi/apps/lia-app` | `pnpm run typecheck` | **PASS automatizado** |
| `airi/apps/lia-app` | `pnpm run build` | **PASS automatizado**, Core + main/preload/renderer |
| `airi` | `./apps/stage-tamagotchi/node_modules/.bin/vue-tsc.cmd --ignoreConfig --noEmit --target esnext --module esnext --moduleResolution bundler --types node --skipLibCheck apps/lia-app/src/renderer/src/views/HomeView.vue` | **PASS automatizado**, componente Vue |

Lint em `airi`, com os cinco arquivos da entrega:

```powershell
./node_modules/.bin/moeru-lint apps/lia-app/src/renderer/src/views/HomeView.vue apps/lia-app/src/renderer/src/views/home-vm.ts apps/lia-app/src/renderer/src/views/home.test.ts apps/lia-app/src/renderer/src/views/home.browser.case.ts apps/lia-app/vitest.home.browser.config.ts
```

**PASS automatizado**, saída 0. Três problemas de estilo na primeira execução
foram corrigidos. Os 18 testes Home também passaram em execução dirigida.
O agente principal repetiu a suíte completa Launcher, browser, typecheck e build
depois da última correção; não depende apenas do relato do worker.

Antes da implementação: **FAIL esperado**, 6 casos browser sem o novo botão.
A revisão identificou risco de bloquear início por PID histórico: teste novo
produziu **FAIL** (1 falha / 6 passes), corrigido e repetido com 7 PASS.
Respostas de parada `error`, `running` ou `stopping` não aprovam sucesso;
rejeições não exibem payload bruto. Revisão final: sem apontamentos pendentes.

A validação mínima Alethe cobriu orçamento antes/depois, concorrência,
timeout, recuperação de resultados e encerramento de árvore local inofensiva
no Windows. A skill está disponível no catálogo da sessão. **Nenhum worker CLI
de IA ou modelo externo foi chamado nesta rodada**; nenhuma configuração global
ou dependência nova foi instalada. Não se repetiu auditoria de skills/upstream.

## Windows: integração real do Launcher com fixture de processo

**PASS Windows real no escopo Launcher → IPC → gerenciador → processo controlado.**
**NÃO EXECUTADO:** AIRI Stage real, resposta do modelo, personagem e áudio.
A fixture não é um Stage funcional nem prova de conversa ponta a ponta.

Roteiro executado depois dos testes e do build:

1. Criado perfil descartável fora do Git, setup concluído e voz desabilitada.
   `LIA_USER_DATA` e `LIA_AIRI_ROOT` só no processo de QA; configuração sintética
   via API pública, sem ler credenciais ou alterar o perfil pessoal.
2. Workspace temporário contém entrada Node no caminho de `electron-vite` que
   imprime `ready in 1 ms`, cria um filho Node inofensivo e mantém ambos ativos.
   O pré-requisito Core foi **skipped/não aplicável nessa fixture**; não é prova
   do build do core-agent no AIRI Stage real.
3. Executável Electron do Launcher compilado aberto visivelmente, com CDP local
   9265 e perfil isolado. Processo 15240; logs: `lia-core.ready` +135 ms,
   `window-created` +232 ms, `renderer-ready` +707 ms.
4. Clique real em **Conversar com Lia**: pai 6464 e filho 8020 observados;
   Home mostrou **Conversando…** e **Encerrar conversa**.
5. Clique real em **Encerrar conversa**: ambos botões desabilitados durante
   **Encerrando…**; depois `stageState.phase=stopped`, sucesso visível e início
   habilitado. Pai e filho ausentes na checagem posterior dessa primeira parada.
6. Reabertura: novo pai 21408, filho 8272. Novo clique em **Conversando…**
   manteve PID 21408; nenhuma nova instância foi criada.
7. Segunda parada: pai ausente, filho 8272 **ainda presente na checagem imediata**
   (17:45:09.0198376Z). Fechamento pelo `requestQuit()` público; checagem seguinte
   não encontrou 8272, 21408 ou 15240. Log de shutdown terminou em saída 0 às
   17:45:09.208Z. **Latência de saída do filho não medida**; não há prova de
   remoção instantânea de toda a árvore nem causa confirmada para o intervalo.

A primeira tentativa de lançar o executável por invocação direta com redireção
PowerShell deixou uma janela incompleta e CDP sem resposta. Nenhum Stage iniciou.
O processo de QA foi identificado por PID e horário e encerrado. O mesmo build,
aberto por `Start-Process` com stdout/stderr em arquivos, funcionou. Causa dessa
tentativa **não confirmada**; não houve aumento de timeout ou alteração de backend
para contornar. O Launcher e a fixture usados na rodada estão encerrados.

Evidências locais ignoradas pelo Git, apenas deste QA:

- `Tests/artifacts/home-stop-20261028/captures/running.png`
- `Tests/artifacts/home-stop-20261028/captures/stopped.png`
- `Tests/artifacts/home-stop-20261028/fixture.json`, `launch.json`, `result.json`
- `Tests/artifacts/home-stop-*.log`: RED/GREEN, lint e typecheck dirigido.

`result.json` conserva `secondChildGone: false`: não foi sobrescrito para ocultar
a observação imediata. O relato acima preserva a checagem posterior separadamente.
Screenshots revisadas: layout, legibilidade e feedback **aprovados**; imagens
não demonstram semântica do backend. Este relatório versionado registra os
resultados mesmo quando os artefatos locais não estiverem disponíveis.

## Pendências e publicação

- **NÃO EXECUTADO:** novo gate AIRI/modelo/voz/imagem real; chamada externa exigiria
  autorização específica com limites. Nenhum PASS histórico foi renovado aqui.
- **NÃO EXECUTADO:** instalação limpa, atualização, multimonitor e release completa.
- **NÃO EXECUTADO nesta entrega:** suítes gerais Python/Node raiz e Core-agent;
  não houve mudança nesses módulos. A suíte Launcher relevante passou.
- Fase 8.0D continua aberta; não há promoção de baseline nem aprovação de release.
- Próxima entrega: corrigir feedback de salvar em ConfigView, apagado por reload,
  com regressão no componente e estados de carregamento/erro.

Commit desta entrega identificável por `feat: permite encerrar conversa pela Home`.
Publicação prevista apenas por push normal na branch acima; SHA final e igualdade
local/remoto devem ser conferidos após o push e informados na resposta de entrega.
