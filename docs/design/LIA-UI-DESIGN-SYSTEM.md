# Lia — UI Design System & App Shell

**Status:** Baseline v0.1  
**Scope:** Lia App visual language, shell, navigation, reusable UI primitives, concepts, production assets, status surfaces, and implementation rules.  
**Purpose:** Canonical design baseline for implementing the Lia App without depending on chat history or improvising visual/product decisions.

---

## 1. Product identity

Lia is the product.

AIRI is an underlying technical base/fork/engine and should not appear as the primary brand in the normal Lia UI.

### Branding rule

> **Do not display “Projeto AIRI” or AIRI branding in the normal Lia product shell.**

AIRI may remain referenced in:

- source code where technically required;
- architecture documentation;
- upstream/fork notes;
- diagnostics when implementation details are explicitly relevant.

The normal user experience should present **Lia**.

---

## 2. Design direction

The established visual direction is:

- dark/near-black foundation;
- magenta and violet accent;
- controlled neon/cyber-anime influence;
- Lia as the visual protagonist;
- rounded panels/cards;
- soft gradients;
- subtle glow;
- clear status;
- spacious hierarchy;
- expressive but not noisy;
- product language instead of infrastructure jargon.

The UI should feel like a polished companion product, not a developer dashboard.

---

## 3. Golden concepts

Canonical concept set:

```text
docs/design/concepts/
  01-home.png
  02-ai-resources.png
  03-voice.png
  04-personality.png
  05-appearance.png
  06-presence.png
  07-tools.png
```

Current role of each concept:

1. **Home**  
   Primary visual baseline and character-first landing page.

2. **IA & Recursos**  
   Brain, perception, voice, and tool overview.

3. **Voz**  
   Visual direction for voice configuration. Actual controls must remain engine-capability-driven.

4. **Personalidade**  
   Visual direction for canonical Lia personality, traits, behavior, initiative, and response preview.

5. **Aparência**  
   Visual direction for Lia model identity, outfits, accessories, expressions, and visual presets.

6. **Presença**  
   Visual direction for Static/Free desktop presence, hover-hide, scale, background, movement, and Home behavior.

7. **Ferramentas**  
   Visual direction for user-readable capabilities, permissions, status, and access configuration.

Concept images define:

- composition;
- visual hierarchy;
- visual density;
- mood;
- relationship between Lia and controls;
- normal-user terminology.

Concept images do **not** define:

- exact backend implementation;
- unsupported controls;
- provider-specific details;
- final responsive breakpoints;
- technical parameters that the active capability does not expose.

---

## 4. Production assets vs design references

Keep product assets and visual references separate.

### Design references

```text
docs/design/concepts/
```

These files guide implementation and review.

They are not loaded by the runtime UI.

### Canonical Lia product assets

Recommended product-owned location:

```text
lia/assets/
  character/
    LiaHeroImage.png

  brand/
    LiaName.png

  icons/
    IconAppCompact.png
    IconAppToolBar.png
```

These assets belong to the Lia product boundary, not the AIRI technical subtree.

Do not place new canonical Lia identity assets under `airi/` merely because the current runtime implementation still lives there.

A later architectural phase may migrate more Lia-owned runtime/code boundaries non-destructively.

---

## 5. App shell

The shell should be stable across primary Lia App pages.

Primary regions:

```text
┌───────────────────────────────────────────────┐
│ Sidebar        │ Main content / status        │
│                │                              │
│                │                              │
│                │                              │
│ Version + ⚙    │                              │
└───────────────────────────────────────────────┘
```

The shell should not visually compete with Lia or with the active page.

---

## 6. Sidebar branding

### 6.1 Top-left

The top-left branding area should stay deliberately minimal.

Preferred option:

```text
[ IconAppCompact / L icon ]
```

Alternative:

```text
[ LiaName image ]
```

Do not show all of the following together:

```text
L icon
Lia
Desktop Companion
```

The product brand should not be repeated unnecessarily.

### 6.2 Branding frequency

> **The Lia brand appears once in the main shell.**

Avoid repeating:

- “Lia”
- “Desktop Companion”
- AIRI/project branding

