# Catálogo de skills de agentes da Lia

Auditoria por conteúdo das 28 skills encontradas em `airi/.agents/skills/` na branch `arena/01a10290-lia-project`. A meta é que instruções úteis sobrevivam à futura remoção do AIRI, sem copiar regras incompatíveis nem arquivos que dependem de referências ausentes.

## Regras de independência

- Skills canônicas ficam em `.agents/skills/` na raiz.
- Skills em `airi/.agents/skills/` são fonte temporária, não dependência permanente.
- Copiar só o `SKILL.md` não basta se ele depende de `references/`, scripts, fixtures ou cenários específicos.
- Regras AIRI não prevalecem automaticamente sobre arquitetura, testes, design system ou segurança da Lia.
- Skills de desenvolvimento não são skills executáveis da Lia em runtime.

## Skills canônicas na raiz

| Skill | Função |
|---|---|
| `lia-safe-change` | Preservar trabalho e limitar escopo |
| `lia-test-discipline` | Escolher suítes corretas e evitar falsos verdes |
| `lia-regression-investigation` | Método de investigação |
| `lia-release-gate` | Gate de release |
| `stage-runtime-debugging` | Diagnóstico do Stage |
| `lia-windows-electron-validation` | Validação Windows real |
| `lia-browser-automation` | Automação browser/renderer |
| `lia-electron-cdp-debugging` | Seleção de alvos Electron/CDP |
| `lia-visual-evidence` | Evidência visual repetível |
| `lia-vue-development` | Vue, Pinia, VueUse e TypeScript |
| `lia-vue-testing` | Testes Vue |
| `lia-pnpm-workspaces` | Dependências e workspaces |
| `lia-unocss-ui` | UnoCSS |
| `lia-ai-sdk-integration` | SDKs de IA e APIs compatíveis |
| `lia-eventa-ipc` | Eventa/RPC/IPC |
| `lia-agent-evaluation` | Avaliação de modelo e ferramentas |
| `lia-voice-diagnostics` | Diagnóstico de voz |
| `lia-ui-quality-review` | UX, acessibilidade e estados de interface |
| `lia-security-review` | Segurança e permissões |
| `airi-upstream-integration` | Integração temporária com upstream |

## Auditoria individual das 28 skills do AIRI

