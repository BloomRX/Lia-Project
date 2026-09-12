# Dívida de i18n — painel de Settings do AIRI (pt-BR)

Registrada na Phase 4E-1 (superfície unificada "Configurar Lia"). **Não corrigida
neste commit de propósito**: a 4E-1 entregou a superfície de configuração da Lia,
e traduzir o namespace `settings.*` do AIRI é um trabalho de escopo próprio, com
revisão de termos técnicos, sem relação com a arquitetura entregue.

## O que está medido

O locale `pt-BR` distribui apenas `tamagotchi` (mais `home.yaml`, que é importado
por `pt-BR/tamagotchi/index.ts` como `../home.yaml`). Não existe tradução pt-BR
para o namespace `settings.*`.

Contagem obtida varrendo `packages/stage-ui/src/**/*.{vue,ts}` em busca de
`t('settings.…')` e comparando com todas as chaves presentes em
`packages/i18n/src/locales/pt-BR/**/*.yaml`:

| Recorte | Chaves usadas no stage-ui | Sem tradução pt-BR |
| --- | --- | --- |
| Namespace `settings.*` inteiro | 430 | **430** |
| └ `settings.pages.providers.*` (catálogo/instância de provider) | 171 | **171** |
| &nbsp;&nbsp;&nbsp;└ campos `api-key` | 9 | 9 |
| &nbsp;&nbsp;&nbsp;└ campos `base-url` | 3 | 3 |
| &nbsp;&nbsp;&nbsp;└ campos `thinking-mode` | 9 | 9 |

Exemplo de chave afetada:
`settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label`

Como `fallbackLocale` é `en`, essas telas **caem silenciosamente para inglês** —
não há erro nem warning em runtime.

## Contraste com a superfície da Lia

O painel de configuração da Lia está completo nos dois locales:

| Namespace | pt-BR | en | Divergência |
| --- | --- | --- | --- |
| `tamagotchi.home.*` | 110 | 110 | nenhuma, nos dois sentidos |

As 32 chaves novas da 4E-1 (`tamagotchi.home.config.*`) foram escritas em pt-BR e
en juntas. `lia-config.test.ts` trava isso: extrai as chaves referenciadas pelos
componentes — inclusive as resolvidas por interpolação, como
`` tt(`fields.${row.key}`) `` — e falha se alguma faltar em qualquer um dos dois
locales, além de comparar os dois arquivos inteiros.

## Impacto para o usuário hoje

Nulo para o fluxo da Lia: a seção **IA** da tela "Configurar Lia" reusa
`LiaProviderConfig`, que resolve tudo por `tamagotchi.home.provider.*` (40 chaves,
0 sem tradução). A dívida só aparece se o usuário entrar no Settings do AIRI —
superfície que o produto Lia não expõe nem referencia.

## Critério para fechar

1. Criar `packages/i18n/src/locales/pt-BR/settings/` espelhando a estrutura de
   `en/`, começando por `settings.pages.providers.*` (171 chaves).
2. Manter termos técnicos que não devem ser traduzidos (`API key`, `Base URL`,
   `reasoning effort`) em uma tabela de termos compartilhada, para não divergir
   entre telas.
3. Estender o padrão do `lia-config.test.ts` para o namespace `settings.*`:
   nenhuma chave usada em `stage-ui` pode existir só em `en`.
4. Só então considerar o namespace fechado — com contagem antes/depois medida,
   não estimada.

## Fora deste registro

- Os warnings de i18n e a CSP do Electron continuam como dívida separada, sem
  relação com esta.
- Nenhuma chave `tamagotchi.*` está pendente.
