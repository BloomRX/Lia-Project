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
4. Indicar uma **voz de reserva** — escolha secundária, `[Nenhuma]` por padrão
   (decisão 9.5).
5. Poder **limpar** a voz e voltar ao estado "nenhuma voz configurada", que é
   válido e não um erro (decisão 9.3: não há default de fábrica).

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

**Decidido (9.1):** a voz da Lia tem uma única superfície — a tela Configurar
Lia. O Settings do AIRI não deve oferecer configuração de voz concorrente na
experiência da Lia, e isso entra como **cleanup próprio em commit separado**
quando a 4E-2 for implementada, sem se misturar com o escritor. Enquanto esse
cleanup não existir, a rota paralela pode divergir; ela não é tratada como
suportada e a divergência se resolve pela regra acima na próxima abertura.

---

## 5. Estrutura da tela

Definição de produto fechada. Substitui o `<dl>` read-only atual da aba Voz,
mantendo a linguagem visual do resto do painel.

```
Voz

Voz principal
  Provedor
  Voz
  Modelo (somente quando necessário)

[▶ Ouvir exemplo]

Voz de reserva
  [Nenhuma]
  ou
  escolher outra voz
```

E, por baixo, o que está gravado — em texto discreto, para quem precisar conferir
sem transformar a tela em painel técnico:

```
voice.tts.preferred
voice.tts.fallback[]
```

Mapeamento para o que já existe (seção 3):

| Campo | Fonte |
| --- | --- |
| Provedor | `availableSpeechProvidersMetadata` |
| Voz | `availableVoices` / `getVoicesForProvider(provider, model?)` |
| Modelo (quando necessário) | `providerModels`, exibido só se `supportsModelListing` |
| Estados de espera/erro | `isLoadingActiveProviderModels`, `isLoadingSpeechProviderVoices`, `speechProviderError` |

Princípios:

- **Ordem Provedor → Voz → Modelo**, e o Modelo **só aparece quando o provider
  exige** (`supportsModelListing`). Não expor Modelo por padrão é o que impede a
  tela de virar configuração técnica.
- **Sem campo livre de Model ID.** Sempre dropdown alimentado pelo catálogo vivo.
- **Voz de reserva é secundária**: `[Nenhuma]` como padrão, escolha opcional
  abaixo da principal. A capacidade de fallback fica transparente sem competir
  com a escolha dominante.
- **Estados de carregamento e erro visíveis.** Silenciar erro é anti-padrão já
  rejeitado neste projeto.
- **Salvar é explícito.** Nada persiste só por abrir a aba.
- **Ouvir exemplo não persiste** nada (decisão 9.4).

---

## 6. Fluxo de escrita

Ordem decidida em 9.2: **a fonte de verdade primeiro, a projeção depois.**

```
usuário escolhe voz
  → (opcional) [▶ Ouvir exemplo] — runtime apenas, nada persistido
  → Salvar
      1. useLiaVoiceStore.updateTtsConfig({ preferred, fallback })
             → normalizeLiaVoiceTts   (descarta campos desconhecidos/credenciais)
             → applyTtsState          (refs do store)
             → persistTtsConfig       → IPC Set → lia-product.json   ← FONTE
      2. useAiriCardStore.updateActiveCardSpeech({ provider, model, voice_id })
         useAiriCardStore.persistActiveCardModuleSelections()         ← PROJEÇÃO
      3. applyVoiceTarget(preferred)   (fala já, sem precisar reiniciar)
```

Se o passo 2 falhar:

- **`voice.tts` permanece gravado** — a fonte de verdade não é revertida;
- a UI **mostra erro**;
- **não existe estado "parcialmente salvo"** na interface: ou salvou, ou falhou;
- na **próxima abertura da aba**, a projeção é **ressincronizada a partir de
  `voice.tts`** quando houver divergência. Sem isso a falha ficaria silenciosa
  até o próximo restart, e isso é requisito, não detalhe.

Invariantes a manter:

1. **Nenhum segredo em `lia-product.json`.** `normalizeTtsTarget` no main mantém
   só `providerId/modelId/voiceId` e descarta o resto — inclusive
   `apiKey`/`baseUrl`. A UI não contorna isso; chaves continuam no vault da 4C.
2. **`fallback` sempre array.** O serviço main materializa `[]` e o store já
   garante; uma substituição não pode derrubar a lista por omissão. `[Nenhuma]`
   na UI é `fallback: []`, nunca ausência do campo.
