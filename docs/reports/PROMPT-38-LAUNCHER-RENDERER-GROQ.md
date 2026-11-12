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

## Resultado final

| Critério | Status | Observação |
| --- | --- | --- |
| Renderer abre sem reload manual | PASS | `lia-app.window-created` e `lia-app.renderer-ready` ocorreram no runtime real sem reset manual. |
| Groq real com ferramenta iniciada pelo Launcher | BLOCKED | A chave configurada no ambiente atual retornou `401 invalid_api_key`; a prova real do tool-call exige chave válida e configuração operacional correta. |

O trabalho preservado de OIDC e chat segue intacto; o que resta é apenas a configuração de um provedor Groq válido para fechar a validação do segundo gate.
