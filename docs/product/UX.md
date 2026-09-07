# UX — Especificação de experiência do produto **Lia**

> **M1 · Lia Shell / Product Foundation · Documento de produto**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Base:** fork AIRI `v0.12.0-beta.5` (validado na M0) + camada de produto Lia.
> **Âmbito deste doc:** definir a **experiência** que a Lia entrega — Home, navegação,
> linguagem de UI, identidade, estados e comportamento — e os **componentes reutilizáveis**
> que sustentam essa experiência. A **divisão técnica** (o que reutilizar/estender/encapsular
> do AIRI) está em `docs/architecture/LIA-INTEGRATION-PLAN.md`; o **recorte de M1** em
> `docs/product/M1-SCOPE.md`.
> **Fonte normativa:** regras de produto em `AGENTS.md` (§1, §5, §42–§48, §67–§70, §83–§86).
> Marcações: `[PROPOSTA]` = decisão da Lia; `[AIRI]` = capacidade existente que a Lia reutiliza.

---

## 1. Referência de produto (leia primeiro)

> **A Lia é um *game launcher* + *desktop companion*, NÃO um painel administrativo.**
> `AGENTS.md §42`

Toda decisão de UI em M1 é filtrada por essa frase. Consequências práticas:

- A Home gira em torno da **personagem**, do **estado**, da **ação principal**, da
  **conversa**, da **voz** e das **atividades** — nunca de tabelas de providers.
- Métricas, endpoints, ports, CUDA/Vulkan, nomes de engines, stack traces e logs longos
  **não aparecem na Home**; moram em **Advanced/Diagnostics** (`§43`, `§83`).
- A linguagem é de produto ("Modelo de IA", "Voz", "Reconhecimento de voz") — termos
  técnicos só em Advanced (`§84`).
- Toda tela tem feedback: loading/success/error/empty/disabled/unavailable/progress
  (`§46`–`§48`). UI/UX é **requisito funcional**, não enfeite.

---

## 2. Identidade da Lia

**Objetivo:** a Lia deve ser percebida como um produto próprio, com a estética anime /
cyber / neon / elegante do AIRI **mantida ou evoluída**, não copiada e colada.

- **Persona:** "Lia" é o primeiro personagem/preset padrão (`§5`). A identidade do produto
  (nome, ícone, appId) é **da Lia**; o AIRI é tratado como runtime, não como a identidade.
- **Tom:** acolhedor, vivo, próximo de uma companhia — nunca robótico e nunca "dev tools".
- **Linguagem de produto** (pt-BR principal, en-US como segundo idioma desde M1 — ver §8).
- **Consistência:** um **design system único** reutilizável (cores, tipografia, botões,
  estados) aplicado a toda a UI (ver §10).

> `[PROPOSTA]` A identidade visual (paleta "Lia", logotipo, ícone do app, splash/onboarding
> de marca) entra em M1. Como o AIRI aplica a própria estética via `uno.config.ts` + temas
> (`@proj-airi/ui` `useTheme`, `stage-layouts` `theme-color`), a Lia deve **definir um tema/logo
> Lia** por cima, sem reescrever o motor visual.

---

## 3. A Home (experiência principal)

Modelo conceitual (de `AGENTS.md §44`, traduzido para a estrutura da Lia):

```
                    LIA
              [ LIA — personagem ]
          (avatar/modelo do personagem ativo)
  "Oi... você voltou."          ← saudação/estado de presença

  Status:  ● Tudo pronto        ← status amigável (ver §6)

  [ CONVERSAR ]                 ← ação primária
  [ FALAR ]                     ← voz (quando habilitada)
  [ ATIVIDADES ]                ← futuro / entretenimento

  Atalhos:
  [ Personagem ] [ Voz ] [ Discord ] ...
  [ Mostrar logs ]              ← colapsável, NÃO na Home a estala
```

