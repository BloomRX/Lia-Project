# Plano de migração — tirar a Lia de dentro do AIRI

Estado: **Fases 1, 2 e 3 concluídas; Fase 4 iniciada** (27/10/2026).
Princípio: incremental, reversível, e nenhuma funcionalidade removida para
fazer build passar.

---

## 1. Situação de partida

| Componente | Hoje | Já é da Lia? |
| --- | --- | --- |
| Launcher | `airi/apps/lia-app` (~11 110 linhas) | **sim, 100%** |
| Núcleo da Lia | `airi/packages/lia-core` (67 arquivos) | **sim, 100%** |
| Stage | 165 arquivos **injetados** em `airi/apps/stage-tamagotchi` | **não** |
| Runtime de conversa | `airi/packages/core-agent` (modificado) | não — compartilhado |
| UI compartilhada | `airi/packages/stage-ui` (45 criados, 39 modificados) | parcial |

O Launcher e o núcleo não precisam ser extraídos: **já são independentes**. A
dificuldade é o Stage.

---

## 2. Fase 1 — referência limpa (CONCLUÍDA)

Clone do `moeru-ai/airi` em `2c1e223`, **fora** da árvore do repositório. Sem
isso não existe "antes" para comparar. Ver `AIRI-COMPARISON.md` §1.

**Estado:** `git describe --tags` = `v0.12.0-beta.5`. Nenhuma instalação de
dependências feita no clone.

**Limitação:** esse clone não sobrevive ao reprovisionamento do ambiente. Para
reconferir os números, refazer os passos de `AIRI-COMPARISON.md` §8.

---

## 3. Fase 2 — comparação (CONCLUÍDA)

`docs/architecture/AIRI-COMPARISON.md`. Resultado: 353 criados, 95 modificados,
**0 removidos**.

O número que muda o plano: **zero remoções**. Uma atualização do upstream não
pode ressuscitar arquivo apagado pela Lia, porque a Lia não apaga.

---

## 4. Fase 3 — contratos (CONCLUÍDO o núcleo; o resto é pré-requisito)

`lia/core` (`@lia/contracts`), **zero dependências**, 26 testes verdes com o
`node --test` nativo.

Por que zero dependências: se `@lia/contracts` precisasse de build, ela
arrastaria o `pnpm install` do AIRI — e a fronteira de independência morreria na
primeira linha.

| Contrato | Estado |
| --- | --- |
| Ciclo de vida do Stage | **implementado + testado** |
| Protocolo Launcher ↔ Core ↔ Stage | **implementado + testado** |
| Saúde e falhas | **implementado + testado** |
| Configuração / migração de config | mapeado, não implementado |
| Personagem / presença | mapeado, não implementado |
| Chat / streaming (porta `LiaChatPort`) | mapeado, não implementado |
| Voz | mapeado, não implementado |
| Permissões / ferramentas | mapeado, não implementado |
| Logs / diagnósticos | parcial (callback `onLog`) |

---

## 5. Fase 4 — construir `lia/`, migrar incrementalmente

### 4a — Stage mínimo (ESCRITO, testado sem display)

`lia/stage`:
- `src/main/stage-host.ts` — ciclo de vida, plataforma injetada, **9 testes**;
- `src/main/index.ts` — único arquivo que importa Electron, 53 linhas;
- `src/renderer/index.html` — placeholder declarado como placeholder.

O gate de ciclo de vida está **PASS** em Linux headless. Janela real, render
real e encerramento sem órfão no Windows estão **NÃO EXECUTADOS**: o ambiente do
agente não tem display nem binário do Electron.

### 4b — Launcher (ESCRITO, testado na decisão)

`lia/launcher`:
- `src/resolve-stage-target.ts` — a **decisão** de qual Stage subir, em função
  pura, com 5 testes sobre a decisão (não sobre "o executável foi chamado");
- `src/index.ts` — `createLauncher`, 3 testes.

Ainda **não substitui** `airi/apps/lia-app/src/main/airi-stage-manager.ts`. Essa
substituição é o passo 4c-4, e é o ponto de rollback (§6).

### 4c — Próximos passos, em ordem

1. Portar `main/services/lia` (70 arquivos) para `lia/stage`, um serviço por
   commit, com o teste colocado correspondente.
2. Criar o `LiaChatPort` e ligá-lo ao `@proj-airi/core-agent` por adaptador.
3. Migrar `main/configs/lia{,-schema,-product}.ts` para `lia/core`.
4. Só então trocar o `AiriStageManager` pelo `createLauncher`.
5. Deixar `apps/stage-tamagotchi` intocado (é do upstream, não mexer).

---

## 6. Reversão

Cada passo tem que poder ser desfeito **sem `git reset`**. Regra desta missão:
nada de `reset --hard`, `restore`, `clean`, `stash`, `rebase`, `--amend` ou
force push.

- O código novo vive em `lia/`, que o AIRI **não conhece**. Apagar `lia/core`,
  `lia/stage` e `lia/launcher` volta ao estado atual exato (os assets de
  `lia/assets/` são anteriores e ficam).
- `lia/` **não entra** em `airi/pnpm-workspace.yaml`. Se entrasse, passaria a
  exigir o catálogo e o install do AIRI, e o rollback deixaria de ser trivial.
- O `AiriStageManager` continua sendo o caminho de produção até o passo 4c-4.
  Nada é removido antes de o substituto estar verde.

### Critério de rollback por passo

Um passo é revertido se, isoladamente:

- qualquer teste que passava antes falhar;
- o Stage deixar de abrir no Windows;
- aparecer processo órfão depois de fechar;
- `git diff --check` acusar espaço em branco.

---

## 7. Gate honesto

| Verificação | Estado em 27/10/2026 |
| --- | --- |
| `@lia/contracts` — 26 testes | **PASS** (executado) |
| `lia/stage` — 9 testes | **PASS** (executado) |
| `lia/launcher` — 8 testes | **PASS** (executado) |
| Teste de mutação (declarar pronto antes da hora) | **detectado** |
| Teste de mutação (versão malformada aceita) | **detectado** — foi encontrado assim |
| Typecheck de `lia/` | **NÃO EXECUTADO** (sem `tsc` instalado no ambiente) |
| Janela real do Stage | **NÃO EXECUTADO** |
| Encerramento sem órfão no Windows | **NÃO EXECUTADO** |
| Build empacotado | **NÃO EXECUTADO** |
| Testes do Launcher existente, antes/depois | **NÃO EXECUTADO** nesta rodada |

Nenhuma linha desta tabela marcada NÃO EXECUTADO pode ser relatada como PASS.
