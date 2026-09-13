# 4E-2 — Relatório da Rodada 2 (bugfix)

Base: `9661da4` → HEAD **`5f44ee8`** (branch `arena/01a07b6d-lia-project`, enviada ao remote).

Três commits, um por responsabilidade:

| SHA | Assunto |
| --- | --- |
| `215557f` | `fix(lia): hydrate the speech runtime from the persisted voice` (item C) |
| `efe9dec` | `fix(lia): stop querying unconfigured providers and drop speech-noop from the picker` (itens A e D) |
| `5f44ee8` | `fix(lia): keep Kokoro voice discovery off an unverified WebGPU backend` (item B) + teste determinístico de WAV |

> **Não é um PASS.** Nada aqui foi validado em runtime real: o sandbox não tem GPU,
> WebGPU, `DISPLAY` nem binário do Electron. Os itens B e E dependem de QA no Windows.

---

## 1. Causa exata do ruído do Kokoro

**Não foi determinada, e eu não vou fingir que foi.** O que foi *eliminado*, por medição:

A cadeia de encoding foi percorrida de ponta a ponta e está correta. Uma sonda
determinística (senoide 440 Hz, 24 kHz, 4800 amostras) passou pelo mesmo
`toWav` que a saída do worker Kokoro usa:

```
HEADER {"riff":"RIFF","wave":"WAVE","fmt":"fmt ","data":"data","audioFormat":1,
        "channels":1,"sampleRate":24000,"byteRate":48000,"blockAlign":2,
        "bitsPerSample":16,"dataSize":9600,"totalBytes":9644}
SAMPLES 4800  duration(s) 0.2000  maxErr 4.449e-5
```

Formato PCM (1), 16 bits, mono, little-endian, `byteRate`/`blockAlign` coerentes,
tamanho de `data` exato. `structuredClone(..., { transfer: [samples.buffer] })` —
que simula o `postMessage` do worker — preserva `Float32Array` e `byteLength`.

Portanto o ruído **nasce nos samples vindos da inferência ONNX**, não na conversão.
Isso é consistente com o log do QA: `kokoro-js` carregou, a sessão foi criada, o
modelo está no runtime — e ainda assim o áudio é lixo.

**Hipótese com evidência (não comprovada):** `getWebGpuState()` apoia-se em
`getCachedWebGPUCapabilities()`, que devolve `null` enquanto `detectWebGPU()` não
roda, e nesse caso cai em `Boolean(navigator.gpu)`
(`packages/stage-shared/src/webgpu/detect.ts:203`). `navigator.gpu` existe em
qualquer Chromium, inclusive quando a GPU não consegue rodar WebGPU — uma RX 580
(GCN4) está abaixo do piso do WebGPU do Chrome. Com `config.model` ausente, a
descoberta de vozes escolhia `fp32-webgpu` e a síntese ia por um backend que o
hardware não sustenta.

**O que mudou:** o fallback *implícito* agora é o build WASM
(`getDefaultKokoroModel(false)`). WebGPU continua disponível, mas só por escolha
explícita nas configurações do provedor. A regra é que uma escolha que ninguém
fez não pode comprometer um backend não verificado.

**Se o ruído persistir no Windows**, a causa é outra e o próximo suspeito é a
inferência em si, não o empacotamento — o encoding já está descartado por medição.

## 2. Formato e sample rate antes e depois

**Inalterados.** `toWav(buffer, 24000, 1)` → PCM16 mono 24 kHz nos dois casos.
Nenhum byte do caminho de áudio foi tocado. O commit `5f44ee8` muda apenas *qual
modelo* a descoberta escolhe quando não há `config.model` salvo.

Um detalhe medido e **não corrigido**, por decisão: `toPCM16FromFloat32` passa um
valor fracionário a `setInt16`, que trunca em vez de arredondar, e escala a metade
positiva por `0x7FFF`. O erro máximo de ida e volta é ~5,9e-5 (≈1,94 passo de
quantização, −84 dBFS). Cheguei a trocar truncagem por arredondamento e o teste
pré-existente `wav.test.ts` falhou — ele fixa `0.5 → 16383` como comportamento.
Revertido: é imperceptível, o pacote é compartilhado por todos os outros
provedores de fala, e não é a causa do ruído reportado.

