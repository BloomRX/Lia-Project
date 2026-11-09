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
frame time, impacto em jogos e energia não foram medidos. Não há vencedor de
engine nem meta arbitrária de memória. Pacote atual e comparação controlada
serão registrados somente após execução.

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
e [inventário físico](../licenses/PACKAGED-INVENTORY-2026-11-08.json) substituem
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
| `vitest run --project node`, Stage | 2356 PASS/4 skips, exit 0; `beta-final2-stage-tests`. Guarda aditiva posterior para alias local: 23 PASS em `beta-native-editor-alias-final`, sem alegar agregado posterior |
| `vitest run --project browser`, Stage | 54 PASS, exit 0; `beta-final2-stage-browser`; avisos ResizeObserver preservados |
| `vitest run --config vitest.credential-editor.config.ts`, Stage | 6 PASS, exit 0; `beta-final2-credential-editor-browser` |
| `vitest run --maxWorkers 1 --no-file-parallelism`, lia-core legado | 368 PASS, exit 0; `beta-core-full-sequential` |
| `pnpm run test:shadow`, stage-ui-live2d | 5 PASS; contraprova SFC anterior 4 FAIL/1 PASS; typecheck do pacote exit 0 |
| Composable keyless + registro de porta, stage-ui | 5 PASS, exit 0; `beta-keyless-final-tests`. Transformação de teste do ramo anterior: 2 FAIL/2 PASS, sem alterar fonte em disco; `beta-keyless-counterproof` |
| `node --test "Tests/tools/*.test.mjs"`, raiz | 270 PASS, exit 0; `beta-root-harness-tests` |
| `moeru-lint <arquivos tocados>`, airi | exit 0; `beta-touched-lint-final`; erros iniciais de formatação corrigidos sem desativar regras |
| `pnpm run typecheck`, Launcher/Stage/stage-pages | exit 0, três logs `beta-final2-*-types` |
| `pnpm run build`, Launcher/Stage, sequencial | exit 0, `beta-final2-*-build`; Launcher recompila Core |
| Gate original Electron, PS5.1 / PS7, `-SkipBuild` após build atual | PASS Windows, exit 0 em ambos; `beta-electron-gate-ps51`/`ps7` |

Gates de componentes: `J:/lia-evidence/6de84dd5-9406-4f7a-97dc-5cfa8cfa6db4/`
e `J:/lia-evidence/1f69ffbc-b890-47a6-a2c2-82b7bca6ae2b/`, com `report.json`
e `electron.log`, 16 grupos por rodada, sentinelas ausentes. Comando Stage:
`powershell.exe -NoProfile -File ./scripts/provider-runtime-electron/run-gate-windows.ps1
-SkipBuild -ExportRoot J:/lia-evidence -ElectronZip
C:/Users/lucas/AppData/Local/Temp/lia-electron-official-670c18ee-5d18-4b64-893c-ccfdbfa2c3d4.zip`,
depois equivalente com `pwsh.exe`. Runtime oficial 43.4.1, ZIP SHA-256
`c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a`.
Não cobre serviço externo, audição física ou instalador.

## Próximas dependências para beta

1. Concluir execução Main dos consumidores legados e eliminar plaintext de
   configurações, broadcast, logs e retornos IPC, com migração não destrutiva.
2. Fechar comparação de desempenho do pacote atual sem carga concorrente;
   instrumentar frames, ocultação/pausa e cenário de jogo antes de prometer leveza.
3. Gates externos/voz física e máquina limpa; tradução completa e presença.
4. Licenças/assets, assinatura e ciclo de distribuição testado.

Nenhum resultado unitário ou sintético desta rodada transforma a Lia em
**Candidata a beta** ou **Pronta para beta**.
