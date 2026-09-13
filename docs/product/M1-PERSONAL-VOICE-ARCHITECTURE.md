# M1 — Personal Voice Import: arquitetura

**Commits:** `b3b8045` (biblioteca + storage + testes) · `f36b07d` (tipagem).
Branch `arena/01a07b6d-lia-project`, enviada.

> **Não é PASS**, e duas partes do escopo **não foram implementadas**: a UI (item F)
> e a engine concreta (itens D/E). Seções 6 e 12 explicam o que existe, o que falta
> e por quê.

---

## 1. Arquitetura escolhida

**A voz personalizada cabe inteira no schema que já existe.** Nada de store
paralelo, nada de segundo writer:

```
voice.tts.preferred = { providerId: 'custom-local-voice', voiceId: '<profile-id>' }
```

`LiaVoiceTtsTarget` já é `{ providerId, modelId?, voiceId? }`. O `voiceId` vira o
id do profile. Consequências diretas:

- `saveTtsConfiguration()` continua sendo **a única** rota que seleciona voz.
- preview e chat já leem o mesmo target — não há caminho novo a sincronizar.
- a correção da rodada 4 (modelo opcional) é o que torna isso possível: um alvo
  sem `modelId` é válido.

A **biblioteca** de profiles é uma preocupação separada (nome, engine, arquivos) e
tem seu próprio IPC. Isso não é um segundo writer: ela descreve as vozes que
existem; quem seleciona continua sendo `voice.tts`.

## 2. Onde os profiles ficam

```
userData/lia-voices/
  index.json              <- registro: só metadata
  <profile-id>/           <- uma pasta por voz
    model.pth
    index.index
```

**Estratégia: copiar para `userData`**, em vez de registrar referência externa.
Justificativa:

- o arquivo de origem normalmente está em Downloads, e usuários movem/apagam;
- um diretório é o backup inteiro, e o uninstall leva junto com o `userData`;
- nunca pode parar dentro do repositório nem do instalador;
- o custo é uma cópia única no import, limitada por `MAX_FILE_BYTES` (4 GB).

Nenhum caminho absoluto no registro, nenhum binário, nenhum base64 — **afirmado
por teste**.

## 3. Formato / schema

```ts
interface LiaCustomVoiceProfile {
  id: string          // uuid estável
  name: string        // amigável, único (case-insensitive)
  engine: string      // 'generic' | 'rvc' | ...
  createdAt: string   // ISO
  files: Array<{ role: string, filename: string, bytes: number }>
  metadata?: Record<string, string>   // só strings, truncadas a 500 chars
}
```

`filename` é sempre um nome simples dentro da pasta do profile — nunca caminho
absoluto, nunca separador. Engines são **declaração**, não implementação: cada
entrada lista os `roles` que um profile daquele tipo precisa e as `extensions` que
o picker deve oferecer.

## 4. Fluxo de importação

1. UI pede os caminhos → `electronLiaVoiceProfilesPick` roda `showOpenDialog` **no
   main**.
2. Os caminhos devolvidos entram num allowlist de vida curta (máx. 64).
3. `electronLiaVoiceProfilesImport` **só aceita caminhos desse allowlist**.
4. Validação completa **antes** de copiar o primeiro byte: engine conhecida, roles
   válidos e sem duplicata, extensão, existência, tamanho > 0 e ≤ 4 GB, nome não
   vazio e não duplicado.
5. Cópia para `userData/lia-voices/<uuid>/`, com re-checagem de contenção por
   arquivo. Falha na cópia → a pasta é removida, nada fica pela metade.
6. Registro escrito; o profile aparece na lista.

**Cancelamento do picker resolve `null` e não altera nada** — testado.

## 5. Como `voice.tts` referencia a voz

Por id: `targetForProfile(profile) → { providerId: 'custom-local-voice', voiceId: profile.id }`.
O teste afirma que o alvo serializado **não contém** o nome do arquivo nem `/`, e
tem menos de 120 chars.

Remover o profile ativo **repara o target na mesma operação**, por
`saveTtsConfiguration()`: promove a primeira reserva; sem reserva, limpa o slot.
Nenhum target fica apontando para uma voz que não existe mais.

## 6. Engine concreta — **não escolhida, e o motivo**

Não escolhi por preferência; os critérios que você listou apontam todos para a
mesma conclusão, mas eu **não consegui verificar nenhum deles nesta sessão** (sem
GPU, sem Python, sem Windows, sem rede para os endpoints). Então implementei a
arquitetura e deixei a engine como próxima etapa, exatamente como o spec permite.

Análise para **Ryzen 5 5500 / RX 580 8GB / sem CUDA**:

| Engine | CPU viável? | RX 580? | Modelo importável | Integração | Risco |
| --- | --- | --- | --- | --- | --- |
| **AllTalk** | Sim | Não (irrelevante se CPU) | Depende do backend | **HTTP server — é o design dele** | Licença **não verificada aqui** |
| **RVC** | Sim, lento | Não | Sim (`.pth` + `.index`) | App pesado com API | Precisa de TTS base + conversão (2 etapas); licença **varia por modelo** |
| **XTTS v2** | Sim, muito lento | Não | Sim (~2 GB) | Via servidor | **Licença Coqui não-comercial** — bloqueio real para produto (confirmar) |
| **F5-TTS** | Na prática não | Não | Sim | Servidor | Exige GPU de verdade |

Sobre a RX 580: GCN4 (gfx803) está abaixo do piso do ROCm/PyTorch moderno, então
**GPU local está fora** para qualquer uma — o que já era a conclusão da rodada
anterior sobre o WebGPU.