## 3. Causa exata do chat sem TTS

Duas falhas independentes, ambas necessárias para o sintoma:

1. **Nada aplicava a voz no boot.** `registerRuntimeExtensions()` só registra a
   *policy* de fallback (`voice.ts:393`). Grep por chamadores de `applyVoiceTarget`
   fora de `voice.ts`/`voice-editor.ts`: nenhum. O speech store ficava no seu
   default `'speech-noop'` (`speech.ts:241`).
2. **O chat é outra janela.** `src/main/windows/chat/index.ts:47` abre um
   `BrowserWindow` próprio com `#/chat`, então ele tem seu próprio Pinia e seu
   próprio speech store. Mesmo hidratando o launcher, o chat continuaria mudo.

Resultado: a resposta em texto aparecia e `speech()` ia para o provedor noop.

## 4. Onde a hidratação quebrava

Em nenhum lugar específico — **ela não existia**. Persistir `voice.tts` e
reprojetá-lo no cartão funcionava (por isso "persistência OK"), mas nada lia essa
configuração para configurar o runtime. A janela de chat nem sequer tinha
`onMounted`.

Adicionado `hydrateRuntime()` no store de voz: `refreshConfig()` →
`resolveCurrentVoiceTarget()` → `applyVoiceTarget()` →
`resyncProjectionFromSource()`. Chamado do `onMounted` de `chat.vue` e do
`home.vue`. É somente leitura em relação a `voice.tts`: aplica o que está
persistido, nunca grava.

## 5. Causa das mini travadas

Trocar de provedor disparava uma consulta de catálogo para cada entrada do
dropdown, inclusive as que não têm como responder — exatamente o que o log do QA
mostrou: 401 do provedor official, `.trim()` sobre config `undefined` em
deepgram/openai/elevenlabs, e conexão recusada nos engines locais.

Além disso, `isLoadingVoices` era um booleano único e compartilhado: uma resposta
tardia do provedor que você acabou de deixar limpava o indicador de loading do
provedor atual.

## 6. Quais provedores deixaram de ser consultados sem configuração

`requiresConfiguration()` deriva a prontidão de metadata que o registry **já
publica** — `requiresCredentials`, `configuredBy` e `configuredProviders` do
config store. Nenhum provedor é listado à mão e não há registry paralelo.

`configuredBy` estava na definição do provedor mas não era serializado no
`ProviderMetadata`; passei a serializá-lo (`metadata.ts`, 2 linhas). Era o sinal
que faltava: os provedores `configuredBy: 'authentication'` têm
`requiresCredentials: false` e mesmo assim não funcionam sem sessão — eram eles
que produziam o 401.

Varredura das definições de TTS: dos ~19 provedores, apenas **`kokoro-local`**
não exige nada (`speech-noop` também, mas está oculto do picker). Todos os demais
passam a reportar "configure este provedor antes" sem instanciar nem fazer
request. Isso é corroborado em runtime: o helper de teste que procurava um segundo
provedor de fala sem credencial falhou com *"the live registry exposes no
credential-free speech provider"*.

Os cinco estados do catálogo agora são distintos — `unselected`, `loading`,
`needsConfiguration`, `empty`, `error`, `ready` — em vez de três booleanos que
podiam discordar entre si.

## 7. Confirmação do filtro de `speech-noop`

Filtrado **somente** em `providerOptions` do editor Lia. O registry global não foi
tocado: `availableSpeechProvidersMetadata` continua contendo `speech-noop`, o AIRI
continua podendo usá-lo e o speech store continua com ele como default.

Testado nos dois lados: o registry contém, o picker não contém, e
`offered === registered.filter(id => id !== 'speech-noop')` — nenhuma outra opção
foi removida junto. A primeira opção continua "Nenhuma voz configurada"; "None"
não aparece em lugar nenhum.

## 8. O reload do Vite reapareceu?

**Não verificado — não há como.** `optimizeDeps.include: ['kokoro-js']` continua
presente em `apps/stage-tamagotchi/electron.vite.config.ts:109`, com o comentário
explicativo. Conforme instruído, **nenhum patch novo foi feito**: a condição para
agir era o log mostrar "optimized dependencies changed. reloading" de novo, e o
sandbox não executa o Vite do Electron.

