# AIRI limpo × AIRI modificado — comparação reproduzível

Medido em 27/10/2026, a partir do HEAD `f1eebd9` da branch
`arena/01a10290-lia-project`.

Este documento existe porque `git diff` entre branches da Lia **não** responde a
pergunta certa: o AIRI entrou por `git subtree add --squash`, então o histórico
do upstream não está no repositório e a comparação tem que ser feita **contra um
clone limpo**, arquivo a arquivo.

---

## 1. Base de referência

| Campo | Valor | Como foi verificado |
| --- | --- | --- |
| Upstream | `moeru-ai/airi` | `airi/README.md` e `docs/upstream/AIRI-INTEGRATION.md` |
| Tag | `v0.12.0-beta.5` | `git describe --tags` no clone de referência |
| Tag anotada (objeto) | `6ea680f51486d257f9b0eeda3bdc25db4307d3bb` | `api.github.com/.../git/ref/tags/v0.12.0-beta.5` |
| Commit alvo (peeled) | `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf` | `api.github.com/.../commits/<sha>` — mensagem `release: v0.12.0-beta.5`, data 2026-08-29 |
| Data da consulta | 27/10/2026 | esta rodada |
| Licença do código | **MIT** (© 2024-PRESENT Neko Ayaka) | `LICENSE` do upstream + `AIRI-INTEGRATION.md` §1 |

**Correção ao registro anterior.** `docs/airi-modificacoes-registro.md` §1
afirmava que o commit-base era **desconhecido** e que havia contradição entre
`package.json` (`0.12.0-beta.5`) e o badge do README (`v0.11.3`). As duas coisas
são falsas:

- o commit é conhecido e está registrado em `docs/upstream/AIRI-INTEGRATION.md` §1;
- `v0.11.3` é o texto de um **badge de download**, não a versão da cópia.

O registro é corrigido nesta rodada.

### Reproduzir o clone

```bash
git clone https://github.com/moeru-ai/airi.git /fora/do/repo/airi-upstream
cd /fora/do/repo/airi-upstream
git checkout 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf
git describe --tags    # v0.12.0-beta.5
```

O clone **não** pode ficar dentro do repositório da Lia: o Git o trataria como
repositório aninhado.

---

## 2. Números da comparação

Método: caminhar as duas árvores ignorando `.git`, `node_modules`, `dist`,
`out`, `.turbo`, `coverage`; comparar por conteúdo de bytes.

| Classe | Quantidade |
| --- | --- |
| **A** — criados pela Lia (não existem no upstream) | **353** |
| **B** — arquivos do upstream modificados pela Lia | **95** |
| **C** — já existem no upstream e não devem ser reaplicados | — (ver §5) |
| **arquivos do upstream removidos pela Lia** | **0** |
| Total na referência | 5 332 |
| Total em `airi/` | 5 685 |

**Zero remoções** é um resultado importante: a Lia só **adiciona** e
**modifica**. Nenhuma atualização futura do upstream pode "ressuscitar" um
arquivo que a Lia apagou, porque não existe essa categoria.

---

## 3. Classe A — o que a Lia criou (353 arquivos)

| Área | Arquivos | O que é |
| --- | --- | --- |
| `apps/stage-tamagotchi/` | 165 | injeção da Lia **dentro** do Stage do AIRI (ver detalhe abaixo) |
| `packages/lia-core/` | 67 | núcleo próprio: `brain`, `bootstrap`, `bridge`, `paths`, `product`, `secrets`, `voice` |
| `apps/lia-app/` | 59 | **o Launcher**: 55 arquivos em `src`, ~11 110 linhas |
| `packages/stage-ui/` | 45 | componentes e telemetria adicionados à UI compartilhada |
| `packages/i18n/` | 7 | locale pt-BR e chaves de tradução |
| `packages/core-agent/` | 2 | peças novas no runtime do agente |
| `docs/product/` | 2 | relatórios de release |
| raiz de `airi/` | 5 | `DevKit.bat`, `DevTamagotchi.bat`, `QA.bat`, `QA-Miniconda.bat`, `DiagnoseLiaProvider.ps1` |

Detalhe dos 165 em `stage-tamagotchi` — é aqui que a Lia **vive hoje**:

| Caminho | Arquivos |
| --- | --- |
| `src/main/services/lia/` | 70 |
| `src/renderer/stores/lia/` | 29 |
| `src/renderer/services/lia/` | 15 |
| `src/renderer/components/lia-config/` | 12 |
| `src/main/configs/lia*.ts` | 4 |
| `src/main/windows/main/` | 4 |
| `src/renderer/diagnostics/` | 4 |
| demais (testes de correlação, devflow, assets) | ~27 |

`apps/lia-app` e `packages/lia-core` **não existem** no upstream — são criação
integral (confirma `docs/airi-modificacoes-registro.md` §2.1).

---

## 4. Classe B — o que a Lia mudou no código do AIRI (95 arquivos)

Ordenado por volume de alteração. Binários (ícones) aparecem como contagem de
linhas de diff binário, não de linhas de código.