**Recomendação:** AllTalk v2 via HTTP como primeira engine, porque é literalmente
um servidor local — desacopla o runtime pesado do renderer Electron, que é o que
você pediu ("preferir integração via API/local server"). Com a arquitetura que
está commitada, integrar é: uma entrada em `VOICE_ENGINES` + um adapter de
síntese. **Nada no core ramifica por engine.**

**Ressalva que preciso registrar:** se o backend do AllTalk for XTTS, a licença
não-comercial da Coqui vem junto. A licença segue o *modelo*, não o servidor. Isso
precisa ser resolvido antes de distribuir.

## 7. O que está implementado

| Camada | Arquivo | Estado |
| --- | --- | --- |
| Contrato | `shared/eventa/index.ts` | ✅ tipos + 5 canais |
| Storage + validação | `main/services/lia/voice-profiles.ts` | ✅ 15 testes |
| Ponte IPC + allowlist | `main/services/lia/voice-profiles-service.ts` | ✅ registrado em `main/index.ts` |
| Store renderer | `renderer/stores/lia/voice-profiles.ts` | ✅ 9 testes |

## 8. Arquivos alterados

```
apps/stage-tamagotchi/src/shared/eventa/index.ts
apps/stage-tamagotchi/src/main/services/lia/voice-profiles.ts          (novo)
apps/stage-tamagotchi/src/main/services/lia/voice-profiles.test.ts     (novo)
apps/stage-tamagotchi/src/main/services/lia/voice-profiles-service.ts  (novo)
apps/stage-tamagotchi/src/main/index.ts
apps/stage-tamagotchi/src/renderer/stores/lia/voice-profiles.ts        (novo)
apps/stage-tamagotchi/src/renderer/stores/lia/voice-profiles.test.ts   (novo)
```

Nenhum binário, nenhum modelo, nada dentro do repo.

## 9. Testes — 24 novos, todos passando

**Storage (15):** import válido com cópia real dos bytes · registro só com
metadata (sem caminho, sem binário, sem base64) · sobrevive a restart · remoção
apaga pasta e registro · **caminho fora do allowlist rejeitado** · extensão errada
· nome vazio · nome duplicado · engine desconhecida · role desconhecida · arquivo
ausente reportado sem exception · registro corrompido = biblioteca vazia ·
`resolveFile` nunca sai da pasta · teto de tamanho e engines declaradas ·
`safeFilename` contra `..`, `.`, dotfiles, NUL, caminhos absolutos e reservados.

**Renderer (9):** target referencia só por id · carrega biblioteca e engines ·
**picker cancelado não altera nada** · extensões da engine vão para o picker ·
import falho vira código amigável · remover profile não-usado não toca
`voice.tts` · **remover o profile ativo repara o target promovendo a reserva** ·
sem reserva, limpa o slot · `voice.tts` continua sendo a fonte da seleção.

## 10. Mutations — 5/5 detectadas

| # | Mutação | Resultado |
| --- | --- | --- |
| M1 | remover o allowlist de caminhos | **1 failed** ✓ |
| M2 | não escrever o registro (sem persistência) | **4 failed** ✓ |
| M3 | `safeFilename` sem neutralizar traversal | **2 failed** ✓ |
| M4 | remover profile sem limpar o target | **2 failed** ✓ |
| M5 | `targetForProfile` com voice hardcoded | **1 failed** ✓ |

**Três expectativas minhas estavam erradas e os testes pegaram.** Eu esperava que
`safeFilename('../escape.pth')` devolvesse `null`; ele devolve `'escape.pth'` —
que é justamente a neutralização correta, a mesma regra do caminho absoluto. O
mesmo para `resolveFile('abc', '/etc/passwd')` → `<root>/abc/passwd`, sempre
contido. Reescrevi os testes para afirmar a propriedade que importa (contenção),
não a que eu tinha imaginado. E passei a **rejeitar** NUL em vez de removê-lo
silenciosamente — é vetor clássico de truncagem.

## 11. Validação

| Suíte | Resultado |
| --- | --- |
| `stage-tamagotchi` (node) | **86 arquivos, 663 passed, 1 skipped** (+2 arquivos, +24 testes) |
| ESLint nos alterados | **0 erros** |
| `vue-tsc` tamagotchi | **3 erros = baseline exato** (`provider-config-service.ts:41` TS2322, `home.vue:85` TS6133, `lia-persona.ts:383` TS6133) |
| `stage-ui` | não tocado nesta rodada |

Um deslize meu que o typecheck pegou: `VOICE_ENGINES` é `as const`, então
`roles.includes(role)` rejeitava uma string comum; e o `injeca.invoke` novo
precisava de `dependsOn` explícito. Corrigidos em `f36b07d`.

## 12. O que falta

- **UI (item F)** — não implementada. Falta a seção "Vozes personalizadas" em
  Configurar Lia → Voz (Importar / Nome / Engine / Status / Testar / Remover) e as
  strings pt-BR/en.
- **Engine (itens D/E)** — nenhum adapter de síntese. Sem ele, selecionar um
  profile persiste corretamente mas **não produz áudio**.
- **Testes 8–10 do item I** (preview usa profile, chat usa o mesmo profile) —
  exigem um adapter; hoje não há o que exercitar.
- **`custom-local-voice` não está no registry de providers** — de propósito.
  Registrar um provider que não sintetiza criaria uma opção que parece funcionar
  e não funciona, que é a classe de bug que as rodadas anteriores passaram
  eliminando.

Minha sugestão de ordem: decidir a engine (AllTalk?) → adapter de síntese +
registro do provider → UI. Nessa ordem a UI já nasce apontando para algo que
fala.