3. **`voice.stt` intocado.** A ponte só possui a fatia `tts`.
4. **Sem default de fábrica** (9.3): salvar sem escolher nada não é um caminho; o
   estado "nenhuma voz" vem de não ter salvo, não de um default implícito.

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
9. **Ordem (9.2):** `voice.tts` é gravado **antes** da projeção do card — o teste
   deve afirmar a ordem, não apenas que os dois aconteceram.
10. **Falha na projeção (9.2):** com o card falhando, `voice.tts` continua
    gravado, a UI reporta erro, e a próxima abertura **ressincroniza** a projeção
    a partir da fonte.
11. **Modelo só quando necessário (seção 5):** com `supportsModelListing` falso, o
    campo Modelo não é renderizado.
12. **Ouvir exemplo não persiste (9.4):** tocar a amostra não invoca o IPC `Set`
    nem `updateActiveCardSpeech`.
13. **`[Nenhuma]` na voz de reserva** é gravado como `fallback: []`, nunca como
    ausência do campo.
14. **Atualizar** `voice-hydration.test.ts`: a asserção "nenhum módulo em runtime
    escreve `voice.tts`" deve passar a apontar para o novo escritor legítimo, em
    vez de ser apagada.

Sem testes de screenshot.

---

## 9. Decisões fechadas

As cinco decisões foram fechadas em 2026-09-12. O que segue é o combinado, não
mais uma recomendação.

### 9.1 — Uma única superfície de voz

A voz da Lia tem **uma** superfície: a tela **Configurar Lia**. O Settings do
AIRI **não** deve oferecer configuração de voz concorrente na experiência da Lia.

**Isso é um cleanup próprio, feito quando a 4E-2 for implementada, em commit
separado — não misturado com o escritor.** Duas razões: o escritor é o caminho
crítico e não deve carregar mudança no AIRI; e o cleanup tem risco e revisão
próprios.

Consequência a registrar: enquanto o cleanup não acontecer, existe uma rota
paralela que pode divergir da fonte de verdade. Ela não deve ser tratada como
suportada, e a divergência se resolve pela regra da seção 4 (a fonte de verdade
vence) na próxima abertura da aba.

### 9.2 — Ordem de escrita: a fonte de verdade vence

**Gravar `voice.tts` primeiro; só depois atualizar a projeção do card.**

Se a atualização do card falhar:

- mostrar erro ao usuário;
- **manter `voice.tts` persistido** — não reverter a fonte de verdade;
- **não inventar um estado "parcialmente salvo"**: ou a UI diz que falhou, ou diz
  que salvou.

Isso inverte a recomendação anterior deste documento (que era gravar o card
primeiro). A razão de produto prevalece: a fonte de verdade nunca pode ficar
atrás da projeção.

**Requisito de implementação que decorre disso:** como `voice.tts` pode ficar
gravado enquanto o card não foi atualizado, a abertura da aba precisa
**ressincronizar a projeção a partir da fonte de verdade** quando detectar
divergência. Sem isso, a falha ficaria silenciosa até o próximo restart.

### 9.3 — Sem default de fábrica nesta fase

A 4E-2 **não define voz default**. O §8.3 do plano da Phase 4 condiciona essa
escolha ao teste real do `kokoro-local` em hardware, e uma hipótese não vira
default de produto antes desse teste.

A aba continua podendo mostrar "Nenhuma voz configurada ainda." — e isso é um
estado válido, não um erro.

### 9.4 — Amostra de voz

Texto **fixo, curto e em pt-BR**, **sem persistência**. Conteúdo **neutro**, que
permita avaliar timbre e pronúncia — não uma fala da personalidade da Lia, para
que a amostra não sugira conteúdo que a voz não vai reproduzir no uso real.

Tocar a amostra usa o runtime e não grava nada em `lia-product.json` nem no card.

### 9.5 — Voz de reserva exposta agora, de forma secundária

O `fallback` **entra nesta fase**, mas como escolha **secundária**: a voz
principal domina a tela; abaixo dela, "Voz de reserva" com `[Nenhuma]` como
opção padrão, opcional.

O objetivo é tornar a capacidade de fallback **transparente** sem transformar a
tela em configuração técnica.

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
8. **Cleanup do Settings do AIRI entregue em commit separado** (decisão 9.1): a
   superfície da Lia passa a ser a única que configura voz. Não misturar com o
   escritor.

Ordem de entrega sugerida, um commit por responsabilidade:

1. escritor (`voice.tts` → projeção → runtime) + testes;
2. UI da aba Voz (voz principal, ouvir exemplo, voz de reserva) + i18n pt-BR/en;
3. ressincronização da projeção na abertura + teste de divergência;
4. cleanup do Settings do AIRI.
