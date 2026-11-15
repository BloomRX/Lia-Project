# Prévia de voz por transporte nativo

O Corte B foi consolidado em `13cbb52`. A validação Windows dessa entrega
continua no [relatório do Corte B](LIA-NATIVE-PROVIDER-COVERAGE.md#18-prompt-31--integração-e-validação-no-windows).
Este corte migra a prévia de duas definições existentes que usam `audio/speech`.

## Fluxo e autoridade

O painel Voz e a prévia dos perfis chamam `createVoicePreviewDriver`. A seleção
de provedor, modelo e voz vem de `voice.tts` e do editor. Para
`openai-audio-speech` e `openai-compatible-audio-speech`, o driver usa a porta
de execução já empregada pelo chat. Um endpoint legado salvo pode ser importado
como metadado sem chave. O registro persistido vence. Se o endereço legado
mudar após a importação, a prévia para para evitar envio ao destino antigo.
Um registro removido ou desabilitado não é reativado pela prévia.

O Main consulta o mesmo repositório de transportes e o mesmo cofre. O contrato
`audio-speech` distingue síntese de chat e descoberta. O Main vincula o
protocolo aos dois IDs suportados, e recusa chat com esses IDs mesmo que um
registro seja reclassificado. A requisição IPC envia
texto, modelo, voz e uma conferência opcional do endereço salvo. O Main rejeita
credenciais e rascunhos nesse IPC. O destino vem do registro, com HTTPS para
serviços remotos e HTTP permitido em loopback. Redirecionamentos são recusados.
Os escopos das duas definições têm leitura direta negada, inclusive antes de
criar o registro. A chave precisa estar previamente no cofre do escopo exato.

A operação reutiliza o dono da janela, cancelamento, invalidação, prazo de
30 segundos e leitura em blocos do executor atual. O Main limita o áudio a
8 MiB e exige `audio/*`. Falhas usam a classificação segura do transporte.
O Renderer decodifica e reproduz os bytes com o driver já usado pela prévia.

## Mapa da voz e dependências

| Família encontrada no registro compartilhado | Execução e situação |
| --- | --- |
| Duas definições de áudio compatíveis com `audio/speech` | Prévia Lia pelo Main quando o endpoint está salvo e a chave está no cofre. |
| Kokoro local, VoiceVox, IndexTTS, áudio local e voz personalizada | Seguem pelo pipeline existente. Dependem do motor/configuração selecionados. O driver local e o caso Kokoro foram preservados. |
| ElevenLabs, MiniMax, Gemini, MiMo, Comet, OpenRouter e variantes Unspeech | Protocolos, autenticação ou formatos próprios. Permanecem no catálogo compartilhado e fora da execução nativa deste corte. |
| Serviços oficiais AIRI, Player2, áudio de navegador e speech-noop | Dependem de sessão, plataforma ou adapter próprios. O registro de uma definição não prova disponibilidade no Stage distribuído. |

`Stage.vue` ainda cria o cliente por `providersStore.getProviderInstance` e
chama `speechStore.speech` na fala automática. Catálogo, seleção de modelos e
vozes, fachadas de configuração, motor local, avatar e pipeline de reprodução
do Stage continuam ligados ao AIRI. O corte moveu o contrato de transporte
para `lia/core` e retirou a construção do cliente AIRI do caminho compatível
da prévia. Nenhuma dependência de pacote foi removida.

## Auditoria dirigida de credenciais

| Classificação | Evidência e consequência |
| --- | --- |
| Main legítimo | O executor de transportes e a transcrição usam a referência de escopo do registro. `secrets-service.ts` valida operações do cofre. |
| Renderer com metadados | Prévia nativa e chat migrado usam os canais de execução; os bytes e estados retornados não incluem a credencial do cofre. Escrita explícita de credencial continua no canal de escrita já existente. |
| Renderer com credencial legada | O resolver em `stores/lia/provider.ts` ainda consulta `secretGet` para chat fora do catálogo e STT não migrado. O store AIRI monta o cliente no Renderer a partir do resultado. Fechar esses escopos exige migrar os consumidores. |
| Configuração legada | `withResolvedCredential` no store AIRI mantém o payload de configuração quando o resolver não retorna valor. Uma cópia histórica com `apiKey` continua um risco distinto do getter. A migração existente de chat usa `adopt` e limpeza condicionada; a prévia deste corte importa somente endereço. |
| Fora do caminho de produção auditado | Os launchers do gate e seus exports são evidência local. Web e pocket têm políticas próprias e não foram alterados. |
| Teste ou fixture | A matriz de provedores e a prévia usam credenciais sintéticas em perfil isolado. |

A busca incluiu IPC do cofre, leitores no Stage, build dos providers,
configuração compartilhada, requisições e referências a variáveis de ambiente
no app. A inspeção não constitui inventário completo de dependências transitivas
ou de todos os caminhos de autenticação do AIRI. A próxima correção independente
é a configuração de voz avançada com destino e chave no Main, incluindo
migração segura de valores legados e tratamento explícito de conflitos.

## Evidência

- Núcleo Lia: 77 testes aprovados. Stage: 118 testes focados em sete arquivos,
  cobrindo transcrição, transportes, escopos, prévia e compatibilidade local.
- Harness: 143 testes aprovados. Lint do harness, Core e fontes Stage, typechecks
  Stage e harness, build completo e `git diff --check` passaram. O lint Stage
  manteve quatro avisos preexistentes do executor.
- Gate Windows Electron 43.4.1: 16/16 grupos em PowerShell 7.6.9 e 5.1.
  Cada execução observou 40 requisições, incluindo uma síntese autenticada,
  11 identidades encerradas e zero skips. Os quatro artefatos por pacote
  conferem com o manifesto e não contêm credenciais sintéticas detectáveis.
  PowerShell 7 compilou o Stage e 5.1 reutilizou o preload.
- PowerShell 7: `J:\lia-evidence\87402a19-021e-410f-8321-a3f125fc55a6`.
  PowerShell 5.1: `J:\lia-evidence\a9083821-14ce-4b6d-8959-8ee038d4c58a`.

Após reforçar o vínculo entre protocolo e escopo, os 118 testes focados passaram
novamente e o gate repetido em PowerShell 7 confirmou 16/16 grupos. Pacote final:
`J:/lia-evidence/d4d4475e-2edc-4bbd-973f-c7d700dbda7b`.

O gate real prova o transporte de áudio, e a reprodução da prévia foi exercitada
com um `AudioContext` simulado. Escuta em hardware, serviços externos, criação
de configuração de voz do zero, descoberta de catálogo de voz remoto e fala
automática não foram aprovadas. O próximo corte de UI deve manter endereço e
chave na seção avançada de Voz, com seleção e prévia no fluxo documentado.

## Configuração no painel Voz

O painel reutiliza seu seletor de provedor e opções avançadas. Para os dois
adaptadores nativos, exibe endereço, campo de senha, status de configuração,
salvamento e **Testar e ouvir**. O catálogo existente continua disponível
quando o adapter o fornece. Onde o catálogo não existe, o usuário informa
modelo e voz. A prévia principal usa a seleção persistida e fica indisponível
enquanto faltarem os dados. Teste e prévia têm cancelamento e não sobrepõem
reprodução entre si.

Main valida o destino e escopo, serializa a escrita com o cofre existente e usa
a revisão do repositório para impedir atualização desatualizada. Falha no
transporte tenta restaurar a chave anterior. O endpoint só é ativado após
validar os dados e guardar a credencial quando fornecida. O executor consulta
chave e registro sob a mesma fila para evitar combinar chave nova com endereço
antigo durante o salvamento. Chave em branco mantém a anterior. A resposta
expõe somente endpoint, revisão e presença. O formulário limpa a senha após
enviar. Salvar verifica formato e persistência. Testar faz a requisição e toca
a amostra, com feedback de erro, cancelamento e timeout.

Validação: 91 testes Node do Stage, 8 Chromium, typecheck Stage/harness, lint,
build i18n e Stage. Gate Electron com as chamadas reais de salvar, consultar e
sintetizar no grupo 4, 16/16 grupos nas duas versões. Pacotes em
`J:/lia-evidence/ebe6937e-61ff-4354-8d28-e3ac5ec2f01f` (5.1) e
`J:/lia-evidence/639596bd-cc10-4c18-9ea6-0f1f308f3588` (7).
Captura do formulário pt-BR revisada em
`J:/lia-evidence/voice-ui/captures/voice-connection-pt-BR.png`.

Validação manual Windows ainda necessária: configurar um serviço autorizado,
salvar, reabrir e verificar senha vazia, selecionar modelo e voz, ouvir uma
prévia, interromper, trocar de provedor e observar falha de autenticação e
timeout. A reprodução física e um serviço externo ficaram fora do gate local.

## Fala automática no Stage

O texto da resposta chega à sessão de fala criada em `onBeforeMessageComposed`.
Para adapters HTTP, o segmentador produz pedidos para `stageSynthesizeSegment`
e a fila aplica a política de fallback por turno. O Stage normaliza o texto,
usa provedor, modelo e ID de voz projetados pela seleção `voice.tts`, decodifica
o áudio e entrega o buffer ao gerenciador de reprodução e sincronização labial.
O cancelamento da sessão anterior e o sinal da fila continuam controlando cada
pedido. Mudanças da seleção persistida também encerram a sessão e a reprodução.
A comparação usa a seleção da Lia para não confundir fallback temporário com
uma troca feita pelo usuário.

O Stage agora recebe uma função opcional do host. A página desktop Lia injeta
`createNativeSpeechSynthesis`, também usada na prévia. Para as duas definições
compatíveis, o branch nativo roda antes da criação do cliente AIRI e passa o
sinal do turno ao executor Main. Segmentos vazios terminam sem IPC. O Main
continua resolvendo endpoint e chave. Seleção de modelo e voz chega ao Main
como campos validados do pedido. Os motores locais, adapters de streaming,
fila, decodificação, playback e fallback continuam nos componentes existentes.
Web e pocket não recebem a função do host desktop. Nenhuma dependência de
pacote foi removida.

Resultados: 97 testes focados do Stage, 20 testes das suítes de pipeline e
sessão TTS do Stage UI, 143 do harness, lint, typechecks e build completo.
Electron 43.4.1: 16/16 grupos em cada versão, 40 requisições e 11 identidades
encerradas em cada execução. O gate exercita a função usada pelo Stage com
IPC, cofre e HTTP local. O teste não abre a cena completa do personagem.
Exportações verificadas por SHA-256 em
`J:/lia-evidence/51ec21e7-7409-4fb0-bc65-9a632bb83432` (7) e
`J:/lia-evidence/c26c6867-7d94-412b-bd07-b82fdd3d5258` (5.1, inclui o ajuste
final para segmentos vazios).

### Transcrição e credenciais restantes

O bloco abaixo registra o estado no corte `e152900`. A transcrição gravada,
seu cancelamento e a edição nativa de credenciais foram ampliados no corte
seguinte: [arquitetura, matriz atual e roteiro](LIA-NATIVE-TRANSCRIPTION.md).
Os protocolos de sessão e leitores legados identificados nessa matriz
continuam pendentes; não há alegação de segurança global do Renderer.

A rota de gravação padrão derivada de Groq já vai ao Main. O adaptador
`RecordingTranscriptionExecution` de gravações ainda não recebe o sinal do
ciclo da captura. O timeout existe no Main, mas fechar ou trocar a captura
não cancela esse trabalho por IPC. Adaptadores de transcrição que usam
streaming e os motores locais têm ciclos separados no store de audição.
O próximo corte precisa propagar cancelamento do chamador até o transporte e
definir o registro de endpoint dos adapters HTTP adicionais antes de negar
suas leituras legadas. Chat fora do catálogo e STT legado continuam no inventário
acima, junto das cópias históricas. Esta rodada não ampliou o catálogo migrado.

Para a validação manual, use um serviço autorizado e siga o roteiro da seção
anterior. Depois envie uma mensagem que provoque fala, envie outra durante a
reprodução e confirme que a anterior para. Repita ao trocar de voz e ao usar
um motor local. Teste autenticação inválida e timeout separadamente. Registre
o resultado ouvido e o dispositivo, sem incluir a chave ou o texto privado.
