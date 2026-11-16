# Especificação — ciclo de vida Launcher ↔ Runtime

**Versão:** 1.0 (proposta) · **Data:** 16/11/2026 · **Base:** `8558c2c`
**Decisões relacionadas:** D-02 (runtime único rejeitado), D-04 (fechar ≠ parar), D-07 (gate)
**Status:** especificação. **Nenhuma linha de código de produto foi escrita nesta rodada.**

---

## 1. Objetivo

Definir, de forma implementável e testável, como o Launcher e o Runtime (Stage) coexistem quando
**não** são um só processo:

1. fechar o Launcher mantém o Runtime funcionando;
2. reabrir o Launcher **descobre** o Runtime existente e o controla;
3. o Launcher pede **pausa**, **encerramento normal** e **encerramento forçado**, distintos;
4. o Runtime encerra limpo: hooks, logs, recursos;
5. o Launcher não depende de referências a filhos que ele mesmo criou;
6. descoberta e controle resistem a reinício do Launcher, órfãos e múltiplas instâncias;
7. o encerramento **não** começa por `taskkill /T /F`.

**Fora de escopo:** implementar; trocar framework; runtime único; orçamento; qualquer alteração
em `codex/lia-multi-provider-voice`.

---

## 2. Estado atual (fatos verificados)

| # | Fato | Evidência |
|---|---|---|
| 1 | Fechar a janela do Launcher dispara `app.quit()` e o coordenador **para o Stage** | `lia-app/src/main/index.ts:241-258`; `shutdown-coordinator.ts:1-30` |
| 2 | `holdsOwnedStage()` só reconhece o filho criado nesta sessão | `airi-stage-manager.ts:204-206` |
| 3 | O Stage **não** tem canal de controle; a única comunicação é o pipe de credenciais | ausência de canal; `owner-channel.ts` |
| 4 | No Windows, o primeiro gesto de parada é `taskkill /PID /T /F` | `airi-stage-manager.ts:228-243` |
| 5 | O Stage **tem** encerramento limpo (`before-quit` → `handleAppExit` → hooks → `injeca.stop` → flush de logs) | `stage …/index.ts:686-732` |
| 6 | O Stage encerra quando todas as janelas fecham | `stage …/index.ts:675-681` |
| 7 | O Stage tem tray com "Quit" → `app.quit()` | `stage …/tray/index.ts:243` |
| 8 | O Stage usa a **pasta de dados de produto** como `userData` (perfil Chromium) | `stage …/index.ts:97-101` |
| 9 | O Stage perde as credenciais gerenciadas quando o owner morre | `credential-owner-access.ts:73-97`; `owner-channel.ts:182-243` |
| 10 | O Stage escreve no `stdout` que o Launcher mantém aberto | `airi-stage-manager.ts:425-427` |
| 11 | Existe protocolo versionado com envelope tolerante a lixo, **sem consumidor** | `lia/core/src/protocol.ts`; `lia/core/test/protocol.test.ts` |
| 12 | Existe máquina de estados idêntica à do manager, **sem consumidor** | `lia/core/src/lifecycle.ts:13`; `airi-stage-manager.ts:44` |

O item 12 é o mais importante para o desenho: **não se cria uma terceira máquina de estados.**
Q-01 decide onde ela mora (pacote consumido ou especificação executável).

---

## 3. Vocabulário

| Termo | Definição |
|---|---|
| **Launcher** | processo `Lia.exe` (controle) |
| **Runtime** | processo `LiaStage.exe` (personagem) |
| **Instância** | um Runtime concreto, identificado por `instanceId` UUIDv4 gerado no boot |
| **Registro** | arquivo `%APPDATA%\Lia\runtime.json` escrito pelo Runtime |
| **CCR** | *Control Channel of the Runtime* — canal autenticado descrito no §5 |
| **Adoção** | Launcher lê o registro, conecta ao CCR e reconhece um Runtime já em execução |
| **Parada cooperativa** | pedido `runtime.shutdown` + espera do encerramento real |

