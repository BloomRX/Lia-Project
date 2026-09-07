# M1-SCOPE — Lia Shell / Product Foundation (recorte e escopo)

> **M1 · Escopo do primeiro objetivo do produto Lia**
> **Data:** 07/09/2026 · **Branch:** `arena/01a07b6d-lia-project`
> **Base:** fork AIRI `v0.12.0-beta.5` — M0-A **aprovada e encerrada**.
> **Contexto normativo:** `AGENTS.md` §1–§97; UX do produto em `docs/product/UX.md`;
> divisão técnica em `docs/architecture/LIA-INTEGRATION-PLAN.md`.
> **Estado desta etapa:** o pedido M1 pede **primeiro** estes 3 documentos e, ao terminá-los,
> **PARAR** e aguardar revisão/aprovação antes de codificar.

---

## 1. Objetivo da M1

> Construir a **fundação do produto Lia** — identidade, shell/home "launcher", navegação,
> configurações, configuração persistente, pt-BR + en-US, sistema de status, logs colapsáveis,
> diagnostics básico — sobre o runtime AIRI validado, **sem duplicar o que já existe** e
> **sem refatorar/alterar o AIRI nesta fase**.

Não é implementar todas as features do produto; é criar uma **base sólida** que as receba depois
(Voice Studio, RVC/AllTalk, hardware recommendation, computer use, Discord completo, proativo,
entretenimento e instalador final ficam para fases futuras).

---

## 2. O que entra na M1 (deliverables)

### 2.1 Identidade Lia
- App/product rebatizado: **appId, productName, ícone, nome técnico** Lia (decisão de identidade
  visual em `UX.md §2`/`§9`).
- Rebranding da shell Electron e da "casca" desktop para o produto Lia (o AIRI vira a base, não
  a marca visível).

### 2.2 Home launcher-like
- Home de produto (referência: game launcher + desktop companion — `UX.md §1/§3`): personagem
  + estado + ação principal (CONVERSAR) + voz + atalhos.
- A conversa reutiliza o chat/pipeline do AIRI (`useChatStore`, janela `chat`); a Home **emoldura**
  e abre a conversa — sem reimplementar chat/LLM/voz.

### 2.3 Navegação
- Modelo de "destinos" com Home como hub (Home → Conversar / Personagem / Voz / Configurações /
  Advanced), com voltar claro (`UX.md §4`).
- Reuso do roteamento/layouts do AIRI.

### 2.4 Configurações (settings)
- Janela/UI de configurações reorganizada com **linguagem de produto** e navegação por seções
  amigáveis; parte técnica em **Advanced**.
- Reaproveitar o framework de settings/stores já existente (ver integração plan).

### 2.5 Configuração persistente
- Schema de configuração do usuário **versionado** (`schemaVersion`) + camada de migração e
  separação config/secrets/userData — construído **sobre** o mecanismo de persistência do AIRI
  (`createConfig` com schema valibot), em **namespace da Lia** (não mexendo no core).
- Persistência confiável de ao menos: identidade/idioma, caminhos, preferências de UI e estado
  do onboarding.

### 2.6 pt-BR e en-US
- Adicionar o locale **pt-BR** ao mecanismo i18n do AIRI (mesmo padrão dos idiomas existentes)
  + garantir **en-US** como fallback/segundo idioma.
- Aplicar UI em ambos; padrão de detecção pt-BR→en-US (ver integração plan §8).
- Sem hardcode de texto novo.

### 2.7 Sistema de status
- Chips de status **amigáveis** (Home) traduzindo o estado real dos órgãos (AI/Voz/etc.) para
  linguagem de usuário (`UX.md §6`, `§85`).

### 2.8 Logs colapsáveis
- Painel de logs técnicos **colapsável**, fora da Home; acesso via ação explícita / Advanced
  (`UX.md §7`, `§56–§58`).

### 2.9 Diagnostics básico
- Advanced/Diagnostics (estado por camada + Repair básico) — **nível M1**: sistema/estado do
  runtime, sem implementar ainda as features de M2 (hardware-detection→profiles etc.).

### 2.10 Arquitetura preparada para Character / AI / Voice / etc.
- A estrutura de pastas/pacotes da Lia separa limites por domínio (character, ai/voice etc.) e
  já reserva os pontos de encaixe futuros — mas **não implementa** as features futuras
  (ver §3 "não entra").

---

## 3. O que NÃO entra na M1 (non-goals explícitos)

Não implementar em M1 (virão depois; `M1-SCOPE` deve apenas deixar o encaixe previsto):

- **Voice Studio** (app auxiliar de voz);
- **RVC / AllTalk** (voice conversion);
- **Hardware recommendation engine** / perfis Recommended/Local/Hybrid/Cloud automáticos (M2);
- **Computer use**;
- **Discord completo**;
- **Comportamento proativo**;
- **Sistema de entretenimento**;
- **Instalador final** / distribuição (`LiaSetup.exe`, assinatura, notarização) — M6.
- Também **NÃO**: corrigir/backport do tipo falha `d8e62f12`; refatorar o AIRI; editar o núcleo
  do AIRI; criar novo sistema de tradução; duplicar chat/voz/providers/memória.

---

## 4. Trabalho em pacotes (sugestão de estruturação pós-aprovação)

