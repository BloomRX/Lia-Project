---
name: lia-release-gate
description: Executa e documenta o gate de release da Lia no Windows, separando PASS, FAIL, BLOCKED e NOT RUN. Use ao rodar os testes de release, decidir se a Lia pode ser declarada pronta, atualizar RELEASE-WINDOWS ou CURRENT-STATE, ou quando a pergunta for se a release esta aprovada.
compatibility: O gate real exige Windows com o checkout, Node e Python no PATH. Fora do Windows apenas a parte automatizada roda, e ela nao substitui o gate.
---

# Gate de release da Lia

## A regra que não se negocia

**Build verde não significa que a Lia abre.** Suíte automatizada verde **não é**
o gate — o gate é Windows real, com a janela abrindo, a personagem aparecendo e
o usuário conversando.

Nunca reporte item não executado como PASS. Nunca promova a baseline funcional
um commit que não passou por Windows real.

## 1. Ler o estado antes de rodar qualquer coisa

1. `docs/project/CURRENT-STATE.md` §0 — baseline, fase, o que já foi provado.
2. `docs/project/QUANTO-FALTA.md` — critérios da fase e o que exige o PC do Dev.
3. `docs/product/RELEASE-WINDOWS-<data>.md` mais recente — a rodada anterior.
4. `git rev-parse --abbrev-ref HEAD` e `git status --porcelain -uall`.

Se o estado do repositório não bate com o que o relatório afirma, diga isso e
trabalhe a partir do que o `git` mostra — não do que o documento diz.

## 2. Comandos

Os comandos das quatro suítes, o diretório correto e o rebuild necessário estão
em **`lia-test-discipline`** — não os repita aqui. Um comando copiado em dois
lugares diverge.

Para lint, typecheck e build, o script declarado é a fonte:

| Etapa | Comando | Estado da verificação |
| --- | --- | --- |
| Lint | `cd airi; pnpm exec moeru-lint <arquivos>` | executado em rodadas anteriores |
| Typecheck | `cd airi; pnpm run typecheck` | script declarado, não executado por mim |
| Build | `cd airi; pnpm -F @lia/lia-app run build` | script declarado, não executado por mim |

"Script declarado" não é "executado". Ao registrar, use o veredito que
corresponde ao que você realmente rodou.

## 3. Classificar cada item, sem meio-termo

| Veredito | Significa |
| --- | --- |
| **PASS** | Executado nesta rodada, no ambiente declarado, com saída e código de saída registrados. |
| **FAIL** | Executado e falhou. Inclui o trecho da falha e o comando exato. |
| **BLOCKED** | Não pôde ser executado por impedimento externo (credencial, rede, quota, hardware). Diga qual. |
| **NOT RUN** | Simplesmente não foi executado. **Nunca** é PASS. |

Um `429`, `413` ou `401` do provedor é **BLOCKED**, não FAIL de código — mas
também não é PASS.

## 4. Falha: reproduzir antes de corrigir

Não altere código para fazer um gate passar. Reproduza, identifique a causa,
corrija a causa e prove que a correção resolve. O método está em
`lia-regression-investigation`; o gate só registra o resultado.

Falha intermitente **não** é resolvida. Repita de forma limitada e registre as
repetições; nunca aumente timeout nem engula exceção para ficar verde.

## 5. Registrar a evidência

Escreva em `docs/product/RELEASE-WINDOWS-<data>.md`, que é versionado.
`Tests/runs/` é *gitignored* — log que só existe lá não é evidência que outro
agente consiga ler.

Cada item registrado precisa de:

- comando exato, código de saída e contagem (`Ran N tests`, `N passed`);
- ambiente: host, versão do interpretador ou Node, data;
- veredito da tabela do item 3;
- limitações, inclusive o que **não** foi coberto.

Ao fechar a rodada, atualize `CURRENT-STATE.md` §0 e `QUANTO-FALTA.md` com o
resultado real — ou não declare nada.

## 6. Parar em vez de inventar

Aplique **STOP AND REPORT** quando: um gate obrigatório falha; a causa de um
bloqueador não foi identificada após investigação razoável; falta credencial ou
acesso. Apresente o que rodou, o que falhou, a hipótese mais forte e o próximo
experimento seguro. Release não aprovada é uma resposta legítima.

## 7. O que este gate não cobre

Estes itens exigem o PC do Dev e **não** podem ser substituídos por automação:
teste humano de microfone, failover E2E contra serviços reais, loop real de
ferramentas, medição de latência e rede, comparação visual completa dos
concepts, presença Free/multimonitor e instalação limpa/atualização/desinstalação
do instalador.

Automatizado verde nesses itens é zero evidência de runtime.