**Fases do Runtime** (idênticas a `StagePhase` de `lia/core/src/lifecycle.ts`):
`stopped → starting → running → stopping → stopped`, com `error` terminal para a tentativa.

---

## 4. Ações do usuário e efeito exato

| Ação | Launcher | Runtime | Mecanismo |
|---|---|---|---|
| **Fechar** (X da janela) | encerra o processo | **continua** | nenhum pedido de parada; registro permanece |
| **Minimizar** | continua | continua | `minimize()`; nada muda no Runtime |
| **Parar a Lia** (botão explícito) | continua | encerra | `runtime.shutdown` → confirma → sai |
| **Sair completamente** | encerra | encerra | `runtime.shutdown` + confirmação + `app.exit` |
| **Parar à força** (recuperação) | continua | encerra sem hooks | `taskkill /PID /T /F` — **somente** após timeout, com rótulo explícito |

**Requisito de UI:** as quatro ações precisam ser distinguíveis na interface. "Fechar" não pode
ser o mesmo botão que "parar a Lia". O texto de confirmação de "parar à força" deve dizer que
dados não salvos podem ser perdidos.

**Compatibilidade:** a opção "fechar encerra a Lia" (comportamento atual) fica disponível como
preferência explícita, **padrão desligada** (Q-04). Implementada como: ao fechar, se a preferência
estiver ligada, o Launcher executa "Sair completamente".

---

## 5. Descoberta e canal de controle

### 5.1 Por que não basta o PID

PID **não** é identidade: é reciclado pelo SO, não prova que o processo é nosso e não sobrevive a
uma checagem de "existe". O registro precisa de: `instanceId` (aleatório, único), caminho do
executável, versão do Runtime, horário de início, e um **segredo efêmero** que só o processo vivo
possui.

### 5.2 Registro `runtime.json`

Escrito pelo **Runtime** (dono da própria identidade), atomicamente (`tmp` + `rename`):

```jsonc
{
  "schemaVersion": 1,
  "instanceId": "6f1c…",              // UUIDv4, gerado no boot
  "pid": 12345,
  "exePath": "C:\\Users\\…\\Lia\\resources\\stage\\LiaStage.exe",
  "appVersion": "0.12.0-beta.5",
  "protocol": "1.1.0",
  "startedAt": "2026-11-16T18:04:11.302Z",
  "pipe": "\\\\.\\pipe\\lia-ccr-v1-6f1c…",
  "publicKey": "<base64, X25519, 32 B>",
  "launch": { "spawnedBy": "launcher", "launcherPid": 4321 },
  "state": "running"                   // running | paused | stopping
}
```

Regras:

- **Nada de segredo** no arquivo. `publicKey` é pública; a privada só existe em memória.
- `startedAt` é o relógio de parede no boot; usado apenas para diagnóstico e ordenação, **nunca**
  como prova de identidade (o relógio pode ser ajustado).
- O arquivo é removido no encerramento normal. Se ficar para trás, é **stale** e será tratado
  pelo §8.
- Gravação atômica e tolerante a falha: se não puder escrever, o Runtime continua funcionando e
  avisa — a descoberta degrada, o produto não.

### 5.3 Protocolo no fio

Reutiliza o envelope de `lia/core/src/protocol.ts` (`makeEnvelope` / `parseEnvelope` /
`negotiate`): JSON de uma linha, `protocol` semver, `type` de lista fechada, `id`, `from`,
`payload`. **Não se cria um segundo protocolo** (Q-06). Tipos novos (minor `1.1.0`):

| Tipo | Direção | Payload |
|---|---|---|
| `runtime.hello` | Launcher → Runtime | `{ clientPublicKey, clientNonce }` |
| `runtime.hello-ack` | Runtime → Launcher | `{ serverNonce, serverTag, instanceId }` |
| `runtime.auth` | Launcher → Runtime | `{ clientTag, seq: 0 }` |
| `runtime.status` | Launcher → Runtime | `{ seq }` |
| `runtime.pause` / `runtime.resume` | Launcher → Runtime | `{ seq }` |
| `runtime.shutdown` | Launcher → Runtime | `{ seq, reason }` |
| `runtime.stopped` | Runtime → Launcher | `{ seq, exitCode }` |
| `runtime.error` | Runtime → Launcher | `{ code }` — código fechado, sem detalhe livre |

