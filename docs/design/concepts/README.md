# Lia — Design Concepts

This folder stores **visual references**, not production UI assets.

The goal is to give implementation agents and developers a stable visual target without forcing the runtime UI to depend on PNG screenshots.

---

## Rules

1. Concept images define:
   - composition;
   - visual hierarchy;
   - spacing direction;
   - product mood;
   - relationship between Lia and controls;
   - normal-user terminology.

2. Concept images do **not** define:
   - exact technical parameters;
   - unsupported controls;
   - final responsive behavior;
   - backend/provider implementation;
   - engine-specific settings that do not exist.

3. Production UI must remain capability-driven.

4. Lia should remain the visual protagonist.

5. Normal UI should avoid technical jargon.

6. Advanced provider/backend/runtime information belongs behind an advanced surface.

---

## Suggested filenames

```text
docs/design/concepts/
  README.md
  01-home.png
  02-ai-resources.png
  03-voice.png
  04-personality.png
  05-appearance.png
  06-presence.png
  07-tools.png
```

Use source-quality images where possible.

Do not use screenshots of partially implemented UI as replacements for the golden concepts unless the design itself has intentionally changed.

---

## Concept status

| # | Concept | Status | Notes |
|---|---|---|---|
| 01 | Home | Existing | Current primary visual baseline |
| 02 | IA & Recursos | Existing direction | Brain + perception + voice + tools overview |
| 03 | Voz | Existing direction | Keep style; real controls remain engine-specific |
| 04 | Personalidade | To create | Must express Lia's canonical identity without becoming prompt engineering UI |
| 05 | Aparência | Existing direction / revise | Lia model + clothes; separate from desktop Presence |
| 06 | Presença | To create | Static vs Free mode, background, hover-hide, movement behavior |
| 07 | Ferramentas | To create | User-readable capabilities and permissions |

---

## Home

Home should remain simple and character-first.

Primary action:

**Conversar com Lia**

Possible compact status summary:

- Cérebro
- Voz
- Percepção
- Ferramentas

Do not turn Home into a technical dashboard.

---

## IA & Recursos

Purpose:

> Make it obvious what Lia is currently using to think, perceive, speak, and act.

Primary hierarchy:

1. Brain
2. Perception
3. Voice
4. Tools

The selected brain should be visually dominant.

“Automático” means:

> Use the selected brain's native capability when available.

Overrides may route a specific capability to another model.

---

## Voz

Purpose:

> Configure how Lia sounds.

The concept may show:

- selected engine;
- readiness;
- profile;
- preview;
- optional converter;
- engine-specific settings.

Do not copy decorative or illustrative sliders into production unless the selected engine actually supports those parameters.

---

## Personalidade

Purpose:

> Configure how Lia behaves while preserving her canonical identity.

Suggested visual groups:

- Lia Original preset;
- personality traits;
- conversation behavior;
- initiative/autonomy;
- preview/example reaction.

Avoid raw system-prompt text in the normal UI.

---

## Aparência

Purpose:

> Configure how Lia herself looks.

Key areas:

- Lia base model;
- outfits;
- accessories;
- expressions;
- future look presets.

The product currently assumes Lia as the canonical character rather than a generic avatar browser.

---

## Presença

Purpose:

> Configure how Lia occupies the desktop.

### Static Mode

- background on/off;
- transparent mode;
- position;
- scale;
- hide on hover.

### Free Mode

- movement enabled;
- allowed behavior;
- pause;
- pin;
- return Home;
- hide on hover;
- fullscreen handling.

Hide-on-hover is a shared option across both modes.

---

## Ferramentas

Purpose:

> Show what Lia is allowed to do.

Potential groups:

- Arquivos
- Computador
- Navegador
- Jogos
- Terminal

The first-level UI should use user-facing language.

Detailed permissions may live one level deeper.

---

## Production assets vs design references

Recommended separation:

```text
production assets:
  app-specific asset directory
  e.g. hero images, icons, avatar resources actually used at runtime

design references:
  docs/design/concepts/
```

The existing Lia hero image belongs in production assets when it is integrated into the application.

Golden concept PNGs belong in this folder.
