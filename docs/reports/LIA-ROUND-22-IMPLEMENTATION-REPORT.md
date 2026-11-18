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
| SEC-05 no chat e STT | Pendente | Falta vínculo persistente entre credencial e origem nesses transportes. |
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