`health.ping`/`health.pong` já existem e são usados como keep-alive.

**Limites:** mensagem ≤ **8 KiB**, deadline **5 s** por resposta, no máximo **1** conexão de
controle ativa, `seq` monotônico por conexão (fora de ordem ⇒ conexão encerrada).

### 5.4 Handshake (X25519 + HKDF + HMAC)

```
Launcher                                   Runtime
   │  lê runtime.json (instanceId, pipe, publicKey)
   │── connect(pipe), deadline 5 s ────────────────►│
   │── runtime.hello { lpk, cnonce } ──────────────►│
   │                                                │  sk = X25519(priv, lpk)
   │                                                │  K  = HKDF-SHA256(sk, salt=instanceId,
   │                                                │        info="lia-ccr-v1", 32 B)
   │◄──────────── runtime.hello-ack { snonce, st, instanceId } │
   │  K = HKDF-SHA256(X25519(lpriv, spk))
   │  verifica st == HMAC(K, "S"‖cnonce‖snonce‖lpk‖spk‖instanceId)
   │── runtime.auth { ct = HMAC(K, "C"‖snonce‖cnonce‖spk‖lpk‖instanceId), seq:0 } ─►│
   │◄──────────────────────────── runtime.status / ok ─│
   │── comandos: tag_i = HMAC(K, seq‖type‖payloadCanônico) ─►│
```

| Propriedade | Como é obtida |
|---|---|
| O cliente fala com o **processo certo** | `st` prova posse da privada cujo `publicKey` está no registro; `instanceId` amarra ao registro |
| O servidor fala com um cliente **vivo no handshake** | `ct` prova posse de `K` derivado do handshake (não reutilizável) |
| **Replay** não funciona | nonces aleatórios de 32 B por conexão + `seq` monotônico + chave efêmera |
| **PID reciclado** não engana | identidade é o handshake; PID serve só para o kill e para diagnóstico |
| Instância **errada** (dois registros) | `instanceId` no HMAC; divergência ⇒ recusa |
| Versão **incompatível** | `negotiate()` recusa major diferente antes do handshake |

**Implementação sem dependência nova:** `node:crypto` tem `generateKeyPairSync('x25519')`,
`diffieHellman`, `hkdfSync` e `createHmac`. Nenhuma biblioteca adicional.

### 5.5 O que este canal **não** protege (modelo de ameaça honesto)

| Ameaça | Coberto? | Por quê |
|---|---|---|
| Outro usuário do Windows controlar o Runtime | **Sim** | DACL padrão de named pipe dá escrita só ao dono/administradores (MS Learn, `CreateNamedPipe`, Anexo); o atacante não conecta como cliente que escreve |
| Outro usuário **ler** o canal | **Parcial** | a DACL padrão concede leitura a `Everyone`; por isso **nenhum segredo trafega** — o canal transporta comandos e metadados |
| Cliente remoto (rede) | **A verificar** | `PIPE_REJECT_REMOTE_CLIENTS` não é exposto por `net.Server`; o nome local `\\.\pipe\…` não é publicado na rede, mas isso é propriedade do SO a confirmar no Windows |
| Malware **do mesmo usuário** | **Não** | o mesmo usuário lê `runtime.json`, o AppData, e pode falar o protocolo. Um limite real exigiria identidade de SO/hardware, fora do escopo |
| Comando arbitrário | **Sim** | lista fechada de tipos; payload validado com esquema estrito; nada de shell, caminho ou execução |
| Recordar comandos de ontem | **Sim** | chave efêmera por processo + nonce + `seq` |

