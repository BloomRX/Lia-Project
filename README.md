# Lia-Project

**Lia** — companheira virtual (AI companion), um produto próprio em processo de desacoplamento técnico. O [Project AIRI](https://github.com/moeru-ai/airi) é mantido como referência e fonte de estudo, não como a arquitetura final obrigatória.

## Comece aqui

| O que você procura | Onde encontrar |
| --- | --- |
| Estado atual e validações pendentes | [Estado agora](docs/project/CURRENT-STATE.md#0-estado-agora) |
| Visão, funcionalidades e critérios de aceitação | [Especificação do produto](docs/product/ESPECIFICACAO-GERAL-DO-PRODUTO-LIA.md) |
| Plano para tornar o AIRI apenas referência | [Plano de desacoplamento](docs/architecture/AIRI-DECOUPLING-PLAN-2026-10-28.md) |
| Guias, decisões e relatórios | [Índice da documentação](docs/README.md) |
| Identidade e linguagem | [Padrão da marca](docs/BRAND-STANDARDS.md) |

## Como o desktop inicia hoje

No Windows, com Node.js e Corepack disponíveis, abra `Lia.bat` na raiz.
O script prepara os pacotes com seus lockfiles e abre o Launcher próprio.
A ação **Conversar com Lia** abre o Stage próprio. Use `Lia.bat -PrepareOnly`
para instalar as dependências e compilar sem abrir uma janela.

| Componente | Caminho atual |
| --- | --- |
| Entrada de desenvolvimento | [Lia.bat](Lia.bat) |
| Launcher e empacotamento Windows | [lia/desktop](lia/desktop) |
| Stage para conversa, avatar e voz | [lia/stage](lia/stage) |
| Configuração do produto, cofre e voz | [lia/runtime](lia/runtime) |
| Contratos e desenvolvimento | [lia/](lia/README.md) |

O fluxo a partir de `Lia.bat` funciona com a árvore `lia/`. O empacotamento
privado ainda separa a edição nativa da legada. Consulte o estado atual
para acompanhar a validação de funcionalidades e distribuição.

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