### Prioridades da Home (em ordem)
1. **Personagem** — o personagem ativo (Lia por padrão) é o centro; tudo é "conversar com ela".
2. **Estado** — um status amigável e confiável ("Tudo pronto" / "Voz pronta" / "Discord
   desconectado" / "Controle do PC bloqueado") — nunca `READY`/`ERROR`/`OFFLINE`.
3. **Ação principal** — CONVERSAR é sempre a ação dominante e de um só clique.
4. **Voz** — FALAR é a segunda ação quando o pipeline de voz está pronto.
5. **Atividades / atalhos** — segundo plano, para navegação e futuras features.

### O que a Home NÃO mostra
Backend, endpoint, porta, CUDA/Vulkan, engine local, stack trace, logs detalhados, tabela de
providers, IDs técnicos. Tudo isso vive em **Advanced/Diagnostics** (`§43`, `§83`).

> **Relação com o AIRI:** o AIRI já tem a "conversa" completa funcionando (janela `chat`,
> store `useChatStore`, orquestrador `useCharacterStore`). A **Home é a nova camada de produto**
> que **emoldura** a conversa já existente — a Home entra e a conversa usa o pipeline existente,
> **sem duplicar** chat/LLM/voz.

---

## 4. Navegação

A Lia herda o **modelo multi-janela do Electron/AIRI** (`windows/: main, chat, settings,
onboarding, widgets, …`): o desktop companion mantém janelas próprias e foco no personagem.
Sobre isso, a Lia introduz **navegação de produto por "destinos"**, sempre com voltar claro:

- **Home (launcher)** — o "hub" que abre no app; a partir dela o usuário vai a cada destino.
- **Conversar** — a experiência central (janela de chat do AIRI embrulhada/skin-da-Lia).
- **Personagem / Voz / Atividades** — destinos de segundo nível.
- **Configurações** — janela de settings do AIRI, reorganizada com **linguagem de produto**
  (agrupar em seções amigáveis; a parte técnica migra para Advanced).
- **Advanced / Diagnostics** — modo opcional onde **todo** detalhe técnico fica (ver §7).

Regras de navegação:
- **1 clique** para a ação principal; nunca exigir que o usuário "configure para começar".
- Toda tela identifica **onde estou** e **como voltar** (breadcrumb/back claro).
- Estados intermediários usam os estados de UI do §5 (nunca tela morta em branco).

> `[AIRI]` reutilizável: `vue-router` file-based + layouts (`stage-layouts`), navegação por
> hash por janela, `router.beforeEach` de transição de páginas já existente em
> `pages/settings/index.vue`. A Lia reaproveita esse mecanismo de rotas.

---

## 5. Estados de UI e feedback (obrigatório em toda tela nova)

Adotar o conjunto de `§47` de forma **consistente** (mesmos nomes/cores/posição em todas as
telas), via componentes reutilizáveis (§10):

| Estado | Uso | Regra de UX |
|---|---|---|
| `default` | estado inicial | nunca em branco — sempre conteúdo/placeholder |
| `loading` | carregando | spinner/skeleton + rótulo simples; nunca sumir a tela |
| `success` | concluído | feedback positivo sutil; manter o usuário na tela |
| `error` | falhou | erro **amigável** (ver §7); nunca stack trace na interface normal |
| `empty` | sem dados | orientar o usuário ("Nenhuma atividade ainda") com ação |
| `disabled` | indisponível | desabilitar + explicar o porquê (tooltip), nunca esconder |
| `unavailable` | recurso não suportado | explicar em linguagem simples + sugerir alternativa |
| `installing`/`downloading` | progresso | ver barra de progresso (§6) |
| `retrying` | re-tentativa | mostrar que está tentando novamente |

Operações longas têm **progresso reutilizável** (`§48`): rótulo + barra + bytes/velocidade/
tempo estimado + Cancelar — com pause/resume/retry/checksum quando aplicável (`§49`).

---

## 6. Sistema de status (chips amigáveis)

Estado do "companheiro" exibido na Home com **linguagem de usuário** e **ponto colorido**
(com reforço além da cor para acessibilidade `§68`):

- ● **Tudo pronto**
- ● **Voz pronta**
- ○ **Discord desconectado** (integração opcional)
- 🔒 **Controle do PC bloqueado**
- (futuro) **Baixando…**, **Instalando…**, **Offline**, **Precisa de atenção**

Regras:
- O status deriva de **estado real do runtime** (órgãos: AI, Voz, Visão, Memória, Discord,
  Computer Use) **traduzido** para rótulo amigável por uma camada de produto — o estado técnico
  bruto (`READY`/`DEGRADED`/`OFFLINE`) permanece disponível em Diagnostics (`§85`).
- Nada de jargão (`backend`, `endpoint`) nos rótulos.

---

## 7. Erros, logs colapsáveis e Diagnostics

### Erros amigáveis (`§58`)
- Nunca mostrar stack trace / exceção crua na interface normal.
- Formato: **mensagem simples** + até 3 ações possíveis
  (ex.: `[Tentar novamente] [Corrigir] [Detalhes]`).
- `[Detalhes]` abre um painel **colapsável** com o log técnico — nunca na Home.

### Logs colapsáveis (`§56`–`§57`)
- Sistema de logs com categorias (General/AI/Voice/System/Network/Debug), timestamp,
  severidade, **sem secrets**.
- Na UI: o log técnico vive **colapsado**; só é aberto por ação explícita do usuário.
- "Mostrar logs" é um destino/painel opcional (Advanced), não conteúdo da Home.

### Diagnostics (`§59`)
- Agrupador em **Advanced** com o estado de cada camada:
  Sistema (CPU/RAM/GPU/Disco/Áudio) · AI (LLM/Voz/Reconhecimento/Viagem…) · Runtime ·
  Integrações — cada um com estado amigável e, quando possível, **Reparar**.
- Não é a Home; não mostra portas/endpoints por padrão.

---

## 8. Linguagem da UI / Internacionalização (requisito pt-BR + en-US)

A Lia distingue 4 idiomas (`§67`): **UI Language**, **Character Language**,
**AI Response Language**, **Voice Language**. Em M1 o requisito firme é **UI em pt-BR e en-US**
(sendo pt-BR o padrão do produto); as demais camadas de idioma são preparadas na arquitetura,
mas **não** precisam de conteúdo completo em M1.

- **Padrão de UI:** idioma detectado do sistema → pt-BR se `pt`/`pt-BR`/`pt-PT`; senão en-US
  como fallback universal.
- **Sem hardcode de texto** em componentes novos (todas as strings por chave de tradução).
- **Relação com o AIRI:** o AIRI já tem framework i18n completo (`@proj-airi/i18n`: dicionários
  por idioma + `resolveSupportedLocale` + remap de locale; renderer `vue-i18n`; main `@intlify/core`)
  e hoje NÃO tem pt-BR. A Lia **estende** esse mecanismo **adicionando o locale `pt-BR`** (mesma
  forma dos 9 idiomas existentes), **sem criar um sistema novo**. Detalhe técnico em
  `LIA-INTEGRATION-PLAN.md §8`.
- **Terminologia de produto:** aplicar sempre `§84` (ex.: "Modelo de IA", "Voz",
  "Reconhecimento de voz", "Servidor/API").

---

## 9. Identidade visual e tema

- Reusar o motor visual do AIRI (`uno.config.ts` + temas/`useTheme`) e **sobrescrever com a
  marca Lia** (paleta, logo, ícone do app). Manter o clima anime/cyber/elegante.
- Acessibilidade mínima sempre (`§68`): contraste, legibilidade, foco de teclado, tooltips,
  estados que não dependem só de cor, opção de reduzir animações.
- Responsivo ao redimensionamento da janela (`§69`); o desktop-companion pode ter janelas
  pequenas que precisam ficar utilizáveis.

---

## 10. Componentes reutilizáveis (design system)

Toda UI nova de M1 usa um kit único de componentes (proposto como extensão do que o AIRI já
oferece via `stage-ui`/`ui`):

- **Estados:** `<LiaSpinner>`, `<LiaSkeleton>`, `<LiaEmpty>`, `<LiaErrorBoundary>`/amigável,
  `<LiaDisabled>`, badge de `unavailable`.
- **Feedback:** `<LiaToast>`, `<LiaStatusDot>`/chips, `<LiaProgress>` (barra + bytes + velocidade
  + tempo + cancelar).
- **Layout/nav:** `<LiaTopBar>`/título, navegação de destino, painel de logs **colapsável**,
  shell de janela com título + ações.
- **Formulários:** campos/selects com estados consistentes (derivados dos padrões AIRI).

> Regra de ouro: **reutilizar antes de criar** (`§94` — nada de abstrações duplicadas).
> Componentes já existentes no AIRI (`stage-ui/src/components`, `ui`, `stage-layouts`) devem ser
> o ponto de partida; o kit Lia só adiciona o que faltar e não duplica.

---

## 11. Estados de sucesso / heurísticas de aceite (UX)

Uma feature/tela de M1 só é aceitável se, ao ser revisada, responder:

1. **Objetivo claro** — dá para dizer em 1 frase o que ela faz para o usuário.
2. **Ação primária óbvia** — o próximo passo é evidente e em 1 clique.
3. **Nunca em branco/travada** — sempre um dos estados de UI do §5 visível.
4. **Erro humano** — se falhar, a mensagem é amigável, com caminho de ação, e o log fica
   **colapsado/Advanced**.
5. **Sem jargão** na Home; termos técnicos só em Advanced.
6. **Consistente** — usa os componentes/tema/status do kit Lia.
7. **Acessível** e responsivo.
8. **Reutilização** — não duplicou algo que o AIRI já provia (confere em LIA-INTEGRATION-PLAN).

---

## 12. Fora do escopo desta UX (em M1)

Nada abaixo entra na UI de M1 (ver também `M1-SCOPE.md`), ainda que a arquitetura deva permitir
encostá-los depois: **Voice Studio**, **RVC/AllTalk**, **engine de recomendação de hardware**,
**computer use**, **Discord completo**, **comportamento proativo**, **sistema de entretenimento**
e **instalador final**. A Home os reserva como "atividades/atalhos futuros", mas não os constrói.

*Fim do documento `docs/product/UX.md`.*