**Conclusão registrada:** a fronteira de segurança é a **conta do Windows**. O canal impede
controle por outro usuário, por processo remoto e por instância errada; não impede malware do
próprio usuário — e nenhum mecanismo em espaço de usuário impediria.

### 5.6 Por que não reutilizar o *server channel* do Stage

O Stage já hospeda um servidor WebSocket (`services/airi/channel-server`, porta 6121, token
opcional com default vazio). Ele é **compatibilidade com clientes AIRI externos**, não controle
do produto: depende de configuração do usuário, aceita TLS opcional, e transformá-lo em canal de
controle misturaria a superfície AIRI com a superfície de produto — exatamente a dependência que
D-01 quer evitar. **Rejeitado.**

---

## 6. Credenciais quando o Launcher sai

### 6.1 O problema (verificado)

O vault vive no Launcher. O Stage consome por `owner-channel`. Quando o processo do Launcher
morre, o pipe fecha, o cliente produz `CredentialOwnerError('unavailable')`, e
`resolveMainCredential` converte em `ProviderError('credentials')`
(`credential-owner-access.ts:73-97`; `owner-channel.ts:182-243`). Resultado: **fechar o Launcher
quebraria a conversa** — exatamente o que D-04 quer evitar.

### 6.2 Solução escolhida: **sessão de credencial com cache em memória**

| Regra | Detalhe |
|---|---|
| **Concessão** | ao resolver uma referência permitida, o Stage guarda o valor **em memória** pelo resto da vida do Runtime |
| **Escopo** | só `apiKey` de escopos presentes em `lia-transports.json` (mesma allowlist de hoje: `lia-host.ts:389-393`) |
| **Revalidação** | a cada uso, a referência é reconferida contra o repositório de transportes; uma referência removida deixa de valer mesmo em cache |
| **Escrita** | `set/change/delete` **nunca** são cacheados e exigem o owner vivo; com o Launcher fechado, escrita falha com erro honesto |
| **Persistência** | **zero** — nada em disco, nada em log, nada em IPC |
| **Descarte** | no `runtime.shutdown`, no tray "Quit" e na parada cooperativa: limpar o cache e as referências |

**Justificativa de segurança:** o Stage já recebe a chave em claro para cada chamada HTTP; o cache
não aumenta a exposição a um atacante que já lê a memória do processo, e **não** relaxa a
allowlist. O que ele remove é a dependência de o Launcher estar vivo para **ler** — que é
justamente o requisito.

### 6.3 Limite honesto

Se o **Runtime** reiniciar com o Launcher fechado, o cache não existe: o Runtime volta ao modo sem
owner e, sem cipher próprio, não consegue ler o vault gerenciado. Nesse estado ele deve:

1. continuar oferecendo voz local e tudo que não exige provider remoto;
2. reportar `providers: unavailable (launcher ausente)` de forma legível;
3. **não** tentar escrever no vault;
4. reconciliar quando o Launcher voltar.

Isso é uma **degradação**, não um bug. Vai para a matriz de riscos (R-05).

### 6.4 Invariante do stdout

O Launcher spawna o Stage com `stdio` padrão (pipes). Quando o Launcher morre, o pipe quebra. O
Stage **não pode** cair por `EPIPE` ao escrever log. Requisitos:

- instalar handler de `error` em `process.stdout`/`process.stderr` no Stage main, ignorando
  `EPIPE`/`ERR_STREAM_DESTROYED`;
- o log durável é o **FileLogger** (`setupFileLogger`), não o stdout;
- o sinal de pronto deixa de ser **só** stdout: passa a existir também em `runtime.json`
  (`state: "running"`), para o caso de adoção sem pipe.

---

## 7. Encerramento seguro do Runtime

### 7.1 Sequência normativa

