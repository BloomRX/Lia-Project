# Lia — Critérios objetivos de aceite das evidências de áudio do Codex (AV-01…AV-15)

**Data:** 2026-11-15 (UTC) · **Autor:** Arena (Linux sandbox) · **Branch:** `arena/18f50ae7-lia-project` @ `2ead383774dd44fbbaab5ceaac612a1fb126a28f`
**Acompanha:** [`LIA-AUDIO-EVIDENCE-RECONCILIATION.md`](LIA-AUDIO-EVIDENCE-RECONCILIATION.md) (pushed @ `2ead383`)
**Natureza:** especificação de aceitação documental — **nenhum teste re-executado** (requisito: revisar os resultados finais sem refazer o que já foi feito); **nenhum arquivo de implementação tocado**; **nenhum merge**; nenhum resultado inventado.
**Regra-mãe (plano rev.2, §5.5 / G‑AUD / B‑07):** *AV-01…AV-15 **todos PASS** no Windows físico, com Kokoro local e STT Groq, **no mesmo SHA congelado**. Qualquer BLOCKED impede o gate; “funciona no mock” não conta. AV-04/AV-07 usam os limiares aprovados em P‑2.*

---

## 0. Bloqueio de entrada — o commit `9e94dce` e o “relatório novo” não são legíveis daqui

Antes de qualquer avaliação, registro factual do que foi verificado **nesta data**:

| Verificação (somente leitura) | Resultado |
|---|---|
| `git fetch origin '+refs/heads/*:refs/remotes/origin/*' +refs/pull/*/head:refs/remotes/pr/*` + todas as branches, PR refs e tags do `BloomRX/Lia-Project` | tip de tudo listado; **`9e94dce` não pertence a nenhuma ref** |
| `git ls-remote --heads --tags origin` | 12 branches + 5 PR refs (`pr/1`…`pr/4` = `682f8e0`, `1c86ce9`, `7a93af1`, `abeffa4`); nenhuma contém `9e94dce` |
| `gh api repos/BloomRX/Lia-Project/commits/9e94dce` | `No commit found for SHA: 9e94dce` (422) |
| `gh api repos/BloomRX/{Lia-AgentHub,Lia-Forge,Lia-Go,Lia-Model-Lab,Lia-Studio,LiaVoiceStudio,3d-create,3d-sprite,animations-free,ChibiCreate,ComfyUI_Colab,SilksongREA}/commits/9e94dce` | nenhum retornou `9e94dce` |
| Google Drive (`search_files`: nome contém `LIA`, `AUD`; `modifiedTime > 2026-11-13`; Drive completo visível) | **zero** documentos de evidência/AV modificados ou contendo esses termos |
| Repositório local (`git cat-file -t 9e94dce`) | objeto não existe |

**Interpretação objetiva:** ou `9e94dce` é um commit criado/local ao checkout Windows do Codex **que nunca foi enviado**, ou o SHA citado não está correto. Nos dois casos, este relatório trata o “relatório novo” (matriz AV-01…AV-15) como **inacessível — e nada nele pode ser usado para promover qualquer AV**. Se o usuário fornecer o destino do commit (branch, remoto, zip ou link), a comparação do §1 é refeita contra o conteúdo real; os critérios do §2/§3 continuam válidos como régua.

**Consequência direta:** a seção 1 compara os critérios do plano com a situação documental atual; a seção 2 fixa regras de aceite globais; a seção 3 fixa forma e substância de aceite **por AV**; a seção 4 resume a revisão final sem re-execução; o §5 lista o caminho de desbloqueio. Nenhuma linha promove PASS sem evidência inspecionável.

---

## 1. AV-01…AV-15 no plano rev.2 × situação atual (comparação factual)

Legenda de “Fonte”: **P2** = plano rev.2 (`LIA-BETA-READINESS-PLAN-2026-11-14.md` @ `0bf0629` / `origin/arena/7fa837f0-lia-project`), texto de evidência exigido; **REC** = `LIA-AUDIO-EVIDENCE-RECONCILIATION.md` (@ `2ead383`).

