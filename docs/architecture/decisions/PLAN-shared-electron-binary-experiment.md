# Experimento — binário Electron compartilhado, processos separados

**Decisão:** [D-06](DECISION-RECORD-2026-11-16.md#d-06--autorizar-o-experimento-do-binário-electron-compartilhado)
**Base:** `8558c2c` · **Data:** 16/11/2026
**Status:** plano aprovado. **Nenhuma alteração de empacotamento foi feita nesta rodada.**

---

## 1. Hipótese e o que ela **não** promete

**Hipótese.** É possível manter dois processos Electron independentes (Launcher e Stage) usando
**uma única cópia física** do runtime (DLLs, `icudtl.dat`, paks, `electron.exe`), reduzindo o
espaço instalado e, possivelmente, a memória física por compartilhamento de páginas de código,
**sem** violar nenhuma invariante.

**O que o experimento não promete — e precisa ser dito antes:**

| Ideia comum | Realidade |
|---|---|
| "O instalador cai pela metade" | **Não** por si só. O NSIS comprime **duas** cópias do runtime; hardlink não é preservado pela extração padrão. O instalador só encolhe com passo de instalação personalizado (fora do escopo). |
| "A RAM cai muito" | **Hipótese.** Working set soma páginas compartilhadas por processo; a métrica honesta é **private bytes** e memória física livre. O ganho pode ser pequeno. |
| "Dá para usar um app.asar só" | **Não.** Cada app precisa do seu `resources/app.asar`; o que se compartilha é o **runtime**, não o código do app. |

**Ganho esperado (ESTIMATIVA):** 150–220 MB de espaço instalado e 0–8% de memória física.
**Não medido.** Se o ganho de memória for < 5%, o experimento falha por mérito.

---

## 2. Estado atual do empacotamento

| Fato | Evidência |
|---|---|
| O Launcher empacota e copia o Stage inteiro para `resources/stage` | `electron-builder.config.ts` (`extraResources`) |
| O Stage é empacotado separadamente com seu próprio runtime | `scripts/package-windows.mjs:56-70` |
| A versão do runtime é validada em 3 lugares | catálogo `^43.4.1`; `electronVersion: '43.4.1'`; `ELECTRON_VERSION` no script |
| O Stage empacotado é validado por arquivo | `validatePackagedStage`: `LiaStage.exe`, `resources/app.asar`, `icudtl.dat`, `LICENSE.electron.txt`, `LICENSES.chromium.html`, `version` |
| Licenças do runtime são verificadas por SHA-256 contra a origem oficial | `package-windows.mjs:74-85` |
| Nenhum canal de atualização no Stage | `package-windows.mjs:87-89` (falha se `app-update.yml` existir) |
| Runtime oficial 43.4.1 x64 | **143,2 MiB** comprimido (150.154.788 B) |

---

## 3. Desenho do experimento

### 3.1 Estratégia escolhida: **runtime compartilhado por hardlink, dois apps**

```
Lia\                                   ← instalado
├─ Lia.exe                             ← Launcher (electron-builder padrão)
├─ *.dll, icudtl.dat, *.pak, …         ← runtime #1 (arquivos reais)
├─ resources\
│  ├─ app.asar                         ← código do Launcher
│  └─ stage\
│     ├─ LiaStage.exe                  ← cópia real (~150 KB, renomeada)
│     ├─ resources\app.asar            ← código do Stage
│     ├─ version
│     ├─ LICENSE.electron.txt
│     ├─ LICENSES.chromium.html
│     └─ *.dll, *.pak, icudtl.dat …    ← HARDLINKS para o runtime #1
```

Por que funciona: o Windows resolve DLLs a partir do diretório do executável; hardlinks no mesmo
volume apontam para o mesmo conteúdo sem duplicar bytes. Cada app mantém o seu `app.asar`, o seu
processo e o seu `userData`.

**Pré-requisito físico:** mesmo volume (o instalador instala tudo em um diretório, então vale).

### 3.2 O que **não** muda

| Item | Continua |
|---|---|
| Processos | dois, independentes |
| `userData` | `%APPDATA%\Lia\launcher-profile` (Launcher) e `%APPDATA%\Lia` (Stage) — **distintos** |
| Sessões | `session.defaultSession` própria por processo; nenhuma partição compartilhada |
| Preload/IPC | separados por app.asar |
| Encerramento | independente (D-04) |
| Assinatura | mantida como hoje (unsigned interno, com aviso) |
| Versão do runtime | idêntica nos dois, validada por hash |

### 3.3 Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Um único `app.asar` com dois entrypoints | Electron não permite dois apps no mesmo processo; exigiria runtime único (D-02, rejeitado) |
| `electron.exe` na raiz rodando o Stage por argumento | App empacotado ignora caminho de app no argv; `defaultApp` é falso |
| Symlink/junction | Exige privilégio ou Developer Mode; hardlink não |
| Repack do NSIS com dedup | Exige plugin/script de instalação; complexidade e risco de assinatura — fica para depois, **se** o experimento justificar |
| Baixar o runtime no primeiro uso | Muda o modelo de distribuição offline; fora de escopo |

---

## 4. Protocolo

### 4.1 Preparação (uma vez)

1. Branch isolado de trabalho (`arena/7fa837f0-lia-project` + commit do experimento), **nunca**
   `main`.
2. Build limpo do Stage (`electron-vite build`) e do Launcher.
3. Empacotar duas vezes: **baseline** (como hoje) e **experimento** (hardlinks).
4. Guardar os dois instaladores e as duas árvores instaladas, com SHA-256 de cada.

### 4.2 Medições

| ID | Medida | Como |
|---|---|---|
| M1 | Tamanho do instalador | `(Get-Item LiaSetup-*.exe).Length` |
| M2 | Espaço instalado — total | `Get-ChildItem <installdir> -Recurse -File \| Measure-Object Length -Sum` |
| M3 | Espaço instalado — `resources\stage` | idem, restrito ao diretório |
| M4 | Espaço **físico** (não lógico) | `fsutil volume allocationReport C:` (antes/depois) ou `du`-equivalente por cluster |
| M5 | Memória — private bytes somados | protocolo C1/C2 de `BENCHMARK-C0-C8-windows.md` §4 |
| M6 | Memória física livre | `(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory` |
| M7 | Funcional | checklist §4.3 |
| M8 | Desinstalação | remover o app; verificar que os arquivos do runtime do Launcher **permanecem** |

> **M4 é o que prova o hardlink.** Tamanho lógico (M2/M3) pode não mudar se a ferramenta contar
> links; o espaço alocado no volume é a prova física.

### 4.3 Checklist funcional (M7)

| # | Verificação |
|---|---|
| K1 | Launcher abre; 5 telas navegam |
| K2 | Stage abre a partir do Launcher; avatar renderiza (WebGL/D3D11) |
| K3 | Transparência e clique atravessável funcionam |
| K4 | Tray do Stage presente; "Quit" encerra |
| K5 | Chat e configurações abrem (janelas 2 e 3) |
| K6 | Legenda/overlay abrem (famílias que usam `screen`) |
| K7 | Áudio: TTS toca; microfone captura |
| K8 | Nenhum erro de "outra instância" / lock de perfil |
| K9 | Fechar o Launcher não encerra o Stage (requer D-04; se ainda não implementado, marcar N/A) |
| K10 | Matar o Stage não derruba o Launcher |
| K11 | Matar o Launcher (Task Manager) não derruba o Stage |
| K12 | Reabrir o Launcher e reabrir o Stage não deixa órfãos |

---

## 5. Critérios PASS / FAIL

**PASS** exige **todos**:

| # | Critério | Limite |
|---|---|---|
| P1 | `resources\stage` ocupa ≥ **80%** menos espaço físico | M3/M4 |
| P2 | C1 (os dois ociosos) private bytes não piora | ≤ **+5%** |
| P3 | K1–K8, K10–K12 passam (K9 é `N/A` até D-04 existir) | 100% |
| P4 | Nenhuma violação de isolamento: `userData` distintos, sessões distintas, sem erro de lock | inspeção + log |
| P5 | Desinstalar remove tudo, sem deixar arquivo órfão nem apagar o runtime do Launcher | M8 |
| P6 | `validatePackagedStage` continua passando (licenças, `version`, `icudtl.dat`) | script |

**FAIL** se qualquer um:

| # | Falha | Consequência |
|---|---|---|
| X1 | P1 não atinge 80% | ganho de disco insuficiente para justificar o risco |
| X2 | P2 piora > 5% | ganho de memória inexistente/negativo |
| X3 | Qualquer K falha | regressão funcional |
| X4 | Assinatura/updater quebram | inaceitável |
| X5 | Desinstalação deixa lixo ou apaga o Launcher | inaceitável |

**FAIL por mérito** (P1 e P2 abaixo do limite, mas nada quebrado) ⇒ **manter o layout atual** e
registrar o resultado. Não é fracasso do time; é a resposta à pergunta.

---

## 6. Rollback

| Cenário | Ação | Tempo |
|---|---|---|
| Antes de publicar | `git revert` do commit do experimento; rebuild | 1 build |
| Instalação de teste | desinstalar; reinstalar o pacote anterior | minutos |
| Produção | **não se aplica** — o experimento não toca a instalação de produção | — |

O experimento **não** altera `electron-builder.config.ts` na branch principal até o PASS. Ele vive
em commit isolado, atrás de um script de empacotamento alternativo (`package-windows.mjs
--shared-runtime`), que por padrão **não** roda.

---

## 7. Riscos do experimento

| ID | Risco | Mitigação |
|---|---|---|
| X-1 | Antivírus/EDR tratar hardlink como anomalia | validar em máquina limpa; se bloquear, FAIL |
| X-2 | Hardlink atravessar volumes (usuário escolhe outro drive) | detectar e cair para cópia com aviso |
| X-3 | Ferramenta de backup/limpeza quebrar links | documentar; não é requisito do experimento |
| X-4 | Atualização futura do Electron substituir só uma cópia | validação por hash no build + `version` idêntico |
| X-5 | Licenças do runtime não encontradas no diretório do Stage | manter as cópias reais (são pequenas) |
| X-6 | Conclusão errada por medir working set | medir private bytes + memória livre (M5/M6) |

---

## 8. O que o experimento **não** faz

- Não junta processos (D-02).
- Não compartilha `session.defaultSession`, perfil ou preload.
- Não muda a instalação de produção.
- Não promete reduzir o instalador.
- Não substitui o gate G-4 (benchmark do Launcher).

---

## 9. Critérios de aceitação do plano

| # | Critério | Status |
|---|---|---|
| 1 | Hipótese explícita e falsificável | **PASS** (§1) |
| 2 | Alternativas descartadas com motivo | **PASS** (§3.3) |
| 3 | PASS/FAIL definidos **antes** da medição | **PASS** (§5) |
| 4 | Rollback simples | **PASS** (§6) |
| 5 | Nenhuma alteração de produção | **PASS** |
| 6 | Medição física, não só lógica | **PASS** (§4.2 M4) |
