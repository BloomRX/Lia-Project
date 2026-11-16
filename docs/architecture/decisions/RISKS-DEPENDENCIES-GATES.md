# Riscos, dependências e gates — arquitetura do desktop

**Data:** 16/11/2026 · **Base:** `8558c2c` · **Status:** plano de coordenação
**Documentos irmãos:** [decisões](DECISION-RECORD-2026-11-16.md) · [ADR](ADR-0001-desktop-runtime-d-plus.md) · [SPEC](SPEC-launcher-runtime-lifecycle.md) · [Core](PLAN-core-public-surface.md) · [binário](PLAN-shared-electron-binary-experiment.md) · [benchmark](BENCHMARK-C0-C8-windows.md)

---

## 1. Fases (o que será feito, em que ordem)

| Fase | Entrega | Depende de | Não pode começar antes de |
|---|---|---|---|
| **F0** | Contrato de lifecycle no papel + testes headless do handshake/registro | D-01, D-04 (sign-off) | G-0 |
| **F1** | CCR + adoção + parada cooperativa + sobrevivência de credencial | F0, Q-01 | G-1 |
| **F2** | Superfície pública de `@lia/contracts` (ondas 0–7) | D-05 | G-0 (pode rodar **em paralelo** a F1) |
| **F3** | Perfis separados (`profiles\launcher`, `profiles\stage`) | D-04 | G-1 |
| **F4** | Experimento do binário compartilhado | D-06 | G-3 |
| **F5** | Benchmark C0–C8 | F1, F3 | G-3 |
| **F6** | Higiene: asset de 1,77 MB, versão do Electron em um lugar | — | pode rodar a qualquer momento |

**Paralelismo permitido:** F2 é independente de F1 (mexe em especificador de import, não em
comportamento). F6 é independente de tudo. **F1 e F2 na mesma branch ao mesmo tempo é proibido**
se ambos tocarem `stage-tamagotchi/src/main/services/lia/**` — coordenar por arquivo.

---

## 2. Gates

| Gate | Pergunta | Entrada | Saída | Estado |
|---|---|---|---|---|
| **G-0** | As decisões estão registradas e assinadas? | este pacote | sign-off de D-01/D-03/D-04/D-07 | **ABERTO** (parcial: D-02/D-05/D-06/D-08 aprovadas) |
| **G-1** | O lifecycle funciona e não deixa órfão? | F1 | T16–T18 PASS em Windows + T1–T15 PASS | **ABERTO** |
| **G-2** | A superfície do Core está fechada? | F2 | S1–S5 verdes + `grep` = 0 | **ABERTO** |
| **G-3** | Os números existem? | F5 | C0–C8 publicados com cabeçalho completo | **ABERTO** |
| **G-4** | O Launcher justifica outro host? | C0 | `privateMB > 350` ou `processesNoCrashpad > 6` | **ABERTO** — depende de G-3 |
| **G-5** | O binário compartilhado vale? | F4 | P1–P6 PASS | **ABERTO** |

**Nenhum gate acima foi fechado nesta rodada.** O máximo que se pode dizer é: G-0 tem
documentação pronta e sign-off pendente.

### 2.1 Critério de abertura de cada gate

| Gate | Abre quando | Fecha quando |
|---|---|---|
| G-0 | — | tabela de sign-off preenchida (D-01, D-03, D-04, D-07) |
| G-1 | T1–T15 verdes em Node | T16–T18 PASS no Windows, com evidência anexada |
| G-2 | ondas 0–7 concluídas | S1–S5 verdes **e** prova de mutação em S1 |
| G-3 | F1 e F3 concluídas | C0–C8 com 5 repetições e cabeçalho |
| G-4 | C0 medido | decisão registrada (manter ou abrir protótipo) |
| G-5 | experimento empacotado | PASS/FAIL registrado com M1–M8 |

---

## 3. Matriz de riscos

Severidade = impacto se acontecer. Exposição = probabilidade × impacto, qualitativa.