| ID | Definição do critério (rev.2, resumida) | Evidência exigida pelo plano | Estado rev.2 | Estado conforme reconciliação | Classe atual (gate) |
|---|---|---|---|---|---|
| AV-01 | Mic: permissão concedida só para áudio; negada para vídeo sobrevive a "reabrir" | log Main + screenshot do prompt | NOT RUN | nada versionado; nada inspecionável | **NOT RUN** |
| AV-02 | Seleção de dispositivo ≥1 entrada; troca persiste; próxima captura usa o novo | captura + log de `deviceId` (sem PII) | NOT RUN | idem | **NOT RUN** |
| AV-03 | Captura+VAD: 3 s de fala → início/fim + buffer ≥2 s; silêncio não envia | log VAD + duração | NOT RUN | unit (voice-input-vad-startup) verde NO LINUX; VAD real depende de download silero-vad | **NOT RUN** |
| AV-04 | STT remoto (Groq): chega em ≤ **1,5× duração + 2 s** `[proposto]`; ≥90% palavras-chave em 3 frases fixas pt-BR | texto + tempos | NOT RUN | **sem limiar aprovado (P‑2 pendente!)**; STT Groq real nunca executado no candidato | **NOT RUN** — e não testável sem P‑2 |
| AV-05 | STT sem vazar chave: nenhuma credencial em log/DOM/toast/URL; falha de provider tipada | chave sintética + derrubar rede | NOT RUN | chave Groq só pode entrar via UI real; varredura anti-segredo é pré-condição de aceite (§2-R8) | **NOT RUN** |
| AV-06 | Transcrição vira exatamente UMA mensagem do usuário e a conversa responde; mesmas ferramentas/anexos do texto | ditado → resposta visível | NOT RUN | Voice→D2B12→Brain histórico é de `3ef6d11` (não transferível) | **NOT RUN** |
| AV-07 | Kokoro instala, pré-aquece e sintetiza pt-BR com RTF ≤ **0,5** `[proposto]` após aquecimento; 5 frases | tabela RTF + WAV | **BLOCKED (rede/Python)** | smoke dev-only declarou 4+6 WAVs (N2) — **não fecha**: RTF exigido é do engine **instalado e pré-aquecido pelo app**, 5 frases padronizadas, não de smoke externo; DirectML (ORT 1.24.4) FALHOU | **NOT RUN/BLOCKED** — e não testável sem P‑2 |
| AV-08 | Reprodução no dispositivo padrão; legenda ao vivo; “parar fala” corta em ≤1 s e não retoma | gravação + log | NOT RUN | playback stubbed unit verde; device real não medido | **NOT RUN** |
| AV-09 | Falhas tratadas: provider offline, engine ausente, voz inexistente → mensagem humana tipada, sem crash e sem repetir áudio | 3 falhas induzidas | NOT RUN | unitário parcial; nenhum cenário induzido real | **NOT RUN** |
| AV-10 | Seleção `voice.tts` persiste `preferred`/`fallback`; aplica na próxima resposta; não grava segredo | `lia-product.json` sanitizado | NOT RUN | nada; exige perfil real inspecionável | **NOT RUN** |
| AV-11 | Cancelamento: stop na síntese e na reprodução libera fila; nenhuma 2ª reprodução começa | log + gravação | NOT RUN | stop/cancel unit verde; AV exige runtime | **NOT RUN** |
| AV-12 | Encerramento: sair falando não deixa processo órfão (python/worker/Electron); próxima abertura sintetiza de novo | `Get-Process` antes/depois | NOT RUN | smoke declarou shutdown do worker externo; **ciclo completo in-app não medido** | **NOT RUN** |
| AV-13 | Degradação: mic ausente/negado → chat de texto funciona com erro tipado | screenshot + log | NOT RUN | unit hearing cobre opt-out (`voice.enabled=false`); cenário real não executado | **NOT RUN** |
| AV-14 | Estado honesto: UI distingue preparando/pronta/erro/indisponível; nunca “pronta” com engine ausente | screenshots (forçando engine ausente) | NOT RUN | nada | **NOT RUN** |
| AV-15 | Privacidade: áudio não persistido sem consentimento; transcrição não em log de diagnóstico sem ação do usuário | inspeção de perfil/log | NOT RUN | nada; exige varredura anti-PII do perfil (§2-R8) | **NOT RUN** |

