# M1 — Custom Voice, Phase 3: AllTalk end to end

Branch `arena/01a07b6d-lia-project`. Base `badbc9b`. **Status: NOT a PASS of custom voice.**

What changed this round: a custom voice went from "importable but silent" to
importable, publishable, selectable, previewable and speakable in chat — with an
AllTalk server running on the user's machine.

| SHA | Content |
|---|---|
| `1fc2ac5` | AllTalk runtime config + owned voice sync (main process) |
| `3e639ca` | `custom-local-voice` provider + end-to-end synthesis |
| `80b73f1` | Custom voice panel in the Voz tab |
| `b26b2b3` | Restart + offline-fallback tests |

---

## 1. Final `AllTalkRuntimeConfig` schema

```ts
// shared/eventa/index.ts
interface LiaAllTalkRuntimeConfig {
  baseUrl: string       // no trailing slash
  voicesDir?: string    // absent when not configured
  voicesDir is never settable from the renderer
  timeoutMs?: number
}
```

The client's own `AllTalkRuntimeConfig` has `baseUrl` and `timeoutMs` required;
`resolveAllTalkRuntime()` fills both from documented defaults
(`http://127.0.0.1:7851`, `60_000`) so no caller has to ask whether a default was
applied. An unset `voicesDir` stays **absent** rather than becoming `''`, because
"not configured" and "configured as empty" owe the user different instructions.

## 2. Where it is persisted

`voice.runtime.alltalk` inside the existing **`userData/lia-product.json`** — not
a new file. The `voice` domain already held `tts` and `stt`; runtime settings are
"where a voice comes from" rather than "which voice is selected", so they sit
beside them. Additive and optional: a document written before this slice existed
still parses, no migration, nothing lost.

`mergeAllTalkRuntime()` is pure and tested to leave `voice.tts` and `voice.stt`
byte-identical. **This bridge is not a second writer of the voice selection.**

## 3. Ownership / sync strategy

```
userData/lia-voices/<profile-id>/reference.wav   CANONICAL, owned by the Lia
<alltalk voicesDir>/lia-<profile-id>.wav         DERIVED COPY, disposable
```

The canonical file is the only thing the Lia treats as real. The copy exists
solely because AllTalk resolves `character_voice_gen` as a filename *inside its
own folder* and cannot be handed reference audio over the API. Deleting or
moving AllTalk's folder costs one re-sync — proven by a test that wipes the
folder and rebuilds the copy.

The original is never moved out of `userData`, and no user file is renamed.

## 4. Managed filename strategy

`lia-<profile-id>.<ext>`, where the id must match the `randomUUID()` shape the
store mints and the extension must be one of `.wav .mp3 .flac .ogg`. Derived,
never chosen: the user's original filename is never used, so two profiles
imported from files that happened to share a name cannot collide, and a
hand-made `lia.wav` cannot be mistaken for ours.

**Removal re-derives the name from the profile id** and only unlinks when the
recorded metadata matches that recomputation exactly and still resolves inside
the configured `voicesDir`. A directory is never removed whatever it is named.

**Change detection uses size + mtime, not a hash.** A profile's reference audio
is written once at import and never rewritten in place — importing again mints a
new id — so size+mtime identifies the content completely. Hashing would read a
possibly large WAV on every preview for information the metadata already
carries. The invariant is documented in the module so a future in-place replace
knows it must re-sync.

## 5. Provider registration

`packages/stage-ui/src/libs/providers/providers/custom-local-voice/`. Registered
**now, not earlier**, because before this it could not synthesize and a silent
entry in the picker is worse than no entry.

- `requiresCredentials: false`, `tasks: ['text-to-speech']`
- `listModels: []` — no model catalogue, which keeps the model picker hidden
  rather than broken (the shape Kokoro already relies on)
