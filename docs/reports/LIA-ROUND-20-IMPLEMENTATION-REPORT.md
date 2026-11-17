# Lia — Rodada 20 no Windows

Base `3c2b132f9e5afea25b85bdf87428ed9c550b119f`, branch `arena/7fa837f0-lia-project`.
O checkout Principal estava limpo em `da3a150` e avançou por fast-forward
até a referência remota verificada. A coleta e os logs locais ficam em
`J:/lia-evidence/round20-3c2b132/`.

Na retomada o HEAD era `4f01d1b`, com sete commits desta rodada e
12 caminhos pendentes (oito rastreados e quatro novos). Índice vazio.
A contagem anterior de 34 arquivos era de um estado intermediário.
A árvore separada `audio-407300b` e suas alterações locais foram preservadas.

## Commits de código e testes

| Commit | Entrega |
| --- | --- |
| `2fabc39` | Revalidação de ferramentas no despacho, na execução e após substituição de registro. |
| `7ff636b` | Credenciais em HTTPS ou loopback HTTP, com regressão local de redirect. |
| `2301b44` | Fixtures Windows com named pipe e diagnósticos TypeScript da integração. |
| `8235fdf` | Guarda de janela/frame de STT e cancelamento na troca de documento. |
| `e448464` | Sanitização dos sinks de voz e regressões com canários. |
| `ec5622a` | OIDC-OFF padrão e regras de sessão e saldo. |
| `4f01d1b` | Verificação do observador no seu contexto após a introdução do Runtime independente. |
| `5216455` | Prévia nativa permitida em Configurações e cancelamento pelo frame proprietário. |
| `036e567` | Recuperação e créditos no líder, regressão de sincronização e OIDC-OFF sem preload. |
| `7373cbe` | Caminho relativo da captura Chromium no checkout ativo. |

## Resultado por atividade

| Item | Estado | Evidência e limite |
| --- | --- | --- |
| REC-01 | PASS para o lote novo, BLOCKED para os originais | Quatro WAVs em [manifesto](evidence/LIA-ROUND-20-WAV-INVENTORY.csv). Os diretórios históricos do beta e de RX 580 continuam ausentes. |
| P-2 | PENDING APPROVAL | Protocolo experimental abaixo. Nenhum limiar foi promovido a requisito. |
| P-1 / SEC-R-06 / T-06 | Implementado. Smoke e janela de rede do OFF passaram | Main rejeita login antes do PKCE. Preload recusa IPC OIDC e expõe somente um booleano. O Renderer limpa o estado legado e os controles de conta mostram indisponibilidade. A entrada definitiva do OIDC no produto segue pendente. |
| T-07 / SEC-04 | BLOCKED | O IPC ainda preserva a leitura condicional para provedores legados não curados. Falta migrar consumidores e demonstrar compatibilidade e recusa no Electron. |
| T-08 / SEC-05 | BLOCKED | O bloqueio de HTTP externo protege o transporte. A troca de origem HTTPS ainda exige vínculo persistido autorizado e migração segura das credenciais existentes. |
| SEC-R-01 | PASS automatizado | Revalidação depois da resolução, no despacho e antes de executar. Remoção e substituição invalidam objeto capturado. |
| SEC-R-02 | PASS automatizado e integração HTTP local | URLs efetivas com credencial exigem HTTPS ou loopback permitido. Redirect recusado. Escopo e destino HTTPS continuam pendentes em SEC-05. |
| SEC-R-03 / SEC-R-04 | Implementado no store compartilhado | Geração, refresh single-flight, descarte de respostas antigas e créditos com estado explícito. O caminho legado ativável continua sujeito à auditoria completa. |
| SEC-R-05 | Implementado | Logs de voz em caminhos de sucesso/erro usam estados e metadados permitidos. Canários cobrem descarte antes/depois do STT e erros. |
| STT-02/03/04/06/07/08 | Parcial / BLOCKED | O Main verifica o frame principal da janela Stage ou as rotas de preview STT na janela de configurações que ele criou. Quit ou troca do documento abortam trabalho pendente. Consentimento por destino, retenção, telemetria, revogação e vinculação da credencial a origem seguem pendentes. |
| G-AUD | BLOCKED | 0/15 critérios aceitos em conjunto. Coleta anterior prova L1/L2; L3–L9 seguem sem evidência elegível. |
| G-ARCH | Aberto | Named pipe e ciclo de vida com processos Node reais no Windows. Cofre cifrado passou no gate Electron local. Falta confirmar o ciclo completo Launcher/Stage no desktop e medir C0–C8. |