**Síntese:** o plano rev.2 declara 14× NOT RUN e 1× BLOCKED; a reconciliação desta branch confirma **exatamente esse placar** — nenhum AV promoveu. O smoke declarado (E-01/E-02) alimenta **no máximo** AV-07 como insumo parcial (e mesmo assim em escopo e método errados); nada mais aproveita. **Score de gate: 0/15 atribuíveis.**

Divergência adicional a registrar: o plano rev.2 marca AV-07 como “BLOCKED (rede/Python)” — ou seja, o próprio plano já considera que a coleta depende de acesso que o Linux não tem; este status permanece até R-4/R-6 da reconciliação serem versionados.

---

## 2. Critérios objetivos de aceite — regras globais para QUALQUER evidência (R-01…R-10)

Uma evidência só é “aceita” para G‑AUD se **todas** estas regras forem satisfeitas; a violação de qualquer uma reprova o artefato (independente de quão bom pareça o log):

- **R-01 Âncora de SHA.** Todo lote de evidências declara `git rev-parse HEAD` e `git status --porcelain` do checkout usado, em arquivo `00-ambiente.txt` dentro do lote. O SHA deve ser **exatamente** o congelado do beta (`407300b8baa56b0ed8d14b7b2c0628222754e51f` ou o substituto ratificado pelo produto). Qualquer divergência = lote **ANULADO** para o gate.
- **R-02 Mesmo SHA.** Os 15 AV executores devem pertencer ao **mesmo** commit. Carry-forward ou “mistura de commits” não existe para áudio.
- **R-03 Ambiente físico.** Janela de execução no Windows 11 físico (RX 580 8 GB, Ryzen 5 5500, 16 GB) declarada; Linux/mock/CI jamais aceitos para AV-*.
- **R-04 Método literal.** Cada AV traz: pré-condições, comando/click, observado vs esperado, timestamps, console log (Main/Stage), sem truncagem de erros. Screenshot isolado sem log reprova (AV-01, AV-09, AV-14, AV-15 exigem log ao lado).
- **R-05 Artefato inspecionável.** Arquivos produzidos (WAV, `lia-product.json` sanitizado, `Get-Process` pré/pós) versionados no lote ou com SHA-256 registrados; WAV total ≤ ~8 MB → commitar como binários; senão manifesto + 1 WAV representativo por rodada.
- **R-06 Validade técnica de WAV.** Header RIFF+fmt+data, `nchannels=1`, `framerate=24000`, `sampwidth=2`, duração > 0,5 s, RMS > 0, sem clipping > 0 dBFS. 48 kHz re-encodado ou estéreo reprova o caminho Kokoro direto.
- **R-07 Mock não conta.** Qualquer texto do tipo “mock sintetizou”, “harness PASS”, “suíte unit verde” = evidência da camada N1 apenas. AV-07/08/11/12 exigem processo/voz/áudio reais.
- **R-08 Anti-segredo e anti-PII.** Varredura obrigatória antes do commit: chaves (`gsk-`, `sk-`, tokens), conteúdo de `lia-secrets.json`, `%APPDATA%\Lia` bruto, `deviceId`/labels reais, áudio com voz pessoal não autorizada. Redact ou descartar.
- **R-09 Rastreio de sessão.** Logs com `lia.voice.prewarm|synthesize|engine.error|voice-install|shutdown`, ou “not observed” explícito (o harness canônico `Tests/tools/qa-voice-metrics.mjs` já implementa a cláusula honest-summary). Ausência de linhas ≠ aprovação; é ausência de prova.
- **R-10 Fechamento honesto.** Toda declaração de gate só após `CURRENT-STATE.md` atualizado **no mesmo commit** que adiciona as evidências; relatório de resultado referenciando esta régua; riscos residuais assinados pelo produto. BLOCKED declarado por AV quando qualquer pré-condição falhar — jamais "quase-PASS".

---

## 3. Critérios objetivos de aceite por AV-01…AV-15

Formato: **aceite exige** bullets; **reprova se** bullets. Cada linha indica qual(is) regra(s) global(ais) R-xx se aplica com mais força.

