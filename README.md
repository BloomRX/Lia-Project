# Lia-Project

**Lia** — companheira virtual (AI companion) construída sobre a base do [Project AIRI](https://github.com/moeru-ai/airi).

## Status

- ✅ **Estudo técnico completo do AIRI concluído** → [`docs/estudo-airi.md`](docs/estudo-airi.md)
- 🎯 **Decisão:** fork da versão **`v0.12.0-beta.5`** (a mais recente disponível, mesmo sendo beta — 29/08/2026), licença MIT, com remote `upstream` para absorver evoluções.
- 🗺️ **Roadmap:** Fase 0 (base/toolchain) → Fase 1 (identidade "Lia" + pt-BR) → Fase 2 (corpo/voz: avatar Live2D + TTS/STT) → Fase 3 (habilidades: plugins, memória, integrações) → Fase 4 (distribuição).

## Documentação

| Documento | Descrição |
|---|---|
| [`docs/estudo-airi.md`](docs/estudo-airi.md) | Estudo completo do Project AIRI: arquitetura, monorepo, stack, versões, providers, riscos e estratégia |
| [`tools/README.md`](tools/README.md) | DevKit universal: uso, comandos, segurança e configuração por projeto |

## DevKit

Git seguro e **universal** (`DevKit.bat` + `tools/`) — funciona em qualquer projeto:
cole os dois na raiz e use. Menu interativo ou `python tools/project_cli.py <comando>`.

- `sync` valida sintaxe, commita, rebasa e empurra **sem force e nunca direto na main**
- Varredura anti-credenciais no stage e nos commits ainda não publicados
- Bloqueia pesos de IA (>95 MiB, `.gguf`/`.safetensors`), `.env` e pastas geradas
- Wizard de primeiro cadastro: repo **privado** no GitHub com confirmação digitada e retomada segura
- Configuração opcional por projeto via `devkit.json` na raiz (veja `tools/devkit.example.json`)

Testes do kit: `python tools/test_project_cli.py` e `python tools/test_creation.py` (sem rede).