| # | Passo | Timeout | Falha ⇒ |
|---|---|---|---|
| 1 | Launcher envia `runtime.shutdown` ({reason}) | 5 s p/ resposta | passo 4 |
| 2 | Runtime: `app.quit()` → `before-quit` → `handleAppExit()` (hooks, `injeca.stop`, flush de logs) | 15 s (configurável) | passo 4 |
| 3 | Launcher observa `runtime.stopped` e o fechamento do pipe; confirma que o PID sumiu | 5 s | passo 4 |
| 4 | **Fallback único**: `taskkill /PID <pid> /T /F` | 10 s | estado `error` honesto |
| 5 | Rechecagem: PID sumiu? | 5 s | `error`, com o PID e o motivo no log |

- O passo **2 reutiliza** o caminho existente do Stage (`handleAppExit`, `index.ts:686-730`) —
  nada de segunda rotina de saída.
- `taskkill` deixa de ser **primeiro** gesto e passa a ser **quarto**.
- "Encerramento forçado" explícito do usuário pula 1–3 e vai direto ao 4, com confirmação.
- Ordem preservada do coordenador atual: o Stage sai antes de qualquer outro alvo.

### 7.2 Rota de recuperação

| Situação | Ação |
|---|---|
| Runtime travado (não responde ao handshake) | oferecer "parar à força" com PID e há quanto tempo está sem resposta |
| `taskkill` falhou | mostrar erro com código; **não** fingir que parou; sugerir Gerenciador de Tarefas |
| Registro aponta para PID morto | marcar `stale`, permitir iniciar novo Runtime |
| Dois registros / instância divergente | o mais recente vence após handshake; o outro é marcado `stale` |

### 7.3 Pausa

`runtime.pause` **não** encerra nada. Observáveis exigidos: animação parada, reprodução de áudio
pausada, presença oculta, tray indicando pausa, processo e credenciais intactos. Hoje só existe
`config.paused` da presença (`presence-service.ts:89`) — o resto é implementação nova no Stage,
**fora desta rodada**.

---

## 8. Casos de borda

| # | Caso | Comportamento exigido |
|---|---|---|
| E1 | Launcher fechado, Runtime vivo, usuário reabre o Launcher | adoção em ≤ 2 s; UI mostra "Lia em execução" e as ações de parada |
| E2 | Registro existe, PID vivo, mas é **outro** processo (PID reciclado) | handshake falha ⇒ `stale` ⇒ oferecer iniciar; **nunca** matar o PID alheio |
| E3 | Registro existe, ninguém escuta no pipe | `stale` após deadline; oferecer iniciar |
| E4 | Runtime morreu sem limpar o registro | detectar via handshake e/ou PID ausente; marcar `stale`; mostrar motivo se houver `exitReason` |
| E5 | Dois Launchers | `enforceSingleInstance` já impede; o segundo vira pedido de foco |
| E6 | Dois Runtimes | `installSingleInstanceGuard` no Stage impede o segundo (`single-instance.ts:45`) |
| E7 | Runtime iniciado **sem** Launcher (usuário abriu pelo atalho) | modo não gerenciado; registro escrito; Launcher pode adotar e passar a comandar |
| E8 | Launcher fecha durante um `runtime.shutdown` | o Runtime segue o encerramento; o Launcher que reabrir vê `stopping`/`stopped` |
| E9 | Usuário fecha a janela principal do Stage | comportamento atual: `window-all-closed` → sai; o registro é limpo |
| E10 | Disco cheio ao escrever `runtime.json` | Runtime continua; aviso; Launcher trata ausência de registro como "não gerenciado" |
| E11 | Registro corrompido (JSON inválido) | ignorar, renomear para `runtime.stale.json`, oferecer iniciar |
| E12 | Launcher e Runtime de **versões** diferentes | `negotiate()` recusa major diferente; UI pede atualização; nunca comandar às cegas |

---

## 9. Matriz de testes (sem Electron, sem Windows, onde possível)

Os testes de contrato rodam em Node puro, como os de `lia/core` (105 testes PASS em 16/11).