### AV-01 — Permissão de microfone (áudio sim / vídeo não / persistente)
- Aceite: `00-ambiente.txt`; log Main com evento de permissão para áudio e recusa para vídeo; screenshot do prompt (se captura possível); após reabertura, permissão preservada (log ou UI state print). R-01,R-04,R-08.
- Reprova: permissão dada “para sempre” via configuração externa sem log; ausência de restart; screenshot sem log.
### AV-02 — Seleção e persistência de dispositivo
- Aceite: enumeração ≥1 entrada pt-BR; troca no Configurar Lia; próxima captura usa o novo device; persistência após reabrir (`lia-product.json` sanitizado mostrando deviceId não-PII ou índice); log com deviceId semanticamente consistente. R-01,R-04,R-08,R-10.
- Reprova: PII de dispositivo (nome pessoal) sem redact; hotplug não testado; device list vazia declarada como PASS.
### AV-03 — Captura + VAD
- Aceite: frase controlada de ~3 s → log VAD com início/fim + duração do buffer ≥2 s; 10 s silêncio → nenhum envio (zero linhas `voice-send-sequence`/`user message`); distância VAD↔STT preservada. R-03,R-04,R-07.
- Reprova: envio disparado por silêncio; buffer <2 s aceito; VAD rodando via mock/fixture.
### AV-04 — STT remoto Groq (limiar **[proposto]**: ≤1,5×dur+2 s; ≥90% keywords)
- Aceite: **pré-requisito P-2 aprovado por escrito** (sem isso, PASS é inválido por construção). 3 frases pt-BR fixas versionadas; transcript de cada uma com timestamp início/fim; RTF e latência computados por script versionado; % de palavras-chave por frase (≥90%); logs Main mostrando chamada Groq real (sem chave) e nenhum token em URL/log; erros tipados em caso de falha. R-01,R-04,R-05,R-08.
- Reprova: limiar próprio sem P-2; transcrição editada manualmente; ausência das frases fixas; “ficou bom o suficiente”.
### AV-05 — STT sem vazamento de credencial
- Aceite: chave **sintética** configurada pela UI real; derrubar rede → erro tipado (`LiaError`/`provider_error`); varredura automatizada por `gsk-*|sk-*|Bearer` em logs, `%APPDATA%\Lia`, DOM dumps, toasts, URLs; screenshot do erro humano; **chave real jamais usada/registrada**. R-04,R-08,R-09.
- Reprova: varredura em transcrição de áudio apenas; screenshot contendo chave; ausência de typed error.
### AV-06 — Ditado → UMA mensagem → resposta
- Aceite: ditado de uma frase → exatamente 1 mensagem de usuário no histórico; resposta da conversa ocorre pelo mesmo pipeline de digitação (ferramentas/anexos/D2B12); log de send + histórico versionado. R-03,R-04,R-07.
- Reprova: duas mensagens (split), resposta fora do fluxo, ou divergência de comportamento vs texto sem registro de bug.
### AV-07 — Kokoro local: instalação, prewarm, RTF ≤ **0,5** `[proposto]` (CPU, 5 frases)
- Aceite: pré-requisito P-2. Engine instalado pelo caminho de produto; log `lia.voice.prewarm` + `lia.voice.synthesize ok=true`; tabela com 5 frases pt-BR (texto das frases commitado), duração do WAV vs tempo de síntese → RTF por frase ≤ limiar aprovado **após aquecimento**; diretório de runtime confirmado (`%LOCALAPPDATA%\Lia\runtimes`); WAVs R-06-válidos versionados; modelo hash (`fbae9257…` ou o ratificado) registrado. **NÃO aceitar como prova: smoke dev-only** — o smoke do Codex (E-01/E-02) é insumo de N2 apenas. R-01,R-04,R-05,R-06,R-07.
- Reprova: RTF medido sem aquecimento; RTF do DirectML/GPU não exigido aqui (escopo CPU per DP-2); ORT 1.24.4 sem correção do ConvTranspose; 5 frases diferentes da (futura) pré-definição sem justificativa.
### AV-08 — Reprodução + legenda + “parar fala” ≤1 s
- Aceite: áudio toca no dispositivo padrão (gravação de tela com áudio ou observação registrada + log playback-manager); legenda/subtitle acompanha o fonema/segmento; “parar fala” corta em ≤1 s (medição por timestamp de clique→silêncio) e **não retoma**; nenhuma segunda faixa é enfileirada. R-03,R-04,R-09.
- Reprova: corte >1 s; retomada; legenda dessincronizada sem registro; áudio sem dispositivo real.
### AV-09 — Falhas tratadas (provider offline / engine ausente / voz inexistente)
- Aceite: 3 cenários induzidos; em cada um: mensagem humana tipada (screenshot), nenhum crash (processo vivo, log), nenhum áudio repetido; classificação do erro no log (`provider_error|engine_missing|voice_not_found`). R-04,R-08,R-09.
- Reprova: qualquer cenário com stacktrace exposto ao usuário; crash do Main/Stage; repetição automática de áudio.
### AV-10 — Persistência da seleção de provedor/voz
- Aceite: AI Settings altera `voice.tts.preferred`/`fallback` pela UI; reabrir app; próxima resposta já usa o alvo novo (log `voice.select` ou equivalente); `lia-product.json` versionado **sanitizado** mostrando new_value; nenhum segredo no arquivo. R-04,R-05,R-08.
- Reprova: escrita fora da UI (edição manual de JSON); arquivo contendo chave; troca não aplicada na próxima resposta.
### AV-11 — Cancelamento durante síntese e durante reprodução
- Aceite: dois congelamentos distintos (durante `lia.voice.synthesize` e durante playback): fila liberada, nenhuma reprodução subsequente; TTS em voo cancelado (log de cancel/stop); gravação/log por momento; 2ª interrupção também tratada. R-03,R-04,R-09.
- Reprova: slot fila preso; síntese completa ignorando stop; 2ª reprodução começa sozinha.
### AV-12 — Sem processos órfãos após sair falando
- Aceite: `Get-Process` antes/depois (python/worker/Electron) — **zero** PIDs residuais associados à sessão; saída graciosa logada (`[lia:shutdown]` ou equivalente); **reabertura sintetiza de novo** (log `synthesize ok=true` após relanço). R-03,R-04,R-05.
- Reprova: 1 worker/python órfão; reabertura silenciosa sem TTS; shutdown forçado como “pass”.
### AV-13 — Degradação com mic ausente/negado
- Aceite: mic desconectado (USB removido ou permissão negada) → Stage abre; chat de texto funcional; erro tipado visível; **sem** laço de permissão/modal em loop; mic retorna → fluxo normal retoma. R-03,R-04,R-07.
- Reprova: app quebrado/modal travado; erro genérico sem tipo; caminho texto indisponível.
### AV-14 — Estado honesto da UI (preparando/pronta/erro/indisponível)
- Aceite: screenshot de cada estado forçável; forçar engine ausente (renomear runtime ou perfil sem runtime) → UI **nunca** mostra “pronta”; erro diz o que fazer (instalar/verificar IA); preparando exibe progresso honesto. R-04,R-08.
- Reprova: “pronta” com engine ausente (falha crítica); screenshot sem log; estado não reproduzível.
### AV-15 — Privacidade (áudio não persiste; logs sem transcrição sem ação)
- Aceite: varredura de `%APPDATA%\Lia` e do perfil de teste por arquivos de áudio/scratch (`*.wav` residuais) — zero não-consentido; logs de diagnóstico (`%APPDATA%\Lia\logs` ou console) mostram **metadata-only** (sem conteúdo transcrito) salvo ação explícita do usuário (export de conversa/diagnósticos); consentimento de gravação respeitado. R-05,R-08,R-09.
- Reprova: WAV de teste deixado em disco sem autorização; log contendo texto falado; retenção silenciosa.

