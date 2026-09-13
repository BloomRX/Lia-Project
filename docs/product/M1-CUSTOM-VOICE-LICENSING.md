# Custom voices: licensing and what the Lia does not ship

This is a note about boundaries, not legal advice. It exists because a voice
cloning feature touches three things with three different licences, and it is
easy to blur them.

## The three things, and who owns which

| | What it is | Licence | Does the Lia ship it? |
|---|---|---|---|
| The Lia | This application | Unchanged by this feature | Yes |
| AllTalk | The local speech server the Lia talks to over HTTP | Its own licence | **No** |
| XTTS-v2 | A backend AllTalk can load to clone a voice | **Coqui Public Model License (CPML), non-commercial** | **No** |

**Nothing about this feature changes the Lia's own licence.** No third-party
code was copied in, no weights were vendored, and no model is downloaded by the
app.

## What the user installs themselves

Both AllTalk and any XTTS-v2 weights are installed separately, by the user, on
their own machine. The Lia never downloads, bundles, mirrors or redistributes
them. What the Lia does is:

- remember an address the user typed (`voice.runtime.alltalk.baseUrl`);
- remember a folder the user picked through the OS dialog (`voicesDir`);
- copy the user's *own* reference audio into that folder so AllTalk can resolve
  it by name.

If neither is installed, the app runs normally: the panel reports "Not
configured" and every other voice keeps working.

## XTTS-v2 specifically

The XTTS-v2 **weights** are released under the **Coqui Public Model License
(CPML)**, which restricts use to non-commercial purposes. The licence text ties
this to payment rather than to intent — permitted "only so far as you do not
receive any direct or indirect payment arising from the use of the model or its
output".

Coqui Inc shut down in January 2024, so there is no longer a party selling a
commercial licence for these weights. Treat XTTS-v2 as **non-commercial only,
with no route to change that**.

One published summary claims the CPML permits commercial use below thresholds
of US$1M annual revenue or 10,000 end users. That reading conflicts with the
licence text quoted above and with the majority of sources, so **do not rely on
it**. Anyone weighing commercial use should read the `LICENSE.txt` shipped with
the checkpoint on Hugging Face rather than trusting any summary, including this
one.

Note the split that catches people out: the Coqui TTS *library* (Python code) is
MPL-2.0 and is fine commercially. It is the trained *weights* that are CPML.
"Code is open" and "model is free for my product" can be false and true at once.

## Imported voices are the user's responsibility

A user can import any audio they can put a file path to. The Lia validates the
file, copies it, and publishes it — it does not and cannot judge where the
recording came from. Cloning a voice without that person's consent may be
unlawful in the user's jurisdiction regardless of any software licence.

The app therefore:

- keeps the recording private, under `userData`, never in the repository;
- stores no binary in any config, so a shared settings file leaks nothing;
- makes removal real: deleting a profile deletes the canonical file and the
  derived copy the Lia published.

## What is deliberately not here

- No weights in the repository, and no download step that would fetch them.
- No training or fine-tuning in the Lia.
- No bundling of AllTalk into the installer.
- No change to the Lia's own licence.