at both the top and bottom of the sidebar.

---

## 7. Sidebar footer

The bottom-left area is functional, not a second branding area.

Preferred structure:

```text
Beta · 0.0.1        ⚙
```

or:

```text
Live · v0.1.0       ⚙
```

The version/channel label should be:

- discreet;
- low contrast;
- small;
- non-dominant.

The settings gear lives in this bottom area.

### Rule

> **Global Settings belongs in the sidebar footer, not in the top-right product status area.**

---

## 8. Main top-right status area

Moving Settings away from the top-right reserves this area for useful product context.

Potential future status items:

- Lia ready;
- current Brain Engine;
- microphone state;
- voice state;
- presence mode;
- connectivity;
- active operation;
- warning/error when relevant.

Do not permanently show every status at once.

Use contextual priority.

Example:

```text
● Lia pronta
```

Expanded or contextual states may show:

```text
Qwen Omni
Kokoro
Mic ativo
Modo Livre
```

when they materially help the current workflow.

---

## 9. Navigation

Proposed navigation hierarchy:

### Main

- Início
- Conversar

### Lia

- IA & Recursos
- Personalidade
- Voz
- Aparência
- Presença

### System

- Ferramentas / Extensões
- Diagnósticos

Global settings are opened by the footer gear and may contain:

- Geral
- Atualizações
- Privacidade e Segurança
- Dados
- Sobre

A dedicated Memória area may be added later after its architecture is defined.

---

## 10. Page structure

Primary settings/configuration pages should usually follow:

```text
Page header
Short explanatory copy
Primary/highest-importance card
Secondary sections
Contextual Lia visual / illustration where appropriate
Advanced details only when needed
```

Do not give every card equal visual weight.

The page's primary decision should be visually dominant.

Examples:

- IA & Recursos → Brain card dominates.
- Voz → selected Voice Engine dominates.
- Personalidade → Lia Original / personality identity dominates.
- Presença → current presence mode dominates.
- Ferramentas → capability/access state dominates.

---

## 11. Lia as protagonist

Lia should remain visibly part of the product.

Possible roles:

- hero illustration;
- character preview;
- contextual reaction;
- appearance preview;
- presence preview;
- personality preview.

Do not force a large character illustration into every dense technical surface.

Use Lia when she reinforces product identity or helps explain the setting.

The interface should never feel like a generic settings app with a character pasted on top.

---

## 12. Home

Home remains simple and character-first.

Primary action:

**Conversar com Lia**

Possible compact information:

- current Brain;
- Voice status;
- Perception readiness;
- Tools state.

Do not turn Home into a dashboard.

The hero image is a canonical production asset, not a placeholder.

---

## 13. IA & Recursos

Purpose:

> Make it immediately clear what Lia is using to think, perceive, speak, and act.

Hierarchy:

1. Brain
2. Perception
3. Voice
4. Tools

### Brain

Show:

- friendly model name;
- selected state;
- user-facing capabilities.

Avoid normal-mode jargon such as:

- provider endpoint;
- OpenAI-compatible transport;
- backend implementation;
- raw model IDs unless needed.

### Perception

Typical cards:

- Ver
- Ouvir

Modes:

- Automático
- Modelo específico
- Desativado

“Automático” means:

> Use the selected Brain Engine's native capability when available.

### Voice

Summary only:

```text
Kokoro
Pronto
[ Configurar voz ]
```

### Tools

Compact enabled/disabled summary.

Detailed permissions belong deeper in Ferramentas / Privacy & Security.

---

## 14. Personalidade

Purpose:

> Adjust Lia while preserving Lia.

Default identity:

**Lia — Original**

Normal UI may expose understandable traits such as:

- Energia
- Espontaneidade
- Humor
- Carinho
- Objetividade
- Iniciativa
- Curiosidade
- Expressividade

Tsundere behavior is part of Lia's canonical identity and should not be treated merely as a generic personality slider that silently transforms Lia into an unrelated character.

### Behavior section

May include:

- can initiate conversation;
- can comment on context;
- can suggest alternatives;
- preserves personality when receiving subjective commands;
- avoids overly formal assistant language;
- can demonstrate preferences.

