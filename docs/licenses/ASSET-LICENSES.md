# ASSET-LICENSES

Registro de **assets e modelos distribuídos com a aplicação** Lia (conforme AGENTS.md §97 THIRD-PARTY ATTRIBUTION).

## Estado em 08/11/2026 — distribuição pública não aprovada

O inventário físico dos dois ASAR privados contradiz o registro M0-A. O Stage contém **3412 arquivos de fontes, 4 VRM, 133 caminhos Cubism/Live2D e 248 caminhos Spine**. As categorias são heurísticas por caminho, podem sobrepor e não equivalem a quantidades de modelos. O Launcher contém `out/renderer/assets/LiaHeroImage-BLKXUVQa.png`. Nenhum asset ou dependência foi removido nesta revisão.

| Família | Evidência e licença | Classificação | Obrigação ou pendência |
|---|---|---|---|
| Comfortaa 5.3.0 | Aviso local de `@fontsource-variable/comfortaa`: SIL OFL 1.1, autores Comfortaa, nome reservado | **Aprovado com atribuição**, somente a família licenciada | Preservar copyright e OFL; não vender fonte isoladamente, respeitar nomes reservados em derivados. Conferir propagação dos avisos ao pacote final. |
| Outras fontes | Dez famílias adicionais Fontsource 5.3.0 declaram OFL-1.1; 3412 arquivos totais por extensão | **Não verificado** por arquivo | Conferir aviso de cada família e vínculo das cópias geradas; metadados não autorizam toda fonte encontrada. |
| VRM | Quatro caminhos `.vrm` no Stage | **Requer autorização / não verificado** | Identificar autor, licença específica, uso comercial e redistribuição de cada modelo. Licença do renderizador não cobre modelo. |
| Modelos Live2D, texturas e animações | Caminhos Cubism/Live2D; aviso SDK local distingue modelos de exemplo por contrato | **Requer autorização / não verificado** | Identificar modelos efetivamente empacotados e termos próprios. Não aplicar licença genérica da pasta. |
| Modelos, texturas e animações Spine | Caminhos Spine; licença do runtime é separada dos assets | **Requer autorização / não verificado** | Conferir origem e direitos de cada conjunto. |
| Lia Hero PNG | Imagem física no ASAR do Launcher | **Requer autorização / não verificado** | Documentar autoria, origem e permissão de distribuição; nome do arquivo não prova titularidade. |

O aviso local `CubismSdkForWeb-5-r.3/Core/LICENSE.md` aponta licença proprietária para Cubism Core. O aviso geral do SDK distingue componentes, Core e materiais de exemplo, incluindo exigências específicas de publicação. Isso não é uma aprovação de redistribuição: os contratos completos e o enquadramento da Lia ainda precisam de revisão. Ver também [avisos de terceiros](THIRD-PARTY-NOTICES.md).

Reproduzir: `node tools/release/inventory-packaged-licenses.mjs`. [Resumo versionado](PACKAGED-INVENTORY-2026-11-08.json) contém hashes e contagens; a evidência detalhada fica fora do Git. O inventário lê apenas manifestos; esta revisão adicional leu avisos locais indicados. Conteúdo de modelos não foi analisado. Runtime, arquivos externos aos ASAR e instalador exigem revisão separada.

## Histórico M0-A — 07/09/2026

O registro original dizia “nenhum asset/modelo [...] foi adicionado/embutido ainda”. Preservado como histórico; **não descreve o pacote privado de 08/11/2026**. Não registrar segredos ou informações privadas neste documento.
