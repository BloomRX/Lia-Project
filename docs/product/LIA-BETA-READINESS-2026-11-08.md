# Lia — prontidão para beta, 08/11/2026

HEAD inicial `dcd0b058483912b2047a82973e39edb1d076a344`, branch
`arena/01a10290-lia-project`. **Classificação: Ainda bloqueada para beta.**
O pacote privado anterior e todos os commits/evidências foram preservados.
Nenhum instalador foi publicado, nenhuma engine foi migrada.

## Recuperação e integração

O preflight repetido às 21:13 BRT encontrou o mesmo HEAD, índice vazio e **20
arquivos rastreados alterados**, além dos novos testes/documentos/ferramentas;
a referência do pedido a 18 era uma fotografia anterior. Nenhum trabalho foi
descartado. Remoto atualizado sem divergência. Os agentes de auditoria,
idioma, lifetime da sombra e inventário concluíram seus arquivos; declarações
foram conferidas por diff e testes. O ensaio antigo terminou em exit 0.

Na retomada seguinte, `f111200` coincidia com o tip remoto. O índice e os
arquivos rastreados estavam limpos. Restavam três arquivos novos da comparação
de desempenho, preservados e revisados. Os 20 arquivos pertenciam ao snapshot
anterior, já integrado. O agente visual revisou capturas existentes em leitura.

| Frente | Resultado comprovado | Limite |
| --- | --- | --- |
| Cofre | Recusa mutação de arquivo vazio, inválido, truncado ou sem permissão; criação real ENOENT preservada; falhas de cifra não exportadas; temporário removido em falha de rename | Não resolve sozinho escritores legados concorrentes de processos diferentes |
| Logs Main | Query credentials e campos JSON conhecidos mascarados no Viewer e no arquivo; teste lê arquivo real | Não protege segredo arbitrário sem formato nem limpa logs históricos |
| Editor chat nativo | Porta Main para definições migradas/aliases; input legado passa provider-id; resolução Renderer recusada para aliases | Outros protocolos, páginas específicas, validação/ping legado e integrações continuam pendentes |
| Serviço sem chave | Exigência de credencial declarada pela porta; serviço local não é rebaixado a não configurado por não ter chave | Presença de configuração não prova conexão com ferramenta |
| Idioma | Shell e Config pt-BR/en, efeito após persistência, loading/erro/retry; erro resolvido no IPC não libera formulário com defaults | Home/Voz/Diagnósticos e outras janelas ainda possuem tradução parcial |
| Sombra Live2D | RAF encerrado na pausa/desmontagem; callback antigo não reinicia loop, retomada única | Sem atribuir os 2 GB a esse loop; custo GPU precisa medição |
| Voz desativada | Primeiro uso explicitamente somente texto não pré-aquece worker de voz; engines continuam instaladas/registradas e reativação usa lazy path existente | Não encerra automaticamente worker já ativo ao desativar durante sessão |

## P0 — credenciais

[Mapa por consumidor](../architecture/LIA-BETA-CREDENTIAL-AUDIT-2026-11-08.md)
registra chamador, alcance, Renderer, Owner, risco e correção por família.
Há credenciais legadas em configurações/broadcast/PATCH, STT de sessão, TTS,
imagem/widgets, busca, integrações e autenticação. Ocultar uma entrada do menu
não fecha uma rota/IPC. Não foi removida funcionalidade para declarar segurança.
Revisão independente corrigiu duas regressões do trabalho novo: falha resolvida
de leitura de configuração e serviço local sem chave. Aprovação global continua
negada até a migração e os gates por protocolo.

### Retomada OIDC Desktop

Preflight em `2a9eca5d4b4d3283adbf137ef2e503bbe9607e3e`, branch
`arena/01a10290-lia-project`. O tip remoto era idêntico. `git status
--porcelain=v2 --branch --untracked-files=all`, `git diff --stat` e
`git diff --cached --stat` mostraram checkout e índice limpos. O Git local
não reproduziu os dez arquivos da visualização posterior. Sem a origem
daquela contagem, sua causa segue não confirmada. Os commits `40c6c03`,
`bf8407e`, `e504f7f` e `2a9eca5` foram preservados.

