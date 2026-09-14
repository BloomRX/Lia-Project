# M1 — Voice Blocker Round 4

**Commits:** `5d9af9f` (correção do chat + resolver + teste de integração).
Branch `arena/01a07b6d-lia-project`, enviada.

> **Não é VOICE PASS.** E uma parte importante do escopo **não foi implementada** —
> seção 5 abaixo explica por quê, com a evidência, e o que preciso de você para
> destravar.

---

## 1. Causa EXATA de o chat não tocar TTS

Uma linha no auto-TTS do chat, em `packages/stage-ui/src/components/scenes/Stage.vue`:

```ts
if (!model || !voice)
  return null
```

`return null` **sem log, sem erro, sem aviso**. O doc da própria função dizia que
"no model picked" era um no-op legítimo. Para a configuração da Lia, as duas
metades da condição disparavam:

- **`!model` — sempre.** Kokoro não publica catálogo de modelos
  (`getModelsForProvider('kokoro-local')` → 0), então o editor de voz nunca
  mostra seletor de modelo, `modelId` fica `''` e `applyVoiceTarget` grava
  `activeSpeechModel = ''` (`voice.ts:272`). Todo segmento era descartado.
- **`!voice` — enquanto o catálogo não carrega.** `activeSpeechVoice` só é
  preenchido por um watcher que resolve o id contra `availableVoices[provider]`
  (`speech.ts:251-274`). Kokoro só publica as vozes depois que o modelo ONNX
  sobe. Um voice id válido com catálogo vazio era indistinguível de "nenhuma voz
  selecionada".

## 2. Ponto exato onde a cadeia parava

```
assistant response → segmentação → stageSynthesizeSegment(request, signal)
  → resolve provider instance            ✓ passava
  → let model = activeSpeechModel  ('')
  → let voice = activeSpeechVoice  (undefined)
  → if (!model || !voice) return null    ← PARAVA AQUI, em silêncio
  → speechStore.speech(...)              nunca alcançado
  → playback                             nunca alcançado
```

**Por que o preview funcionava:** `voice-preview.ts:94` chama
`speechStore.speech(provider, target.modelId ?? '', ...)` **diretamente** — sem
esse gate. Modelo vazio sempre foi aceitável rio abaixo: `speech()` só repassa o
modelo para `provider.speech(model, cfg)` (`speech.ts:306`). Por isso a mesma
configuração falava no preview e ficava muda na conversa.

Nota: a hidratação da rodada anterior **não** estava errada, mas também não era o
bloqueio. Ela aplicava o alvo corretamente; o alvo era rejeitado depois.

## 3. Como foi corrigido

Na camada base (`Stage.vue`), não no editor da Lia:

- **Modelo é opcional.** `speech()` repassa o modelo; providers que o ignoram já
  aceitam string vazia — é o que o preview sempre passou. Um provider que
  realmente precise de um agora **falha alto** e cai na policy de fallback
  existente, em vez de emudecer a conversa, e avisa no console.
- **Voice id é suficiente.** Quando o catálogo ainda não resolveu o objeto, é
  construído o mesmo descritor mínimo que o caminho OpenAI-compatible já
  construía inline — com `languages: []` em vez de inventar um idioma, porque
  afirmar um idioma errado alimentaria SSML com tag errada.
- `!voice` de verdade (nenhum id) continua sendo no-op legítimo.

A resolução foi extraída para `libs/speech/synthesize-target.ts`
(`resolveSynthesisTarget`) para que `Stage.vue` e o teste compartilhem **uma**
implementação, em vez de o teste reescrever a regra.

## 4. Teste de integração

`apps/stage-tamagotchi/src/renderer/stores/lia/chat-voice-pipeline.test.ts` — 5
testes, todos passando.

**Real e compartilhado com produção:** o store de voz da Lia e sua ponte de
persistência, `hydrateRuntime()`, o speech store, `resolveSynthesisTarget` (a
mesma função que `Stage.vue` chama) e `speechStore.speech()` de verdade — a
cadeia chega até `generateSpeech`/`postJSON` do `@xsai`.

**Escopo, declarado com clareza:** o teste dirige o pipeline pela fronteira que o
segmentador usa — o callback `tts` por segmento. A fiação interna do host do
segmentador **não** está coberta por este teste; ela já é coberta por
`libs/speech/tts-fallback.pipeline.test.ts`, que dirige o `createSpeechPipeline`
real. Tentei ligar o host (`registerHost`) e o `openIntent` do
`useSpeechRuntimeStore`: `openIntent` recebia o `tts` mas nunca o chamava, e
duplicar aquele harness não adicionaria cobertura do caminho da Lia. **Se você
quiser cobertura do host também, é trabalho separado.**

O que **não** é aceito aqui: o teste não chama `speech()` diretamente — ele passa
pela resolução real de alvo a partir do estado hidratado.

### Mutation checks (obrigatórias do item B)

| # | Mutação | Resultado |
| --- | --- | --- |
| MB1 | remover `applyVoiceTarget` do `hydrateRuntime` | **3 failed** / 1 passed ✓ |
| MB2 | restaurar `if (!modelId) return null` (o bug) | **3 failed** / 1 passed ✓ |
| MB3 | liberar `speech-noop` no resolver | **1 failed** / 4 passed ✓ |

MB3 **não** era detectada na primeira versão: sem voz configurada o `voiceId`
também fica vazio, então o resolver já devolvia `null`. Adicionei o cenário que
falta — `activeSpeechVoiceId` residual de um provider anterior com o runtime em
`speech-noop` — e aí passou a falhar como deve.

## 5. Edge TTS — **não implementado**, e o motivo

Auditei antes de escrever qualquer coisa, como pedido:

