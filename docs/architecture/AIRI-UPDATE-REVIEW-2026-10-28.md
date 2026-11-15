# Lia × AIRI estável — comparação seletiva

**Data:** 28/10/2026 · **Natureza:** análise e documentação. **Nada foi integrado,
mesclado ou aplicado.** Nenhum arquivo de `airi/` foi alterado.

Complementa `AIRI-COMPARISON.md` (que mede *o que a Lia mudou*) e
`LIA-MIGRATION-PLAN.md` (que define *como extrair*). Este documento responde a
outra pergunta: **do que o AIRI avançou, o que serve à Lia?**

---

## 1. O que foi comparado

### Stable consultada

| Campo | Valor | Como foi verificado |
| --- | --- | --- |
| Repositório | `moeru-ai/airi` | clone isolado em `/home/user/ref-airi` |
| Tag | **`v0.13.0`** | `git cat-file -t v0.13.0` → `tag` (anotada) |
| Commit | **`3c4aca209330f1a78fe7288e8c4ca75639cd10e6`** | `git rev-parse v0.13.0^{}` |
| Data | 2026-10-28 05:26:59 +0800 | `git log -1` |
| Publicação | 2026-10-27T22:03:08Z | API `/releases` (prerelease=false, draft=false) |

`v0.13.0` é a estável mais recente. `v0.12.0` (23/10) e `v0.12.0-beta.6` existem
entre ela e a base da Lia; `v0.12.0-beta.5` também está marcada no GitHub como
`prerelease=false`, apesar do nome.

### Versão presente na Lia

| Campo | Valor |
| --- | --- |
| Tag vendada | **`v0.12.0-beta.5`** |
| Commit | **`2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf`** |
| Registro | `docs/upstream/AIRI-INTEGRATION.md` §1; corrigido em `docs/airi-modificacoes-registro.md` §1 |

O histórico do upstream **não está** no repositório da Lia (entrou por
`git subtree add --squash`). Isso foi confirmado: `git log --all -- airi/ |
grep -c subtree` → **0**. Consequência direta: **a Lia nunca absorveu nenhuma
mudança do upstream desde a integração**, e `git diff` entre branches da Lia não
mede nada contra o AIRI.

### Distância entre as duas

| Métrica | Valor |
| --- | --- |
| Commits | **529** |
| Arquivos alterados | **3 959** |
| Linhas | +331 697 / −114 050 |

Esse volume não é analisável linha a linha, e listar 529 commits não informaria
nada. A análise abaixo filtra por **áreas de dor já documentadas da Lia**.

### Estado do repositório da Lia no momento da análise

| Item | Valor |
| --- | --- |
| Branch | `arena/01a10290-lia-project` |
| HEAD | `a9789432e7d2fe9b86fdd44be4cb51a442f67598` |
| Status | limpo (clone novo; a cópia antiga em `/home/user/Lia-Project` foi **ignorada** por estar em `db99c70` com 9 arquivos alheios não commitados) |
| `main` | `db99c709059a6d074b18361bfb32c9f144620632` — intocada |

---

## 2. Modificações específicas da Lia já documentadas

Onde procurar, para não refazer pesquisa:

| Documento | O que cobre |
| --- | --- |
| `docs/architecture/AIRI-COMPARISON.md` | inventário medido: **353 criados, 95 modificados, 0 removidos** |
| `docs/airi-modificacoes-registro.md` | classificação de risco para re-clone, por diretório |
| `docs/patches/stage-node-runtime-c52c995.patch` | patch do runtime Node do Stage |
| `docs/architecture/LIA-STAGE-ARCHITECTURE.md` | os três níveis e os contratos |
| `docs/project/CURRENT-STATE.md` §0 | estado operacional e gates |

Os pontos que esta análise confirmou no código, e que condicionam tudo abaixo:

- **Todos os arquivos candidatos desta análise já foram modificados pela Lia.**
  Verificado por comparação byte a byte contra o clone em `2c1e223`: nenhum está
  intocado. Portanto **nenhuma adoção futura é cherry-pick limpo** — todas serão
  aplicação manual sobre código divergente.
- A Lia corrigiu localmente a perda de espaço em `chat-orchestrator-runtime.ts`
  com uma abordagem **diferente** da que o upstream escolheu depois.

---

