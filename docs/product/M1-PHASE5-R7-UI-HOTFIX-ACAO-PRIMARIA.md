# M1 Fase 5 — Round 7, hotfix de UI: o botão que derivava de booleanos improvisados

Adendo ao `M1-PHASE5-R7-CONTINUACAO-OFICIAL-E-ROOT-LOCAL.md`. Este documento
registra a correção pedida no brief A–H: a derivação da ação primária do cartão
de instalação, sem nenhum toque no bootstrap, Miniconda, comandos de setup,
AllTalk, instalação de pacotes, implementação de migração, launchers ou TTS.

## 1. Estado exato que escondia o botão

Duas falhas combinadas, não uma:

1. **O card inteiro desaparecia.** Quando o IPC `electronLiaRuntimeState`
   rejeitava (o caso real: a migração de root lançando EPERM dentro do handler,
   corrigido no main em `c3cda69`), o probe do renderer classificava o runtime
   como `'error'` — e o gate da section
   (`needsInstall || bootstrapOutcome || state === 'error'`) recusava
   `'error'`. Resultado: desmontar o cartão, não apenas esconder o botão. O
   usuário via uma tela de voz vazia, sem nenhum caminho de ação.
2. **O botão se escondia por booleanos de template.** Mesmo montado, o botão
   vivia atrás de `v-if="!isReady && !isRunning"`, e `needsRepair` era um
   booleano composto à mão. **Toda** fase ativa (`checking`, runs de ida e
   volta intermediárias) escondia o botão — exatamente quando o painel deveria
   mostrar que algo está acontecendo.

Fixture oficial do relato (R6/R7): fonte presente, Miniconda válido, env
incompleto, `start_alltalk.bat` ausente, último bootstrap `failed`, runtime
não-ready — combinação que os booleanos antigos classificavam de forma solta.

## 2. Template responsável

`src/renderer/components/lia-config/sections/RuntimeInstallCard.vue`:

- o bloco do botão com `v-if="!isReady && !isRunning"` e os rótulos por
  `needsRepair`/`isFailed || isCancelled`;
- a função `onPrimaryAction` que convertia `needsRepair` no flag de intent do
  `runBootstrap`;
- `src/renderer/components/lia-config/sections/VoiceSection.vue`, com o gate
  de montagem do cartão (sem o caso `'error'`).

## 3. Por que os testes antigos não pegaram

Os testes antigos alimentavam as stores via **mock de estado coerente**:
runtime `notInstalled` + bootstrap `undefined`/`not-installed` — combinações
que os booleanos de template até acertavam. Dois buracos reais nunca foram
exercitados:

- **IPC rejeitando** (probe do runtime em `'error'`): nenhum teste montava a
  section com o invoke do estado rejeitando, então o desmonte do cartão inteiro
  passava despercebido;
- **fases ativas intermediárias** como 'checking' em conjunto com runtime
  não-ready: os invariantes antigos *(button hidden while installing)* chegavam
  a **consagrar** o comportamento escondido como correto — o teste protegia o
  bug.

## 4. Regra nova

`shared/lia-voice.ts` exporta `resolveVoiceRuntimePrimaryAction({ bootstrap,
runtimeReady })`, pura, única fonte da derivação card-wide:

| Estado real | Ação primária |
| --- | --- |
| `not-installed` / sem bootstrap | `install` ("Instalar") |
| fases ativas (`checking`, `installing-prerequisites`, `installing-runtime`, `preparing-model`, `verifying`) | `installing` — botão **visível e desabilitado** ("Instalando…") |
| `failed` com `failureCategory === 'health'` | `repair` ("Reparar") |
| `failed` (demais causas) | `retry` ("Tentar novamente") |
| `cancelled` | `retry` |
| `repair-needed` | `repair` |
| `ready` | `repair` |

`'none'` só existe — e só pode existir — quando o runtime está realmente
`ready`; para custom voice com runtime incompleto, `'none'` é, por definição,
bug. O cartão calcula tudo a partir disso: visibilidade, estado desabilitado e
rótulo; `onPrimaryAction` envia o flag de intent apenas quando a ação é
'repair'. UI e bootstrap usam o mesmo resolver de root (verificado);
nenhum novo estado paralelo foi inventado.

## 5. Teste R7 (fixture do relato + mutação)

- `shared/lia-voice.test.ts` — matriz G1–G8 cobrindo cada fase/canônico;
  inclui a fixture oficial do relato (steps metade-feitos, run-setup `failed`,
  runtime `notInstalled`) esperando `'retry'`, e o par `'none'` só com
  `runtimeReady`.
- `BootstrapProgressUi.test.ts` — 3 novos testes no componente real: a matriz
  "nenhum estado real deixa o painel sem ação" (not-installed habilitado,
  injetando fases ativas com botão desabilitado, ready com Reparar), a fixture
  R7 com rótulo "Tentar novamente", e o mount com probe `'error'`.
- **Verificação de mutação**: remover a ramificação `ready || repair-needed
  → repair` (mutar para `ready` apenas) faz `lia-voice.test.ts` falhar com
  exatamente "repair-needed → repair"; restaurado, 539/539 verdes.
- Os invariantes antigos que consagravam o esconderijo (botão ausente durante
  o run; "done: no action button") foram **reescritos intencionalmente** para o
  novo contrato: botão visível-desabilitado durante o run, Reparar como ação de
  manutenção no estado pronto.

## 6. SHA

Hotfix de UI: **`8d7c21a`** — "fix(lia-ui): derive the install card's primary
action from real state (round-7 ui hotfix)". Soma: 539 testes passando
(services/lia main + lia-config renderer + stores/lia + shared), `vue-tsc
--noEmit` com 0 erros, eslint limpo nos arquivos tocados. O typecheck aproveita
o round para quitar dívidas latentes de tipagem nos services do main (ponte
provider/chat, cast do getPath 'localAppData', step 'runtime-root' no log,
locais mortos) — nada disso altera bootstrap, Miniconda, setup, AllTalk,
instalação de pacotes, migração, launchers ou TTS.

## Por fim (H)

O hotfix **não** declara o installer PASS. O próximo passo permanece sendo o
QA Windows da Round 7 (empacotar e click-through na máquina), agora com o
cartão derivando ação de estado real em vez de booleanos improvisados.