| ID | Risco | Prob. | Impacto | Exp. | Mitigação | Fase |
|---|---|---|---|---|---|---|
| **R-01** | Implementar "fechar ≠ parar" sem adoção ⇒ Runtime órfão e incontrolável | Alta se fatiado | Alta | **Alta** | CCR + adoção **no mesmo incremento**; feature flag | F1 |
| **R-02** | Adoção aceitar processo impostor (pipe plantado, registro forjado) | Baixa | Alta | Média | handshake X25519 + `instanceId` + versão; PID é só diagnóstico (SPEC §5.4) | F1 |
| **R-03** | **Credencial morre com o Launcher** ⇒ conversa quebra ao fechar | **Alta** (comportamento atual) | Alta | **Alta** | sessão de credencial em memória + revalidação de allowlist (SPEC §6.2) | F1 |
| **R-04** | Runtime cai por `EPIPE` no stdout quando o Launcher fecha | Média | Alta | **Alta** | handler de `error` em stdout/stderr; log durável é arquivo; teste T14/T18 | F1 |
| **R-05** | Runtime reinicia com o Launcher fechado e perde tudo | Média | Média | Média | degradação honesta (voz local, providers indisponíveis) + reconciliação na reabertura | F1 |
| **R-06** | Duas máquinas de estado (a de `lia/` e a nova) | **Alta** se Q-01 não for decidida | Média | **Alta** | Q-01 antes de F1; usar uma só | F1 |
| **R-07** | Migração do Core quebrar build do Stage | Média | Média | Média | ondas com tipo antes de valor; spike descartável; `tsc` sem erro novo | F2 |
| **R-08** | `file:` + build não funcionar nos apps | Média | Média | Média | plano B (alias TS) documentado, sem esconder a limitação | F2 |
| **R-09** | `taskkill` continuar sendo o caminho real e o CCR virar decorativo | Média | Média | Média | teste de ordem (T10) exige `shutdown` antes do kill | F1 |
| **R-10** | Hardlink quebrar assinatura/desinstalação | Média | Alta | Média | P4–P6 no experimento; rollback = pacote anterior | F4 |
| **R-11** | Conclusão errada por medir working set | **Alta** | Alta | **Alta** | gate usa private bytes; working set é informativo (BENCHMARK §4.1) | F5 |
| **R-12** | Electron 43 sair de suporte | **Alta** (3 majors/8 semanas) | Média | **Alta** | upgrade 45.x com regressão Windows; versão em um lugar | F6 |
| **R-13** | Conflito com a recuperação de áudio do Codex | Média | Alta | **Alta** | não tocar `codex/lia-multi-provider-voice`; F1 não altera áudio; arquivos de voz fora do escopo | todas |
| **R-14** | "Fechar ≠ parar" aumentar consumo percebido sem aviso | Média | Média | Média | UI indica "Lia continua em execução"; tray do Stage visível | F1 |
| **R-15** | Gate G-4 disparar por composição de processos, não por peso | Média | Média | Média | excluir crashpad da contagem do gate (§BENCHMARK 6) | F5 |
| **R-16** | Documentação virar a entrega e nada ser implementado | Média | Alta | **Alta** | F1 e F2 têm critérios de saída objetivos; G-1/G-2 cobram teste, não texto | todas |

---

## 4. Dependências externas

| ID | Dependência | Precisa de | Se faltar |
|---|---|---|---|
| **D-a** | Windows 11 + Ryzen 5 5500 + RX 580 + 16 GB | T16–T18, C0–C8, F4 | tudo fica **NÃO EXECUTADO**; gates G-1/G-3/G-4/G-5 não fecham |
| **D-b** | Build empacotado do Stage | F4, F5 | `electron-vite build` + empacotamento; sem ele, só cenários em dev (não comparáveis) |
| **D-c** | PresentMon | C7 | C7 = N/A (não estimar FPS) |
| **D-d** | Integração da recuperação de áudio (Codex) | validação de C4 com voz real | C4 parcial: medir sem voz e declarar |
| **D-e** | QA / máquina limpa | instalação e desinstalação | F4 e M8 ficam pendentes |

**Nenhuma dessas dependências autoriza "aproximar" um número.** O relatório final declara o que
não foi feito.

---

## 5. Ordem recomendada (quando houver sign-off)

```
G-0 (sign-off)
  ├─ F2 (Core, ondas 0→7)        ← independente; pode ir primeiro, é o menor risco
  ├─ F6 (higiene)                ← independente
  └─ F1 (lifecycle)
        ↓ G-1 (Windows)
     F3 (perfis)
        ↓
     F5 (benchmark C0–C8)
        ↓ G-3/G-4
     F4 (binário)  ← pode rodar em paralelo a F5 (não depende de D-04)
```

**Por que F2 primeiro:** é a única fase com risco quase zero (só especificador de import), produz
ganho permanente e não depende de decisão de produto. Se o dono quiser um primeiro passo visível
sem tocar comportamento, é F2.

**Por que F1 antes de F3:** sem adoção, separar perfis não resolve nada observável; e F3 toca o
mesmo caminho de boot.

---

## 6. Regras de convivência (anti-conflito)

| Regra | Motivo |
|---|---|
| Não editar `codex/lia-multi-provider-voice` nem arquivos de voz em F1/F2 | R-13 |
| F1 não altera `services/lia/lia-voice-service.ts`, `voice-config-service.ts`, `main-window-voice-runtime.ts` | são o caminho de áudio |
| F2 altera **apenas** o especificador de import nesses arquivos, se necessário | idem |
| Nenhuma fase faz `reset`, `clean`, `rebase`, `force push` | regra da branch |
| `main` não recebe nada | regra do projeto |
| Commit por onda/fase, com mensagem que diga o que muda e o que não muda | auditoria |

---

## 7. Critérios de aceitação deste documento

| # | Critério | Status |
|---|---|---|
| 1 | Todo risco tem mitigação e fase | **PASS** |
| 2 | Gates com entrada e saída explícitas | **PASS** (§2) |
| 3 | Dependências externas nomeadas | **PASS** (§4) |
| 4 | Ordem executável com paralelismo permitido | **PASS** (§5) |
| 5 | Nenhum gate declarado fechado sem evidência | **PASS** |
