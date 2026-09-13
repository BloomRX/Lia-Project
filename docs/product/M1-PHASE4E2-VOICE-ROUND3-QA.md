# 4E-2 — WINDOWS QA ROUND 3 (plano corrigido)

## O que mudou em relação ao plano que você mandou

Três correções, todas verificadas no código:

### 1. HEAD esperado é `18c381f`

Adicionei a instrumentação que o TESTE 7 procurava. **Faça `git pull` de novo.**

```
cd J:\Lia-Project
git checkout arena/01a07b6d-lia-project
git pull origin arena/01a07b6d-lia-project
git log --oneline -7
```

Esperado, nesta ordem:

```
18c381f docs(lia): QA plan for 4E-2 round 3, corrected for where the logs land
2a????? (este arquivo)
c371cec feat(lia): add build-mode-gated audio diagnostics for the Kokoro path
8326751 docs(lia): note the report commit in the 4E-2 round 2 findings
76bd178 docs(lia): report the 4E-2 round 2 findings
5f44ee8 fix(lia): keep Kokoro voice discovery off an unverified WebGPU backend
efe9dec fix(lia): stop querying unconfigured providers and drop speech-noop from the picker
215557f fix(lia): hydrate the speech runtime from the persisted voice
```

**O que importa é que `c371cec` esteja presente** — é ele que traz os logs. Os
commits de documentação acima dele não afetam o comportamento. Se `c371cec` não
aparecer, pare: os TESTES 3, 5 e 7 não vão produzir nada.

### 2. O terminal do `DevTamagotchi.bat` NÃO mostra esses logs

O `.bat` roda `pnpm dev:tamagotchi` e mostra o log do **main process**. As três
tags novas são `console.info` do **renderer** — elas não aparecem nesse terminal.

**Use F12.** Verificado em `apps/stage-tamagotchi/src/main/index.ts:394`:
`optimizer.watchWindowShortcuts(window)` é aplicado a *toda* janela criada, então
F12 abre/fecha o DevTools em desenvolvimento em qualquer janela.

### 3. A janela de chat tem o SEU console

O chat é um `BrowserWindow` separado em `#/chat`
(`src/main/windows/chat/index.ts:47`). Portanto:

| Log | Aparece no DevTools de… |
| --- | --- |
| `[LIA-KOKORO-AUDIO]` (preview) | janela **Home / Configurar Lia** |
| `[LIA-VOICE-RUNTIME] stage=hydrate` do launcher | janela **Home** |
| `[LIA-VOICE-RUNTIME] stage=hydrate` do chat | janela **CONVERSAR** ← pressione F12 *nela* |
| `[LIA-KOKORO-AUDIO]` (fala do chat) | janela **CONVERSAR** |

Se você abrir F12 só na Home, o TESTE 5 vai parecer "nenhum log" e não é.

---

## O que cada log diz — e por que isso resolve o TESTE 3

`[LIA-KOKORO-AUDIO] stage=worker-output` sai **antes** de qualquer conversão, com
os samples exatamente como o worker ONNX devolveu. É a linha que separa
"inferência ruim" de "empacotamento ruim" — o encoding já está descartado por um
teste determinístico, mas agora dá para confirmar na sua máquina.

| Leitura em `stage=worker-output` | Diagnóstico | Onde está o bug |
| --- | --- | --- |
| `nonFinite > 0` | a inferência produziu NaN/Infinity | backend ONNX (WebGPU/WASM) |
| `rms` ≈ 0 e `min = max = 0` | buffer silencioso | modelo não gerou nada |
| `rms > 0.9`, ou `max > 1`, ou `min < -1` | saturação/clipping | normalização na inferência |
| `rms` entre 0.05 e 0.3, `min`/`max` dentro de ±1, `nonFinite = 0`, `ctor = Float32Array` | **samples corretos** → o problema é depois | `toWav` ou `decodeAudioData` |
| `sampleRate` ≠ 24000 | taxa de amostragem errada | header / worker |
| `ctor` ≠ `Float32Array` | buffer do tipo errado | `postMessage` do worker |
| `durationMs` incompatível com o tamanho do texto | reamostragem errada | worker |

E comparando as duas linhas:

- `worker-output` ruim **e** `wav-response` coerente → o bug é a **inferência**.
- `worker-output` bom **e** `wav-response` com `sampleRate`/`channels`/`dataSize`
  incoerentes → o bug é o **encoding**.
- **Ambos bons** e ainda assim ruído → o bug está no **playback/decode**.

**Copie as duas linhas `[LIA-KOKORO-AUDIO]` inteiras.** Elas valem mais do que a
classificação A–E.

---

## TESTES 1 a 7

Mantidos como você escreveu, com duas observações.

### TESTE 1 — PICKER
Como está. `"None"` ainda aparecendo = FAIL imediato.

### TESTE 2 — KOKORO SEM TROCAR DE PROVIDER
Como está. Se aparecer `optimized dependencies changed. reloading`, copie a linha.

> Nota: o reload aparente do primeiro clique também pode ser outra coisa. Antes
> desta rodada, a primeira descoberta de catálogo escolhia WebGPU implicitamente
> (`5f44ee8` mudou isso para WASM). Carregar o backend GPU se parece com um
> restart. Se o reload sumiu mas ficou lento, é o WASM carregando — esperado na
> primeira vez.

### TESTE 3 — PREVIEW KOKORO
Como está, **mais**: abra F12 antes de clicar em ▶ e copie as duas linhas
`[LIA-KOKORO-AUDIO]`.

Classifique A–E e **não chame C de PASS**. Se der ruído, teste no máximo mais uma
voz — mas agora a segunda voz só interessa se a primeira tiver `nonFinite = 0`.

### TESTE 4 — PERSISTÊNCIA
Como está.

### TESTE 5 — CHAT TTS  ← o crítico
Como está, **mais**: F12 **na janela CONVERSAR** antes de enviar a mensagem.

O que procurar, em ordem:

1. `[LIA-VOICE-RUNTIME] stage=hydrate` — existe?
   - **Não existe** → a hidratação não rodou nessa janela; bug de boot.
   - Existe com `resolvedTarget: null` → nada foi persistido; bug de persistência.
   - Existe com `resolvedTarget` preenchido mas `activeProvider: "speech-noop"` →
     `applyVoiceTarget` não aplicou; bug no store.
   - Existe com `activeProvider: "kokoro-local"` → hidratação OK, siga para 2.
2. `[LIA-KOKORO-AUDIO] stage=worker-output` — saiu?
   - **Não saiu** → `speech()` não chegou ao provedor; bug de segmentação/dispatch.
   - Saiu → compare com o preview. Mesmo `rms`/`nonFinite` = mesmo bug.
3. Se os dois logs são bons e não há áudio → bug de playback.

É exatamente essa árvore que distingue *"preview = ruído / chat = ruído"* de
*"preview = ruído / chat = silêncio"*, que é o que você pediu.

### TESTE 6 — PROVIDER PERFORMANCE
Como está. Providers não configurados agora mostram
**"Configure este provedor antes de escolher uma voz dele"** e **não fazem
request nenhum**. Dos ~19 provedores de TTS, só `kokoro-local` não exige nada.

### TESTE 7 — CONSOLE
Salve **dois** logs: o terminal do `.bat` (main) e o console de cada janela (F12 →
botão direito → *Save as…*).

Busque por: `kokoro`, `onnx`, `wasm`, `webgpu`, `LIA-KOKORO-AUDIO`,
`LIA-VOICE-RUNTIME`, `optimized dependencies`, `Error`, `Unhandled`.

---

## Validação executada antes de enviar

| Suíte | Resultado |
| --- | --- |
| `stage-ui` (node) | **134 arquivos, 864 passed** (9 testes novos) |
| `stage-tamagotchi` (node) | **82 arquivos, 629 passed, 1 skipped** |
| ESLint nos arquivos alterados | **0 erros** |
| `vue-tsc` tamagotchi | **3 erros = baseline exato** |
| `vue-tsc` stage-ui | **0 erros** |

Uma coisa que os testes revelaram e eu tinha errado: `import.meta.env.DEV` é
`true` no vitest. O gate é por build mode, então num `vite build` de produção fica
fechado — e num `DevTamagotchi.bat` fica aberto, que é o que queremos. Não há
flag de localStorage que reabra isso em produção.