## 3. Tabela de avaliação

`Risco` considera conflito textual com o código já modificado da Lia.
`Commit` é o do upstream que introduziu a mudança.

| # | Melhoria upstream | Situação atual na Lia | Classe | Benefício | Risco / dependências | Próximo passo |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `f289c5969` preservar espaço em literais de fala (v0.13) | **Corrigido**, mas por outra via: `if (speechOnly.length > 0)` em `:717`. Upstream acumula espaço inicial até chegar texto visível | **Já temos** (divergente) | Mesmo sintoma resolvido nos dois. Upstream evita fala em branco no início e não retém branco em stream falho | Conflito direto: mesmas linhas, lógicas incompatíveis | Não portar agora. Ao sincronizar o arquivo, adotar a versão do upstream e reexecutar o teste de aderência do dono |
| 2 | `73b76e85a` rodar IPC uma vez por request (`window-context.ts`, `onlySameWindow`) | `createContext(ipcMain, window)` **sem** a opção em `windows/main/rpc` e `windows/settings/rpc` | **Vale aproveitar** | Elimina a classe de defeito "uma ação por janela aberta" (fechar app, abrir pasta, reiniciar MCP executam N vezes) | Baixo. `onlySameWindow` **já existe** no eventa 1.0.0 fixado e **já é usado** em `electron-screen-capture/src/main/index.ts:203` | Adotar o helper `libs/electron/window-context.ts` e trocar as 2 chamadas |
| 3 | `c4e691ab1` resolver caminhos de renderer e preload num só lugar | `libs/electron/location.ts` tem `baseUrl(parentOfIndexHtml)`; cada janela calcula o próprio caminho | **Vale aproveitar** | Caminho resolvido na hora de carregar a página, não no setup do manager — janela nova pega a raiz atual (build/hot reload) | Médio. Toca `main/index.ts`, modificado pela Lia | Portar as funções `getRendererRoot()`/`getPreloadPath()` e migrar janela por janela |
| 4 | `343cff90e` preservar grapheme clusters nos chunks de TTS | **Defeito presente**: `tts-chunker.ts:72` faz `if (value.length > 1) { … continue }` | **Vale aproveitar** | Hoje todo cluster com mais de uma unidade UTF-16 é **descartado antes do TTS**: emoji e marcas combinantes. Texto pt-BR em NFD perderia acentos na fala | Baixo (cirúrgico), mas o arquivo tem divergência própria da Lia (§5, lacuna L2) | Aplicar só a remoção do bloco `length > 1` + o tratamento de CRLF; teste com "ção" em NFD e um emoji |
| 5 | `3cb8c1b99` isolar conclusões de reprodução obsoletas | Não verificado se a Lia tem o sintoma | **Investigar** | `playback-manager.ts` já difere do base; risco de áudio velho "vencer" o novo | Desconhecido | Ler `playback-manager.ts` da Lia e comparar com o diff do commit antes de decidir |
| 6 | `9faf6fbff` rodar IPC do updater uma vez por request | `auto-updater.ts` modificado pela Lia | **Adaptar** | Mesma classe do #2, no caminho de atualização: evita instalar/baixar duas vezes | Médio | Só faz sentido **depois** do #2, que é a causa raiz compartilhada |
| 7 | `188eac836` isolar escrita de configuração entre ciclos de vida (com `flush()`) | `persistence.ts` modificado pela Lia | **Adaptar** | Escrita pendente pode atravessar o ciclo de vida e cair no host seguinte; `flush()` dá ponto de sincronização no desligamento | Médio-alto: mexe em persistência, que é justamente o que a Lia controla com `lia-product.json` | Investigar se algum store da Lia usa escrita diferida; se sim, adaptar o `flush()` sem trazer o resto |
| 8 | `300773ef2` gravar sessões só por ações com identidade (`storeMessage`) | Lia resolveu retry sem ID por **índice**; upstream por **identidade** | **Adaptar** | Gravar por identidade torna o retry idempotente (não duplica a mensagem) | Alto: `session-store.ts` e `chat.ts` estão entre os arquivos mais modificados da Lia | Não portar isolado. É pré-requisito de qualquer sincronização futura do chat |
| 9 | `dedbbf447` manter o turno de origem quando o retry falha antes de gravar | `chat.ts` modificado (+460/−76) | **Adaptar** | Evita perder a mensagem do usuário quando o retry morre antes da persistência | Alto: mesmo arquivo e mesma região do trabalho de retry da Lia | Comparar com a política de falha da Lia antes de qualquer decisão |
| 10 | `33870846a` repetir falhas temporárias de provedor (408/429/5xx) | Lia tem política de falha própria, na UI | **Investigar** | Retry automático antes de qualquer evento de stream | Alto risco de **retry duplo**: upstream em `llm-service.ts`, Lia na UI | Mapear as duas camadas antes de considerar. Um retry duplicado multiplica chamadas pagas |
| 11 | `99dce26f9` ignorar respostas de `notice` sem conteúdo visível | Não encontrado uso de `notice:` nas áreas da Lia | **Não aplicar** (por ora) | Evita mensagem de assistente vazia | Nenhum identificado | Reavaliar só se a Lia passar a usar `notice` |
| 12 | `fe11decc2` interromper resposta de chat ativa (28 arquivos) | `speech-output-control.ts` modificado pela Lia | **Investigar** | Interrupção coordenada entre chat e fala | Alto: mudança ampla | Ler o commit inteiro antes de qualquer decisão |
| 13 | `b8600d90d` remover o limite de passos de ferramenta | Não verificado | **Investigar** | Tarefas longas com muitas ferramentas param de ser truncadas | Desconhecido; interage com o orçamento de ferramentas | Verificar se a Lia depende do limite atual como salvaguarda |