---

## 4. Revisão final — resultados consolidados (sem re-execução)

Documentos/evidências revisados nesta auditoria (leitura apenas):

| Item revisado | SHA/branch | Situação |
|---|---|---|
| Plano rev.2 §4–§5 (AV-01…AV-15, G-AUD, B-07, QAs, P‑2) | `0bf0629` (via `origin/arena/7fa837f0-lia-project` e `origin/codex/lia-multi-provider-voice`) | referência normativa; reproduzida no §1 |
| `LIA-AUDIO-EVIDENCE-RECONCILIATION.md` (esta branch @ `2ead383`) | gate 0/9; AV placar 0/15; G-AUD BLOCKED | íntegro (commitado) |
| `LIA-AUDIO-QA-MATRIX.md` + `evidence/LIA-QA-VALIDATION-407300b-…/` | `407300b` | re-verificação Linux 1.940 PASS; **RT ausente**; nada promove AV |
| Evidências Linux carregadas adiante (`5ec464e`, `ae46c49`) | carry-forward rotulado | rótulo mantido; sem promoção para `407300b` |
| `lia-windows-integrated-validation-0818305/` | `0818305` (Windows físico, voz OFF no perfil) | boot apenas; fora do áudio |
| Histórico `3ef6d11` (“WINDOWS E2E PASS”, CURRENT-STATE §2 aqui) | `3ef6d11` | **não transferível**; rotulado |
| `LIA-MULTI-PROVIDER-VOICE-ARCHITECTURE.md` | `fd0451d` | afirmação de smoke sem artefatos versionados; E-01/E-02 → **BLOCKED** |
| `git log` global + branches remotas + PRs + tags + Google Drive + GitHub REST | — | **`9e94dce` inexistente** (§0) |

