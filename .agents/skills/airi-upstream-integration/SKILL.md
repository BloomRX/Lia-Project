---
name: airi-upstream-integration
description: Avalia e integra seletivamente atualizacoes do AIRI vendado em airi/, sem re-clone cego e sem perder as modificacoes da Lia. Use ao comparar com o upstream moeru-ai/airi, avaliar uma correcao vinda de la, decidir se um patch upstream deve entrar, ou quando alguem pedir para atualizar o AIRI.
compatibility: Requer git e acesso a github.com. O clone de comparacao vive fora do repositorio.
---

# Integrar atualizações do AIRI

`airi/` é uma **cópia vendada** do AIRI, não um submódulo: não existe
`airi/.git` nem `.gitmodules`. Isso muda o método — não há `git diff` contra o
upstream, e um re-clone apaga as modificações da Lia.

## 0. Confirmar a proveniência registrada

`docs/airi-modificacoes-registro.md` §1 e `docs/upstream/AIRI-INTEGRATION.md`
registram a base `2c1e223c8dd813d7c74a324d7fd7399fbf47e8bf`, tag
`v0.12.0-beta.5`. CURRENT-STATE §0.1 confirmou a comparação em 27/10/2026.

Não reabra a proveniência como desconhecida sem evidência nova. Confira o
registro antes de comparar; se houver divergência, investigue e documente.

## 1. O que nunca fazer

- Re-clonar o AIRI por cima de `airi/`.
- `git merge`, `git pull` ou substituição em bloco da árvore vendada.
- Descartar modificação da Lia sem autorização explícita.
- `git reset --hard`, `git clean` ou `git restore` para "limpar" depois.
- Integrar várias mudanças do upstream de uma vez.

## 2. Ler o registro de modificações primeiro

`docs/airi-modificacoes-registro.md` é a fonte de verdade sobre o que é nosso:

| Seção | O que responde |
| --- | --- |
| §1 Proveniência | versão vendada e commit-base confirmado |
| §2.1 Risco ZERO | `apps/lia-app` e `packages/lia-core` **não existem** no upstream — criação integral da Lia |
| §2.3 RISCO REAL | arquivos do upstream que **nós** modificamos — os que um re-clone sobrescreveria |
| §5 | como reaplicar cada modificação |

Se a mudança upstream tocar um arquivo da §2.3, ela **conflita com patch
nosso** e exige análise antes de qualquer edição.

## 3. Comparar sem tocar no repositório

Clone o upstream **fora** do checkout e compare por caminho:

```powershell
git clone --depth 200 https://github.com/moeru-ai/airi.git $env:TEMP\airi-upstream
```

`--depth 1` basta para ver o estado atual, mas não para achar o base — para isso
é preciso histórico. Use `git log` e `git tag` no clone para localizar o commit
cuja árvore mais se aproxima de `airi/`.

Depois compare arquivo a arquivo. No PowerShell:

```powershell
# exemplo de comparação de conteúdo, sem alterar os arquivos
git diff --no-index -- "$env:TEMP\airi-upstream\package.json" ".\airi\package.json"
```

Confirme também caminhos relativos: comparar apenas `Name` com Compare-Object
não prova igualdade. Exit 1 do diff acima indica diferenças, não erro de execução;
SHA-256 também permite conferir igualdade dos arquivos relevantes.
Compare **os arquivos realmente afetados**, não o diff inteiro. Um relatório
com 400 arquivos não é análise.

## 4. Classificar cada mudança

| Classe | Critério | Ação |
| --- | --- | --- |
| Correção de segurança | fecha vulnerabilidade explorável | candidata forte; integrar pequeno |
| Correção de bug | defeito reproduzível que afeta a Lia | candidata; teste dirigido antes |
| Funcionalidade | recurso novo do AIRI | decisão do Dev, não do agente |
| Incompatível | muda contrato que a Lia usa | recusar sem autorização explícita |
| Dependência/infra | bump de pacote, config de build | separar das mudanças funcionais |

Não misture mudança funcional com atualização de dependência no mesmo lote —
se uma quebrar, não se sabe qual foi.

## 5. Integrar pequeno e provado

1. Uma mudança por vez, no menor conjunto de arquivos possível.
2. Teste dirigido **antes**: reproduza o defeito que a correção resolve.
3. Aplique, rode o teste dirigido, depois as suítes afetadas
   (`pnpm exec vitest run --root packages/<pacote>`).
4. Se o arquivo estiver na §2.3, reaplique o patch da Lia e teste de novo.
5. Reverta se não houver ganho concreto — "está mais novo" não é ganho.

## 6. Registrar

Para cada integração, registre em `docs/airi-modificacoes-registro.md`:
origem e commit upstream, arquivos, conflito com patch nosso, adaptação feita,
testes rodados e resultado. Sem isso a próxima pessoa repete o trabalho.

## 7. Parar

Pare e reporte quando: o base não puder ser determinado; a mudança tocar a §2.3
sem que o patch da Lia seja conhecido; o teste dirigido não reproduzir o defeito
que a correção promete resolver; ou a integração exigir alterar `main`.