### Preview

A response preview is encouraged.

It helps users understand behavioral changes without exposing raw system prompts.

---

## 15. Voz

The Voice page must preserve the real modular voice architecture.

Canonical pipeline:

```text
Brain text
  ↓
selected TTS Engine
  ↓
optional voice converter
  ↓
playback
```

Normal page structure:

- Voice Engine;
- install/readiness state;
- profile/voice;
- preview;
- engine-specific options;
- optional converter;
- advanced details.

### Capability-driven controls

Do not create universal sliders merely because they look good in a concept.

Only display parameters the selected engine actually supports.

Examples:

- Kokoro controls may differ from Chatterbox;
- Piper may expose different settings;
- RVC belongs to an optional converter layer;
- native Brain audio may be represented as another output route.

---

## 16. Aparência

Purpose:

> Configure how Lia herself looks.

### Avatar / Model

The canonical character is Lia.

This is not initially a generic avatar marketplace/browser.

Show:

- Lia;
- model/VRM identity/version when useful;
- avatar readiness/status.

### Outfits

Clothes are separate from the base Lia model.

Future behavior may support:

- manual selection;
- change by request;
- autonomous change based on context.

The UI should support Lia having preferences/reactions instead of behaving like a passive dress-up doll.

### Other future areas

Depending on model capability:

- accessories;
- hairstyle variations;
- expressions;
- look presets.

---

## 17. Presença

Purpose:

> Configure how Lia occupies the desktop.

Appearance and Presence are separate concepts:

```text
Aparência = how Lia looks
Presença  = how Lia behaves/exists on the desktop
```

### Static Mode

Possible controls:

- background on/off;
- transparency;
- position;
- scale;
- always-on-top behavior;
- hover-hide.

### Free Mode

A Lia-specific extension.

Possible controls:

- movement enabled;
- movement boundaries;
- pause;
- pin;
- return Home;
- fullscreen behavior;
- monitor selection;
- hover-hide.

### Hover-hide

“Ocultar ao passar o mouse” is a cross-mode option.

It can apply to both:

- Static Mode;
- Free Mode.

### Home

“Home” means Lia returns to the user's preferred/base desktop position.

---

## 18. Ferramentas

Purpose:

> Show what Lia is able and allowed to do.

User-facing categories may include:

- Arquivos
- Computador
- Navegador
- Jogos
- Terminal

Important distinction:

```text
Tool enabled ≠ Full permission
```

First-level cards show status and purpose.

Detailed access belongs under permission controls.

Examples:

```text
Arquivos
Ativado
Ler, criar, mover e organizar arquivos
[ Permissões ]
```

Do not surface MCP/internal tool schemas to normal users.

---

## 19. Security UI integration

Global Settings should eventually include:

```text
Privacidade e Segurança
```

Potential groups:

### Permissions

- Microphone
- Screen
- Files
- Computer
- Terminal

### Protections

- Confirm sensitive actions
- Protect system paths
- Block automatic elevation
- Record activity

### Activity

- View Activity History

Security states should use the same visual system as the rest of Lia rather than looking like a separate enterprise application.

---

## 20. Core visual tokens

Exact production values should be extracted/refined during implementation, but the semantic token system should exist from the first design-system phase.

Recommended semantic tokens:

```text
background
backgroundRaised

surface
surfaceRaised
surfaceInteractive

border
borderStrong

textPrimary
textSecondary
textMuted

accent
accentSoft
accentStrong

success
warning
danger
info
```

Do not scatter raw hex values throughout components.

The design system owns color semantics.

---

## 21. Accent usage

Magenta/violet is the Lia identity accent.

Use it for:

- selected states;
- primary actions;
- focus;
- key borders;
- active indicators;
- controlled highlights.

Avoid:

- every border glowing;
- every card using strong magenta fill;
- every text label becoming neon;
- excessive gradients.

The visual result should feel premium and calm, not like a permanently flashing HUD.

---

## 22. Glow usage

Glow is a supporting effect, not structural layout.

Use stronger glow for:

