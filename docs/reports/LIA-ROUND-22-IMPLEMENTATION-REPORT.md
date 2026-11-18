# Lia — Rodada 22

| Verificação | Estado | Evidência |
| --- | --- | --- |
| OIDC desligado no Stage | PASS automatizado | Flag antiga não habilita o bridge nem a persistência no Renderer desktop. |
| OIDC pelo owner do Main | PASS focado | PKCE com owner simulado valida o sucesso sem payload. O owner de sessão também passou sua suíte própria. |
| OIDC integrado aos serviços do Stage | BLOCKED | Conta, HTTP e streaming ainda precisam dos adaptadores Main ligados ao ciclo de vida do Stage. O preload continua anunciando OFF. |
| OIDC com emissor externo | NOT RUN | Nenhum login em emissor externo executado. |
| Consentimento STT nativo | PASS focado | Aceite por gravação antes de acesso ao cofre. Recusa, cancelamento tardio, mudança de configuração e perda da autorização da janela bloqueiam envio. |
| STT em loopback | PASS Windows | Gate Electron de providers com IPC, cofre e serviço HTTP local. Artefatos em `Tests/artifacts/provider-runtime-electron/1794960227815/`. |
| Alternativas de STT no Renderer desktop | PASS focado | Sem executor de gravação registrado no Main, o Stage recusa a transcrição. Web Speech e streaming legado ficam indisponíveis também nas prévias e no DevTools Aliyun. O transporte Apple Speech exclusivo de macOS ficou fora da validação Windows. |
| SEC-04 | Pendente | Migração dos consumidores legados. |
| SEC-05 no TTS HTTP nativo do Stage | PASS Windows | Electron 43.4.1, serviço HTTP em loopback e credenciais sintéticas. |
| SEC-05 no chat e STT com chave compartilhada | Pendente | Falta vincular as credenciais usadas por chat e pelo STT derivado da configuração de chat. |
| SEC-05 nos adaptadores dedicados de gravação | PASS Windows | Electron com HTTP em loopback e chaves sintéticas. O diálogo remoto ainda é NOT RUN. |
| G-AUD | BLOCKED | O ensaio físico e a prova de consentimento para todos os caminhos ainda faltam. |
| G-ARCH | NOT RUN | C0–C8 aguardam execução no Windows com o build integrado. |

O STT nativo usa um diálogo da janela Electron para cada envio remoto. A
tela informa o provedor, a URL efetiva e que o áudio sairá do computador.
Cancelar é a ação padrão. Cancelar após o início do upload interrompe a
operação local e a espera pela resposta. Bytes já recebidos pelo serviço
permanecem sujeitos à política do destinatário. O Main resolve o destino
com base na configuração persistida e rejeita redirecionamentos.

No Windows, o corte de OIDC passou em 30 testes focados do Stage,
24 do Stage UI, 156 do Core e 358 do Launcher com 2 skips.
O corte STT passou em 102 testes focados e no gate Electron local.
O ensaio do diálogo com provedor remoto é NOT RUN.

Após fechar os caminhos alternativos, passaram 30 testes focados do
Stage UI e 66 do Stage no Windows. Os testes comprovam que o bloqueio
ocorre antes de construir o reconhecedor, consumir o stream ou invocar
o cliente de rede. O executor de gravação local permanece selecionável
pelo mesmo contrato do Main.
Lint, typecheck do Stage e build de produção passaram. O gate Electron
com HTTP em loopback passou novamente, com artefatos em
`Tests/artifacts/provider-runtime-electron/1794960626907/`.

### Vínculo de origem no TTS HTTP nativo do Stage

O Main grava a chave no slot cifrado existente junto à origem HTTP
(protocolo, host e porta) e ao escopo do provedor. A execução exige que
ambos correspondam à configuração. Uma chave legada permanece preservada
e precisa ser informada novamente na tela de conexão. A reutilização da
chave já vinculada é permitida ao alterar apenas o caminho na mesma origem.
Set e Adopt genéricos recusam os slots dos dois provedores de síntese.

- **PASS automatizado** em 94 testes focados do Stage e typecheck do Stage.
- **PASS Windows** em 16 grupos do gate Electron com serviço local. Confirma
  síntese com chave sintética, recusa de troca de origem sem nova chave e
  recusa de leitura de configuração de voz pela segunda janela. O relatório
  registrou ausência das sentinelas de chave nos logs. Artefatos em
  `Tests/artifacts/provider-runtime-electron/1794960965814/`.
- **PASS** no lint das alterações em TypeScript e YAML. O lint abrangendo o
  script `gate.test.mjs` registrou **FAIL** por sete ocorrências já presentes
  na base, incluindo imports exigidos pelo runner Node.
- **NOT RUN** em serviço externo. G-AUD e G-ARCH continuam abertos.

### Regressão ampliada no Windows

Windows 11 Home build 26200, Ryzen 5 5500 e Radeon RX 580 2048SP
com driver 31.0.21925.1001. Build testado a partir de `ad718b3`.