> A divisão fina entre "criar na Lia" e "reusar do AIRI" está em `LIA-INTEGRATION-PLAN.md`.
> Aqui está a leitura de M1 em pacotes de entrega:

- **P1 · Identidade + shell**: rebrand appId/productName/ícone; casca desktop Lia; reuso do
  bootkit/windows do AIRI.
- **P2 · i18n pt-BR/en-US**: adicionar locale `pt-BR`; aplicar em UI; fallback en-US.
- **P3 · Home launcher**: página/destino Home com personagem/status/ação; integração com a
  conversa existente.
- **P4 · Navegação + Configurações de produto**: modelo de destinos; settings reorganizadas com
  linguagem de produto.
- **P5 · Config persistente**: schema versionado em namespace Lia + migrações + separação de
  diretórios.
- **P6 · Status system**: camada produto → status amigável da Home.
- **P7 · Logs colapsáveis + Diagnostics básico**: painel de logs + tela Diagnostics/Advanced.
- **P8 · Pacote/estrutura por domínio**: organização dos novos pacotes/limites da camada Lia.

Cada pacote fecha com o DoD do `AGENTS.md §79` (typecheck/lint/testes/erros/loading/docs/etc.).

---

## 5. Critérios de aceite da M1

No fim da M1, deve ser possível, como **usuário leigo**:

1. Abrir a "Lia App" (não "AIRI") e ver a **Home launcher** com a personagem e um status claro.
2. **Conversar** em 1 clique (a conversa abre/reusa o pipeline AIRI).
3. Trocar o **idioma da UI** entre **pt-BR** e **en-US**; em primeira execução detectar pt-BR.
4. Acessar **Configurações** e mudar preferências que **persistem** entre reinícios.
5. Ver **estado amigável** em vez de `READY/OFFLINE/ERROR`.
6. Num erro, ver mensagem amigável e **log colapsado/Advanced**, sem stack trace na interface.
7. Abrir **Advanced/Diagnostics** e ver o estado básico do runtime.
8. Nada disso ter **duplicado** funcionalidade do AIRI nem **alterado** o core do AIRI.

**DoD técnico:** typecheck passa (56/57 baseline + mudanças da Lia sem novas falhas), lint passa
sobre o código da Lia, testes relevantes passam, docs atualizadas, sem secrets, sem quebra do que
já roda (build:web e dev:tamagotchi continuam abrindo).

---

## 6. Dependências e ordem

A arquitetura da M1 foi **aprovada** (decisões em `LIA-INTEGRATION-PLAN.md §9`): Lia vive dentro
do monorepo AIRI (`airi/`), `apps/stage-tamagotchi` é a base direta (re-identificada como Lia),
sem nova app/pacotes micro, rebrand só de identidade (documentado como "Lia identity patch"),
i18n estende o AIRI com pt-BR, Home é camada sobre o chat existente.

Ordem de implementação aprovada:
1. Fase 1 — Electron identity (rebrand).
2. Fase 2 — Lia application shell / Home.
3. Fase 3 — Navigation.
4. Fase 4 — pt-BR + en-US integration.
5. Fase 5 — Lia configuration (namespace `lia`, reuso `createConfig`).
6. Fase 6 — status abstraction (apresentação; detecção detalhada é M2).
7. Fase 7 — logs / friendly errors (investigar/reusar infra do AIRI antes de criar).
8. Fase 8 — basic settings reorganization (linguagem de produto).
9. Fase 9 — tests.
10. Fase 10 — documentation.

> Árvore final, arquivos AIRI a modificar, arquivos Lia novos, arquivos intocados, ordem de commits
> e riscos: `docs/architecture/M1-IMPLEMENTATION-PLAN.md`.

---

## 7. Riscos e aberturas (M1)

- **Decisão de layout/repo** (aberta) afeta onde o código Lia vive; não bloqueia a *análise*,
  mas precisa ser fixada antes de codar.
- **Escopo de rebrand do Electron** — o mínimo para parecer "Lia" sem refatorar o core precisa
  ser pontual e documentado como patch Lia (não refactor).
- **Config versionada** deve ser construída como adição (namespace Lia) para não colidir com o
  schema do AIRI (`configs/global.ts`) e para sobreviver a rebases upstream.
- **Diagnostics em M1 é básico** — cuidado para não escorregar para M2 (hardware/profiles).
- **Idioma por camada** (Character/AI/Voice) é previsto em arquitetura, mas só a **UI** exige
  conteúdo completo em M1.

---

## 8. Status

- [ ] UX (`docs/product/UX.md`) — produzido, **aguardando revisão**.
- [ ] M1-SCOPE (este) — produzido, **aguardando revisão**.
- [x] LIA-INTEGRATION-PLAN (`docs/architecture/LIA-INTEGRATION-PLAN.md`) — **decisões resolvidas**.
- [x] M1-IMPLEMENTATION-PLAN (`docs/architecture/M1-IMPLEMENTATION-PLAN.md`) — produzido
  (árvore/arquivos/ordem de commits/riscos), **aguardando revisão**.
- [ ] **PARADA para revisão/aprovação antes de qualquer código (M1 Part 2).**

*Fim do documento `docs/product/M1-SCOPE.md`.*