- Lia hero/character emphasis;
- selected primary card;
- primary CTA;
- rare important status.

Use weak/no glow for:

- secondary cards;
- long lists;
- settings rows;
- technical details.

This reduces visual fatigue.

---

## 23. Surface hierarchy

Suggested hierarchy:

### Level 0

App/background.

### Level 1

Large page sections / major cards.

### Level 2

Nested settings surfaces / rows / selectors.

### Accent surface

Selected or active primary component.

Avoid unnecessary “card inside card inside card” nesting.

---

## 24. Corners and geometry

The concepts establish:

- rounded corners;
- soft containers;
- no sharp enterprise-table aesthetic.

Create shared radius tokens such as:

```text
radiusSm
radiusMd
radiusLg
radiusXl
```

Do not choose arbitrary radii per component.

---

## 25. Spacing

Use a consistent spacing scale.

Conceptual scale:

```text
space1
space2
space3
space4
space6
space8
space12
```

Maintain generous breathing room between major groups.

Dense controls may use tighter internal spacing, but page hierarchy should remain obvious.

---

## 26. Typography

Typography hierarchy should include semantic roles:

- page title;
- section title;
- card title;
- body;
- secondary/help;
- compact status;
- version/meta.

Avoid excessive font-size variation.

Normal settings text must remain highly readable.

Decorative/handwritten-style text from concepts should be used sparingly and never for critical controls.

---

## 27. Status badges

Create reusable status semantics.

Examples:

- Pronto
- Selecionado
- Instalando
- Desativado
- Não instalado
- Não disponível
- Erro
- Automático
- Ativado

A status badge should communicate state without forcing the user to infer meaning only from color.

---

## 28. Reusable UI primitives

The first implementation phase should establish reusable components instead of styling every page independently.

Candidate primitives:

```text
LiaAppShell
LiaSidebar
LiaSidebarItem
LiaSidebarFooter

LiaPageHeader
LiaSection
LiaCard
LiaHeroCard
LiaCapabilityCard

LiaStatusBadge
LiaSettingRow
LiaToggle
LiaSelect
LiaSlider
LiaSegmentedControl

LiaPrimaryButton
LiaSecondaryButton
LiaIconButton

LiaEmptyState
LiaErrorState
LiaLoadingState
```

Names are illustrative; implementation may adapt to existing conventions.

The important requirement is shared ownership of:

- appearance;
- spacing;
- status;
- interaction;
- accessibility.

---

## 29. Dynamic/capability-driven UI

This rule is fundamental:

> **Concepts define visual structure; runtime capabilities define actual controls.**

Examples:

- If a Brain has no audio input, do not claim it can listen natively.
- If a Voice Engine does not expose emotion control, do not show an emotion slider.
- If a model is not installed, show that state honestly.
- If Free Mode is not implemented yet, do not present it as operational.

The UI can show future features only when clearly marked as unavailable/coming later and when doing so serves a real product need.

Prefer not showing non-functional controls in production.

---

## 30. Normal vs Advanced

Normal mode:

- user language;
- model/engine friendly names;
- status;
- capabilities;
- common settings.

Advanced mode:

- provider;
- backend;
- endpoint;
- model ID;
- runtime path;
- inference implementation;
- technical diagnostics.

Do not leak implementation complexity into the default UI.

---

## 31. Interaction states

Every reusable interactive component should define:

- default;
- hover;
- focus;
- active/selected;
- disabled;
- loading where applicable;
- error where applicable.

Keyboard navigation and visible focus must be maintained.

Do not use glow as the only focus indicator.

---

## 32. Accessibility

The visual identity must not compromise usability.

Requirements:

- readable contrast;
- visible focus;
- semantic labels;
- keyboard navigation;
- controls not identified by color alone;
- sufficiently large interactive targets;
- reduced-motion compatibility where animation is added.

---

## 33. Motion

Animation should make Lia feel alive without making the settings application noisy.

Good uses:

- subtle transitions;
- card selection;
- status changes;
- Lia expression/preview;
- controlled panel reveal.

Avoid:

- continuous decorative movement;
- constant pulsing of many elements;
- large unnecessary parallax;
- animation that delays interaction.

