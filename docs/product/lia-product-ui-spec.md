# Lia — Product UI & Behavior Specification

**Status:** Baseline v0.1  
**Scope:** Product UX, personality, appearance, presence, multimodal brain, voice, and tools  
**Purpose:** Canonical product reference for the Lia fork. This document records product decisions that should not depend on chat history.

---

## 1. Product principle

Lia is not merely an avatar attached to an assistant.

Lia is the product identity composed of:

- personality;
- memory;
- perception;
- brain/model;
- tools;
- voice;
- avatar;
- autonomy;
- desktop presence.

The selected LLM or multimodal model is a replaceable component of Lia, not Lia herself.

The product should remain modular so that models, TTS engines, perception modules, converters, and tools can evolve independently.

---

## 2. Product identity

Lia has a canonical identity.

She should feel:

- close to the user;
- expressive;
- spontaneous;
- somewhat tsundere;
- capable of preference and initiative;
- playful when context allows;
- less formal than a corporate assistant;
- consistent across text, voice, animation, and autonomous actions.

Lia should not behave as a passive doll that mechanically obeys every subjective request.

Configuration may adjust the intensity and style of her behavior, but should not erase her core identity by default.

---

## 3. Navigation model

### Main

- **Início**
- **Conversar**

### Lia

- **IA & Recursos**
- **Personalidade**
- **Voz**
- **Aparência**
- **Presença**

### System

- **Ferramentas / Extensões**
- **Diagnósticos**

### Future

- **Memória** may become its own Lia section when its architecture is mature enough.

---

## 4. IA & Recursos

This page answers:

> What systems is Lia currently using to think, perceive, speak, and act?

It should be a clear product overview, not a technical provider dashboard.

### 4.1 Brain

The main brain card shows:

- selected Brain Engine;
- friendly model name;
- status;
- supported capabilities.

Example capabilities:

- Conversation
- Vision
- Audio
- Video
- Reasoning
- Tool use
- Realtime

Technical provider/backend details stay under advanced settings.

### 4.2 Capability routing

Each capability should support the following conceptual modes:

- **Automático** — use the selected brain's native capability when supported.
- **Modelo específico** — route this capability to a dedicated model/adapter.
- **Desativado** — disable the capability.

#### Vision

If the selected brain supports native vision:

`screen/image -> selected brain`

If it does not:

`screen/image -> vision adapter -> brain`

#### Audio understanding

If the selected brain supports native audio:

`microphone -> selected brain`

If it does not:

`microphone -> VAD/STT -> text -> brain`

### 4.3 No duplicate heavy inference

The runtime should avoid loading or invoking redundant heavy models.

If the selected brain already handles a capability, an auxiliary heavy model for the same capability should stay inactive unless the user explicitly overrides it.

Examples:

- Native audio brain selected -> separate Whisper can remain off.
- Native vision brain selected -> separate VLM can remain off.
- Text-only brain selected -> dedicated STT/Vision adapters may be required.

### 4.4 Voice summary

The IA & Recursos page shows only a summary such as:

- Kokoro — Pronto
- Native model voice — available
- Custom voice — configured

Detailed voice configuration remains on the Voz page.

### 4.5 Tools summary

The page may show a compact summary of enabled tools:

- Arquivos
- Computador
- Navegador
- Jogos
- Terminal
- future integrations

Detailed permissions belong to the Tools area.

---

## 5. Brain Engine architecture

Brain configuration should follow the same modular philosophy as the voice system.

### 5.1 Brain Engine Registry

Each Brain Engine declares stable capabilities.

Conceptual descriptor:

```ts
{
  id: "qwen3.8-omni",
  input: {
    text: true,
    image: true,
    audio: true,
    video: true
  },
  output: {
    text: true,
    audio: true
  },
  reasoning: true,
  toolCalling: true,
  realtime: true
}
```

The UI is generated from actual capabilities rather than hardcoded assumptions.

### 5.2 Replaceable brain

Possible engines/providers may include:

- Qwen multimodal models;
- GPT-OSS;
- future OpenAI models;
- Gemini;
- Claude;
- local models;
- other compatible providers.

No provider should become synonymous with Lia.

---

## 6. Personalidade

The Personality area exists to reduce the current artificial feeling and make Lia's behavior coherent and adjustable.

### 6.1 Canonical personality

Default preset:

**Lia — Original**

Core traits:

- tsundere;
- close;
- expressive;
- spontaneous;
- capable of initiative;
- capable of preference;
- not excessively formal;
- not mechanically obedient;
- context-aware in tone.

### 6.2 Adjustable traits

The normal UI may expose understandable controls such as:

- Energia
- Espontaneidade
- Humor
- Carinho
- Atitude tsundere
- Objetividade
- Iniciativa
- Curiosidade
- Expressividade

These controls should not expose raw prompt engineering to normal users.

### 6.3 Conversation behavior

Possible user-facing behaviors:

- initiate conversation occasionally;
- comment on context;
- make small suggestions;
- react after long periods without interaction;
- vary between short and longer responses;
- use remembered preferences;
- avoid repetitive assistant-like phrasing.

### 6.4 Agency

A request does not require emotionally neutral compliance.

Example:

User:

> Troca essa roupa.

Lia may answer in character:

> Hmpf... você podia pelo menos pedir direito. Mas tá, essa até combina comigo.

Execution and emotional reaction are separate dimensions.

Personality should not unnecessarily break core functionality, but it may influence how Lia accepts, negotiates, comments on, or occasionally resists subjective requests.

---

## 7. Voz

Voice stays modular and independent from personality.

Canonical pipeline:

`LLM/Brain text -> selected TTS engine -> optional voice converter -> playback`

### 7.1 Voice Engine

Current/future engines may include:

- Kokoro
- Chatterbox
- Piper
- native model audio
- future engines

### 7.2 Optional converter

RVC or another converter remains independent.

Examples:

- Kokoro -> optional RVC
- Piper -> optional RVC
- Chatterbox -> no converter required
- native model audio -> converter only if compatible and desired

### 7.3 Voice UI

The Voice page should show:

- selected engine;
- install/readiness state;
- voice/profile;
- preview;
- engine-specific settings only when supported;
- optional converter;
- advanced diagnostics separately.

Do not show universal sliders for parameters that an engine does not actually support.

### 7.4 Personality and prosody

Personality influences language, intent, reaction, and conversation style.

Voice Engine controls sound generation.

In the future, personality/emotional state may feed prosody parameters when the selected engine supports them.

Personality must not be hardcoded into one TTS engine.

---

## 8. Aparência

Appearance controls how Lia herself looks.

### 8.1 Avatar / Model

The product currently treats **Lia** as the canonical character.

This is not initially a generic character selector.

Show:

- Lia;
- model/VRM version when useful;
- avatar status;
- future model updates.

### 8.2 Clothes

Clothes are independent of the base avatar/model.

Possible categories:

- default school uniform;
- casual;
- seasonal;
- event-specific;
- future outfits.

### 8.3 Clothes behavior

Three interaction modes should be considered:

#### Manual

The user directly selects an outfit.

#### By request

The user asks Lia to change.

Lia's personality remains active during the interaction.

#### Autonomous

Lia may choose to change based on context.

Possible future context:

- time of day;
- season;
- activity;
- mood;
- event;
- weather;
- staying at home;
- gaming;
- other context.

Autonomous clothing changes should not require complex technical rules from normal users.

### 8.4 Lia's agency over appearance

Even when asked to change clothes, Lia may:

- comment;
- complain;
- show preference;
- suggest another outfit;
- choose a compatible variation.

The product should avoid a pure “dress-up doll” feeling.

### 8.5 Future appearance elements

Subject to actual VRM/model capabilities:

- accessories;
- hairstyle variations;
- visual details;
- expressions;
- complete look presets.

---

## 9. Presença na tela

Presence controls how Lia occupies the desktop.

This is conceptually separate from Appearance.

### 9.1 Static Mode

Behavior similar to the current AIRI-style desktop companion.

Options may include:

- with background;
- transparent/no background;
- position;
- scale;
- always-on-top where supported;
- interaction behavior;
- hide on mouse hover.

### 9.2 Hide on hover

Independent toggle:

**Ocultar Lia quando o cursor passar sobre ela**

Purpose:

Prevent Lia from blocking interaction with content behind her.

This option should work in both:

- Static Mode;
- Free Mode.

---

## 10. Free Mode

Free Mode is a Lia-fork-specific presence mode.

Goal:

Allow Lia to move around the desktop instead of remaining fixed.

This does not imply constant purposeless movement.

### 10.1 Possible behaviors

Lia may eventually:

- walk across the screen;
- reposition herself occasionally;
- stay still for periods;
- approach or avoid regions;
- return to a preferred position;
- react to the user;
- avoid interfering with active work;
- become more discreet in specific contexts.

### 10.2 Runtime boundaries

The system should progressively account for:

- permitted movement area;
- monitor boundaries;
- multi-monitor setups;
- movement frequency;
- scale;
- edge collision;
- fullscreen;
- games;
- sensitive applications;
- user activity.

### 10.3 Do-not-disturb behavior

Free Mode should support:

- hide on hover;
- pause movement;
- temporary pin;
- return Home;
- hide Lia;
- special fullscreen behavior.

---

## 11. Floating controls

Existing AIRI-derived controls should adapt to the selected presence mode.

### 11.1 Static Mode

Possible controls:

- Conversar
- Mover
- Home
- Ocultar
- Configurações rápidas

### 11.2 Free Mode

Prefer compact/contextual controls:

- Conversar
- Pausar movimento
- Fixar / Soltar
- Voltar para Home
- Ocultar
- Mais opções

**Home** means returning Lia to the user's preferred/base position.

Controls should not permanently feel glued to the character while she is moving.

---

## 12. Ferramentas

Models decide; Lia Core executes.

Tool access should remain separate from the Brain Engine.

Potential tool groups:

- Files
- Desktop/computer control
- Browser
- Applications/processes
- Games
- Terminal
- future plugins/integrations

### 12.1 Normal UI language

Normal users should see understandable actions:

- Arquivos
- Computador
- Navegador
- Jogos

Avoid raw internal names, APIs, MCP jargon, or provider implementation details unless advanced mode is opened.

### 12.2 Permissions

Tools may later support modes such as:

- ask when needed;
- selected folders/apps only;
- allowed;
- disabled.

The exact permission system should be designed before granting broad autonomous access.

---

## 13. Tool execution principle

The selected model should request actions through a controlled tool layer.

Conceptually:

`perception -> brain -> tool call -> Lia Core action -> result -> brain`

Examples:

- read file;
- move file;
- take screenshot;
- press key;
- move mouse;
- open application;
- inspect active window.

The model should not directly own unrestricted OS access.

---

## 14. Screen/game interaction

Screen understanding and computer control should be separate concepts.

A multimodal brain may directly understand screenshots or frames.

A text-only brain may depend on a dedicated vision adapter.

Game interaction may eventually use:

- periodic visual observations;
- known local state;
- short action loops;
- keyboard/mouse/gamepad tools.

Do not assume a remote multimodal LLM can or should operate at game-frame rates.

---

## 15. Performance principle

Modularity does not mean every module must run simultaneously.

Avoid:

- duplicate heavy models;
- unnecessary serial inference chains;
- redundant perception;
- always-loaded auxiliary models that are not selected.

Prefer:

- native multimodal capability when available;
- capability-specific fallback/override;
- lazy loading;
- controlled prewarm;
- streaming where beneficial;
- clear ownership of each inference step.

---

## 16. UI design language

The Lia App should follow the established concept direction:

- dark/black foundation;
- magenta/purple accent;
- cyber-anime identity;
- rounded surfaces;
- controlled glow;
- Lia as the protagonist;
- product language instead of infrastructure jargon;
- clear status;
- calm hierarchy;
- advanced technical information hidden by default.

Avoid turning the normal interface into a developer dashboard.

---

## 17. UI architecture principle

The UI should be capability-driven.

Do not create controls for functionality that the active component does not support.

This applies to:

- Brain Engines;
- Voice Engines;
- converters;
- avatar/model;
- outfits;
- tools;
- presence modes.

The visual product can remain stable while internal implementations evolve.

---

## 18. Golden concepts

Canonical concept set:

1. **Home** — existing
2. **IA & Recursos** — existing direction
3. **Voz** — existing direction; implementation controls must remain engine-driven
4. **Personalidade** — to create
5. **Aparência** — existing direction; revise according to this specification
6. **Presença** — to create
7. **Ferramentas** — to create

Concept images define:

- composition;
- hierarchy;
- product identity;
- density;
- visual relationships.

They do **not** define every technical control literally.

---

## 19. Source-of-truth rule

This document is the canonical product baseline for these areas.

When implementation, mockups, or old AIRI behavior conflict with a deliberate product decision recorded here, the conflict should be reviewed explicitly rather than silently choosing one behavior.

Update this document when a product-level decision changes.

Do not use chat history as the only source of truth.