| Arquivo | + / − | O que é | Preservar? |
| --- | --- | --- | --- |
| `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | +1033 / −9 | runtime de conversa: portas de contexto, metadados de provedor | **sim — crítico** |
| `packages/stage-ui/src/stores/chat.contract.test.ts` | +881 / −5 | contrato de chat | **sim** |
| `packages/stage-ui/src/stores/chat.ts` | +460 / −76 | store de chat da UI | **sim** |
| `apps/stage-tamagotchi/src/shared/eventa/index.ts` | +461 | eventos / IPC | **sim** |
| `packages/stage-ui/src/components/scenes/Stage.vue` | +282 / −122 | cena do palco | **sim** |
| `apps/stage-tamagotchi/src/main/index.ts` | +310 / −11 | bootstrap do main | **sim** |
| `packages/stage-ui/src/stores/modules/airi-card.test.ts` | +276 / −34 | cartão / personagem | sim |
| `apps/stage-tamagotchi/resources/icon*.png`, `build/icon.*` | binário | **identidade visual** da Lia | sim (assets) |
| `apps/stage-tamagotchi/src/main/windows/main/index.ts` | +90 / −67 | janela principal | sim |
| `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` | +142 / −2 | área interativa / chat | sim |
| `apps/stage-tamagotchi/src/renderer/pages/index.vue` | +103 / −14 | home | sim |
| `packages/core-agent/src/runtime/chat-orchestrator-runtime.test.ts` | +175 / −19 | testes do runtime | sim |
| `pnpm-lock.yaml` | +131 / −23 | dependências da Lia | sim |
| `packages/i18n/**` | vários | traduções pt-BR | sim |
| `packages/pipelines-audio/**` | pequeno | controle de streaming de voz | sim |
| `integrations/discord-bot/.../summon.ts` | pequeno | integração | não usado pela Lia — avaliar |

**Ícones:** `resources/icon*.png` e `build/icon.*` foram substituídos pelos da
Lia. Isso é **branding**, classificado como E (assets), e um re-clone do AIRI
devolveria a identidade do AIRI sem aviso.

---

## 5. Classes C/D/E/F

- **C — correções upstream já presentes:** não há como afirmar quais mudanças do
  AIRI posteriores a `2c1e223` a Lia já absorveu, porque a Lia **nunca fez
  `subtree pull`** desde a integração. Não inventar essa lista.
- **D — temporário/obsoleto:** `airi/DevKit.bat`, `DevTamagotchi.bat`,
  `QA.bat`, `QA-Miniconda.bat` são arneses de bancada do AIRI, não produto da
  Lia. Não remover sem decisão.
- **E — assets/config/licenças:** ícones (acima), `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `electron-builder.config.ts`, `electron.vite.config.ts`,
  `vitest.config.ts`. São os itens que uma reconstrução fiel precisa.
- **F — sem proveniência confirmada:** nenhum arquivo caiu nesta classe nesta
  comparação. Todos os 95 têm origem atribuível a uma área da Lia ou a
  dependência/assets. Isso **não** significa que cada linha seja intencional —
  significa que não encontrei arquivo órfão.

---

## 6. Dependências que a Lia introduziu

`airi/package.json` e `pnpm-lock.yaml` divergem do upstream. A reconstrução fiel
não é "copiar o AIRI e aplicar um patch de código": é **copiar, reaplicar o
código e reinstalar com o lockfile da Lia**.

Verificado por contagem de diff: `pnpm-lock.yaml` difere em +131 / −23 linhas.

---

## 7. O que isso significa para a independência

O resultado desconfortável desta comparação:

> **A Lia não é hoje um aplicativo separado do AIRI. É o AIRI com 353 arquivos
> próprios injetados dentro, alguns dos quais alteram o runtime de conversa
> compartilhado.**

Consequências para a missão de independência:

1. `apps/lia-app` (Launcher) e `packages/lia-core` já são **100% da Lia** — são
   a parte mais fácil de extrair.
2. O Stage da Lia **não existe como artefato separado**: são 165 arquivos
   inseridos dentro de `apps/stage-tamagotchi/`. Extrair isso é o trabalho real.
3. As alterações em `core-agent` e `stage-ui` são o ponto de maior risco: são
   pacotes compartilhados e modificados, e um `subtree pull` as sobrescreveria.

---

## 8. Reproduzir a comparação

```bash
# 1. clone de referência fora do repositório
git clone https://github.com/moeru-ai/airi.git ../airi-upstream
git -C ../airi-upstream checkout 2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf

# 2. contagem por classe
diff -rq \
  --exclude=.git --exclude=node_modules --exclude=dist --exclude=out \
  ../airi-upstream airi | wc -l

# 3. volume por arquivo modificado
for f in $(diff -rq --exclude=.git --exclude=node_modules --exclude=dist \
             --exclude=out ../airi-upstream airi | grep 'differ' | awk '{print $2}' | sed 's|.*airi-upstream/||'); do
  printf '%-60s %s\n' "$f" "$(diff -u --strip-trailing-cr ../airi-upstream/$f airi/$f | grep -c '^[+-]')"
done | sort -k2 -rn | head -20
```

## 9. Limitações desta comparação

- Feita em Linux, sem `git` do subtree preservado: compara **árvores**, não
  histórico. Não diz **quando** cada mudança entrou.
- Não avalia se cada alteração em `core-agent` é necessária — só que existe.
- Binários comparados por bytes; não avalia se o ícone é visualmente correto.
- Não compara `node_modules` nem artefatos gerados.
- Os números foram medidos numa execução anterior. O clone de referência **não
  sobrevive** ao reprovisionamento do ambiente do agente; para reconferir, é
  preciso refazer os passos da §8.