| Skill vendada | Decisão | Motivo / destino |
|---|---|---|
| `agent-browser` | **Adaptada** | Original é um stub que manda consultar/instalar CLI. `lia-browser-automation` exige verificar disponibilidade e proíbe instalação implícita. |
| `agent-browser-electron` | **Adaptada** | Regras gerais de alvos CDP e janelas sob demanda foram resumidas em `lia-electron-cdp-debugging`; rotas/ícones AIRI excluídos. |
| `create-pr` | **Não copiar integralmente** | Acoplada a fluxo PR do AIRI, cenários Vishot e upload de evidência próprios. Reutilizar princípios quando o fluxo de PR da Lia estiver definido. |
| `enforce-rules-for-unocss` | **Adaptada** | `lia-unocss-ui` preserva leitura de configuração e reutilização de tokens; exclui `@proj-airi/ui` e caminhos AIRI. |
| `enforce-rules-for-vitest` | **Consolidada** | Regras gerais incorporadas a `lia-test-discipline`, `lia-regression-investigation` e `lia-vue-testing`; evita duplicação. |
| `eventa` | **Adaptada** | `lia-eventa-ipc` resume eventos tipados/RPC/streaming e condiciona uso à dependência presente. |
| `pinia` | **Consolidada** | Princípios úteis em `lia-vue-development`; original depende de muitos arquivos `references/*.md` não copiados. |
| `pnpm` | **Adaptada** | `lia-pnpm-workspaces` preserva regras de workspace/lockfile/build e evita presumir versão ou autorizar downloads. |
| `release-note-writer` | **Não copiar integralmente** | Exige inglês e comandos/changelog do AIRI, conflitando com contexto pt-BR e processo de release da Lia. Adaptar futuramente ao processo próprio. |
| `simple-english` | **Não copiar** | Focada em inglês controlado ASD-STE100; não deve impor limites de palavras à documentação/interface pt-BR. |
| `stage-tamagotchi-godot-csharp` | **Manter vendada por enquanto** | Exclusiva do engine Godot/C# em caminho AIRI. Copiar se esse engine virar parte independente da Lia. |
| `tsdown` | **Não copiar ainda** | Referência extensa de bundler. Reavaliar quando confirmar se o build da Lia continuará usando tsdown após a migração. |
| `unocss` | **Consolidada** | Configuração e uso cobertos por `lia-unocss-ui`; enciclopédia e referências externas não precisam ser duplicadas. |
| `upload-github-attachment` | **Não copiar ainda** | Depende de script, `gh`, curl e autenticação. Copiar apenas o markdown quebraria a referência ao script; requer política de publicação própria. |
| `use-agent-browser-for-airi` | **Não copiar** | Específica de importação Live2D/VRM/MMD, cenários e fixtures AIRI. |
| `use-agent-browser-with-input-file` | **Adaptada** | Regras gerais de input/file chooser e pós-condição incorporadas a `lia-browser-automation`. |
| `use-vishot-for-airi` | **Não copiar** | Usa helper, variáveis, modelos e cenários exclusivos do AIRI. |
| `use-vishot-with-capacitor` | **Não copiar por ora** | Focada em Stage Pocket/Capacitor; reavaliar se a Lia mantiver plataforma Capacitor independente. |
| `use-vishot-with-electron` | **Adaptada** | Seleção de janela, prontidão e inspeção visual genéricas em `lia-visual-evidence`. |
| `use-vishot-with-input-file` | **Adaptada** | Regras genéricas de file chooser e pós-condição incorporadas em `lia-visual-evidence` e `lia-browser-automation`. |
| `use-vishot-with-web` | **Adaptada** | Viewport, prontidão e seletores semânticos incorporados em `lia-visual-evidence`. |
| `use-vishot` | **Adaptada** | Manifesto, cenário existente e inspeção das imagens incorporados em `lia-visual-evidence`. |
| `vue-best-practices` | **Adaptada** | `lia-vue-development` mantém princípios úteis sem exigir refatoração prescritiva nem referências ausentes. |
| `vue-testing-best-practices` | **Adaptada** | `lia-vue-testing` remove links para arquivos de referência que não foram copiados e foca comportamento observável. |
| `vue` | **Consolidada** | APIs essenciais incorporadas em `lia-vue-development`; o original repete regras e aponta para referências locais. |
| `vueuse-functions` | **Consolidada** | A recomendação de verificar composables existentes entrou em `lia-vue-development`; não copiamos tabela que depende de centenas de referências. |
| `web-design-guidelines` | **Não copiar integralmente** | Busca regras externas a cada revisão e impõe saída terse `file:line`. `lia-ui-quality-review` é a referência contextual da Lia. |
| `xsai` | **Adaptada** | `lia-ai-sdk-integration` preserva compatibilidade, seleção granular e proteção de segredos sem presumir SDK definitivo. |

## Conflitos detectados

- **Idioma:** `simple-english` e `release-note-writer` impõem inglês, incompatível com a experiência principal pt-BR.
- **Vue:** a skill vendada prescreve divisão de componentes de modo rígido. A versão da Lia favorece componentes focados sem refatoração desnecessária.
- **Instalações:** skills externas recomendam instalações globais, Chromium, `pnpm dlx` ou downloads. As skills da Lia exigem verificar disponibilidade e autorização antes.
- **Referências ocultas:** Vue, Pinia, VueUse e Vishot dependem de `references/`, scripts, fixtures ou helpers. Copiar só o `SKILL.md` não as tornaria independentes.
- **Design:** regras de ícones/componentes/estilo do AIRI não devem sobrepor o design system da Lia.
- **Segurança:** instruções não substituem validação de argumentos, permissões e confirmação na camada de execução.

## Capacidades futuras da Lia em runtime

Organização de arquivos, leitura de documentos, pesquisa web, planejamento/lembretes, assistência de código e configuração de voz são ideias de produto, não skills executáveis implementadas aqui. Exigem contratos de ferramentas, permissões, confirmação, isolamento e auditoria.

## Verificação e remoção futura do AIRI

Esta auditoria leu os `SKILL.md` das 28 skills vendadas e comparou propósito, instruções, dependências e referências. As originais ainda não foram removidas de `airi/`; ficam como fonte temporária enquanto o AIRI permanece. Antes de remover `airi/`, pesquisar referências residuais em todo o repo, conferir scripts/references e validar descoberta das skills pelo agente efetivamente usado.
