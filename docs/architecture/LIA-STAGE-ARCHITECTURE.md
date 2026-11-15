# Arquitetura do Stage próprio da Lia

Estado: **decisão arquitetural + primeira implementação de contrato** (27/10/2026).
Escopo: como o Stage da Lia deixa de ser "AIRI modificado" e passa a ser um
módulo próprio, sem reescrever os motores que já funcionam.

---

## 1. O ponto de partida (medido, não suposto)

Ver `docs/architecture/AIRI-COMPARISON.md`. Em resumo:

- A Lia **não tem** um Stage separado hoje. Tem **165 arquivos injetados** dentro
  de `airi/apps/stage-tamagotchi/`.
- O Launcher (`airi/apps/lia-app`, ~11 110 linhas) e o núcleo
  (`airi/packages/lia-core`) já são 100% da Lia.
- Alterações em `packages/core-agent`, `packages/stage-ui` e `packages/i18n`
  são compartilhadas com o upstream e seriam sobrescritas por um
  `subtree pull`.

Portanto o problema não é "escrever um Stage", é **extrair uma fronteira** onde
hoje há uma injeção.

---

## 2. Decisão: o Stage é um módulo com plataforma injetada

O Stage da Lia será um módulo cuja dependência de plataforma (Electron) entra
**por injeção**, não por import direto. Motivo, e não é teórico: o
`airi-stage-manager.ts` do Launcher atual já faz exatamente isso —

```ts
/** For tests: overriding spawn/exec keeps this class electron-free. */
spawnImpl?: typeof spawn
```

— e essa é a razão de o ciclo de vida do Stage poder ser testado hoje sem
Electron. O Stage próprio adota o mesmo idioma.

Consequências:

1. Toda a lógica de ciclo de vida roda em `node --test`, **sem display e sem
   binário do Electron**.
2. O arquivo que importa `electron` fica sendo um único arquivo fino
   (`lia/stage/src/main/index.ts`, 53 linhas).
3. Trocar Electron por outra shell (Tauri, navegador) no futuro é trocar a
   injeção, não reescrever o Stage.

---

## 3. Os três níveis (o que é nosso, o que é reutilizado, o que é terceiro)

### Nível 1 — experiência e interface próprias (100% Lia)

Janelas, personagem padrão, presença no desktop, comportamento, configurações,
interações, identidade visual (os ícones já são da Lia).

| Item | Onde está hoje | Destino |
| --- | --- | --- |
| Janela do Stage, ciclo de vida | `lia/stage/src/main/` | **novo, feito** |
| Presença / comportamento | `stage-tamagotchi/src/renderer/pages/` | reimplementar sobre o novo Stage |
| Configurações da Lia | `stage-tamagotchi/src/main/configs/lia*.ts` | mover para `lia/core` |
| Chat / InteractiveArea | `stage-tamagotchi/src/renderer/components/InteractiveArea.vue` | reimplementar ou portar com adaptador |

### Nível 2 — infraestrutura reutilizável (do AIRI, por contrato explícito)

Só entra o que declarar dependência e versão. Nada de `import '@proj-airi/x'`
espalhado pela UI da Lia.

| Componente | Pacote | Como é usado |
| --- | --- | --- |
| Runtime de conversa | `@proj-airi/core-agent` | **atrás de adaptador** (§5) |
| Provedores / streaming | `@proj-airi/core-agent`, `@xsai/*` | idem |
| Renderização de personagem | `@proj-airi/stage-ui`, `pixi-live2d-display`, `@pixiv/three-vrm` | a decidir na Fase 4 |
| Áudio / TTS | `@proj-airi/pipelines-audio`, Kokoro | não tocado nesta missão |
| Eventos / IPC | `@moeru/eventa` | avaliar contra o protocolo próprio |

### Nível 3 — terceiros (versão e licença registradas)

Electron, Vue, Pixi, three.js, Live2D, VRM. Licenças **não** foram auditadas
nesta rodada além do AIRI (MIT). Ver §7.

---

## 4. Contratos

Implementados e testados em `lia/core/` (`@lia/contracts`).

### 4.1 Ciclo de vida

Fases: `starting` → `running` → `stopping` → `stopped`, com `error` terminal.

Os invariantes **não foram inventados**: são os que o Launcher já pratica e que
o relatório de 20/10 cobrou depois de um bug real.