---

## 4. Prioridades recomendadas

Ordenadas por **valor sobre esforço**, não por tamanho do commit.

### P1 — Grapheme clusters no TTS (`343cff90e`)

**Por que primeiro:** é o único item em que o defeito **existe hoje** na árvore
da Lia e é verificável sem executar o app. Para um produto em português com voz,
descartar clusters multi-unidade significa perder emoji e perder acentos quando
o texto vem em NFD (forma decomposta, comum após normalização de entrada).
O conserto é a remoção de um bloco de 5 linhas.

**Testes necessários:**
- `"ção"` em NFD atravessa o chunker sem perder a cedilha.
- Um emoji (par substituto) sobrevive ao chunk.
- CRLF entrega `\n` e fecha o chunk como pontuação dura.
- Teste de regressão que fique **vermelho** com o bloco `length > 1` restaurado.

### P2 — IPC uma vez por request (`73b76e85a`)

**Por que:** a Lia vem tratando sintomas dessa classe um por um — "bloqueia
duplicatas durante a parada", "seleção por janela". O mecanismo descrito pelo
upstream é uma **causa comum**: todos os windows compartilham um `ipcMain`, e um
contexto sem `onlySameWindow` faz o mesmo handler rodar em cada janela que o
registrou. Custo baixo: a opção já existe na versão fixada do `eventa`.

**Testes necessários:**
- Com duas janelas abertas, um pedido de encerramento dispara **um** handler.
- Abrir a pasta de dados com três janelas abre **uma** vez.
- Um contexto de janela deixa de responder depois que a janela fecha.

### P3 — Caminhos de renderer/preload num só lugar (`c4e691ab1`)

**Por que:** "a janela não abre" é a dor mais antiga e mais cara da Lia. O
upstream mudou a resolução para acontecer **na hora de carregar**, com o
argumento explícito de que janelas criadas depois pegam a raiz atual. Isso é
plausível para os sintomas de Stage que só falha quando algo foi reconstruído no
meio do caminho — mas **é hipótese**, não causa provada (ver §6).

**Testes necessários:**
- Caminho de preload resolve igual em dev e empacotado.
- Janela criada após troca de raiz carrega da raiz nova.

### P4 — Convergir a correção de espaço (`f289c5969`)

**Por que:** não é uma melhoria a adotar — é uma **divergência a reduzir**. A Lia
e o upstream resolvem o mesmo bug em linhas diferentes do mesmo arquivo, com
lógicas incompatíveis. Enquanto isso existir, cada sincronização futura desse
arquivo será conflito manual. Adotar a versão do upstream elimina esse débito,
**desde que** o teste de aderência do dono (o que reproduz a perda com
granularidade real de transporte) continue verde depois da troca.

