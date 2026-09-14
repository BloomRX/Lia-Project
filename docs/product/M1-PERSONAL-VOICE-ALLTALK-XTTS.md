# M1 — Personal Voice, Phase 2: AllTalk + XTTS-v2

Branch `arena/01a07b6d-lia-project`. Status: **parcial — NÃO é PASS de voz personalizada.**

Decisão de escopo aceita pelo usuário nesta rodada: **AllTalk entra como servidor local
HTTP (runtime/transport), XTTS-v2 é a primeira engine suportada e é OPCIONAL, e a Lia
continua engine-agnostic.** `custom-local-voice` permanece o provider da Lia; o core não é
acoplado ao XTTS-v2; pesos e áudio privado nunca entram no repo.

---

## 1. Estado geral da rodada

| Item | Conteúdo | Estado |
|---|---|---|
| A | Auditoria da API AllTalk com evidência | **Concluído** |
| B | Registrar `custom-local-voice` no speech registry | **Pendente** |
| C | Persistir `AllTalkRuntimeConfig` no config Lia global | **Pendente** |
| D | Metadados XTTS no profile (`backend`, `referenceAudio`, `language`) | **Pendente** |
| E | `voicesDir` + cópia do WAV de referência | Parcial (campo existe, cópia pendente) |
| G/H | UI "Voz personalizada" + status + i18n | **Pendente** |
| I/J | Preview e chat pelo mesmo adapter | **Pendente** |
| K | Doc de licença do XTTS | **Pendente** |
| L | Testes do client + mutations | **Concluído (14 testes, 3/3 mutations)** |
| N | QA real no Windows | **Não feito ⇒ sem PASS** |
| O | Este relatório | Concluído |

O que existe de novo em código nesta rodada é **um único módulo**: o client HTTP do AllTalk
no processo main, com testes. Ele não é chamado por nada ainda — não há provider, não há UI,
não há config persistida. Isto é deliberado: o client é a peça cuja forma era desconhecida
até a auditoria terminar, e foi isolada para poder ser testada contra um servidor real antes
de qualquer coisa depender dela.

---

## 2. Auditoria da API (item A) — o que a evidência mudou no design

Fontes: wiki oficial do AllTalk v2 (`API ‐ Standard TTS Generation API`,
`API ‐ Control and Configuration API`, `API ‐ TTS Request Flowchart`). Três achados
alteraram o desenho; todos estão refletidos no código:

**a) A resposta de `/api/tts-generate` é JSON, não áudio.**
`POST /api/tts-generate` devolve
`{status: 'generate-success'|'generate-failure', output_file_path, output_file_url,
output_cache_url}`. O WAV precisa ser buscado num **segundo request** em `output_file_url`.
Um client que tratasse a primeira resposta como áudio decodificaria um documento JSON.
O client faz os dois hops e resolve a URL relativa com `new URL(audioUrl, base)`.

**b) `character_voice_gen` é um *filename* na pasta de vozes do AllTalk.**
Não é um caminho enviado, nem um upload, nem payload. O AllTalk resolve o nome dentro da
própria pasta de vozes. Consequência: **não existe como "enviar a referência" pela API** —
a Lia precisa colocar o WAV lá (ou pedir que o usuário coloque). Por isso
`AllTalkRuntimeConfig` ganhou `voicesDir?`, ainda não usado por nenhuma cópia.

**c) A tabela de idiomas não tem variantes regionais.**
Códigos documentados: `auto, ar, zh-cn, cs, nl, en, fr, de, hi, hu, it, ja, ko, pl, pt, ru,
es, tr`. **Português é `pt`; `pt-BR` não existe.** Enviar `pt-BR` seria rejeitado. O client
exporta `toAllTalkLanguage()`, que reduz `pt-BR`/`PT-br` a `pt` e devolve `auto` para o que
não está na tabela.

Também confirmado: `Content-Type: application/x-www-form-urlencoded` (não JSON), porta
default **7851**, `text_input` é o único campo obrigatório, e campos omitidos são preenchidos
pelos Global API Defaults do servidor — omitir é o modo pretendido, então o client só envia o
que a Lia decide de fato.

**Health check:** `/api/ready` aparece apenas em fonte secundária e **não** está confirmado na
wiki oficial. O client usa `GET /api/voices` como health, que também devolve a lista de vozes
instaladas — duas informações úteis numa chamada só.

**v1 vs v2:** o README da raiz do AllTalk é v1 e diz explicitamente "Everything on this page
is for AllTalk v1"; v1 usava `/api/generate` e porta 6006 em algumas builds. **Usamos v2.**

**Voz clonada (item F respondido):** XTTS via AllTalk clona **só com reference audio** — basta
o WAV na pasta de vozes e o nome em `character_voice_gen`. **Não precisa de fine-tuning** para
a primeira experiência. Isso confirma a decisão da rodada anterior de não implementar treino
dentro da Lia.

---

## 3. Arquitetura do client

`airi/apps/stage-tamagotchi/src/main/services/lia/alltalk-client.ts`

- **Puro e injetável.** `createAllTalkClient(config, fetchImpl?)` — sem Electron, sem
  filesystem, sem pinia. Isso é o que permite testá-lo e, depois, trocá-lo.
