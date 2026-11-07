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