| ID | Teste | Tipo | Prova |
|---|---|---|---|
| T1 | `Lifecycle` recusa `ready` antes de `spawn`, aceita `running` só após `ready` | unitário | estado honesto |
| T2 | Registro é escrito atomicamente e lido de volta | unitário (`tmpdir`) | E1/E10 |
| T3 | Handshake completo com dois pares X25519 reais | unitário (`node:crypto`) | §5.4 |
| T4 | Tag do servidor inválida ⇒ cliente recusa | unitário | impede impostor |
| T5 | Replay de comando com `seq` repetido ⇒ conexão encerrada | unitário | anti-replay |
| T6 | Payload > 8 KiB ⇒ recusa | unitário | limite |
| T7 | `parseEnvelope` com lixo ⇒ `null`, sem exceção | unitário (já existe) | robustez |
| T8 | Registro stale (PID morto / pipe ausente / JSON inválido) ⇒ `stale` | unitário | E2/E3/E11 |
| T9 | Adoção não mata PID que não completou handshake | unitário | E2 |
| T10 | Sequência de parada: `shutdown` → espera → `kill` (ordem registrada) | unitário com `execFile` dublado | §7.1 |
| T11 | `shutdown` que não responde ⇒ `kill` uma vez ⇒ `error` se ainda vivo | unitário | §7.1/7.2 |
| T12 | Cache de credencial: libera após `shutdown`; não serve referência removida | unitário | §6.2 |
| T13 | Escrita local no Stage gerenciado é recusada | unitário | I-9 |
| T14 | `EPIPE` em `process.stdout` não encerra o processamento | unitário (stream) | §6.4 |
| T15 | Dois registros ⇒ o que completa handshake vence | unitário | §7.2 |
| **T16** | Janela real: fechar o Launcher mantém o Runtime; reabrir adota | **Windows, NÃO EXECUTADO** | E1 |
| **T17** | Sem órfãos após parada cooperativa e após `kill` | **Windows, NÃO EXECUTADO** | §7.1 |
| **T18** | `EPIPE` real ao fechar o Launcher com o Stage logando | **Windows, NÃO EXECUTADO** | §6.4 |

Nenhum teste marcado **NÃO EXECUTADO** pode ser relatado como PASS. Testes de contrato em Node
**não** substituem T16–T18.

---

## 10. Critérios de aceitação

| ID | Critério |
|---|---|
| AC-1 | Fechar o Launcher deixa o Runtime vivo e **controlável** (T16) |
| AC-2 | Reabrir adota o Runtime em ≤ 2 s e permite parar/pausar (T16) |
| AC-3 | Parada cooperativa conclui em < 15 s e chama os hooks (T17) |
| AC-4 | `taskkill` só aparece depois de `shutdown` + timeout (T10) |
| AC-5 | Zero órfãos em 10 s após parada normal e após forçada (T17) |
| AC-6 | Nenhuma mensagem do CCR contém segredo (revisão + teste de esquema) |
| AC-7 | Runtime não cai com `EPIPE` (T14/T18) |
| AC-8 | Credenciais continuam funcionando após fechar o Launcher (T12 + validação Windows) |
| AC-9 | Nenhum caminho novo escreve no vault a partir do Stage em modo gerenciado (T13) |
| AC-10 | Tudo acima atrás de flag, com rollback por restart |

---

## 11. O que esta especificação **não** autoriza

1. Implementar antes de D-01/D-04 terem sign-off.
2. Criar um segundo protocolo ou uma segunda máquina de estados (Q-01).
3. Alterar o caminho de áudio ou a branch de voz do Codex.
4. Trocar o Stage de host.
5. Reutilizar o *server channel* do AIRI como controle.
6. Confiar em PID como identidade.
7. Chamar `taskkill` como primeiro gesto.

---

## Anexo — Fonte primária sobre DACL de named pipe

Microsoft Learn, `CreateNamedPipeA` (§`lpSecurityAttributes`): se `NULL`, o pipe recebe a security
descriptor padrão, cujas ACLs "grant full control to the LocalSystem account, administrators, and
the creator owner" e "read access to members of the Everyone group and the anonymous account".
Consulta: 16/11/2026. É a base do §5.5.