| Invariante | Por quê |
| --- | --- |
| `running` exige sinal de pronto da plataforma | "processo criado" não é "app funcional" |
| `stopped` exige `exit` observado | `stopped` otimista esconde processo órfão |
| `error` é terminal para a instância | nova instância recomeça limpa |
| `spawn` concorrente é recusado | single-flight: um clique duplo não abre dois Stages |
| `stop()` idempotente | dois cliques em fechar não encerram duas vezes |
| transição ilegal devolve `null` e não muda nada | bug de quem chamou fica visível, não vira exceção dentro de callback |

Testado em `lia/core/test/lifecycle.test.ts` (18 casos) e
`lia/stage/test/stage-host.test.ts` (9 casos).

### 4.2 Saúde e falhas

`StageSnapshot` carrega `phase`, `pid`, `startedAt`, `readyAt`, `stoppedAt`,
`exitCode` e `failure`. Campos ausentes **não existem** — não são `undefined`
gravado, o que faz `'readyAt' in snapshot` ser uma pergunta respondível.

`failure` é uma **string curta e legível** — nunca conteúdo de conversa, nunca
segredo, nunca payload de provedor.

### 4.3 Protocolo Launcher ↔ Core ↔ Stage

Envelope `{ protocol, type, id, from, payload }`, versão `1.0.0`.

| Regra | Implementação |
| --- | --- |
| MAJOR igual ⇒ compatível, minor/patch livres | `negotiate()` |
| MAJOR diferente ⇒ recusa com motivo | `negotiate()` |
| versão malformada (`1.x.0`, `v1`) ⇒ recusa | `negotiate()` |
| mensagem malformada não derruba quem recebe | `parseEnvelope()` nunca lança |
| `type` fora da lista é recusado | `parseEnvelope()` |
| `id` ou `from` vazio é recusado | `parseEnvelope()` |

Lista fechada hoje: `health.ping`, `health.pong`, `stage.stop`, `stage.stopped`,
`chat.send`, `chat.delta`, `chat.done`, `chat.error`, `error`.

### 4.4 O que **não** foi implementado (honestidade)

Contratos de configuração/migração, seleção de personagem, modo de presença,
eventos de voz, permissões e ferramentas, logs/diagnósticos **não** têm código
próprio nesta rodada. Estão mapeados aqui e são pré-requisito da Fase 4 da
migração. Não declarar pronto o que não existe.

---

## 5. Não duplicar o runtime de conversa

Decisão: **não reescrever** o runtime de conversa. Ele continua em
`@proj-airi/core-agent`, atrás de uma porta própria da Lia:

```
lia/stage  ──►  LiaChatPort (interface da Lia)
                     │
                     └──►  adaptador  ──►  @proj-airi/core-agent
```

Motivo: `core-agent` já contém o parser de marcadores, o filtro de raciocínio e
o tratamento de ferramentas, com testes e correções caras (a perda de espaço,
por exemplo). Duplicar isso seria reintroduzir os mesmos bugs.

O adaptador é a fronteira que permite trocar a implementação depois sem tocar
no Launcher nem no Stage.

**Estado: a porta `LiaChatPort` ainda não existe em código.** É o próximo passo,
não algo feito.

---

## 6. O que este protótipo é e não é

**É:** um Stage real e mínimo — abre janela, renderiza um placeholder de
personagem, guarda ciclo de vida verificável, encerra sem deixar órfão.

**Não é:** personagem real (VRM/Live2D), voz, memória, multi-monitor, animações.
Nada disso está pronto e nada disso foi observado funcionando.

### Gate que exige Windows (NÃO EXECUTADO aqui)

O ambiente do agente é Linux, sem display e sem binário do Electron. Portanto:

| Verificação | Estado |
| --- | --- |
| Lógica de ciclo de vida | **PASS** — 9 testes em `lia/stage/test/` |
| Contratos do Core | **PASS** — 26 testes em `lia/core/test/` |
| Decisão do Launcher | **PASS** — 8 testes em `lia/launcher/test/` |
| Janela abre de verdade | **NÃO EXECUTADO** |
| Personagem renderiza | **NÃO EXECUTADO** (é placeholder, não personagem) |
| Encerramento sem órfão no Windows | **NÃO EXECUTADO** |

---

## 7. Licenças

| Componente | Licença | Verificado |
| --- | --- | --- |
| Código do AIRI | **MIT** (© 2024-PRESENT Neko Ayaka) | sim — `LICENSE` do upstream |
| `lia/core`, `lia/stage`, `lia/launcher` (novos) | MIT (do projeto) | — |

**Não verificado nesta rodada:** licenças de modelos (Live2D, VRM), fontes,
texturas, áudio e personagens. A missão proíbe presumir que a licença do código
cobre assets de terceiros. Antes de integrar qualquer personagem real, cada
asset precisa de licença registrada.
