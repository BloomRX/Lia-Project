# Lia — UI & Capability Implementation Roadmap

**Status:** Draft baseline  
**Purpose:** Keep product UI work aligned with the runtime architecture while implementation proceeds in small phases.

---

## Principle

Do not implement every future capability at once.

First establish:

- product structure;
- data model;
- capability descriptors;
- reusable UI components.

Then connect real systems incrementally.

Each implementation phase should end with a coherent, testable milestone.

---

## Current product direction

The Lia App should become a stable shell around:

- Brain / multimodal model selection;
- capability routing;
- personality;
- voice;
- appearance;
- desktop presence;
- tools;
- diagnostics.

The AIRI Stage remains the managed companion frontend/runtime until intentionally changed.

---

## Proposed phase family

### 8.0A — Lia App Design System + Shell Foundation

Goal:

Translate the golden concepts into reusable product UI primitives.

Scope:

- design tokens;
- navigation shell;
- page header;
- cards;
- sections;
- status badges;
- setting rows;
- selectors;
- toggles;
- empty states;
- responsive behavior;
- accessibility;
- normal/advanced information hierarchy.

Do not implement new multimodal models in this phase.

---

### 8.0B — Brain Engine Registry

Goal:

Create a provider/model-neutral registry for Lia's main brain.

Capabilities may include:

- text;
- image;
- audio;
- video;
- reasoning;
- tool calling;
- realtime;
- audio output.

No hardcoded assumption that one provider equals Lia.

---

### 8.0C — Capability Router

Goal:

Route each capability to:

- selected brain natively;
- a dedicated override;
- disabled state.

Avoid duplicate heavy inference.

---

### 8.0D — First Multimodal Brain Adapter

Candidate:

Qwen Omni family or another validated multimodal model.

Validation should include:

- text conversation;
- image/screen understanding;
- audio understanding where supported;
- tool calling;
- latency;
- region/network impact;
- failure behavior.

Do not make a model the permanent default until measured on the target Windows machine.

---

### 8.0E — Perception Foundation

Goal:

Establish perception inputs independently from model choice.

Possible inputs:

- microphone;
- screenshot;
- window capture;
- future camera/video.

Perception producers should feed the Capability Router.

---

### 8.0F — Tool Registry

Goal:

Define controlled actions Lia may request.

Initial candidates:

- files;
- application/process operations;
- screenshot/window inspection;
- mouse/keyboard;
- browser integration.

Permission design is part of the product, not an afterthought.

---

### 8.0G — Personality Foundation

Goal:

Move Lia away from generic/artificial assistant behavior.

Deliver:

- canonical Lia personality schema;
- user-facing trait settings;
- conversational behavior rules;
- stable system/prompt composition seam;
- no raw prompt editing in normal UI.

Keep personality independent from TTS.

---

### 8.0H — Appearance Foundation

Goal:

Represent Lia as the canonical avatar with configurable appearance.

Deliver:

- base model identity;
- outfit registry;
- outfit selection;
- future autonomous outfit seam;
- character-consistent reaction layer.

Do not turn the first implementation into a generic avatar marketplace.

---

### 8.0I — Presence Modes

Goal:

Formalize desktop presence.

Modes:

- Static
- Free

Shared behavior:

- background/transparency;
- hover-hide;
- scale;
- position;
- quick controls.

Free Mode is implemented progressively.

---

### 8.0J — Free Mode Experiment

Goal:

Prove that Lia can safely move around the desktop.

Initial experiment:

- one monitor;
- bounded area;
- simple reposition/walk behavior;
- pause;
- pin;
- return Home;
- hover-hide;
- no interference with fullscreen.

Multi-monitor and richer autonomy come later.

---

## Voice roadmap remains modular

Existing voice direction remains valid:

- Kokoro current engine;
- future additional engine(s);
- optional independent RVC;
- personality/prosody refinement;
- latency optimization.

Brain-native audio may be offered as another voice option, not as a replacement for the Voice Engine abstraction.

---

## UI implementation rule

Concepts drive visual hierarchy.

Capability schemas drive actual controls.

Do not copy a mock control into production merely because it appears in a concept image.

---

## Git/documentation rule

Product-level decisions should be committed under `docs/`.

Concept PNGs should be committed under:

`docs/design/concepts/`

Production assets should live in the application's normal asset tree.

Update documentation whenever a deliberate product-level decision changes.
