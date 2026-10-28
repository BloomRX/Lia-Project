# `lia/` — código próprio da Lia

Este diretório é a Lia **fora** do AIRI. Ele fica ao lado de `airi/`, nunca
dentro, e **nunca** entra em `airi/pnpm-workspace.yaml`.

```
lia/
├── assets/     ícones e imagem da marca (já existiam)
├── core/       @lia/contracts — contratos, zero dependências
├── launcher/   decisão e fronteira do Launcher
├── stage/      o Stage da Lia (janela + ciclo de vida)
└── shared/     (reservado, ainda vazio)
```

---

## Por que ao lado e não dentro

`airi/` é uma cópia do upstream `moeru-ai/airi` em `2c1e223` com 353 arquivos da
Lia injetados. Qualquer coisa dentro de `airi/` é sobrescrevível por um
`subtree pull`. `lia/` não é: o AIRI não sabe que ele existe.

E não entra no workspace pnpm do AIRI por um motivo concreto — se entrasse,
`@lia/contracts` passaria a depender do catálogo e do `pnpm install` do AIRI.
Ela perde a única propriedade que a torna útil: **rodar sem instalar nada**.

---

## `lia/core` — `@lia/contracts`

| Módulo | Conteúdo |
| --- | --- |
| `src/lifecycle.ts` | fases do Stage, tabela de transições legais, histórico, `snapshot()` |
| `src/protocol.ts` | envelope, versão, `negotiate()`, `parseEnvelope()` que nunca lança |

Sem dependências, sem build, sem transpilador. Usa `node --test` e o
`--experimental-strip-types` do Node 22.

```bash
cd lia/core && node --experimental-strip-types --test "test/*.test.ts"
# 26 testes, 26 pass
```

**Restrição do strip-types:** o Node recusa sintaxe que só existe em TypeScript
— parameter properties, `enum`, `namespace`, decorators. O código usa
`readonly #campo` com atribuição no construtor. Não adicionar transpilador:
isso arrastaria o install do AIRI.

---

## `lia/stage` — o Stage

`src/main/stage-host.ts` é a lógica inteira. Electron **não** é importado ali:
a plataforma entra por `StageHostDeps` (`createWindow`, `terminate`, relógio,
pid). Esse é o mesmo idioma do `airi-stage-manager.ts` atual, onde
`spawnImpl`/`fuseImpl` existem "for tests" e são o motivo de o ciclo de vida
poder ser testado sem display.

```bash
cd lia/stage && node --experimental-strip-types --test "test/*.test.ts"
# 9 testes, 9 pass
```

`src/main/index.ts` é o único arquivo que conhece Electron. Se ele crescer, a
fronteira está errada.

**O que este Stage não tem:** personagem real (é um placeholder declarado), voz,
memória, animações, multi-monitor. Nada disso foi observado funcionando.

---

## `lia/launcher`

`src/resolve-stage-target.ts` isola **a decisão** de qual Stage subir
(`packaged` × `development`, com `LIA_STAGE_MODE` vencendo a inferência). A
decisão é função pura justamente porque o defeito caro do Launcher não foi
chamar o executável errado — foi decidir errado em qual modo entrar e não
perceber que o processo criado não ficou pronto.

```bash
cd lia/launcher && node --experimental-strip-types --test "test/*.test.ts"
# 8 testes, 8 pass
```

---

## O que está verificado e o que não está

| Item | Estado |
| --- | --- |
| Contratos (26 testes) | **PASS**, executado |
| Stage (9 testes) | **PASS**, executado |
| Launcher (8 testes) | **PASS**, executado |
| Teste de mutação do Stage | **detecta** o bug de declarar pronto antes da hora |
| Janela real do Stage | **NÃO EXECUTADO** — sem display, sem binário do Electron |
| Encerramento sem órfão no Windows | **NÃO EXECUTADO** |
| Typecheck (`tsc`) | **NÃO EXECUTADO** — não instalado |

Este projeto exige Windows real para o gate visual. Teste unitário verde **não**
é esse gate.

---

## Documentos

- `docs/architecture/AIRI-COMPARISON.md` — o AIRI limpo × o AIRI da Lia, medido
- `docs/architecture/LIA-STAGE-ARCHITECTURE.md` — os três níveis e os contratos
- `docs/architecture/LIA-MIGRATION-PLAN.md` — ordem da migração e rollback
