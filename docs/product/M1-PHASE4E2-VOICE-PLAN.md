# M1 Phase 4E-2 — Plano: escolher e persistir a voz da Lia

**Status: plano. Nenhuma linha de código foi escrita nesta etapa.**

Documento de desenho para aprovação antes da implementação. Tudo que está marcado
como *verificado* foi lido no código no commit `dfb76d1`; o que é decisão em
aberto está na seção 9.

---

## 1. Por que esta fase existe

A 4E-1 entregou a superfície unificada "Configurar Lia". A aba **Voz** mostra
`provider / model / voice / fallback` lendo `voice.tts` de `lia-product.json`.

Uma investigação com diagnóstico DEV na máquina real concluiu:

```
ipcGetReturned:    true    a ponte respondeu
ipcTtsExists:      true    sempre true — o handler retorna { tts: … ?? {} }
persistedVoiceTts: false   a fatia tts está vazia
preferredExists:   false   nada para normalizar
```

A cadeia `lia-product.json → IPC → refreshConfig() → applyTtsState() →
VoiceSection.vue` **não perde nada**. Não existe `voice.tts` porque:

- o default do produto é `voice: {}` e o schema declara `tts` como
  `optional(...)` **sem default**;
- **nenhum módulo em runtime escreve** `voice.tts` — `persistTtsConfig` e
  `updateTtsConfig` têm zero chamadores fora do próprio store.

Portanto a aba estava certa ao dizer "Não definido". O que falta não é consertar
leitura: **é existir uma escrita**. Isso é a 4E-2.

> `voice-hydration.test.ts` fixa esse estado, incluindo uma asserção
> deliberadamente frágil de que nenhum módulo em runtime escreve `voice.tts`.
> **Espera-se que essa asserção falhe quando a 4E-2 adicionar o escritor** — e ela
> deve ser atualizada de propósito nesse momento, não contornada.

---

## 2. Objetivo de produto

Na aba Voz, a Lia deixa de ser muda por omissão sem que o usuário precise saber o
que é um provider de TTS:

1. Escolher **uma voz** em linguagem de produto (não "provider/model/voice id").
2. Ouvir um **teste** antes de salvar.
3. **Salvar** — e a Lia passa a falar com aquela voz, inclusive depois de
   reiniciar o app.
4. Opcionalmente, indicar uma **voz reserva** (o `fallback` que a 4D já modela).
5. Poder **desconfigurar** e voltar ao estado atual.

Fora do objetivo: STT/ouvir, permissões de microfone, barge-in, VAD. São itens
3 e 4 do §8.2 do plano da Phase 4 e continuam fora.

---

## 3. O que já existe e deve ser reutilizado (verificado)

Nada disto precisa ser recriado. A 4E-2 é montagem, não infraestrutura.

**Store da Lia — `stores/lia/voice.ts`:**

| API | O que faz |
| --- | --- |
| `updateTtsConfig(next)` | normaliza + aplica + **persiste** em um passo |
| `persistTtsConfig()` | grava via o IPC `Set` já existente |
| `applyVoiceTarget(target)` | escreve `activeSpeechProvider/Model/VoiceId` no speech store existente |
| `refreshConfig()` | leitura (já usada pela 4E-1) |
| `voiceTargetChain`, `resolveCurrentVoiceTarget`, `resetVoiceTarget` | cadeia preferred → fallback, já pronta |

**Catálogo — `useSpeechStore` (stage-ui):** `availableSpeechProvidersMetadata`,
`supportsModelListing`, `providerModels`, `filteredModels`,
`isLoadingActiveProviderModels`, `availableVoices`,
`isLoadingSpeechProviderVoices`, `getVoicesForProvider(provider, model?)`.

**Card — `stores/modules/airi-card.ts`:** `updateActiveCardSpeech({ provider,
model, voice_id })` (grava em `extensions.airi.modules.speech` e chama
`applyActiveCardSettings()`) e `persistActiveCardModuleSelections()`.

Consequência direta: **não** criar provider registry, catálogo próprio, runtime
TTS, fallback runtime, nem lista hardcoded de providers ou models. A regra
"provedor/model nunca hardcoded" é atendida consumindo o catálogo vivo acima, e
"sem campo livre de Model ID" é atendida com dropdowns.

---

## 4. A decisão central: onde mora a verdade

Hoje existem **dois** lugares que descrevem a voz, e eles não se conhecem:

