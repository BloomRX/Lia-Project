# `lia/` — código próprio da Lia

Este diretório é a Lia **fora** do AIRI. Ele fica ao lado de `airi/`, nunca
dentro, e **nunca** entra em `airi/pnpm-workspace.yaml`.

```
lia/
├── assets/     ícones e imagem da marca (já existiam)
├── core/       @lia/contracts — contratos, zero dependências
├── desktop/    Launcher Electron, com lockfile próprio
├── launcher/   decisão e fronteira do Launcher
├── runtime/    @lia/core — produto, cofre, voz e roteamento
├── stage/      o Stage da Lia (janela + ciclo de vida)
└── shared/     (reservado, ainda vazio)
```

---

## `lia/runtime` — `@lia/core`

Com `lia/core` também presente na árvore, execute em `lia/runtime`:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
```

O workspace legado registra esse mesmo pacote para o Launcher e o Stage.

## `lia/desktop` — Launcher Electron

Execute em `lia/desktop`:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
```

`corepack pnpm run dev` prepara o Electron e abre o Launcher. O
botão **Conversar com Lia** ainda abre o Stage legado, que exige o
workspace em `airi/`. A janela do Launcher e seu build não precisam
desse workspace.

## Por que ao lado e não dentro

`airi/` é uma cópia do upstream `moeru-ai/airi` em `2c1e223` com 353 arquivos da
Lia injetados. Qualquer coisa dentro de `airi/` é sobrescrevível por um
`subtree pull`. `lia/` não é: o AIRI não sabe que ele existe.

E não entra no workspace pnpm do AIRI por um motivo concreto — se entrasse,
`@lia/contracts` passaria a depender do catálogo e do `pnpm install` do AIRI.
Ela perde a única propriedade que a torna útil: **rodar sem instalar nada**.

---

## `lia/core` — `@lia/contracts`

| Módulo | Conteúdo |
| --- | --- |
| `src/lifecycle.ts` | fases do Stage, tabela de transições legais, histórico, `snapshot()` |
| `src/protocol.ts` | envelope, versão, `negotiate()`, `parseEnvelope()` que nunca lança |

Sem dependências, sem build, sem transpilador. Usa `node --test` e o
`--experimental-strip-types` do Node 22.

```bash
cd lia/core && node --experimental-strip-types --test "test/*.test.ts"
# 154 testes de contratos e runtime
```

O pacote roda sozinho em uma cópia de `lia/`. Para verificar também
os imports dos aplicativos do workspace legado, execute na raiz do
repositório `node --test Tests/tools/lia-contract-consumers.test.mjs`.

**Restrição do strip-types:** o Node recusa sintaxe que só existe em TypeScript
— parameter properties, `enum`, `namespace`, decorators. O código usa
`readonly #campo` com atribuição no construtor. Não adicionar transpilador:
isso arrastaria o install do AIRI.

---

## `lia/stage` — Stage próprio em desenvolvimento

O ponto de entrada Electron tem lockfile próprio. Em `lia/stage`,
instale com `corepack pnpm install --frozen-lockfile --ignore-scripts` e
execute `corepack pnpm run dev`. O build e a janela foram verificados no
Windows com Electron 43.4.1. O Launcher ainda usa o Stage legado para
conversa. A janela do Stage próprio já permite enviar mensagem ao
provedor local configurado no produto. No Electron foram validados
resposta de um serviço HTTP controlado, cancelamento, preservação do
rascunho e retorno de foco. O Main mantém até seis turnos concluídos em
memória por conversa e descarta o contexto ao mudar de modelo ou endereço.
A janela ainda precisa de avatar e persistência de conversa.

Em modo gerenciado, o Stage próprio publica identidade e atende status
e encerramento pelo canal de controle compartilhado com o Stage legado.
No Windows, o ensaio confirmou o handshake, a recusa de leitura de
credenciais e a remoção do registro após a saída cooperativa.

Para testar com o Launcher em desenvolvimento, prepare o build do
Stage e seu Electron (`corepack pnpm exec install-electron` em
`lia/stage`), configure um provedor gerenciado em **IA & Recursos** e abra o Launcher com
`LIA_NATIVE_STAGE_PREVIEW=1`. **Conversar com Lia** e **Encerrar
conversa** foram verificados no Windows com um registro separado.
O modo experimental oferece conversa com IA local e Groq. O botão
**Ouvir resposta** usa o Kokoro local quando instalado, selecionado
e habilitado. No Electron, a síntese gerou áudio decodificável e a
reprodução avançou. A saída física de áudio ainda não foi verificada.
No caminho autenticado, o Main lê o cofre compartilhado e exige
HTTPS e chave vinculada ao provedor, à origem e à finalidade de chat.
Esse caminho passou em testes com credencial sintética e transporte
simulado. O provedor externo ainda não foi exercitado. O fluxo padrão
e o instalador padrão continuam usando o Stage legado.