| Comando | Resultado |
| --- | --- |
| `corepack pnpm test` em `lia/core` | PASS, 156 testes. |
| `../../node_modules/.bin/vitest run` no Launcher | PASS, 358 testes e 2 skips. |
| `corepack pnpm run build` no Stage | PASS, build de produção. |
| `../../node_modules/.bin/vitest run` no Stage | FAIL inicial, 2 falhas, 2.573 passaram e 4 skips. |
| Vitest Node com `brain-correlation-observer` e `transcription-service` | PASS, 89 testes após o ajuste na composição do diálogo STT. |
| Vitest Node com `voice-preview-credentials.probe` | PASS, 10 testes após atualizar a credencial sintética para o formato vinculado. |
| Vitest Chromium com `VoiceSection`, `SttCredential` e `native-provider-runtime` | PASS, 11 testes em 3 arquivos. |
| Vitest `run --project node` no Stage | PASS, 2.521 testes e 4 skips, 206 arquivos. |
| Vitest `run --project browser` no Stage | PASS, 54 testes, 9 arquivos. |
| `corepack pnpm run typecheck` no Stage e lint dos dois ajustes | PASS. |

As duas falhas iniciais tiveram correções pontuais. O nome do parâmetro
do diálogo STT acionava uma verificação estática sobre a composição do
observador de diagnóstico. A fixture de prévia devolvia um slot secreto
legado, que a síntese agora recusa. O teste continua exigindo que a chave
seja lida apenas no Main e que o áudio chegue à prévia.

Os logs registraram erros `ResizeObserver` no Chromium e recusas de
conexão em loopback na porta 3000. A coleta desses sintomas não determina
sua causa. Logs em `J:/lia-evidence/round22-stt/`. Os artefatos do pnpm
gerados no diretório do Core durante o teste foram preservados nessa
pasta de evidências, fora do checkout.

O protocolo para G-ARCH permanece em
`docs/architecture/decisions/BENCHMARK-C0-C8-windows.md`. Nenhuma medição
C0–C8 foi coletada nesta regressão. O G-AUD ainda exige captura e
reprodução no dispositivo físico e os critérios AV no mesmo SHA.

### Vínculo de origem na transcrição dedicada de gravações

O IPC de configuração recebe o identificador, a revisão e o endereço
esperados, mais a chave digitada. O Main só aceita a gravação quando a
janela é autorizada e o registro persistido corresponde à revisão e ao
endereço. O Main deriva a origem do registro e grava o vínculo no slot
cifrado. A revisão do slot protege contra exclusão ou substituição
concorrente no cofre compartilhado. Um transporte local sem chave segue
disponível. Chaves antigas permanecem no cofre até serem substituídas e
precisam ser informadas novamente para uso nos adaptadores dedicados.

A execução compara origem, escopo e finalidade antes de enviar o áudio.
Um identificador reaproveitado também precisa da finalidade de gravação.
As entradas vinculadas no corte anterior de TTS seguem compatíveis. Alterar
somente o caminho preserva o vínculo. O IPC genérico não aceita nem
devolve o formato vinculado. Os consumidores de chat que ainda usam
chaves antigas também recusam esse formato, inclusive no Launcher.

O gate Electron com serviço local verificou recusa de chave antiga, de
revisão e endereço divergentes e de acesso pela segunda janela. Após
trocar a origem, a fixture confirmou ausência de requisição. O retorno à
origem original manteve a transcrição e o cancelamento em HTTP. As
configurações e os logs não expuseram a chave sintética. O roteiro físico
de consentimento está em `docs/architecture/LIA-NATIVE-TRANSCRIPTION.md`.

| Validação deste corte | Resultado |
| --- | --- |
| `node --experimental-strip-types --test 'test/*.test.ts'` em `lia/core` | **PASS**, 156 testes. A execução inicial detectou o subpath ausente do manifesto, registrado antes da repetição. |
| `vitest run` no Launcher | **PASS**, 359 testes e 2 skips. Após o ajuste de finalidade, a suíte focada de conexão passou nos 33 casos. |
| `vitest run` no Stage | **FAIL inicial**, 2.578 passaram, 1 falhou e 4 skips. O arquivo movido durante a execução foi aberto pelo caminho anterior. A checagem isolada passou em 13 casos. |
| Repetição do `vitest run` no Stage | **PASS**, 2.580 testes e 4 skips em 215 arquivos. Iniciada antes dos últimos ajustes de finalidade. |
| Vitest focado após o ajuste de finalidade | **PASS**, 197 testes em 7 arquivos, incluindo chave de TTS antiga e tentativa de reutilizar TTS em gravação. |
| Build do Stage e do Launcher, typecheck dos dois aplicativos | **PASS**. |
| Lint dos arquivos TypeScript em `airi/` | **PASS**. O script do runner Node mantém as ocorrências preexistentes registradas acima. |
| `node --test scripts/provider-runtime-electron/gate.test.mjs` no Stage | **PASS Windows**, Electron 43.4.1, 16 grupos. `Tests/artifacts/provider-runtime-electron/1794962987405/report.json` e `electron.log`. |

Logs adicionais em `J:/lia-evidence/round22-stt/`, com prefixo
`stt-binding-`. O ensaio físico G-AUD, o serviço de transcrição remoto
e a validação de destino do STT que usa a chave de chat seguem **NOT RUN**.

### Próximo corte de credenciais

O Stage ainda prepara credenciais de chat em duas etapas, gravando a
chave e persistindo o registro em chamadas separadas. O
Launcher também configura credenciais de chat pelo próprio serviço.
O próximo corte deve coordenar a escrita do slot e do destino no Main
antes de exigir o vínculo ao usar as chaves, contemplando os dois
escritores e o STT derivado da configuração de chat. A compatibilidade
com serviço local sem chave continua sendo um caso de regressão.