- `listVoices` maps imported profiles, with `languages` as `{code, title}` pairs
- No transport installed → `CustomVoiceUnavailableError`, a distinct recoverable
  error. The transport is injected; `stage-ui` stays free of Electron and the
  desktop app installs one at startup in `renderer/main.ts`.

## 6. The real request to AllTalk

```
profile id
  -> ensureProfileAvailableToAllTalk()   publish the reference WAV if needed
  -> managed filename                    lia-<profile-id>.wav
  -> POST /api/tts-generate              form-urlencoded, answers with JSON
  -> GET  output_file_url                the actual bytes
```

`character_voice_gen` receives the managed filename, `language` receives `pt`
(reduced from `pt-BR`), and only documented fields are sent so the server's
Global API defaults apply. Tested against a real local HTTP server that records
what it was asked for — so "AllTalk received the managed filename" is an
assertion, not a hope.

## 7. Preview path

`CustomVoicePanel` → `profilesStore.previewProfile()` → `createVoicePreviewDriver()`
→ `providersStore.getProviderInstance('custom-local-voice')` → `speechStore.speech()`
→ provider `fetch` → transport → main process. Text: `Olá! Eu sou a Lia.`

No second synthesis path.

## 8. Chat path

`Stage.vue` → `resolveSynthesisTarget()` → `speechStore.speech()` → the same
provider. A custom voice resolves with no model and no catalogue entry, which is
exactly what `resolveSynthesisTarget` was built to allow in round 4.

**A source-level guard asserts `custom-local-voice` appears in none of
`Stage.vue`, `voice-preview.ts` or `synthesize-target.ts`.** If either grew a
branch, the preview would sound right while the chat stayed mute — the failure
earlier rounds chased.

## 9. Offline / fallback

The provider **throws** when the server is unreachable; it does not return
silence and does not implement its own fallback. The existing 4D policy carries
the turn, driven through its real contract (`onAttemptFailed` / `onTurnEnded`):

preferred (custom, offline) fails → reserve assumed once → sticky for the turn →
`onTurnEnded` restores the preferred, so a server that recovers is used again.

## 10. UI

Configurar Lia → Voz → "Voz personalizada": server status (Conectado /
Desconectado / Não configurado / Erro / Verificando), base URL, folder picker,
import, and per-profile name · language · backend · status · Use / Test / Remove.

`window.prompt`/`confirm` are blocked by lint here, so naming a voice and
confirming a removal are inline states. No stack trace is ever rendered. Status
is fetched on open and after a config change — **no polling loop**.

Import is best-effort about publishing: with no server configured the profile
still joins the library with a per-row note. Selecting a profile goes through
`saveTtsConfiguration()`.

## 11. Licensing

`docs/product/M1-CUSTOM-VOICE-LICENSING.md`. Summary: the Lia ships no AllTalk
and no weights; XTTS-v2 weights are **Coqui Public Model License, non-commercial
only**, and Coqui shut down in January 2024 so no commercial licence can be
bought. The Coqui TTS *library* is MPL-2.0 (commercially fine) — the *weights*
are what is restricted. One published summary claims revenue thresholds permit
commercial use; that conflicts with the licence text and the majority of
sources, so the doc says not to rely on it. The Lia's own licence is unchanged.

## 12. Tests

**90 new this round; 104 covering the feature in total.**

| File | Tests |
|---|---|
| `alltalk-client.test.ts` (round 6) | 14 |
| `alltalk-runtime-config.test.ts` | 16 |
| `alltalk-synthesis.test.ts` | 11 |
| `alltalk-voices-sync.test.ts` | 24 |
| `custom-voice-restart.test.ts` | 3 |
| `custom-voice-convergence.test.ts` | 8 |
| `custom-voice-fallback.test.ts` | 5 |
| `CustomVoicePanel.test.ts` | 12 |
| `custom-local-voice/index.test.ts` (stage-ui) | 11 |

All 24 required cases are covered. HTTP-dependent tests run against a real local
server; nothing needs a real AllTalk.

## 13. Mutations — 8/8 detected

