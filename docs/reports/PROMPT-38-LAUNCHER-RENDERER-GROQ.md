# PROMPT-38 — Validação runtime do Launcher e do fluxo Groq

Validação em 12/11/2026 no ambiente atual, branch `arena/01a10290-lia-project`, preservando o trabalho local de OIDC e chat já validado em PROMPT-37.

## Estado do escopo

A investigação foi continuada a partir do estado da branch sem repetir a análise do diagnóstico do 429 de chat do Groq. O objetivo foi confirmar exclusivamente os dois critérios funcionais ainda não provados:

1. a abertura do Renderer sem reload manual;
2. a chamada real de ferramenta pelo Groq, iniciada pelo Launcher, com execução local e retorno ao modelo e ao chat.

## 1) Renderer: abertura sem reload manual

### Evidência executada

Comando executado no ambiente local:

```powershell
cd J:\Lia-Project\airi
pnpm -F @lia/core build && electron-vite dev
```

### Evidência observada

Saída relevante do runtime do Launcher/Stage:

```text
[lia:boot] lia-app.start at +90ms
[lia] single instance lock acquired - this process is the supervisor
[lia:boot] lia-core.ready at +145ms
[lia:boot] lia-app.window-created at +511ms
[lia:boot] lia-app.renderer-ready at +2135ms
```

O processo levantou a janela principal e chegou a `lia-app.renderer-ready` sem erro de carregamento do Renderer, sem ciclo de reload manual e sem qualquer indicação de falha de inicialização do child process.

### Conclusão

- Status: PASS
- Prova: abertura do Renderer concluída no runtime real do Launcher, sem necessidade de reload manual.

## 2) Groq: chamada real de ferramenta iniciada pelo Launcher

### Evidência executada

Verificação do provedor em tempo real com a chave configurada no ambiente atual:

```powershell
node -e "const key = process.env.GROQ_API_KEY; if(!key) throw new Error('missing'); fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+key}}).then(async r=>{console.log('status=' + r.status); const t = await r.text(); console.log(t.slice(0,600));}).catch(e=>{console.error(e); process.exit(1);});"
```

### Evidência observada

Resposta real do provedor:

```text
status=401
{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}
```

Também foi executada a rota real do Launcher via `createAiConnectionService()` com a chave em ambiente. O serviço gravou a configuração e tentou a sondagem, mas a operação retornou `probe: { ok: false, code: 'http' }` e a resposta do endpoint confirmou `401 invalid_api_key`.

### Conclusão

- Status: BLOQUEADO POR CONFIGURAÇÃO
- O ambiente atual não possui uma chave Groq válida nem uma configuração operacional que permita confirmar a ida e volta real de ferramenta do Launcher.
- Sem uma chave válida do cliente e sem a configuração correta do perfil/provedor, não é possível provar o segundo critério funcional de forma real.

## O que falta para concluir a prova

1. Inserir uma chave Groq válida no ambiente do usuário ou no perfil de configuração do produto que o Launcher usa.
2. Reiniciar o Launcher (ou reabrir a sessão do processo) para que a credencial resolvida e a seleção do provedor sejam reaproveitadas.
3. Reexecutar o fluxo do Launcher/Stage com o modelo Groq configurado e confirmar:
   - discovery do catálogo real;
   - teste de conexão com ferramenta `lia_connection_check`;
   - execução local da ferramenta;
   - retorno do resultado ao modelo;
   - entrega visível no chat.

## Diagnóstico operacional atual (sem expor segredos)

A investigação real do Launcher confirmou que o bloqueio não é de renderização nem de arquitetura do tool call em si: o ambiente *possui* uma variável `GROQ_API_KEY` ativa, mas a chave em uso falha em autenticação real do provedor (`401 invalid_api_key`). O mesmo padrão foi observado na rota negociada pelo Launcher e no endpoint público do Groq (`GET /v1/models`).

Também foi verificado que o diretório de dados do produto esperado pelo Launcher (`C:\Users\lucas\AppData\Roaming\Lia`) não contém `lia-product.json` nem `lia-secrets.json`. O código do Launcher resolve o home canônico via `LIA_USER_DATA` / `APP_USER_DATA_PATH` / `%APPDATA%\Lia` (`lia-product-paths.ts`), então o runtime atual está em um estado em que a chave ativa é inválida e a configuração persistida do produto não foi materializada no diretório canônico.

### Intervenção humana necessária

1. Substituir a chave Groq inválida pela chave válida do cliente na mesma sessão/ambiente em que o Launcher é executado.
2. Certificar que a chave seja carregada pelo processo principal do Launcher e que o user-data do produto fique no diretório correto (`LIA_USER_DATA` ou `%APPDATA%\Lia` quando não houver override explícito).
3. Reabrir o Launcher para reaproveitar a configuração e o cofre secreto do processo principal.
4. Reexecutar o fluxo com o provedor Groq configurado e validar o ciclo completo sem expor a chave:
   - descoberta do catálogo do provedor;
   - teste de conexão com a tool `lia_connection_check`;
   - execução local da ferramenta;
   - retorno do resultado ao modelo;
   - resposta final visível no chat;
   - registro no histórico.

### Verificação segura sem segredo

A validação correta é:

- `status` do endpoint real em `https://api.groq.com/openai/v1/models` deve ser `200` e a resposta deve conter um array `data` de modelos;
- o Launcher deve emitir `probe: { ok: true }` no fluxo de conexão;
- o histórico do chat deve incluir a ferramenta executada e a resposta final do modelo.

Não existe sinal de bypass de autenticação nem de chave inventada: o código e o runtime corretamente rejeitaram a chave inválida e exigem um segredo válido do cliente para fechar a prova real do tool call.

## Resultado final

| Critério | Status | Observação |
| --- | --- | --- |
| Renderer abre sem reload manual | PASS | `lia-app.window-created` e `lia-app.renderer-ready` ocorreram no runtime real sem reset manual. |
| Groq real com ferramenta iniciada pelo Launcher | BLOCKED | A chave ativa no ambiente atual falhou em `401 invalid_api_key`, e o user-data canônico do produto não foi encontrado no diretório esperado. A prova real do tool-call exige uma chave Groq válida e a configuração persistida no mesmo runtime do Launcher. |

O trabalho preservado de OIDC e chat segue intacto; o que resta é apenas a substituição da chave Groq inválida e a reexecução do fluxo real do Launcher para fechar o segundo gate.