| Lugar | Quem lê | Persistência |
| --- | --- | --- |
| `lia-product.json` → `voice.tts` | a aba Voz, a cadeia de fallback 4D | arquivo no `userData` |
| `extensions.airi.modules.speech` | o runtime do AIRI, via `applyActiveCardSettings()` | card, via `useLocalStorageManualReset` |
| `settings/speech/active-provider` etc. | `useSpeechStore` | localStorage (default `speech-noop`) |

O §8.2 do plano da Phase 4 já prevê os dois primeiros: *"persistir também no card
via `persistActiveCardModuleSelections`/`updateActiveCardSpeech`"*.

**Recomendação:** `voice.tts` continua sendo a **fonte de verdade da Lia**.
`extensions.airi.modules.speech` e o speech store são **projeções derivadas**,
escritas no mesmo gesto de salvar — exatamente o modelo já usado na persona, onde
`extensions.airi.persona` é a fonte e `description/personality/scenario` são
derivados.

Isso evita repetir o erro que a migração do card teve de corrigir: nunca ter duas
fontes editáveis do mesmo fato. A regra prática fica:

- a UI **lê** de `voice.tts` (via `useLiaVoiceStore`);
- a UI **escreve** em `voice.tts` e, no mesmo fluxo, projeta para o card e para o
  speech store;
- nenhuma tela edita a projeção diretamente.

**Ponto de atenção a validar na implementação:** o que acontece se o usuário
mudar a voz pelo Settings do AIRI. Ou a projeção volta a divergir, ou o Settings
do AIRI deixa de ser o caminho. Isso é a decisão 9.1.

---

## 5. Estrutura da tela

Substituir o `<dl>` read-only atual da aba Voz, mantendo a mesma linguagem visual
do resto do painel e sem transformar a tela em painel administrativo.

```
Voz
Como a Lia fala.

  Voz da Lia            [ ▾ catálogo: provider › modelo › voz ]
  [ ▶ Ouvir amostra ]
  Voz reserva           [ ▾ mesma árvore, opcional ]  (colapsado por padrão)

  [ Salvar ]   [ Limpar voz ]

  nota: "Voz configurada." / "Nenhuma voz configurada ainda." / erro
```

Princípios:

- **Uma escolha por vez.** O usuário pensa "qual voz", não "qual provider". A
  árvore provider › modelo › voz é o mecanismo; o rótulo é o nome da voz.
- **Sem campo livre de Model ID.** Sempre dropdown alimentado pelo catálogo.
- **Estados de carregamento e erro visíveis**, vindos de
  `isLoadingActiveProviderModels`, `isLoadingSpeechProviderVoices` e
  `speechProviderError`. Silenciar erro é o anti-padrão que este projeto já
  rejeitou.
- **Salvar é explícito.** Nada persiste só por navegar ou abrir a aba — a 4E-1 já
  garantiu isso para leitura e a 4E-2 mantém para escrita.
- **Teste de voz não persiste.** Ouvir a amostra usa o runtime; não grava nada.

---

## 6. Fluxo de escrita

```
usuário escolhe voz
  → (opcional) ouvir amostra via applyVoiceTarget temporário, sem persistir
  → Salvar
      → useLiaVoiceStore.updateTtsConfig({ preferred, fallback })
          → normalizeLiaVoiceTts  (descarta campos desconhecidos/credenciais)
          → applyTtsState         (refs do store)
          → persistTtsConfig      → IPC Set → lia-product.json
      → useAiriCardStore.updateActiveCardSpeech({ provider, model, voice_id })
      → useAiriCardStore.persistActiveCardModuleSelections()
      → applyVoiceTarget(preferred)   (runtime fala já, sem precisar reiniciar)
```

Invariantes a manter:

1. **Nenhum segredo em `lia-product.json`.** `normalizeTtsTarget` no main já
   mantém só `providerId/modelId/voiceId` e descarta o resto — inclusive
   `apiKey`/`baseUrl`. A UI não deve tentar contornar isso. Chaves continuam no
   vault da 4C.
2. **`fallback` sempre array.** O serviço main materializa `[]`; o store já
   garante isso. Uma substituição não pode derrubar a lista por omissão.
3. **`voice.stt` intocado.** A ponte só possui a fatia `tts`.
4. **Se a escrita no card falhar, o estado não pode ficar meio aplicado.**
   Decidir ordem e compensação — é a decisão 9.2.

---

## 7. i18n

pt-BR é a linguagem principal. Toda string nova entra em **pt-BR e en juntas**,
no namespace `tamagotchi.home.config.sections.voice.*`, que hoje tem 11 chaves
(`title`, `summary`, `fields.{provider,model,voice,fallback,unset}`,
`configured`, `notConfigured`, `loading`, `loadError`).

