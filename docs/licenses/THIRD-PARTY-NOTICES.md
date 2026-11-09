# THIRD-PARTY-NOTICES

Relação de **bibliotecas, frameworks, engines e projetos de terceiros** relevantes ao produto Lia (conforme AGENTS.md §97 THIRD-PARTY ATTRIBUTION).

## Estado em 08/11/2026 — inventário privado, sem aprovação pública

O Launcher contém **39 manifestos de pacote e 27 arquivos de aviso**; o Stage contém **1039 manifestos e 789 avisos**. Respectivamente, 27 e 780 manifestos têm aviso na raiz do pacote. Contagens incluem cópias e versões duplicadas; não representam componentes únicos. A classificação automática é sempre `unverified`: `package.json` é declaração, não aprovação legal. O [resumo físico](PACKAGED-INVENTORY-2026-11-08.json) registra SHA-256 dos ASAR e frequência das expressões declaradas.

| Componente/família | Versão observada | Licença/evidência | Classificação e obrigação |
|---|---|---|---|
| Código original Project AIRI | Referência `v0.12.0-beta.5`, commit `2c1e223c…` | `airi/LICENSE`: MIT, © 2024-PRESENT Neko Ayaka | **Aprovado com atribuição** somente para código coberto pelo aviso; preservar copyright e texto MIT. AIRI é referência externa e legado em remoção, não contrato estrutural da Lia. Não cobre dependências/assets. |
| Código original `stage-ui-spine` | Manifesto sem versão | `airi/packages/stage-ui-spine/LICENSE.md`: separação explícita MIT × Spine | **Aprovado com atribuição** apenas para código original MIT. O runtime Spine não recebe essa licença. |
| Outros pacotes declarados MIT/OFL e demais expressões | Frequências no resumo | Manifestos e presença de avisos | **Não verificado** individualmente. Conferir texto, escopo e entrega de notices; declaração MIT não aprova conteúdo agregado. |
| Fontes | Fontsource 5.3.0 | OFL-1.1 declarada; aviso Comfortaa lido | Ver [registro de assets](ASSET-LICENSES.md): aprovação com atribuição limitada à família verificada, sem aprovação global. |
| Spine Runtimes | `spine-core`/`spine-webgl` 4.0.31, 4.1.56, 4.2.119 | `LicenseRef-LICENSE`; seis avisos adjacentes | **Requer autorização / não verificado**. Aviso 4.2.119 de 05/04/2025 remete à seção 2 da licença Spine Editor; alternativa exige licença de cada usuário e inclusão do acordo/copyright. Não há prova de enquadramento/licença da Lia. Versões antigas exigem revisão própria. |
| Cubism Core / Framework / Samples | Cache local `CubismSdkForWeb-5-r.3`; 133 caminhos relacionados no Stage | Avisos locais do SDK, Core e Framework | **Requer autorização / não verificado**. Core é proprietário; componentes usam contrato Live2D próprio; SDK menciona licença de publicação para determinados negócios. Termos completos e relação com bytes empacotados pendentes. |

Fontes locais consultadas: `airi/LICENSE`; `airi/packages/stage-ui-spine/LICENSE.md`; `airi/node_modules/.pnpm/@esotericsoftware+spine-core@4.2.119/node_modules/@esotericsoftware/spine-core/LICENSE`; avisos `LICENSE.md`, `Core/LICENSE.md` e `Framework/LICENSE.md` sob `airi/apps/stage-tamagotchi/src/renderer/.cache/assets/js/CubismSdkForWeb-5-r.3/`; licença do pacote Comfortaa instalado. Os avisos Cubism apontam contratos específicos; nenhum texto completo desses contratos externos foi presumido a partir de uma licença de pasta.

Este documento **não substitui os textos integrais de copyright/licença** que devem acompanhar a distribuição. O empacotamento de notices, runtime Electron/Chromium, arquivos unpacked e instalador precisa de gate separado. Modelos VRM, Hero PNG e animações continuam pendentes. Não houve remoção de assets/dependências nem aprovação da licença do produto Lia.

## Histórico M0-A — 07/09/2026

O registro original descrevia somente documentação e prometia ampliar a lista quando componentes entrassem. Esse estado foi superado pelo inventário físico de 08/11/2026; a antiga descrição “Runtime/base do produto Lia” também não representa a decisão arquitetural atual. Preservado aqui como histórico. Não registrar segredos ou informações privadas neste documento.