| # | Mutation | Result |
|---|---|---|
| MQ1 | Bypass path ownership on removal | 1 failed |
| MQ2 | Let the renderer set `voicesDir` | 2 failed |
| MQ3 | Provider hardcodes the profile id | 1 failed |
| MQ4 | Provider skips the second hop | 9 failed |
| MQ5 | Preview grows a custom-voice branch | 1 failed |
| MQ6 | Sync writes outside `voicesDir` | 8 failed |
| MQ7 | Offline becomes a non-recoverable error | 2 failed |
| MQ8 | Selection bypasses `saveTtsConfiguration` | 2 failed |

**Two of these needed the test fixed first, and both were my fault** (a third
class of mistake, type errors I had already committed, is recorded under
*Validation* below):

- **MQ6 originally passed.** Removing the `isInside` check before a copy changed
  nothing, because `managedVoiceFilename` already guarantees a bare name — the
  guard was unreachable dead code, not a tested property. Replaced with an
  assertion on the outcome: walk the whole temp tree, nothing lands outside
  `voicesDir`.
- **MQ3 originally passed.** The test used `profile-a` as both the selection and
  the plausible hardcode, so pinning the id was invisible. Now uses an id no
  guess would produce.

### Mistakes worth recording

Three separate times this round, a check I had skipped found something a check I
had run did not:

1. **Mutations MQ3 and MQ6 passed on the first try** because the tests were
   wrong, not the code (above).
2. **`stage-ui` `vue-tsc` found two errors I had already committed.** The
   provider test read `.speech` off a `ProviderInstance`, which is a union of
   chat/embed/speech/transcription/model providers and has no such property. The
   tamagotchi typecheck does not reach that file, so skipping the stage-ui run
   hid it.
3. **A type error in the restart test** only appeared on a later tamagotchi run:
   `LiaProductConfig` is the schema's *output* type, where `persona`, `provider`
   and `preferences` are required because the schema gives them defaults.

All three are fixed; both packages now typecheck independently and the suites are
green.

## 14. Validation

| Check | Result |
|---|---|
| tamagotchi node suite | **94 files / 756 passed / 1 skipped** |
| stage-ui node suite | **135 files / 875 passed** |
| `vue-tsc --noEmit` (tamagotchi) | **3 errors = baseline exact** |
| `vue-tsc --noEmit` (stage-ui) | **0 errors** |
| ESLint (files touched) | **0** |

The 3 baseline errors are pre-existing and untouched:
`provider-config-service.ts(41,32) TS2322`, `home.vue(85,9) TS6133`,
`lia-persona.ts(383,42) TS6133`.

`stage-ui` `vue-tsc` was skipped in the first pass and run afterwards, which is
what caught the two `ProviderInstance` errors described below. Both packages are
now typechecked independently.

## 15. What still requires QA on Windows

Nothing here was run against a real AllTalk server, on Windows, with a GPU or
without one. Specifically unverified:

1. **A real AllTalk v2 answering `/api/tts-generate`.** The request shape is
   taken from the official wiki and exercised against a mock, not against the
   product.
2. **The folder picker on Windows**, including UNC paths and a folder on another
   drive.
3. **Reference-audio copy across volumes** — `rename` cannot move across
   filesystems, and the atomic-copy path assumes `voicesDir` and its staging
   file are on the same one (they are, by construction, but this is untested on
   a real Windows layout).
4. **Audio actually reaching the speakers** through the existing playback path
   for a WAV that AllTalk produced.
5. **Latency** for a full round trip on the target hardware.
6. **XTTS-v2 quality and language behaviour** for `pt` with a Brazilian
   reference recording.
7. **The panel's real rendering in a browser.** `CustomVoicePanel.test.ts`
   renders it through `renderToString` and pins the words and controls for each
   state, but no Electron or display exists here, so it was never actually shown
   on screen — layout, focus order and click behaviour are unverified.

**Custom voice is NOT PASS until this is done.**
