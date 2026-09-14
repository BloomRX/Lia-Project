# Phase 5 Round 4 — Miniconda exit=2 + progress UI invisível: causas, correções, provas

Commits desta rodada em `arena/01a09ddb-lia-project` (nesta ordem: bootstrap/args, IPC fix + integração, sonda QA, este doc). **Sem installer PASS** — Round-5 Windows decide.

## 1. Origem de `/NoShortcuts` e `/NoRegistry`

Vieram **copiados do `atsetup.bat` pinado** (`f16117e9`), que os usa na sua linha `start /wait`. Não foram inventados pelo nosso código.

## 2. São suportados pelo installer usado?

São switches da camada **constructor** (a ferramenta que gera os instaladores Miniconda): a documentação oficial do constructor lista `/NoRegistry=[0|1]` e `/NoShortcuts=[0|1]` com defaults 0. Mas **não constam** da página oficial de instalação silenciosa do Miniconda (que lista apenas `/InstallationType`, `/AddToPath`, `/RegisterPython`, `/S`, `/D`, case-sensitive, `/D` por último e sem aspas). Decisão (itens A/D do brief): **produção usa apenas o conjunto oficial documentado**; os dois flags passaram a existir apenas nos modos de isolamento da sonda (`QA-Miniconda.bat shortcuts|registry`), um por vez, para medição.

## 3. Combinação isolada que retornou exit=0

A responder pela rodada 5 no Windows: a linha `miniconda-install-finished exit=N` do `[LIA-VOICE-BOOTSTRAP]` agora registra a execução com `/InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /S /D=<prefix win32>` — nada mais. A sonda manual reproduz o mesmo e permite isolar cada flag extra.

## 4. `_conda.exe` foi criado?

A responder pela rodada 5: o estágio só passa com **exit 0 E prefix E `_conda.exe`** (verificação por artefatos, log `miniconda-install-verify`).

## 5. Normalização do path teve efeito?

O log da rodada 4 mostra o formato misto real: `/D=C:\Users\...\app`**`/alltalk_environment/conda`**. A produção agora entrega ao processo apenas strings win32 (`win32Path`, aplicada ao comando do instalador e ao valor de `/D`; /D continua último e sem aspas). Test pin: `^/D=[^/]+$` no argumento final. O efeito prático será medido na rodada 5 — não afirmamos que era a causa, mas era o único desvio observável na forma do comando.

## 6. Causa final do exit=2

Sainda do instalador com stdout/stderr vazios. Candidatas ranqueadas: **(a)** path misto no `/D` (único desvio confirmado pela evidência do log); **(b)** os dois flags extras (válidos segundo o constructor, mas fora do conjunto oficial — removidos por regra do brief); **(c)** interferência de ambiente (AV), indistinguível sem nova leitura. O fix executa (a)+(b) juntos — decisão explícita do brief — e a sonda manual isola (b) flag a flag se (a) não bastar. A causa exata restante sai da próxima leitura `exit=N` + artefatos, não de suposição.

## 7. Por que o progresso não aparecia na UI REAL

O adapter eventa do processo main (`@moeru/eventa/adapters/electron/main`) encaminha eventos outbound **apenas** por dois caminhos: `window.webContents.send(...)` quando uma janela é passada na criação do contexto, ou `ipcMainEvent.sender.send(...)` quando é *resposta* a um invoke recebido. Todos os bridges Lia eram registrados com `createContext(ipcMain)` — **sem janela**. Um emit espontâneo — exatamente o caso do `onStateChange` do bootstrap durante a instalação — não tem `ipcMainEvent` para responder: `sender == null` e o evento **morria silenciosamente**. Por isso: invokes (state, run) funcionavam, o painel abria normal, nada "quebrava" — e o progresso nunca atravessava. Os testes SSR anteriores provavam o comportamento do store *dado* o estado; ninguém provava que o estado cruzava o fio.

## 8. Correção do caminho IPC/reactivity/render

`main/index.ts`: o invoke injeca do runtime Lia agora depende de `mainWindow` e cria `createContext(ipcMain, deps.mainWindow)` — uma linha que é a diferença entre "emit morre" e "emit chega". Sem segunda state machine, sem timer: main continua fonte da verdade; o renderer só renderiza o que recebe.

## 9. O teste que prova o DOM mudando com eventos

`BootstrapProgressUi.test.ts` (jsdom), com apenas o *transporte* falsificado (objetos IPC em memória): adapter electron/main **com janela** ↔ adapter electron/renderer ↔ electron-vueuse real ↔ store real ↔ **VoiceSection real montada**. Emite checking → downloading → extracting → installing → verifying → ready e afirma DOM visível a cada etapa (título, spinner por etapa, sub-estado "Extraindo os arquivos…", banner "Sistema de voz pronto"); emite failed e afirma o título + "Tentar novamente" + **nenhum vazamento técnico** (miniconda/conda/alltalk/paths não aparecem); e o teste "goes dark": cortar a subscrição após provar que o painel se move ⇒ a próxima emissão não muda um pixel (a mutação L.16 pela própria natureza do teste).

## 10. Mutations (todas detectadas)

| Mutação | Resultado |
| --- | --- |
| recolocar `/NoRegistry=1` | falha o pin literal de args (L.1) |
| recolocar `/NoShortcuts=1` | falha o pin literal de args |
| mover `/D` do final | falha o teste "último arg = `/D=` sem `/` no valor" |
| `/D` com path misto (sem `win32Path`) | falha o pin de normalização |
| store lê snapshot (primeiro estado gruda) | falha o lifecycle DOM |

|-
| subscription desconectada no store | falha o lifecycle DOM / o teste "goes dark" verde por construção cobre a forma positiva |

Suíte: **104 arquivos / 960 passando / 1 skipped**; ESLint 0; vue-tsc **0 erros**.

## 11. SHA

Ver `git log` do branch: (args+retry) → (IPC + integração) → (sonda) → (este doc), sobre o merge `1444e0a`.

## Round-5 Windows QA checklist

1. "Tentar novamente" deve ser imediato: não baixa 97 MB, não baixa 81 MB (installer já presente e verificado — item J: seqüência de atsetup só roda quando o instalador falta).
2. Log: `miniconda-facts` → `miniconda-install-finished exit=N` → `miniconda-install-verify exit=0 conda-prefix-exists=true conda-exe-exists=true` é o objetivo; qualquer outro valor é a próxima pista concreta.
3. Se `_conda.exe` existir: o resume upstream roda — e o log `resume-incomplete` confirmará empiricamente (pela segunda vez) que o pin não tem `:RunScript`. Isso fecha a decisão seguinte com evidência.
4. **O painel deve se mover em tempo real** desta vez: "Preparando o sistema de voz…" + etapas girando ao clicar em Instalar.