O teste `lia-config.test.ts` já compara os dois locales inteiros e extrai as
chaves referenciadas **inclusive as interpoladas** — qualquer chave nova só em um
lado quebra a suíte. Esse mecanismo deve ser mantido como está.

Termos técnicos que não devem ser traduzidos (`API key`, `Base URL`) entram na
tabela de termos quando o cleanup de i18n do AIRI acontecer — registrado em
`docs/product/M1-I18N-DEBT.md`, fora desta fase.

---

## 8. Testes

Mínimo, seguindo o padrão já estabelecido (node para lógica, `*.browser.test.ts`
para montagem real):

1. Escolher uma voz e salvar → `updateTtsConfig` chamado com o alvo certo e o IPC
   `Set` invocado uma vez.
2. O alvo salvo sobrevive ao round-trip: `lia-product.json` → `refreshConfig()` →
   mesmos `providerId/modelId/voiceId`.
3. Salvar também projeta no card (`updateActiveCardSpeech` chamado com os três
   campos).
4. Abrir a aba **não** grava nada — regressão da garantia da 4E-1.
5. Falha na persistência → a UI mostra erro e não finge sucesso.
6. `fallback` vazio é gravado como `[]`, nunca omitido.
7. Nenhuma credencial aparece no payload enviado (o teste do main já cobre o lado
   do serviço; aqui é o lado do renderer).
8. Reiniciar mantém a voz: store novo + mesmo documento → mesmos valores.
9. **Atualizar** `voice-hydration.test.ts`: a asserção "nenhum módulo em runtime
   escreve `voice.tts`" deve passar a apontar para o novo escritor legítimo, em
   vez de ser apagada.

Sem testes de screenshot.

---

## 9. Decisões em aberto (precisam da sua resposta)

**9.1 — Se o usuário mudar a voz pelo Settings do AIRI, o que acontece?**
(a) a projeção diverge e a aba Voz passa a mostrar algo diferente do que está
soando; (b) o Settings do AIRI deixa de expor voz; (c) a aba Voz passa a ler o
speech store em vez de `voice.tts`. **Recomendo (b)**: uma superfície só. Mas é
mudança no AIRI e precisa da sua decisão.

**9.2 — Ordem e compensação se a escrita no card falhar depois de
`voice.tts` já ter sido gravado.** (a) gravar o card primeiro; (b) gravar
`voice.tts` primeiro e compensar; (c) aceitar divergência temporária e
ressincronizar na próxima abertura. **Recomendo (a)** — o card é barato de
escrever e é o que o runtime lê.

**9.3 — Voz default de fábrica.** O §8.3 do plano da Phase 4 sugere um TTS cloud
configurável com `kokoro-local` como reserva, **condicionado a teste real em
hardware**. A 4E-2 deve (a) não definir default nenhum, só permitir escolher; ou
(b) já nascer com um default. **Recomendo (a)** nesta fase, e decidir o default
depois do teste de hardware.

**9.4 — Amostra de voz.** Tocar uma amostra exige decidir o texto (fixo em pt-BR?
o nome da Lia?) e garantir que não persiste nada. **Recomendo** texto fixo curto
em pt-BR, sem persistência.

**9.5 — Escopo do `fallback` nesta fase.** Expor a escolha da voz reserva agora,
ou só a voz principal e deixar o `fallback` para depois? O modelo de dados já
suporta os dois; é só questão de superfície.

---

## 10. Fora de escopo

- STT/ouvir, permissões de microfone, barge-in, sensibilidade de VAD.
- Novos providers de TTS, Edge-TTS, AllTalk, RVC, Voice Studio.
- Sistema de memória.
- Roupas, acessórios, VRM (fase de Avatar).
- i18n legado do painel de Settings do AIRI (`docs/product/M1-I18N-DEBT.md`).
- Os 12 failures baseline do QA automatizado.

---

## 11. Critério de pronto

1. Escolher uma voz na aba Voz e salvar faz a Lia falar com ela, sem reiniciar.
2. Reiniciar o app mantém a voz, e a aba mostra os mesmos valores.
3. Nenhum segredo em `lia-product.json`, em log ou em export.
4. `pnpm typecheck` sem erros novos além dos 3 baseline conhecidos.
5. Suíte verde, com o teste novo de escrita e o `voice-hydration.test.ts`
   atualizado de propósito.
6. Todas as strings novas em pt-BR e en, sem divergência entre os locales.
7. Validação real no Windows: abrir → Voz → escolher → ouvir → salvar → falar →
   reiniciar → confirmar.
