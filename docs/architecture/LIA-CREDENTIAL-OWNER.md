# Credenciais: proprietário Main e acesso entre hosts

Retomada de 08/11/2026. Escopo: transportes Main-native de chat, síntese e
transcrição gravada. Não é aprovação de todos os consumidores legados.

## Problema observado

Launcher e Stage usam perfis Chromium distintos. O arquivo de cofre compartilhado
não torna seus ciphers `safeStorage` intercambiáveis. O Windows registrou falha
de decifragem no Stage para uma chave sintética gravada pelo Launcher. Não foram
copiados `Local State`, chaves criptográficas ou perfis ativos.

## Autoridade e canal

O Launcher mantém seu cipher original e cria uma lease antes de iniciar o Stage.
O perfil Chromium é escolhido explicitamente antes da trava de instância: usa
`@lia/lia-app` quando o perfil original já existe; numa instalação nova usa
`Lia/launcher-profile`. O nome do pacote não muda esse caminho. O Stage continua
com seu perfil separado no diretório de produto. O host recusa iniciar o Stage
se os dois caminhos apontarem para a mesma pasta, inclusive alias já existente.
Não há cópia de perfil. Isso evita que o nome empacotado `lia` selecione
acidentalmente o perfil ativo do Stage ou abandone o cipher anterior.

Um named pipe local aleatório aceita uma capability de 32 bytes, criada para
essa execução. O bootstrap vai no ambiente do processo Main; o Stage consome e
remove essas variáveis antes de criar renderers e serviços filhos. No modo de
desenvolvimento, a cadeia de lançamento Node/Vite também é código confiável;
no pacote, o Launcher abre diretamente o executável Stage.

O protocolo v1 tem um pedido por conexão, limite de 128 KiB por frame, oito
conexões simultâneas e deadline fixo de cinco segundos. Valida operação, escopo,
chave `apiKey`, tamanho e campos inesperados. Autentica com comparação constante.
Não aceita caminho, endpoint remoto, ciphertext ou exportação completa.

- `get`: o Launcher exige referência exata no repository de transportes, inclusive
  registros desabilitados necessários ao rollback de configuração. A execução
  continua exigindo registro habilitado no serviço Main que faz o HTTP.
- `set`/`delete`: ação explícita para um escopo válido de `apiKey`, equivalente ao
  escritor de segredo já existente no Main. Uma entrada sem transporte é inerte.
- Escritas do Launcher e do Stage gerenciado passam pela mesma fila no dono.
  Uma escrita ainda enfileirada revalida cancelamento antes de começar.
- Stop, saída, erro de startup e shutdown revogam a lease. Nova execução recebe
  outra capability. Conexões fechadas não recebem respostas tardias.

O segredo necessário cruza somente o canal Main→Main. A resolução assíncrona
não está ligada ao IPC de leitura do Renderer. As políticas que negam leitura
dos transportes migrados continuam ativas. Não há cache de chaves no cliente;
cada execução consulta o proprietário novamente.

## Compatibilidade e falhas

Novas gravações gerenciadas de `apiKey` usam o cipher do Launcher. Standalone
preserva o cofre original. Se o dono reportar especificamente ciphertext
ilegível, o Stage pode tentar ler a entrada com seu próprio cipher, preservando
entradas antigas gravadas por esse perfil. Essa leitura não migra nem regrava
a entrada. Desconexão, negação ou cancelamento não autorizam fallback.

Se nenhum dos perfis originais conseguir decifrar, o produto retorna erro fixo
de credencial e preserva o arquivo. Não existe recuperação mágica de um perfil
perdido; será necessária nova gravação explícita pelo usuário. Uma chave antiga
sem referência de transporte pode continuar exigindo essa recuperação explícita.

Não há proteção prometida contra malware executado com o mesmo usuário, leitura
de memória privilegiada ou comprometimento do Main. ACL do pipe não foi avaliada
como isolamento entre usuários. Consumidores legados que ainda pedem segredo no
Renderer continuam dívida de migração; este corte não os declara seguros.

## Evidência

Testes reais de pipe, ciphers distintos simulados, rotação, autenticação,
cancelamento, deadline e revogação em `lia/core/test/credential-owner-channel.test.ts`.
Teste do host verifica revogação de escrita enfileirada; sua contraprova sem a
guarda falhou. O primeiro cadastro de voz tem regressão para não ler uma chave
anterior inexistente. Resultados Windows, serviços e limites estão no
[relatório da rodada](../product/RELEASE-WINDOWS-2026-11-07-COMPLETION.md).
