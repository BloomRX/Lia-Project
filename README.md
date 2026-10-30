# Lia-Project

**Lia** — companheira virtual (AI companion), um produto próprio em processo de desacoplamento técnico. O [Project AIRI](https://github.com/moeru-ai/airi) é mantido como referência e fonte de estudo, não como a arquitetura final obrigatória.

## Status

- ✅ **Estudo técnico completo do AIRI concluído** → [`docs/estudo-airi.md`](docs/estudo-airi.md)
- ✅ **Fase 0 (análise + arquitetura) concluída** → [`docs/architecture/`](docs/architecture/)
- ✅ **M0-A (bootstrap do AIRI no repositório) documentado** → [`docs/upstream/AIRI-INTEGRATION.md`](docs/upstream/AIRI-INTEGRATION.md) — status: *BOOTSTRAP DOCUMENTED — BUILD NOT VALIDATED IN SANDBOX*
- 🎯 **Decisão:** fork da versão **`v0.12.0-beta.5`** (a mais recente disponível, mesmo sendo beta — 29/08/2026; tag confirmada upstream → commit `2c1e223c…`), licença MIT, com remote `upstream` para acompanhar evoluções durante a transição. **Nota:** esse fork é a base legada atualmente mantida no repositório; não representa a arquitetura-alvo permanente. O desacoplamento da Lia continua em andamento e deve ser acompanhado em `docs/project/CURRENT-STATE.md`.
- 🗺️ **Roadmap:** Fase 0 (análise/arquitetura) → M0 (base/toolchain do AIRI) → Fase 1 (identidade "Lia" + pt-BR) → Fase 2 (corpo/voz: avatar Live2D + TTS/STT) → Fase 3 (habilidades: plugins, memória, integrações) → Fase 4 (distribuição).

## Padrão da marca

Consulte [`docs/BRAND-STANDARDS.md`](docs/BRAND-STANDARDS.md) para identidade, linguagem, nomenclatura e princípios comuns dos produtos Lia.

## Documentação

| Documento | Descrição |
|---|---|
| [`docs/estudo-airi.md`](docs/estudo-airi.md) | Estudo completo do Project AIRI: arquitetura, monorepo, stack, versões, providers, riscos e estratégia |
| [`docs/architecture/AIRI-ANALYSIS.md`](docs/architecture/AIRI-ANALYSIS.md) | Análise da base atual + arquitetura do AIRI (Fase 0) |
| [`docs/architecture/LIA-ARCHITECTURE.md`](docs/architecture/LIA-ARCHITECTURE.md) | Proposta de arquitetura futura da Lia (Fase 0) |
| [`docs/upstream/AIRI-INTEGRATION.md`](docs/upstream/AIRI-INTEGRATION.md) | Registro do M0-A: tag/commit do AIRI, remotes, toolchain, comandos de bootstrap e limitações |
| [`tools/README.md`](tools/README.md) | DevKit universal: uso, comandos, segurança e configuração por projeto |

## Credits / Third-party projects

Este repositório contém código e componentes de terceiros, incluindo um fork/referência do **[Project AIRI](https://github.com/moeru-ai/airi)**. Alguns caminhos legados ainda dependem de componentes AIRI enquanto o desacoplamento avança. AIRI é referência técnica e origem de parte do código atual, não a arquitetura-alvo nem uma dependência permanente desejada. A Lia também utiliza bibliotecas, engines, modelos e assets de terceiros. Licenças e atribuições detalhadas são registradas em `docs/licenses/` (ver [`THIRD-PARTY-NOTICES.md`](docs/licenses/THIRD-PARTY-NOTICES.md) e [`ASSET-LICENSES.md`](docs/licenses/ASSET-LICENSES.md)).

## DevKit

Git seguro e **universal** (`DevKit.bat` + `tools/`) — funciona em qualquer projeto:
cole os dois na raiz e use. Menu interativo ou `python tools/project_cli.py <comando>`.

- `sync` valida sintaxe, commita, rebasa e empurra **sem force e nunca direto na main**
- Varredura anti-credenciais no stage e nos commits ainda não publicados
- Bloqueia pesos de IA (>95 MiB, `.gguf`/`.safetensors`), `.env` e pastas geradas
- Wizard de primeiro cadastro: repo **privado** no GitHub com confirmação digitada e retomada segura
- Configuração opcional por projeto via `devkit.json` na raiz (veja `tools/devkit.example.json`)

Testes do kit: `python tools/test_project_cli.py` e `python tools/test_creation.py` (sem rede).
