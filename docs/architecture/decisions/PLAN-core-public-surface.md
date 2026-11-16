# Plano — superfície pública de `@lia/contracts`

**Decisão:** [D-05](DECISION-RECORD-2026-11-16.md#d-05--fechar-a-superfície-pública-do-core)
**Base:** `8558c2c` · **Data:** 16/11/2026 · **Status:** plano aprovado; **nenhuma migração feita**

---

## 1. Problema, em uma frase

O pacote `@lia/contracts` existe, tem 1.944 LOC e 105 testes verdes — e **não é um pacote**:
23 arquivos de aplicação o alcançam por caminho relativo (`../../../../lia/core/src/...`), porque
ele não tem `exports`, não é dependência de ninguém e não está no workspace.

**Consequência:** qualquer reorganização de diretório quebra 23 arquivos; o tipo consumido é o
`src` do repositório, não um contrato publicado; e nada impede que a contagem cresça.

---

## 2. Inventário completo (não-teste, `8558c2c`)

**46 linhas** mencionam `lia/core/src`; **44 são statements** (41 `import` + 3 `export … from`),
**1** é `import('…')` inline e **1** é comentário. Arquivos: **23** (Launcher 3, Stage 20).

### 2.1 Por domínio

| Domínio | Statements | Arquivos | Node-only | Consumido por |
|---|---:|---:|---|---|
| `transports/contracts` | 8 | 8 | não | main, renderer, shared |
| `providers/contracts` | 8 | 7 | não | main, shared |
| `providers/index` | 6 | 4 | não | renderer, main |
| `transports/repository` | 5 | 5 | **sim** | main |
| `presence` | 5 | 3 | não | main, shared |
| `credentials/owner-channel` | 3 | 3 | **sim** | main |
| `providers/selection-write-policy` | 3 | 2 | não | main (1 via reexport) |
| `providers/catalog` | 2 | 1 | não | main |
| `transports/validation` | 2 | 2 | não | main, renderer |
| `providers/registry` | 1 | 1 | não | main |
| `providers/runtime` | 1 | 1 | não | main |

### 2.2 Por arquivo (os 23)

**Launcher (3 arquivos, 7 statements)**

| Arquivo | Importa |
|---|---|
| `apps/lia-app/src/main/ai-connection-service.ts` | `providers/catalog` (2), `transports/contracts` (4 símbolos) |
| `apps/lia-app/src/main/ipc.ts` | `credentials/owner-channel` (`isPublicCredentialReference`) |
| `apps/lia-app/src/main/lia-host.ts` | `credentials/owner-channel` (3), `providers/selection-write-policy` (4), `transports/repository` |

**Stage main (17 arquivos)**

| Arquivo | Importa |
|---|---|
| `main/configs/lia-schema.ts` | `presence` (via `import()` inline) |
| `main/services/lia/credential-owner-access.ts` | `credentials/owner-channel` (4), `providers/contracts` |
| `main/services/lia/presence-service.ts` | `presence` (8 símbolos) |
| `main/services/lia/speech-config-service.ts` | `transports/repository`, `transports/validation` |
| `main/services/lia/transcription-adapters.ts` | `transports/contracts`, `providers/contracts` |
| `main/services/lia/transcription-service.ts` | `transports/contracts`, `transports/repository`, `providers/contracts` |
| `main/services/lia/transport-config-service.ts` | `transports/contracts`, `transports/repository` |
| `main/services/lia/transport-execution-service.ts` | `providers/*` (4 módulos), `transports/*` (2) |
| `main/services/lia/provider-config-service.ts` | via `shared/lia/selection-write-policy` (reexport) |
| `shared/eventa/lia-oidc-http.ts` | `providers/contracts` |
| `shared/eventa/lia-presence.ts` | `presence` (reexport) |
| `shared/eventa/lia-transcription.ts` | `providers/contracts` |
| `shared/eventa/lia-transport-execution.ts` | `providers/contracts` |
| `shared/eventa/lia-transports.ts` | `transports/contracts` |
| `shared/lia/selection-write-policy.ts` | `providers/selection-write-policy` (2 reexports) |
| `renderer/services/lia/main-speech.ts` | `providers/index` |
| `renderer/services/lia/main-transport-execution.ts` | `providers/index` |
| `renderer/services/lia/native-provider-runtime.ts` | `providers/index` |
| `renderer/services/lia/transport-config.ts` + `.fixture.ts` | `transports/contracts` |
| `renderer/stores/lia/provider.ts` | `providers/index`, `transports/validation` |

### 2.3 Classes de pureza (verificado)

| Módulo | `node:` imports | Pode no renderer? |
|---|---|---|
| `providers/*` (6 arquivos) | nenhum | **Sim** |
| `transports/contracts`, `transports/validation` | nenhum | **Sim** |
| `transports/repository` | `node:buffer`, `node:crypto`, `node:path` (+ fs) | **Não** |
| `presence` | nenhum | **Sim** |
| `credentials/owner-channel` | `node:buffer`, `node:crypto`, `node:net`, `node:os`, `node:path`, `node:process` | **Não** |
| `lifecycle`, `protocol`, `host` | nenhum | **Sim** |

---

## 3. Superfície proposta

`lia/core/package.json` ganha `exports` (e um build). Sete subpaths públicos, agrupados por
domínio — não um por arquivo:

| Subpath | Arquivo | Pureza | Uso permitido |
|---|---|---|---|
| `@lia/contracts` | `src/index.ts` (lifecycle, protocol, host) | pura | qualquer |
| `@lia/contracts/providers` | `src/providers/index.ts` | pura | qualquer |
| `@lia/contracts/providers/catalog` | `src/providers/catalog.ts` | pura | qualquer |
| `@lia/contracts/transports` | `src/transports/contracts.ts` + `validation.ts` | pura | qualquer |
| `@lia/contracts/transports/repository` | `src/transports/repository.ts` | **node** | **main apenas** |
| `@lia/contracts/presence` | `src/presence/index.ts` | pura | qualquer |
| `@lia/contracts/credentials/owner-channel` | `src/credentials/owner-channel.ts` | **node** | **main apenas** |

`providers/registry` e `providers/runtime` deixam de ser importados diretamente: são
reexportados por `@lia/contracts/providers` (é o que `providers/index.ts` já faz).

### 3.1 Matriz de dependências permitidas / proibidas

| De → Para | Permitido? |
|---|---|
| `@lia/contracts` → `node:*` (nos subpaths node) | sim |
| `@lia/contracts` → `electron` | **nunca** (já é verdade) |
| `@lia/contracts` → `@proj-airi/*` | **nunca** (já é verdade) |
| `@lia/contracts` → dependência de terceiro | **nunca** (zero deps hoje) |
| app main → subpath puro ou node | sim |
| app renderer/shared → subpath **node** | **nunca** |
| app (qualquer) → `lia/core/src/**` por caminho relativo | **nunca** |

---

## 4. Ondas de migração

Cada onda é um commit (ou dois, se o diff passar de ~30 arquivos) e tem rollback = reverter.
**Nenhuma onda muda comportamento em runtime** — só o especificador do import.

| Onda | Conteúdo | Arquivos | Risco | Critério de saída |
|---|---|---|---:|---|
| **0 — spike** | `tsdown` no `lia/core`; `exports`; `file:` dependency em `lia-app` e `stage-tamagotchi`; **um** import convertido e revertido em seguida | 3–4 | Médio | build dos 2 apps + `tsc` dos 2 apps PASS; se falhar → plano B §6 |
| **1 — Launcher** | converter os 3 arquivos do Launcher | 3 | Baixo | testes do Launcher PASS |
| **2 — Stage main (tipos)** | `import type` primeiro: transports/contracts, providers/contracts | ~8 | Baixo | `tsc` do Stage sem novos erros (base: ~345 pré-existentes) |
| **3 — Stage main (valores puros)** | presence, providers/*, transports/validation | ~6 | Baixo | testes de `lia` do Stage PASS |
| **4 — node-only** | transports/repository, credentials/owner-channel | ~8 | Médio | testes de credencial e transporte PASS |
| **5 — renderer/shared** | providers/index, transports/contracts | ~5 | Médio | build do renderer + testes browser PASS |
| **6 — reexport shim** | `shared/lia/selection-write-policy.ts` vira reexport do subpath público (ou é removido, com o consumidor migrado) | 1–2 | Baixo | build |
| **7 — guarda** | teste que falha em qualquer `lia/core/src` fora do pacote + guarda de pureza | 1–2 | Baixo | teste vermelho com violação plantada |

**Ordem obrigatória:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Converter tipo antes de valor reduz a
superfície de falha; node-only depois dos puros evita misturar erro de build com erro de runtime.

---

## 5. Testes que impedem regressão

Criar em `airi/apps/lia-app/src/main/` (onde o `runtime-boundary.test.ts` já mora) e espelhar no
Stage, ou um único teste no pacote de contratos:

| ID | Teste | Falha quando |
|---|---|---|
| **S1** | varrer `apps/*/src/**/*.ts` e falhar em qualquer `lia/core/src` | alguém volta ao caminho relativo |
| **S2** | cada import de `@lia/contracts/<sub>` deve existir em `exports` | typo ou subpath não publicado |
| **S3** | subpaths marcados `node` não podem aparecer em `src/renderer/**` nem `src/shared/**` | renderer puxando `node:fs` |
| **S4** | `@lia/contracts` não importa `electron` nem `@proj-airi/*` | regressão de fronteira |
| **S5** | `package.json` de `@lia/contracts` mantém `dependencies` vazio | dependência entrando pela porta dos fundos |

**Prova de que o teste funciona:** S1 precisa falhar com uma violação plantada (teste de mutação
manual, documentado no commit). Teste que nunca falhou não protege nada.

---

## 6. Plano B (se o spike da onda 0 falhar)

Se `file:` + build não funcionar nos dois apps (por exemplo, `tsc` do Stage recusar o `dist`), a
alternativa é **alias de caminho** em `tsconfig` + `resolve.alias` do electron-vite:

```
"@lia/contracts/*" → "../../lia/core/src/*"
```

Ganha-se o especificador estável e o teste S1, **sem** pacote real: não há `exports`, não há
build, e o "publicável" continua não sendo verdade. A limitação deve ser registrada em
`CURRENT-STATE.md` como pendência, não escondida.

**Não fazer:** mover `lia/core` para dentro de `airi/packages` nesta rodada. Isso quebra o
critério de rollback trivial do `LIA-MIGRATION-PLAN.md` §6 e mistura dois trabalhos.

---

## 7. Compatibilidade com consumidores existentes

| Consumidor | O que já funciona | O que muda |
|---|---|---|
| `@lia/core` (airi) | 16 subpaths, zero violações | **nada** |
| `@lia/contracts` (lia/core) | 105 testes via `node --experimental-strip-types` | ganha `exports` + `dist`; testes continuam rodando no source |
| Launcher | build bundla o `@lia/core` | passa a consumir `@lia/contracts` por nome |
| Stage | `tsc` com ~345 erros pré-existentes | nenhum erro **novo** é aceitável |
| `lia/stage`, `lia/launcher` | importam `../../core/src/...` | passam a importar `@lia/contracts` quando Q-01 for decidida |

---

## 8. Critérios de aceitação

| ID | Critério |
|---|---|
| AC-1 | `grep -rn "lia/core/src" airi/apps/*/src` = **0** |
| AC-2 | S1…S5 verdes, com prova de mutação em S1 |
| AC-3 | Build e testes dos dois apps sem regressão |
| AC-4 | Nenhum arquivo movido; nenhuma API alterada |
| AC-5 | `@lia/contracts` com `dependencies: {}` e zero import de `@proj-airi/*` |
| AC-6 | Cada onda revertível por `git revert` (sem `reset`) |

---

## 9. O que este plano **não** faz

- Não move código, não renomeia módulos, não cria abstração nova.
- Não altera contratos nem comportamento.
- Não remove dependência alguma.
- Não decide Q-01 (onde o lifecycle mora).
- Não toca em `apps/stage-tamagotchi/src/main/services/lia/*` além do especificador do import.