A contraprova `oidc-cancel-red.log` falhou nos dois casos de cancelamento
durante a troca de código. O handler emitiu o callback legado mesmo após
logout ou fechamento. Agora a tentativa cancelada aborta o HTTP, fecha o
loopback e descarta o resultado tardio. Na substituição entre janelas, a
janela anterior recebe um evento sem dados para sair do carregamento. O
logout de Settings cancela primeiro no Main e só então executa o logout
legado. Falhas de transporte e de entrega IPC registram fase e, quando
aplicável, status numérico. Sem corpos HTTP ou exceções externas nos logs.

A revisão independente apontou o carregamento da janela anterior, a promessa
de entrega do Eventa e a ordem de logout. Os três foram tratados e o delta
foi revisto novamente. O achado de propriedade da sessão continua aberto.
O teste de sucesso mantém o contrato atual, em que tokens chegam ao Renderer.
Renovação concorrente, revogação e restauração no Main seguem sem implementação
e sem validação. [Mapa de consumidores e ordem do corte](../architecture/LIA-BETA-CREDENTIAL-AUDIT-2026-11-08.md#oidc-desktop--fronteira-e-ordem-de-corte).

No agregado Node do Stage, `vitest run --project node` retornou **FAIL**,
exit 1. Houve 2365 PASS, 4 skips e um timeout de 15 s em `image-journal.test.ts`
(`oidc-final-stage-node.log`). A mesma assinatura aparece em
`beta-final3-stage-tests.log`, anterior a este delta. A causa ainda não foi
confirmada. O teste e seu limite foram preservados.
Em `vitest run --project node src/renderer/stores/tools/builtin/image-journal.test.ts`,
o arquivo isolado passou os dois casos, exit 0 (`oidc-final-image-journal-isolated.log`).
Isso mantém o agregado classificado como FAIL.

Logs e códigos de saída da retomada em `J:/lia-evidence/`. Verificações
executadas no Windows em 08–09/11/2026, no Stage salvo indicação.

| Comando | Resultado |
| --- | --- |
| `vitest run --project node` com handler OIDC, loopback, callback Renderer, botão e conta | PASS automatizado, 15 testes, exit 0 em `oidc-final-focus-confirmed`. O loopback validou um callback HTTP real e rejeitou estado incorreto. A troca de código usa fixture no teste do handler. |
| `vitest run --project browser` | PASS automatizado, 54 testes, exit 0 em `oidc-final-chromium`. Avisos de ResizeObserver preservados. |
| `corepack pnpm run typecheck` e `corepack pnpm run build` | PASS automatizado, exit 0 em `oidc-final-typecheck` e `oidc-final-build`. |
| `moeru-lint` nos sete arquivos tocados do Stage, a partir de `airi/` | PASS automatizado, exit 0 em `oidc-final-lint-last` após ajuste de imports no teste do botão. |
| `run-gate-windows.ps1 -SkipBuild` em PowerShell 5.1 e 7 com o ZIP oficial 43.4.1 | PASS Windows de componentes com HTTP sintético, 16 grupos e exit 0 por execução. Sentinelas ausentes nos respectivos logs. |
| Core e Launcher | NÃO EXECUTADO nesta rodada. Nenhum código desses pacotes nem o contrato de inicialização do Stage mudou. |

O gate de componentes gerou `report.json` e `electron.log` em
`J:/lia-evidence/af08f27d-5f27-4d30-8db5-c8fac9689512/` (PS5.1) e
`J:/lia-evidence/a2ee3aea-064b-45e2-b234-ab98f4e0a6d7/` (PS7).
Login OIDC externo ficou NÃO EXECUTADO. O critério de propriedade exclusiva
segue aberto. O código e o teste de sucesso confirmam que o callback legado
ainda transporta os tokens.

## Desempenho

[Baseline detalhado e métricas por processo](../architecture/LIA-BETA-PERFORMANCE-2026-11-08.md).
Pacote antigo: 720 amostras/3600,01 s, 17 PIDs observados, Private Working Set e
contadores GPU efetivamente disponíveis, ausências excluídas das médias.
Working Set somado não é RAM exclusiva; Private Bytes não é residência.
Private Bytes cresceu cerca de 175,91 MiB entre janelas de cinco minutos,
principalmente no processo GPU do Stage; isso não demonstra vazamento.
CPU foi contaminada por testes no host nos primeiros ~20 minutos.

Separação dos cenários: Launcher fechado/Stage fechado, Stage parado **animado**,
após chat/presença e contínuo foram medidos. Avatar estático sem animação,
ocultação, pausa, fala física e jogo ainda exigem passagens próprias. FPS,
frame time, impacto em jogos e energia não foram medidos. A comparação com o
pacote atual usa os artefatos das duas coletas, com as diferenças de carga
registradas. Não há vencedor de engine nem meta arbitrária de memória.

## Matriz Windows de distribuição e hardware

| Gate | Procedimento e evidência necessária | Estado nesta rodada |
| --- | --- | --- |
| Instalação limpa | Usuário/VM limpo, NSIS, Launcher→Stage, descoberta/ferramenta, serviço sem chave e chave sintética, memória/personalidade/presença, reabertura | NÃO EXECUTADO; host com dependências de desenvolvimento não equivale a máquina limpa |
| Atualização | Versão anterior instalada, dados/credenciais criados no próprio perfil; atualizar, reabrir e comparar dados/rota; sem processo duplicado | NÃO EXECUTADO; não foi criada versão anterior fictícia nem trocado perfil ativo |
| Desinstalação | Desinstalador registrado, remoção de arquivos, dados pessoais preservados, reabertura por reinstalação | NÃO EXECUTADO; configuração NSIS `deleteAppDataOnUninstall:false` não substitui gate |
| Assinatura | Verificar cadeia Authenticode, publisher e timestamp dos EXE/NSIS | Pacote anterior NotSigned; nenhuma chave/certificado adquirido ou inventado |
| Voz física | Seleção de mic, captura, STT, cancelamento, TTS, reprodução/interrupção e desconexão | NÃO EXECUTADO; inventário de dispositivos OK não prova captura ou audição |
| Serviço externo | Endpoint/chave autorizados, seleção persistida e ferramenta/resultado/resposta | BLOCKED na consulta local anterior; fixture HTTP não é serviço externo real |
| Monitor conectado | Segundo monitor, movimento, pausa e Home | PASS anterior do pacote; repetir somente se caminho mudar |
| Desconexão/DPI/jogos | Hotplug/principal/resolução/escala, borderless/exclusivo, foco e click-through | NÃO EXECUTADO; não se mudaram telas/sessão nem abriu jogo por suposição |

Os dados pessoais ficam fora da pasta de instalação. Desinstalar não é
consentimento para apagar memória/configuração/credenciais. Nenhuma limpeza
automática foi adicionada. Um procedimento de remoção de dados deve mostrar
as categorias, confirmar explicitamente e ser testado antes de distribuição.

## Assinatura — investigação, sem execução de assinatura

O pipeline precisa de identidade verificável e chave protegida em serviço de
assinatura/HSM ou certificado de assinatura de código compatível; não inserir
PFX, senha ou token no repositório. Electron-builder local é **26.15.3**:
consultar seu contrato instalado, sem copiar opções de versão posterior.
Assinar executáveis e instalador, carimbar tempo, então verificar os arquivos
finais; hash SHA-256 isolado prova correspondência, não identidade de publisher.
Referências oficiais: [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool),
[reputação SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
e [electron-builder v26](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
Assinatura não garante ausência de avisos nem aprova licenças/assets. A escolha
de titular/serviço/certificado e suas credenciais depende do responsável pelo produto.

## Licenças

[Assets](../licenses/ASSET-LICENSES.md), [terceiros](../licenses/THIRD-PARTY-NOTICES.md)
e [inventário físico atual](../licenses/PACKAGED-INVENTORY-BETA-2026-11-08.json) substituem
o registro desatualizado de nenhum asset. Tooling lê manifestos de ASAR sem
executar o código empacotado. Avisos adjacentes não autorizam todo o pacote:
modelos, Hero PNG, Cubism e Spine ainda exigem comprovação de direitos/contratos.
Não houve remoção automática de modelos, fontes, runtimes ou funcionalidades.

## Evidências automatizadas e gates

Logs da rodada em `J:/lia-evidence/beta-*`. Resultados iniciais preservados:
Core agregado paralelo: 366 PASS/2 FAIL por timeout; repetição serial: **368
PASS, exit 0**, sem alterar limites. Stage inicial: **2350 PASS/2 FAIL/4 skips**,
timeouts em image-journal e brain-correlation-observer; isolados **55 PASS**.
Esses FAIL não são convertidos em PASS por testes distintos.
O primeiro Launcher após rigor do cofre encontrou fixture que representava
ausência com bytes vazios; corrigida para container JSON vazio válido, sem
alterar asserts nem tornar arquivo truncado gravável. Repetição: **280 PASS,
2 skips**. Chromium Launcher integrado: **16 PASS**. Resultados finais de
Stage, lint, types, builds e componentes foram registrados abaixo.

| Comando / diretório | Resultado e artefato em `J:/lia-evidence/` |
| --- | --- |
| `vitest run`, lia-app | 280 PASS/2 skips, exit 0; `beta-final2-launcher-tests` |
| `vitest run --config vitest.home.browser.config.ts`, lia-app | 16 PASS, exit 0; `beta-final2-launcher-browser` |
| `vitest run --project node`, Stage | 2356 PASS/4 skips, exit 0; `beta-final2-stage-tests`. Após a guarda de alias, 23 PASS focados em `beta-native-editor-alias-final`; agregado `beta-final3-stage-tests` com 2355 PASS/2 FAIL/4 skips e os mesmos dois timeouts, durante execução do harness da raiz. Causa da falha permanece sem confirmação |
| `vitest run --project node`, Stage, execução sequencial com delta OIDC | 2358 PASS/4 skips, 195 arquivos, exit 0; `beta-resume-stage-node` |
| Testes focados de erro OIDC e callback Renderer, Stage | Contraprova FAIL, exit 1 em `beta-auth-error-red`; 2 PASS, exit 0 em `beta-auth-error-green` |
| `vitest run --project browser`, Stage | 54 PASS, exit 0; `beta-final2-stage-browser`; avisos ResizeObserver preservados |
| `vitest run --config vitest.credential-editor.config.ts`, Stage | 6 PASS, exit 0; `beta-final2-credential-editor-browser` |
| `vitest run --maxWorkers 1 --no-file-parallelism`, lia-core legado | 368 PASS, exit 0; `beta-core-full-sequential` |
| `pnpm run test:shadow`, stage-ui-live2d | 5 PASS; contraprova SFC anterior 4 FAIL/1 PASS; typecheck do pacote exit 0 |
| Composable keyless + registro de porta, stage-ui | 5 PASS, exit 0; `beta-keyless-final-tests`. Transformação de teste do ramo anterior: 2 FAIL/2 PASS, sem alterar fonte em disco; `beta-keyless-counterproof` |
| `node --test "Tests/tools/*.test.mjs"`, raiz | 275 PASS, exit 0; `beta-final-root-tests`, incluindo 5 testes do comparador |
| `python -m unittest discover -s . -p "test_*.py" -t .`, tools | 498 descobertos: 488 executados PASS/10 skips, exit 0; `beta-python-tests`. Mensagens de contraprovas de spawn permanecem no log, não são resultado final da suíte |
| `moeru-lint <arquivos tocados>`, airi | exit 0; `beta-touched-lint-final`; erros iniciais de formatação corrigidos sem desativar regras |
| `moeru-lint` em `auth.ts` e `auth.test.ts`, airi | exit 0 em `beta-auth-lint-final` após corrigir dois avisos de estilo |
| `pnpm run typecheck`, Launcher/Stage/stage-pages | exit 0, três logs `beta-final2-*-types` |
| `pnpm run build`, Launcher/Stage, sequencial | exit 0, `beta-final2-*-build`; Launcher recompila Core |
| `corepack pnpm run typecheck` e `corepack pnpm run build`, Stage, após delta OIDC | exit 0 em ambos; `beta-resume-stage-types` e `beta-resume-stage-build` |
| Gate original Electron, PS5.1 / PS7, `-SkipBuild` após build atual | PASS Windows, exit 0 em ambos; `beta-electron-gate-ps51`/`ps7` |
| Mesmo gate, PS5.1 / PS7, após o novo build com delta OIDC | PASS Windows sintético, exit 0 em ambos; `beta-resume-gate-ps51` e `beta-resume-gate-ps7` |

Skips preservados. O Launcher pula a parte dos testes que precisa forçar
falha de escrita real no Windows. No Stage há guards para symlinks e um teste
externo de widgets que exige credencial. O Python contém casos condicionais
de plataforma, links, FIFO e sinais. Os skips não contam como PASS.

Gates de componentes: `J:/lia-evidence/6de84dd5-9406-4f7a-97dc-5cfa8cfa6db4/`
e `J:/lia-evidence/1f69ffbc-b890-47a6-a2c2-82b7bca6ae2b/`, com `report.json`
e `electron.log`, 16 grupos por rodada, sentinelas ausentes. Comando Stage:
`powershell.exe -NoProfile -File ./scripts/provider-runtime-electron/run-gate-windows.ps1
-SkipBuild -ExportRoot J:/lia-evidence -ElectronZip
C:/Users/lucas/AppData/Local/Temp/lia-electron-official-670c18ee-5d18-4b64-893c-ccfdbfa2c3d4.zip`,
depois equivalente com `pwsh.exe`. Runtime oficial 43.4.1, ZIP SHA-256
`c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a`.
A repetição com o delta OIDC preservou `report.json` e `electron.log` em
`J:/lia-evidence/5990954c-d418-450a-9c7a-ad57a826ee41/` (PS5.1) e
`J:/lia-evidence/f033d116-d013-4012-afcd-4b33b1904c2a/` (PS7).
Cada rodada aprovou 16 grupos e confirmou ausência das sentinelas no log.
O gate usa HTTP local sintético. Login OIDC externo, audição física e
instalador ficam fora do seu escopo.

`node --check` dos dois módulos novos do inventário e do roteiro Windows PASS;
testes do inventário: 3 PASS. Tentativa de moeru-lint nos arquivos fora de
`airi/` terminou em exit 2 por ausência de config ESLint na raiz. Não se criou
config global nem se declarou lint completo desses módulos. O lint dos
arquivos da aplicação tocados passou; warning de estilo no teste Node foi
corrigido. Coletor com PWS/GPU/roles repetido em PowerShell 5.1 e 7: exit 0,
sem presumir disponibilidade de todo contador numa janela de apenas três segundos.

## Próximas dependências para beta

### Pacote atual — integridade e fluxo

Wrapper completo `node airi/apps/lia-app/scripts/package-windows.mjs
--internal-test`: exit 0, `beta-package-full.{log,exit}`. Os outputs anteriores
foram renomeados para `dist/windows-before-beta-20261108-2130` e
`dist/lia-windows-before-beta-20261108-2130` nos respectivos apps, sem descarte.
Instalador atual: 787751357 bytes, SHA-256
`c8d949a4b67057d74410551b41c544e57faa3d3290c6e5cbedbdfa94ebaf8754`, NotSigned.
Baseline anterior: 787752487 bytes, SHA-256
`22428a3d232f4002041ec482835eaeaf9761968d4d18d4414a01fbc2bb9fce57`.
Comparar tamanho/hash não prova correção nem equivalência das funcionalidades.

1335 arquivos de `out/` Stage, 353441607 bytes, conferidos por SHA-256 contra
o ASAR incluído: todos iguais (`beta-stage-asar-build-match.json`). O inventário
novo (`beta-packaged-license-inventory-current.json`) encontrou 627 arquivos no
ASAR Launcher e 45397 no Stage, ainda 39/1039 manifestos e 27/789 notices.
Hashes ASAR Launcher `42346f5ade1489ebb0d881484139d8045afa0eb9456c9ebf48430ab3ed7983cd`
e Stage `1f83ecd330bf8d948df4f8b48e8bfd5bc91db4b36d59289607fe6e1d64a221f6`.
Resumo de licenças anterior permanece baseline, não foi sobrescrito.

`node Tests/windows/completion-runtime.mjs --packaged`: PASS Windows com
credencial sintética, exit 0, relatório
`J:/lia-evidence/completion-resume-runtime-1794184979920/report.json`.
Chat, memória opt-in/out, contexto de personalidade, Livre e parada passaram.
Parada observada com `lastExitCode:1`, conforme encerramento forçado atual;
não se declara exit 0 gracioso. Nenhum processo Lia/Stage permanecia depois.

Coleta atual concluída com as mesmas opções da baseline, `--packaged
--without-key --performance --soak-seconds=3600`, sem testes/builds concorrentes.
Root `completion-resume-runtime-1794185046337`; coleta longa
`20261109T004505610Z-beta-continuous-ui-local-fixture-c992f9e696054a268a1a627d87311336`.
O roteiro terminou em **PASS Windows com HTTP sintético sem chave**, exit 0.
Foram 720 amostras em 3600,77 s e 14 PIDs observados. Private Working Set médio
caiu de 1068,01 para 870,87 MiB e Private Bytes de 2485,18 para 1839,65 MiB.
CPU média subiu de 7,55% para 8,95%, a soma de WS aumentou e houve pico maior
de memória dedicada GPU. A comparação por processo e os limites metodológicos
estão no [relatório de desempenho](../architecture/LIA-BETA-PERFORMANCE-2026-11-08.md).

As capturas `01-home.png`, `03-stage.png` e `08-free-stage.png` estão em
`J:/lia-evidence/completion-resume-runtime-1794184979920/captures/`. Conferência
direta e revisão independente: Home com ação legível, Tamagotchi enquadrado
em retrato e Livre com cabelo e sapatos completos. Nas capturas, não se viu
contorno ciano ou sobreposição dos controles. Transparência nativa, foco,
input e DPI exigem outros ensaios. O agente visual atuou em leitura e não
produziu mudanças no checkout.

O pacote medido antecede a correção de erros do login OIDC desta retomada.
O novo delta no Main tem teste RED→GREEN, dois testes focados PASS e revisão
independente. A sessão legada que entrega tokens em sucesso continua aberta.

### Dependências abertas

1. Concluir execução Main dos consumidores legados e eliminar plaintext de
   configurações, broadcast, logs e retornos IPC, com migração não destrutiva.
2. Instrumentar frames, ocultação, pausa de render e jogo. Investigar picos de
   GPU e crescimento por processo antes de aprovar baixo consumo.
3. Gates externos/voz física e máquina limpa; tradução completa e presença.
4. Licenças/assets, assinatura e ciclo de distribuição testado.

| Critério de prontidão | Estado |
| --- | --- |
| Cofre preserva arquivos ilegíveis e recusa sobrescrita | PASS automatizado no caminho testado; concorrência com escritores legados entre processos em aberto |
| Credenciais fora dos consumidores Renderer alcançáveis | BLOCKED por rotas legadas da auditoria; correção pontual do erro OIDC verificada |
| Launcher → conversa → memória/personalidade → presença, pacote privado | PASS Windows com fixture sintética; capturas e relatório preservados |
| Coletas de uma hora e comparação por processo | PASS Windows para coleta; aprovação de baixo consumo em aberto por CPU, GPU e cenários ausentes |
| Direitos de redistribuição demonstrados para o pacote | BLOCKED por modelos, assets, notices e runtimes pendentes |
| Serviço externo autenticado | BLOCKED no ambiente verificado |
| Instalação limpa, atualização, desinstalação e voz física | NÃO EXECUTADO |

Classificação final da rodada: **Ainda bloqueada para beta**.