**Placar final de AV (@ `407300b`): 15 NOT RUN, 0 PASS, 0 FAIL-accertado** (E-03 DirectML FAIL não conta como AV-07 — é falha de engine não exigida pelo build). **G-AUD: BLOCKED. B-07: aberto. Beta interno: NÃO APROVADO.** Nenhum teste foi re-executado nesta rodada; nenhum resultado anterior foi negado; nenhuma prova faltante foi simulada.

---

## 5. Caminho para desbloquear (o que o Codex deve fazer no Windows)

1. **Publicar o trabalho.** Enviar `9e94dce` para uma branch remota (qualquer ref auditável) ou informar a localização real (zip/Drive). Sem isso, o “relatório novo” é inexistente para o gate.
2. **Ancorar SHA.** Registrar `git rev-parse HEAD` no checkout de coleta (esperado `407300b…` ou substituto ratificado); se a coleta ocorreu em outro SHA, **re-coletar** nesse SHA ou reclassificá-la como histórica (SKIP).
3. **Versionar a evidência (R-05).** Inventário recursivo de `J:\lia-evidence\beta-407300b-windows-20261114\` + `…\rx580-local-ai-407300b\`, SHA-256, WAVs (≤8 MB commit; senão manifesto+1 representativo), inspeção técnica (R-06), logs sanitizados.
4. **Executar os 15 AV** no Windows físico com STT Groq + Kokoro local, **no mesmo SHA**, produzindo um dossiê por AV (§3); G-AUD só fecha com os 15 verdes; P-2 precisa ser aprovado **antes** de AV-04/07; AV-12 exige `Get-Process` antes/depois; AV-15 exige varredura de perfil.
5. **Publicar resultado.** Relatório referenciando este documento + atualizar `CURRENT-STATE.md` no mesmo commit (R-10). Qualquer AV com falha/premissa ausente → **BLOCKED** por AV, com comando/erro literal — nunca "quase-PASS".
6. **Não apagar `J:\lia-evidence`**; não commitar binários grandes; varredura anti-segredo (R-08) antes de qualquer push.

---

## 6. Limitações desta verificação

1. Acesso a `J:\` e ao checkout Windows impossível neste ambiente — por isso cada critério acima exige artefatos físicos inspecionáveis, não declaração.
2. O conteúdo real do “relatório novo” de AV (se existir) não foi lido; a §1 reflete **o plano rev.2**, não o relatório. Ajustar a §1 após o relatório se tornar legível.
3. AV-04/AV-07 dependem de P-2 (aprovação de limiares) — sem ela, **nenhum PASS é válido**, independentemente da qualidade da evidência.
4. Limiares citados (≤1,5×dur+2 s; RTF ≤0,5) são **propostas do plano rev.2**, não valores aprovados pelo produto.
5. Esta reconciliação não invalida testes já realizados; apenas impede sua promoção indevida a gate.

**Veredicto:** as evidências de áudio continuam fora do repositório e não inspecionáveis; `9e94dce` não existe nos destinos auditáveis; **o gate de áudio do beta interno permanece BLOCKED com 0/15 AV atribuíveis.** A promoção para G-AUD exige o dossiê completo do §3 (por AV), sob as regras R-01…R-10, no mesmo SHA congelado, com P-2 aprovado e `CURRENT-STATE.md` no mesmo commit.