Free Mode character movement is a product feature and should be treated separately from decorative UI animation.

---

## 34. Responsive behavior

The Lia App should work across the supported launcher/window sizes.

General rules:

- sidebar remains predictable;
- major content hierarchy survives narrower windows;
- cards may stack;
- Lia illustration may reduce or move;
- controls must not become horizontally clipped;
- long labels wrap cleanly;
- advanced detail may move below primary content.

Do not simply scale the whole desktop concept down.

Implement responsive layout intentionally.

---

## 35. Shell status vs page status

Separate global/system status from local page status.

### Global

Examples:

- Lia ready;
- offline;
- microphone state;
- active operation.

### Local

Examples:

- Kokoro installing;
- Qwen selected;
- Free Mode disabled;
- tool permission required.

Do not duplicate the same status in every region.

---

## 36. Settings gear

The gear in the sidebar footer opens global product settings.

It should not be confused with page-specific “Configurar” actions.

Example:

```text
Footer ⚙
→ global Settings
```

while:

```text
Kokoro
[ Configurar voz ]
```

opens the Voice page or an engine-specific configuration surface.

---

## 37. Version/channel presentation

Recommended compact styles:

```text
Beta · 0.0.1
```

or:

```text
Live · v0.1.0
```

Do not use a large marketing badge.

Version is secondary metadata.

The release channel naming policy can evolve independently.

---

## 38. Do not duplicate branding

Explicit anti-patterns:

```text
Top:
[L] Lia Desktop Companion

Bottom:
Lia Desktop Companion
```

or:

```text
Projeto AIRI
Lia
```

in the normal product shell.

Preferred:

```text
Top:
[L]
```

and:

```text
Bottom:
Beta · 0.0.1    ⚙
```

This leaves more room for meaningful status and navigation.

---

## 39. Concept review checklist

Before implementing or approving a screen:

```text
[ ] Looks like Lia, not a generic dashboard
[ ] Lia/AIRI branding rule respected
[ ] Primary task is visually dominant
[ ] Normal language avoids backend jargon
[ ] Controls map to real capabilities
[ ] No invented universal controls
[ ] Status is explicit
[ ] Glow is controlled
[ ] Sidebar/footer pattern is consistent
[ ] Global settings gear is in footer
[ ] Top-right is available for status/context
[ ] Layout can reflow at smaller widths
[ ] Accessibility states are defined
```

---

## 40. Phase 8.0A implementation target

The first visual implementation phase should focus on the system, not on activating every future capability.

### 8.0A — Lia Design System + App Shell Foundation

Deliver:

- semantic design tokens;
- definitive shell/sidebar;
- footer branding/version/settings pattern;
- reusable page primitives;
- reusable card/status/control primitives;
- responsive behavior;
- accessibility baseline;
- migration of selected existing Lia App screens to the shared primitives where safe;
- ability to render concept-aligned placeholder/view-model states without pretending future features are implemented.

Do not add in the same phase:

- Qwen Omni runtime integration;
- screen vision;
- microphone/STT architecture;
- autonomous tools;
- Free Mode movement;
- personality runtime;
- new TTS engines;
- RVC.

Those belong to focused capability phases.

---

## 41. AIRI separation

The design system should be Lia-owned conceptually.

Current implementation may temporarily reside inside AIRI-derived workspace paths because of existing build/workspace constraints.

Do not use that temporary physical path as justification for:

- AIRI branding in the UI;
- new Lia identity assets living permanently under AIRI;
- coupling the visual system to AIRI-specific terminology.

The long-term direction remains:

```text
Lia Product
  ↓
Lia-owned product/UI/core layers
  ↓
AIRI-derived runtime/Stage where still useful
```

Migration should be incremental and non-destructive.

---

## 42. Source-of-truth rule

This document is the canonical baseline for the Lia App shell and visual design system.

When a generated concept, implementation shortcut, existing AIRI UI, or previous mock conflicts with an explicit rule here, the conflict should be reviewed rather than silently copied.

Update this document when a deliberate visual/product decision changes.

Do not rely on chat history as the only design specification.