## Gates do beta

| Gate | Estado | Evidência desta rodada |
| --- | --- | --- |
| G-CONV | NOT RUN | O gate local de providers usa fixture. Faltam os turnos reais do plano. |
| G-HIST | NOT RUN | Testes de memória e regressões de UI não comprovam recuperação após reinício do Windows. |
| G-TOOLS | BLOCKED | SEC-R-01 passou nos testes focados. Falta o round-trip real de ferramenta no Stage. |
| G-STAGE | BLOCKED | Launcher e Stage abriram em ensaios separados. Falta o fluxo completo, avatar e contagem de órfãos no produto. |
| G-AUD | BLOCKED | Os WAVs avulsos estão verificados. Faltam síntese no app, captura e jornada de voz completa. |
| G-INST | NOT RUN | Sem novo ensaio de instalação, atualização e remoção NSIS. |
| G-SEC | BLOCKED | OIDC-OFF e a execução nativa têm evidência Windows. T-07/T-08 e autorização STT continuam abertos. |
| G-CI | BLOCKED | Build e testes pertinentes registrados. Falta a validação de build offline com hashes e do agregado de CI do plano. |
| G-PROC | BLOCKED | Matriz, artefatos selecionados e estado atualizados. O aceite completo no SHA congelado ainda falta. |
| G-ARCH | BLOCKED | Named pipes, cofre e abertura verificados em recortes. C0–C8 e ciclo desktop integrado pendentes. |

## Áudio e limiares

Os quatro arquivos são da coleta isolada Kokoro CPU no código de `407300b`,
documentada no commit local `9e94dce`. Cada WAV passou tamanho RIFF, leitura
integral, mono PCM16 a 24 kHz, duração acima de 0,5 s, RMS positivo e pico sem
clipping. Os hashes conferem com a coleta. O manifesto traz referência
relativa a `J:/lia-evidence/`, SHA, origem, camada, AV relacionado, backend,
formato e timestamps. Os binários ficaram no local original.

O [plano rev.2](LIA-BETA-READINESS-PLAN-2026-11-14.md) e a
[régua AV](LIA-AV-ACCEPTANCE-CRITERIA.md) registram as propostas originais.
AV-04 propõe **1,5 × duração + 2 s** para resposta STT remota e acerto de
palavras-chave em três frases pt-BR. O termo proporcional acompanha o
tamanho da amostra e a margem fixa cobre transporte e processamento inicial.
Sem coleta comparável da Groq, a fórmula pode reprovar por jitter de rede ou
aprovar uma série escolhida com frases curtas e fáceis. Medir do fim da
captura ao texto final visível, com duração real do áudio. Usar frases
fixas, repetir em sessões independentes, registrar rede, região, modelo,
mediana, p95 e falhas. Registrar a taxa de acerto separadamente da latência.

AV-07 propõe RTF **≤ 0,5**, calculado como tempo de síntese dividido pela
duração do áudio, após aquecimento. O objetivo é sintetizar mais rápido
que a duração falada com margem para enfileirar segmentos. O smoke isolado
observou RTF de 1,495 a 3,751. Misturar cold start com síntese aquecida pode
reprovar um fluxo estável, enquanto medir só uma frase sem carga pode ocultar
picos. Testar cinco frases fixas no Stage com dispositivo, engine, versão,
SHA e carga declarados. Registrar cold start à parte e repetir em repouso e
sob carga representativa. Medir também áudio válido e primeiro som audível.
Ambos os valores são **propostos**. Os resultados experimentais devem ser
revisados por Produto antes de qualquer limiar aprovado.

Os quinze casos preservam a [régua AV](LIA-AV-ACCEPTANCE-CRITERIA.md).
Nenhum áudio pessoal foi coletado ou enviado.

