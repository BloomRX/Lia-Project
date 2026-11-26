# ASSET-LICENSES

Registro de **assets e modelos distribuídos com a aplicação** Lia (conforme AGENTS.md §97 THIRD-PARTY ATTRIBUTION).

## Inventário Windows do pacote nativo

Gere a prévia privada com
`node lia/desktop/scripts/package-windows.mjs --internal-test --dir`.
Na raiz, execute `node tools/release/inventory-packaged-licenses.mjs` para
obter os hashes e os metadados dos ASAR do Launcher e do Stage.
O inventário usa o empacotador instalado em `lia/desktop`. As licenças
declaradas e a presença de avisos são insumos para revisão de distribuição.

No pacote descompactado Windows do SHA `47dcb8ea`, gerado em árvore sem
`airi/`, o Launcher tinha 615 arquivos e 35 manifestos, 23 com aviso
adjacente. O Stage tinha 963 arquivos e 19 manifestos, 17 com aviso adjacente.
Nenhum dos ASAR tinha caminhos classificados pelo inventário como fontes,
VRM, Cubism/Live2D ou Spine. A classificação é por caminho, e o inventário
mantém `redistributionApproved: false`. O gate de abertura e encerramento
do Stage pelo Launcher empacotado também passou.


### Prévia de atualização 0.0.2

O mesmo inventário, aplicado ao pacote Windows do ensaio de atualização da
base `0a4cdab5`, encontrou 636 arquivos e 35 manifestos no Launcher e 984
arquivos e 19 manifestos no Stage. Havia avisos adjacentes em 23 e 17
manifestos, respectivamente. Os ASAR não apresentaram fontes, VRM, Cubism
ou Spine por caminho. O único caminho de imagem encontrado foi o Hero do
Launcher. O ícone da Lia é um recurso dos executáveis e fica fora do ASAR.

| Asset da Lia | SHA-256 do arquivo-fonte | Onde entra |
| --- | --- | --- |
| `lia/assets/character/LiaHeroImage.png` | `A6772CB11E20BFA312253DDA69A9A8F8A4A4D55A3B42C7B03999B33D9E9126EB` | Tela inicial do Launcher |
| `lia/assets/icons/IconAppCompact.png` | `1510B224A349AA6C09F7AF53D5D6DB3198A563547C4866E2ABF7321A6B290996` | Launcher, Stage e instalador |

Os hashes delimitam os arquivos a revisar. Faltam evidências de autoria e
direitos de distribuição pública para os dois assets e uma licença explícita
do produto. O gate de instalação verifica a presença dos avisos do runtime e
da atribuição MIT, conforme o escopo do pacote privado.

## Histórico de 08/11/2026 — pacote anterior

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

O [resumo versionado](PACKAGED-INVENTORY-2026-11-08.json) contém hashes e contagens do pacote anterior. A revisão adicional leu os avisos locais indicados. Conteúdo de modelos, runtime, arquivos externos aos ASAR e instalador exigem revisão separada.

## Pacote da comparação beta

O inventário do layout `win-unpacked` medido registra hashes dos arquivos,
formatos e manifestos. O hash do NSIS associado identifica o instalador, que
fica fora desta inspeção de conteúdo. No Stage há quatro entradas VRM que correspondem a dois modelos
em caminhos duplicados, duas amostras GLB de `stats-gl`, dois pesos ONNX de
VAD, 50 imagens por extensão, 3412 fontes e 42 binários ou WASM por extensão.
No Launcher foi encontrado o Hero PNG. A busca por extensões de áudio e
animação não localizou arquivos soltos nessas categorias. Conteúdo incorporado
em bundles, modelos ou downloads externos fica fora dessa contagem.
[Inventário do pacote medido](PACKAGED-INVENTORY-BETA-2026-11-08.json).

| Item | Classificação e evidência |
| --- | --- |
| AvatarSample A/B | **Permitido com condições específicas**, por correspondência de nome, autor e metadados embutidos com os modelos de exemplo publicados pela pixiv. As condições vedam repassar os arquivos por cobrança, aplicar CC0 ou insinuar endosso. A situação comercial do pacote final precisa ser conferida antes de publicar. [Condições oficiais dos modelos](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z) |
| `silero_vad_legacy.onnx` e `silero_vad_v5.onnx` | **Não verificado** para os bytes exatos. SHA-256 e caminhos registrados. O projeto upstream declara MIT e o mantenedor confirma MIT para outro peso identificado por revisão. Falta vincular cada binário empacotado à sua revisão e ao aviso correspondente. [Licença upstream](https://github.com/snakers4/silero-vad/blob/master/LICENSE) · [Resposta do mantenedor](https://github.com/snakers4/silero-vad/discussions/817) |
| `Flamingo.glb` e `LittlestTokyo.glb` | **Não verificado**. Presentes na dependência física e identificados por hash. Falta licença e origem de cada modelo e textura. |
| Texturas, ícones, animações, áudio e Hero | **Não verificado** ou **autorização necessária** quando identificada na tabela anterior. A contagem por extensão não resolve direitos de dados incorporados, assets gerados e elementos de terceiros. |

## Histórico M0-A — 07/09/2026

O registro original dizia “nenhum asset/modelo [...] foi adicionado/embutido ainda”. Preservado como histórico; **não descreve o pacote privado de 08/11/2026**. Não registrar segredos ou informações privadas neste documento.