Para repetir o gate de abertura e encerramento no Windows, prepare
os builds e instale o Electron do Stage. Em `lia/desktop`, execute
`node --experimental-strip-types scripts/check-native-stage.mjs`.
Em uma cópia contendo apenas `lia/`, acrescente `--require-independent`
para exigir a ausência de `airi/`.

Para empacotar a prévia privada, em `lia/desktop` execute
`node scripts/package-windows.mjs --internal-test --native`.
O artefato usa identidade e diretório separados do instalador padrão.
Acrescente `--dir` para gerar apenas a versão descompactada e rode
`node --experimental-strip-types scripts/check-native-stage.mjs --packaged`
para verificar esse executável. A prévia depende dos builds de
`lia/desktop` e `lia/stage` e do Electron oficial instalado no Stage.
Para executar o mesmo gate sobre uma instalação da prévia, passe
`--installed-executable=<caminho absoluto de Lia.exe>`. A instalação
limpa, o ciclo Launcher–Stage e a desinstalação já passaram em uma
pasta isolada de teste.

O workflow `lia-native-windows.yml` usa `git archive HEAD lia` para
instalar, compilar e testar a prévia sem acesso à árvore legada.
Ele também executa a abertura e o encerramento pelo Launcher no Windows.

O serviço HTTP de transcrição e seus adaptadores agora ficam em
`lia/core/src/transcription`. O Stage legado usa esse mesmo serviço
com seu cofre, adaptador de rede e confirmação por gravação. O Stage
próprio recebe gravações pelo IPC. Ele usa a seleção do produto para
transcrição local sem chave ou para um adaptador dedicado via HTTPS.
No caminho remoto, o Main pede confirmação a cada gravação, mantém
a credencial vinculada ao destino no cofre e invalida a confirmação
se a seleção de modelo ou a revisão dos transportes mudar.
Os testes automatizados com transporte simulado cobrem confirmação,
recusa, cancelamento e alteração de configuração. O diálogo nativo e
o envio HTTPS real ainda precisam de validação no Windows.
No percurso local anterior, o Electron transcreveu áudio sintético
e cancelou uma requisição. A interface recebe permissão temporária para o
microfone após o clique, libera a captura antes de transcrever e
insere o texto no rascunho para revisão. O percurso foi exercitado
no Electron com microfone sintético. O microfone físico segue pendente.

`src/main/stage-host.ts` concentra o ciclo de vida da janela sem importar
Electron. A plataforma entra por `StageHostDeps`. O ponto de entrada e
o preload são as fronteiras Electron. Chat, voz e transcrição têm
serviços próprios no Main.

O armazenamento e a busca lexical da memória ficam em `lia/core/src/memory`.
O Stage legado usa esse módulo por meio do IPC existente. Na prévia própria,
as notas ficam no perfil da prévia e a consulta começa desativada. A pessoa
pode salvar ou remover notas e escolher se entram na conversa local.
O Electron no Windows, com serviço HTTP local sintético, confirmou
persistência após reinício e ausência do contexto após desativar a opção.
As notas do perfil legado ainda precisam de um caminho de migração.

```bash
cd lia/stage
corepack pnpm run build
corepack pnpm run typecheck
corepack pnpm run test
```

Ainda faltam avatar, animações, presença em múltiplos monitores,
persistência da conversa e paridade com os provedores do Stage legado.

---

## `lia/launcher`

`src/resolve-stage-target.ts` isola **a decisão** de qual Stage subir
(`packaged` × `development`, com `LIA_STAGE_MODE` vencendo a inferência). A
decisão é função pura justamente porque o defeito caro do Launcher não foi
chamar o executável errado — foi decidir errado em qual modo entrar e não
perceber que o processo criado não ficou pronto.

```bash
cd lia/launcher && node --experimental-strip-types --test "test/*.test.ts"
# 8 testes, 8 pass
```

---

## O que está verificado e o que não está

| Item | Estado |
| --- | --- |
| Contratos (154 testes) | **PASS**, executado em cópia sem `airi/` |
| Stage próprio (16 testes) | **PASS**, executado |
| Seleção de alvo (`lia/launcher`, 8 testes) | **PASS**, executado |
| Teste de mutação do Stage | **detecta** o bug de declarar pronto antes da hora |
| Janela inicial do Stage próprio | **PASS** no Electron 43.4.1 no Windows |
| Encerramento cooperativo do Stage próprio no Windows | **PASS** para o processo principal e a remoção do registro |
| Microfone e saída de áudio físicos | **NÃO EXECUTADO** |

Este projeto exige Windows real para o gate visual. Teste unitário verde **não**
é esse gate.

---

## Documentos

- `docs/architecture/AIRI-COMPARISON.md` — o AIRI limpo × o AIRI da Lia, medido
- `docs/architecture/LIA-STAGE-ARCHITECTURE.md` — os três níveis e os contratos
- `docs/architecture/LIA-MIGRATION-PLAN.md` — ordem da migração e rollback