| AV | Estado | Evidência ainda necessária no SHA candidato |
| --- | --- | --- |
| AV-01 | BLOCKED | Permissão de áudio, recusa de vídeo e reabertura com hardware. |
| AV-02 | BLOCKED | Seleção e troca persistida de dispositivo físico. |
| AV-03 | BLOCKED | Fala e silêncio no VAD com microfone físico. |
| AV-04 | BLOCKED | STT real informado e consentido, credencial no perfil QA e P-2. |
| AV-05 | BLOCKED | Falha de STT autenticado e varredura de segredos no perfil do ensaio. |
| AV-06 | BLOCKED | Uma única mensagem por ditado e resposta real no Stage. |
| AV-07 | BLOCKED | Cinco sínteses aquecidas no app e limiar P-2. Os quatro WAVs são da síntese isolada. |
| AV-08 | NOT RUN | Reprodução audível, legenda e corte no dispositivo padrão. |
| AV-09 | NOT RUN | Induzir serviço offline, engine ausente e voz inexistente no app. |
| AV-10 | NOT RUN | Seleção persistida e aplicada no turno seguinte. |
| AV-11 | NOT RUN | Interromper síntese e playback, verificar a fila. |
| AV-12 | NOT RUN | Fechar durante fala e verificar tracks, worker e reabertura. |
| AV-13 | NOT RUN | Negar microfone e manter o chat textual funcional. |
| AV-14 | NOT RUN | Observar a UI durante preparo, ausência e erro de engine. |
| AV-15 | NOT RUN | Inspecionar persistência, diagnóstico e dados do perfil após ensaio. |

## OIDC e integração seletiva

O Stage usa `VITE_LIA_ENABLE_OIDC=1` somente para opt-in explícito no build de
desenvolvimento. A política é imutável no processo em execução. Reiniciar com
outro build aplica a política nova. O OFF remove chaves de sessão do storage
legado do Renderer, mantendo o cofre de credenciais de provedores independente.
O build desktop trata a ausência da capacidade do preload como OFF. Nos
outros runtimes, a ausência mantém o fluxo existente. Em perfil isolado
no Electron, cinco slots sintéticos desapareceram no reload, o IPC OIDC
foi recusado e os contadores de Monitor de sessão Electron e requisições
do Renderer registraram zero acessos a `/api/auth/` durante 600.000 ms.
O processo saiu com código 0. O teste não usou emissor externo autenticado.

REC-01 e SEC-R-01 a SEC-R-06 foram tratados seletivamente. L-02 e as demais
mudanças de UI da Fase 1 ficam fora desta ordem. O catálogo e a pesquisa de
modelos continuam como referência. O contrato de voz permanece independente
do engine selecionado, com STT e TTS separados.

## Validação

- Windows / Node 24.22.2. Dependências instaladas previamente, lockfile preservado.
- `vitest run` focado em tool-resolver, llm e tools (59 PASS) e llm-service (28 PASS).
- `vitest run` no Launcher (358 PASS, 2 SKIP), incluindo Runtime Discovery e Stage Manager.
- `vitest run --project node` em autenticação, preload, conta, controles e STT do Stage (46 PASS).
- Reteste focado em navegação STT, preload e memória (37 PASS). O cenário
  de troca de documento abortou a requisição e removeu o listener.
- Vitest em autenticação do Stage UI, fetch, catálogo oficial e streaming (35 PASS).
  Os testes de streaming usam WebSocket local com dados sintéticos.
- Fatia de privacidade STT com 62 PASS no Stage UI, 2 PASS no Chromium e
  160 PASS focados no Stage, em
  `J:/lia-evidence/workspace-principal/round20-stt/`.
- `node --experimental-strip-types --test "test/*.test.ts"` no Core (156 PASS). A primeira rodada
  do recorte Runtime tinha falhas/cancelamentos por fixtures POSIX no Windows.
  O ajuste usa o resolvedor canônico de endpoint e as suítes incluem named
  pipes, rejeição de cliente incorreto, parada e dois processos reais.
- Builds dos pacotes, do Launcher e do Stage passaram. Typecheck do Stage
  passou após o build do Core e a correção de três diagnósticos de tipagem.
  Typecheck do Stage UI e Core e lint direcionado dos arquivos alterados
  passaram.
- Launcher Windows, `launcher-clean-cycle.mjs`: duas aberturas em perfil
  isolado, Home visível com uma janela e saída cooperativa com código 0
  em ambas. Esse ensaio não acionou o Stage nem mediu o custo C0.
- Electron Windows 43.4.1, `node --test scripts/provider-runtime-electron/gate.test.mjs`:
  PASS de IPC de produção, cofre cifrado e transporte nativo com servidor
  HTTP local no SHA de código `7373cbe2f7adbb024bbdf24e2d4d0f7300e7269f`.
  A varredura do log passou e os 11 processos acompanhados encerraram.
  `report.json` e `electron.log` em
  `Tests/artifacts/provider-runtime-electron/1794880871500/`.
