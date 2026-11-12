# PROMPT-40 — Validação Windows real do Launcher AI Settings

**Data:** 12/11/2026

**Resultado:** **BLOCKED** — a validação real do AI Settings aguarda interação
humana e uma chave Groq válida inserida diretamente na interface.

**Branch/HEAD após pull:** `arena/01a10290-lia-project` /
`224655291b59ee4eb99aa87eda73693d434a0b74`

## 1. Escopo e segurança

Esta rodada validou somente o início real do Launcher e o estado de prontidão do
Renderer. Nenhuma chave foi solicitada por chat, lida do ambiente, registrada,
ou enviada a um endpoint. Nenhum código do AI Settings foi alterado. O tool
calling do PROMPT-38 não foi testado nem aprovado.

## 2. Git e preservação

- Antes de sincronizar: branch correta, HEAD `a7fdb4550565d42e19d49eedb3075320085e3b84`,
  quatro commits atrás de `origin/arena/01a10290-lia-project`.
- Havia trabalho preexistente local, incluindo mudanças de OIDC/chat, documentos
  beta e arquivos novos. Nenhum desses arquivos foi descartado ou editado nesta
  validação.
- A primeira tentativa de `git pull --ff-only` foi abortada pelo Git porque o
  rascunho não rastreado
  `docs/product/LIA-LAUNCHER-AI-SETTINGS-PROPOSAL-2026-11-12.md` seria
  sobrescrito pelo arquivo remoto.
- O rascunho foi copiado e verificado por hash antes de ser movido para fora do
  caminho conflitante: `C:\Users\lucas\.copilot\session-state\11e73b87-8314-4fe7-8e71-ee08befe1fc2\files\PROMPT39-AI-SETTINGS-PROPOSAL-PRE-PULL.md`.
  A cópia preserva o conteúdo local pré-pull. A segunda tentativa de
  `git pull --ff-only` fez fast-forward sem conflitos até
  `224655291b59ee4eb99aa87eda73693d434a0b74`.
- As alterações locais preexistentes continuaram presentes depois do pull. A
  versão rastreada atual da proposta PROMPT-39 é a versão publicada no branch;
  o rascunho anterior permanece preservado no caminho acima.

## 3. Execução real do Launcher

**Comando:** `J:\Lia-Project\Lia.bat`
**Entrada:** a mesma documentada para desenvolvimento, `Lia.bat` → `pnpm dev:lia`.

Antes do lançamento havia um processo Node preexistente (PID 3944, pertencente
ao host de ferramentas) e nenhum processo Electron. Durante a sessão:

- build de `@lia/core` concluído com sucesso;
- build Main e preload concluído;
- Vite Renderer iniciou em `http://localhost:5173/`;
- janela Electron `Lia` (PID observado 19860) foi criada;
- Renderer reportou `lia-app.renderer-ready` em +1311 ms;
- janela foi fechada por mensagem de encerramento e saiu; o processo de
  desenvolvimento foi encerrado; nenhum dos PIDs Electron/Launcher da sessão
  permaneceu.

Trecho sanitizado dos logs de inicialização:

```text
[lia:boot] lia-app.start at +95ms
[lia:boot] lia-core.ready at +152ms
[lia:boot] lia-app.window-created at +483ms
[lia:boot] lia-app.renderer-ready at +1311ms
```

Esses marcadores provam inicialização e carregamento do Renderer, mas não
provam navegação para AI Settings nem ausência de erros no console do Renderer.
Não houve interação com credenciais ou tráfego ao serviço de IA.

## 4. Teste funcional — resultado individual

| # | Etapa | Resultado | Evidência/limite |
|---|---|---|---|
| 1 | Abrir o Launcher | **PASS** | `Lia.bat`; janela Electron intitulada `Lia`; Renderer pronto. |
| 2 | Abrir AI Settings | **BLOCKED** | Não foi possível interagir com a janela: Computer Use está desativado nesta sessão desassistida. |
| 3 | Cadastrar chave Groq válida | **BLOCKED** | Nenhuma chave foi fornecida nem inserida. O usuário deve digitá-la diretamente no campo protegido da tela, não no chat. |
| 4 | Testar conexão | **NOT RUN** | Depende da configuração pela interface e da chave válida. |
| 5 | Consultar catálogo de modelos | **NOT RUN** | Depende da interação com AI Settings e do serviço autenticado. |
| 6 | Selecionar `openai/gpt-oss-120b` | **NOT RUN** | Nenhuma seleção foi feita. |
| 7 | Salvar configuração | **NOT RUN** | Nenhuma alteração de configuração foi realizada. |
| 8 | Abrir Conversar e enviar mensagem real | **NOT RUN** | Não houve início do Stage nem requisição ao modelo. |
| 9 | Reabrir Launcher e verificar persistência | **NOT RUN** | Não houve configuração salva para reabrir. |

### Verificações adicionais

| Verificação | Resultado | Evidência/limite |
|---|---|---|
| Chave não reaparece após salvar | **NOT RUN** | Nenhuma chave foi inserida ou salva. |
| Estado de conexão apresentado corretamente | **NOT RUN** | AI Settings não foi aberto. |
| Provider/model efetivamente usado pelo Stage | **NOT RUN** | O Stage não foi iniciado. |
| Seleção persiste após reinício | **NOT RUN** | Não houve gravação de seleção. |
| Erros do Renderer | **NOT RUN** | Não foi possível inspecionar console ou estado visual. |
| Processos Electron órfãos | **PASS** | Após fechar a janela e encerrar o processo de desenvolvimento, os PIDs da sessão foram confirmados ausentes. |

## 5. Screenshot e fidelidade visual

**Screenshot do AI Settings: NOT CAPTURED.** Não existe caminho de imagem a
registrar. A ferramenta de interação com desktop não pôde ser habilitada nesta
sessão; `agent-browser` não está instalado e o Launcher não foi iniciado com
CDP. Portanto, não foi possível abrir AI Settings, obter sua imagem ou compará-la
com [`02-ai-resources.png`](../design/concepts/02-ai-resources.png).

A referência conceitual usa shell escuro, acentos magenta/violeta moderados,
cards e hierarquia de “Cérebro da Lia” com Percepção, Voz e Ferramentas. Isso
descreve a referência, não uma comparação visual do build PROMPT-39.

## 6. Intervenção necessária e conclusão

Para retomar os passos bloqueados:

1. Habilitar Computer Use na sessão com `/computer on` (a ferramenta informou
   que não poderia ser ativada enquanto esta execução estivesse desassistida).
2. Abrir novamente o Launcher pelo fluxo `Lia.bat` e acessar **IA & Recursos**.
3. Inserir uma chave Groq válida diretamente no campo de chave da interface.
   **Não enviar a chave por chat, arquivo, variável de ambiente ou log.**
4. Continuar os passos 4–9; registrar somente status, provider/modelId e logs
   sanitizados. Capturar screenshot somente depois de garantir que nenhum segredo
   esteja visível.

O PROMPT-39 não está validado funcionalmente nesta rodada. A inicialização
Electron passou, mas a conexão real, catálogo remoto, seleção, conversa e
persistência continuam sem prova. O PROMPT-38 permanece um gate independente;
nenhum resultado desta rodada altera seu estado.