- **`status()` → `connected | offline | error`.** A distinção importa para a UI: "AllTalk não
  está rodando" (offline) pede uma mensagem diferente de "respondeu com erro" (error). Ambos
  são `ok: false`, sem stack trace na superfície.
- **`synthesize()` → `ArrayBuffer`.** Valida antes de tocar a rede (texto vazio, referência
  vazia), envia o form, confere `status === 'generate-success'`, exige `output_file_url`,
  busca o áudio e **rejeita áudio vazio** em vez de tocar silêncio.
- **Timeout** via `AbortSignal` (`DEFAULT_ALLTALK_TIMEOUT_MS = 60_000`); timeout é `error`,
  não `offline`.
- **Defaults:** `DEFAULT_ALLTALK_BASE_URL = 'http://127.0.0.1:7851'`.

O client **não conhece** XTTS. Ele fala AllTalk. A engine que o servidor carregar
(XTTS-v2, ou outra) continua sendo detalhe do AllTalk — é exatamente o desacoplamento pedido.

---

## 4. Testes (item L) — 14, contra servidor HTTP real

`alltalk-client.test.ts` sobe um `node:http` numa porta efêmera em vez de mockar `fetch`.
Method, content-type, encoding do form e o fluxo de dois hops passam por um socket de verdade.

Cobertura: mapeamento de idioma (4 casos) · conectado com lista de vozes · offline quando nada
escuta · error em HTTP 500 · campos do form conferidos um a um (`text_input`,
`character_voice_gen`, `language=pt`, `narrator_enabled=false`, `output_file_timestamp=true`,
`autoplay=false`) · bytes obtidos do segundo hop · `generate-failure` lança · sucesso sem
`output_file_url` lança · HTTP 503 lança · áudio vazio lança · recusa sem texto/referência
**sem tocar a rede** · default de porta.

**Resultado: 14/14 passed.**

### Mutations — 3/3 detectadas

| # | Mutação | Efeito |
|---|---|---|
| MA1 | `status()` sempre devolve `connected` (health check removido) | 1 failed |
| MA2 | `character_voice_gen` hardcoded para `female_01.wav` | 1 failed |
| MA3 | `toAllTalkLanguage` repassa a tag sem normalizar (`pt-BR` cru) | 1 failed |

Restaurado: 14/14.

---

## 5. Validação executada

| Checagem | Resultado |
|---|---|
| `alltalk-client.test.ts` | **14 passed** |
| Suíte tamagotchi completa | **87 arquivos / 677 passed / 1 skipped** |
| ESLint (arquivos alterados) | **0** (após o commit de limpeza) |
| `vue-tsc --noEmit` | **3 erros = baseline exato** (`provider-config-service.ts:41`, `home.vue:85`, `lia-persona.ts:383`) |

Nota de processo: o commit `7e590c6` foi feito e empurrado **antes** de eu conferir o ESLint
dos arquivos novos, e entrou com 6 achados. O commit `81179d4` corrige os três tipos de
achado (Buffer global no teste, ordem dos hooks, binding de `error` não lido no catch) e
deixa os dois arquivos limpos. A ordem certa era checar antes de commitar.

---

## 6. O que falta (na ordem em que deveria ser feito)

1. **C — persistir `AllTalkRuntimeConfig`** em `main/configs/lia.ts`, **fora** do profile de
   voz. O runtime é do AllTalk (uma instalação por máquina); o profile é da voz. Misturar os
   dois faria trocar de voz exigir reconfigurar servidor.
2. **B — registrar `custom-local-voice`** no registry de speech: resolver o profile, validar,
   mapear para os parâmetros do AllTalk, chamar o client, devolver áudio compatível com o
   pipeline. Hoje o id existe como constante mas não sintetiza — foi deixado assim de propósito
   na rodada anterior.
3. **E/D — `voicesDir` em ação:** copiar o WAV de referência do profile para a pasta do
   AllTalk (com contenção de caminho, como o storage da rodada anterior) e gravar no profile
   `backend: 'xtts-v2'`, `referenceAudio` (nome do arquivo), `language`.
4. **I/J — preview e chat pelo mesmo adapter.** Verificado nesta rodada: o preview chama
   `speechStore.speech(...)` direto em `src/renderer/stores/lia/voice-preview.ts:94`, enquanto o
   chat resolve por `resolveSynthesisTarget()` em
   `packages/stage-ui/src/components/scenes/Stage.vue:536`. Os dois caminhos têm de chegar ao
   mesmo adapter ou a rodada anterior perde o sentido.
5. **G/H — UI:** "Voz personalizada" com nome, engine, status (conectado / desconectado /
   erro / carregando), Testar, Remover. Mensagens amigáveis, sem stack trace. Texto fixo do
   preview: `"Olá! Eu sou a Lia."`. i18n pt-BR/en.
6. **K — doc de licença do XTTS** (usuário instala por conta própria; não redistribuímos pesos).
7. **N — QA real no Windows.** Sem isso não há PASS.

---

## 7. Commits desta rodada

| SHA | Conteúdo |
|---|---|
| `7e590c6` | feat: client HTTP AllTalk v2 + 14 testes |
| `81179d4` | style: limpar 6 achados de ESLint dos arquivos novos |

Local e remoto em `81179d4`; working tree limpo.