Nota: o reload aparente do *primeiro clique* relatado no QA também pode ser outra
coisa — a escolha de WebGPU na primeira descoberta de catálogo (item 1) força o
carregamento do backend GPU, o que se parece com um restart. O commit `5f44ee8`
remove esse caminho.

## 9. Testes

| Suíte | Resultado |
| --- | --- |
| `stage-tamagotchi` (node) | **82 arquivos, 629 passed, 1 skipped** |
| `stage-ui` (node) | **133 arquivos, 855 passed** |
| `packages/audio` encoding | **2 arquivos, 12 passed** (7 novos + 5 pré-existentes intactos) |
| ESLint nos arquivos da tarefa | **0 erros** |
| `vue-tsc` tamagotchi | **3 erros = baseline exato** (`provider-config-service.ts:41` TS2322, `home.vue:85` TS6133, `lia-persona.ts:383` TS6133) |
| `vue-tsc` stage-ui | **0 erros** |

Novos em `wav.deterministic.test.ts` (7): geometria do header, erro máximo de
round-trip, pico/RMS dentro da faixa audível, structured clone com transfer,
equivalência Float32↔PCM16, e o caso de erro em que um buffer Float32 é lido como
PCM16 (dobra a contagem de frames — exatamente o que um ruído desse tipo seria).

Novos em `voice-editor.test.ts` (6): filtro do noop, hidratação aplicando o alvo
persistido, hidratação sem voz configurada não mexendo no runtime, nenhuma
consulta a provedor não configurado, catálogo vazio ≠ precisa de configuração, e
resposta tardia do provedor anterior não limpando o loading do atual.

Quatro testes pré-existentes foram atualizados porque codificavam o comportamento
que A e D corrigem: a contagem do catálogo (20 → 19), `hasNoVoiceCatalog` para um
provedor que agora reporta `needsConfiguration`, a sequência de troca entre
provedores (2 das 5 cargas eram para provedores que hoje são bloqueados) e a
presença de `speech-noop` no picker. Cada um foi reescrito para provar a mesma
intenção original sob o contrato novo, não enfraquecido.

## 10. Mutation checks — 5/5 detectadas

| # | Mutação | Resultado |
| --- | --- | --- |
| M1 | reintroduzir `speech-noop` no picker | **4 failed** / 39 passed |
| M2 | `sampleRate * 2` no header WAV | **4 asserções falharam** (`expected 48000 to be 24000`) |
| M3 | remover `applyVoiceTarget` do `hydrateRuntime` | **1 failed** / 32 passed |
| M4 | limpar todo o estado de loading ao terminar (aceitar stale) | **1 failed** / 32 passed |
| M5 | remover a guarda `requiresConfiguration` em `refreshVoices` | **1 failed** / 32 passed |

Todas revertidas com `cp` de backup; `git status` limpo e suíte re-executada
depois (629 passed).

## 11. Commit SHA

**`5f44ee8`** é o último commit de código. Cadeia: `efe9dec` ← `215557f` ← `9661da4` (base).
Este relatório foi commitado em `76bd178`. Tudo enviado à `arena/01a07b6d-lia-project`.

---

## O que continua em aberto

- **B não está resolvido com certeza.** O encoding está descartado por medição; a
  mudança de backend é fundamentada em leitura de código, não em reprodução.
  Precisa do QA no Windows.
- **E não foi verificado** — exige o Vite do Electron.
- **O diagnóstico `[LIA-VOICE-RUNTIME]` não foi adicionado.** A causa de C ficou
  clara por leitura e por teste, e a instrumentação só seria útil para B — que
  depende de GPU. Se o ruído persistir, o próximo passo é um log DEV com
  `providerId`, `model`, `sampleRate`, `channels`, contagem de frames, duração e
  min/max/RMS dos samples decodificados, gated por build mode.
- Dívida registrada anteriormente segue válida: `docs/product/M1-I18N-DEBT.md`
  (pt-BR sem o namespace `settings` ⇒ ~36 títulos de provedor caem para inglês).