- Smoke Electron do OIDC-OFF no Stage standalone: capacidade desligada
  após reabrir, tentativa de IPC rejeitada, 5/5 slots sintéticos apagados
  e saída do processo com código 0. A primeira janela de observação foi
  153 ms após reload, com zero requisições observadas para `/api/auth/`.
  Evidência em `oidc-electron-smoke.json`. Isto é um recorte do aceite
  de OIDC-OFF, sem validação do modo ligado no emissor real.
- Agregado do Stage Node, `vitest run --project node`: FAIL/incompleto.
  A execução marcou uma falha em `lia-brain-lifecycle`, registrou
  `ECONNREFUSED` em loopback:3000 e ficou sem emitir resumo. Encerrei só
  essa árvore de QA após verificar o processo. A asserção do observador
  rejeitava a palavra `status` fora do seu escopo e já colidia com o
  callback de status do Runtime em `3c2b132`. O teste isolado passou
  10/10 após distinguir os dois contextos. A causa da falta de resumo do
  agregado ficou em aberto.
- Reexecução do agregado Node com `--reporter verbose`: 204 arquivos,
  2.500 PASS e 4 SKIP, antes dos ajustes da revisão final.
- Reteste da revisão: Stage Node focado 54 PASS, Stage UI autenticação
  40 PASS e sincronização Pinia em Chromium 1 PASS com duas instâncias.
- Stage Chromium: 54 PASS em nove arquivos com
  `vitest run --project browser --no-file-parallelism`.
  Execuções anteriores falharam no caminho absoluto de duas imagens de QA
  e por timeout do teste de credencial STT no agregado. O caminho de QA
  passou a ser relativo ao checkout. A execução sequencial passou com o
  timeout existente. O timeout paralelo permanece documentado.
- OIDC-OFF em Electron Windows, `oidc-electron-10m.mjs`: 600.000 ms,
  zero requisições OIDC nos dois contadores, cinco slots apagados, recusa
  do IPC e saída 0. [Evidência sanitizada](evidence/LIA-ROUND-20-OIDC-WINDOWS.json).
  Arquivo local `oidc-electron-10m.json`. Esse
  intervalo completo antecede os ajustes da revisão final.
- A repetição do smoke após integrar a política de preload, no SHA
  `7373cbe`, conferiu
  novamente a capacidade OFF, recusa de IPC, cinco slots apagados,
  zero requisições observadas no recorte de 234 ms e saída 0.

## Revisão independente

A revisão identificou três problemas. A guarda IPC inicial também
bloqueava o preview nativo pela janela Configurações. A autorização agora
reconhece essa janela e somente suas rotas de audição e previews de
provedores nativos. No opt-in OIDC, o caminho de recuperação de HTTP 401
misturava o refresh executado no líder e uma decisão local de limpar a
sessão. As ações de recuperação e relogin agora rodam no líder com
geração e revisão numérica do bearer. A ausência de capacidade do preload
e botões sem efeito em OFF foram tratados. O opt-in e a migração do owner
Main continuam sem aceite de release. A revisão identificou também o
efeito de snapshots completos do plugin Pinia no opt-in. Créditos agora
são atualizados por ação do líder e o watcher não publica resets de saldo
de seguidores. A via legada ainda sincroniza estado de sessão e conserva
escritas diretas de UI, que serão removidas no corte de ownership do Main.

## Segurança residual e próximo corte

O próximo corte de T-07 precisa inventariar os escopos restantes, migrar
cada consumidor necessário ao Main e comprovar que o IPC de leitura não
devolve o segredo sob perfis legados. Para T-08, a autoridade do vault
precisa vincular a credencial à origem no provisionamento, rejeitar
alterações sem reautorização e tratar registros antigos sem atribuir
confiança retroativa a uma URL mutável. A validação deve incluir chat,
speech e STT, mutação concorrente e reinício. L-02 segue bloqueado.

O guard do Main STT cobre a janela principal, o frame e a vida do
documento. Após sair de uma rota de preview, a janela ainda pode cancelar
o próprio pedido pelo frame que o iniciou. A autorização de uma janela
ainda não prova consentimento da
pessoa para enviar áudio a um terceiro. O controle de mídia continua
separado da política de transmissão e os sinks de analytics e suporte
precisam de validação no empacotado.

**Beta interno ainda bloqueado.** Decisões necessárias antes de liberar captura
remota incluem finalidade e destino, duração do consentimento, retenção e a
diferença entre finalizar uma gravação e revogar autorização. Depois, validar
perfil Windows isolado, dados residuais e o fluxo de 15 critérios no mesmo SHA.