- **O AIRI não tem Edge TTS.** Varri os ~55 providers em
  `libs/providers/providers/`: nenhum Edge; nenhuma dependência `edge-tts` no
  monorepo.
- **Não existe API oficial gratuita de Edge TTS.** Toda implementação do
  ecossistema faz engenharia reversa do WebSocket
  `speech.platform.bing.com/.../readaloud/edge/v1` com token DRM `Sec-MS-GEC`. A
  Microsoft já quebrou isso repetidamente (a mudança de token de 2024 derrubou o
  `edge-tts` de Python).
- **Candidatos avaliados no npm:** `msedge-tts@2.0.7` (o mais mantido),
  `edge-tts@1.0.1`, `@andresaya/edge-tts@1.8.0`.
- **`msedge-tts` instala e importa** — exporta `MsEdgeTTS`, `OUTPUT_FORMAT`,
  `ProsodyOptions`. Depende de `axios`, `buffer`, `isomorphic-ws`,
  `stream-browserify`, `ws`.
- **Não consegui verificar o protocolo.** `getVoices()` falhou com
  `AxiosError: Client network socket disconnected before secure TLS connection
  was established` — o sandbox não alcança o endpoint da Microsoft. **Não posso
  afirmar que funciona hoje.**

**Por que parei aqui:** você pediu explicitamente para não adicionar "scraping
frágil ou gambiarra específica de navegador **se existir solução
estável/reutilizável**". Não existe solução estável — só o protocolo reverso. E eu
não tenho como verificar nem o endpoint nem o bundle: `ws` + `stream-browserify`
num renderer Electron é um risco real de build que só um `vite build` na sua
máquina revelaria. Shipar isso cego significaria ou quebrar o build da Lia ou
entregar mais uma voz que não fala — exatamente o que esta rodada existe para
evitar.

**O que preciso de você para destravar (escolha uma):**

1. **Aceitar `msedge-tts` sabendo do risco** — protocolo reverso, pode quebrar sem
   aviso, deps de Node no bundle do renderer. Eu implemento o provider com
   catálogo dinâmico via `getVoices()`, filtro pt-BR, preview e chat, e você
   valida o build no Windows.
2. **Um provider online com chave** — o AIRI **já suporta**
   `openai-compatible-audio-speech` e o `official`. Zero código novo, zero risco
   de bundle, estável. Contradiz "sem autenticação", mas é a única opção
   genuinamente estável.
3. **Implementar o protocolo direto com `WebSocket` nativo** — sem dependência
   nova, ~150 linhas, sem risco de bundle. Continua sendo engenharia reversa e
   continua inverificável daqui.

Minha recomendação técnica: **(2) para baseline agora** e **(1) como opção
experimental** depois, se você quiser mesmo zero-chave.

## 6-9. Itens de Edge TTS

Não se aplicam — nada foi implementado. Registrado para quando houver decisão:
mecanismo (WebSocket reverso), dependência (`msedge-tts` ou nativo),
autenticação (nenhuma, é esse o atrativo — e o motivo da fragilidade), formato
(`audio-24khz-48kbitrate-mono-mp3` é o default do `OUTPUT_FORMAT`), e vozes pt-BR
via `getVoices()` filtrando `Locale === 'pt-BR'` — sem lista hardcodeada.

## 10-11. Preview e chat Edge

**Não testados — não implementados.**

## 12. Kokoro

**Deixado como está.** Nenhum arquivo de PCM/WAV/sample-rate foi tocado nesta
rodada. Continua como debt de provider local.

⚠️ **Expectativa importante para o QA:** com a correção do item 1, o chat agora
**vai produzir áudio** com Kokoro — e será o **mesmo ruído** do preview. Isso é
progresso de diagnóstico (de "mudo" para "audível e ruim", o que confirma que o
pipeline está íntegro e o problema é a inferência), **não** uma voz consertada.

## 13. Fallback

Não redesenhado, conforme pedido. `tts-fallback.pipeline.test.ts` continua
passando dentro dos 864 do stage-ui. **Não adicionei teste novo de fallback**
nesta rodada — o cenário que você descreveu (preferred falhando → uma troca →
sticky → reset) já é o que aquele arquivo cobre com o pipeline real.

## 14. Validação

| Suíte | Resultado |
| --- | --- |
| `stage-tamagotchi` (node) | **84 arquivos, 639 passed, 1 skipped** (+1 arquivo, +5 testes) |
| `stage-ui` (node) | **134 arquivos, 864 passed** |
| ESLint nos arquivos alterados | **0 erros** |
| `vue-tsc` tamagotchi | **3 erros = baseline exato** (`provider-config-service.ts:41` TS2322, `home.vue:85` TS6133, `lia-persona.ts:383` TS6133) |
| `vue-tsc` stage-ui | **0 erros** |

## 15. Commit

**`5d9af9f`** — `fix(lia): make the chat actually speak - a missing model is not a reason to stay mute`

Arquivos: `Stage.vue`, `libs/speech/synthesize-target.ts` (novo),
`chat-voice-pipeline.test.ts` (novo).

---

## O que esta rodada entrega de fato

- ✅ **Causa raiz do chat mudo encontrada e corrigida** — com evidência de código,
  não inferência.
- ✅ **Teste de integração** que percorre persistência → hidratação → resolução →
  `speech()` real, com as 3 mutations obrigatórias detectadas.
- ✅ **Kokoro intocado**, como pedido.
- ❌ **Edge TTS não implementado** — bloqueado na decisão da seção 5.
- ⚠️ **Itens D, E, G não executados** por dependerem de Edge TTS.

O PASS final continua dependendo do QA no Windows.
