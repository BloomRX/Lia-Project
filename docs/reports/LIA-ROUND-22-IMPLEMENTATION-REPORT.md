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
| SEC-04 e SEC-05 | Pendentes | Migração dos consumidores legados e vínculo persistente entre credencial e origem. |
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