**Testes necessários:**
- O teste de granularidade caractere-a-caractere do dono continua PASS.
- Stream que termina em falha não retém fala em branco.
- Espaço entre palavras preservado (sintoma original).

### P5 — Sessão por identidade (`300773ef2` + `dedbbf447`)

**Por que por último:** maior risco e maior conflito, mas é o que destrava
qualquer sincronização futura do chat com o upstream. A Lia resolveu retry sem ID
por índice; o upstream por identidade. As duas convivem mal no mesmo arquivo.

**Testes necessários:** retry não duplica a mensagem; turno de origem preservado
quando o retry falha antes de gravar; seleção de sessão por janela intacta.

---

## 5. Lacunas de documentação e dúvidas

**L1 — Origem dos 353/95/0.** O inventário foi medido uma vez e o clone de
referência é efêmero. Marcado como limitação em `AIRI-COMPARISON.md` §9. Os
números não foram re-medidos nesta rodada.

**L2 — Divergência não explicada em `tts-chunker.ts`.** Comparado com a base
`2c1e223`, a versão da Lia **não** tem o guarda `regexpSound` (que evita pedidos
de TTS sem som útil, como uma aspa solitária) e importa `../stream` em vez de
`@proj-airi/stream-kit`. A versão da Lia parece **anterior** à base fixada.
Isso não está registrado em `airi-modificacoes-registro.md`. **Classe F —
proveniência não confirmada.** Não presumir que foi intencional.

**L3 — Nenhum registro do que já foi absorvido.** Como nunca houve `subtree
pull`, não existe lista de "correções do upstream que a Lia já tem por
coincidência". A classe C de `AIRI-COMPARISON.md` §5 diz exatamente isso: não é
possível afirmar.

**L4 — Comentário obsoleto no teste da Lia.** `chat-orchestrator-runtime.test.ts:276`
ainda diz `// REFUTADA: com este teste o código original também passa`. O texto
está correto como descrição do teste fraco, mas o arquivo hoje contém a correção
— quem ler pode concluir que a cobertura não existe. Débito de documentação, não
de código.

**L5 — Retry em duas camadas.** Não há documento dizendo onde a política de falha
da Lia termina e onde começa a do `llm-service`. Sem isso, a avaliação de
`33870846a` (P?) não pode sair de "Investigar".

**L6 — Gates não executados nesta análise.** Nada foi compilado, instalado ou
rodado no app. Não há `node_modules` no clone. Todas as conclusões vêm de leitura
de código, comparação de arquivos e inspeção do pacote `@moeru/eventa` publicado.

---

## 6. Fatos e hipóteses

**Fatos verificados por execução:**
- `v0.13.0` = `3c4aca20…`, tag anotada, 2026-10-28 05:26:59 +0800.
- Base da Lia = `2c1e223…` = `v0.12.0-beta.5`.
- 529 commits e 3 959 arquivos entre as duas.
- Zero merges de subtree no histórico da Lia.
- `onlySameWindow` existe em `@moeru/eventa@1.0.0` (inspeção do `.d.mts` do pacote
  publicado) e já é usado em `electron-screen-capture/src/main/index.ts:203`.
- A Lia chama `createContext(ipcMain, window)` **sem** opções em
  `windows/main/rpc` e `windows/settings/rpc`.
- `tts-chunker.ts:72` na Lia contém `if (value.length > 1) { … continue }`.
- Os 9 arquivos centrais desta análise diferem do base (comparação `cmp`).
- `chat-orchestrator-runtime.test.ts:276` ainda contém o comentário `REFUTADA`.

**Hipóteses — não provadas, não tratar como causa:**
- Que o defeito de IPC duplicado **se manifeste** hoje na Lia. O mecanismo é
  documentado pelo upstream e o código da Lia é compatível com ele, mas **não foi
  reproduzido**.
- Que a resolução de caminho (#3) explique sintomas de Stage que não abre.
- Que a divergência do `tts-chunker.ts` (L2) seja descuido e não decisão.
- Que `33870846a` causaria retry duplo na Lia.

---

## 7. O que este documento não é

- Não é um plano de integração. Nenhuma mudança de código foi feita.
- Não é um inventário completo do upstream. 529 commits foram filtrados por
  áreas de dor documentadas; o resto não foi lido.
- Não é auditoria geral do projeto.
- Não promove baseline nem aprova gate algum.
