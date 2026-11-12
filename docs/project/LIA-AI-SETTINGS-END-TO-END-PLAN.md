# AI Settings — plano end-to-end (Launcher)

**Criado:** 12/11/2026
**Estado:** plano de execução. A implementação do PROMPT-39 está publicada; a validação
funcional está **BLOCKED** desde o PROMPT-40. Nada aqui autoriza cadastrar credenciais fora
da interface nem ampliar providers.

Documentos de referência:

- [Proposta e decisões aprovadas](../product/LIA-LAUNCHER-AI-SETTINGS-PROPOSAL-2026-11-12.md)
- [Relatório de implementação PROMPT-39](../reports/PROMPT-39-LAUNCHER-AI-SETTINGS.md)
- [Validação Windows PROMPT-40](../reports/PROMPT-40-WINDOWS-AI-SETTINGS-VALIDATION.md)
- [Decisão de arquitetura de runtime](../reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md)

---

## 1. O que já existe (não reconstruir)

| Camada | Implementação | Prova automatizada |
|---|---|---|
| Catálogo de providers | `lia/core/src/providers/catalog.ts` | `lia/core/test/providers-catalog.test.ts` (5) |
| Serviço Main | `airi/apps/lia-app/src/main/ai-connection-service.ts` | 24 testes, incluindo catálogo sem segredo, rollback, host e integração Brain |
| IPC/preload | `lia:ai:providers`, `:get`, `:save`, `:models`, `:test` | indireta (testes do host) |
| UI | `AiResourcesView.vue` + teste estático (7 garantias) | `ai-resources-view.test.ts` |
| Provider → Stage → Brain | `provider.chat.preferred` + `LIA_BRAIN_ENGINE_PROVIDER_MAPPING` | teste de integração no serviço |

Não repetir PROMPT-39 nem reabrir a proposta sem uma divergência reproduzida.

## 2. O que falta provar (gate real)

| # | Passo | Estado (12/11) | Evidência exigida |
|---|---|---|---|
| 1 | Abrir o Launcher | **PASS** (PROMPT-40) | `lia-app.renderer-ready` + janela |
| 2 | Abrir AI Settings | **BLOCKED** | interação real; screenshot sanitizado |
| 3 | Confirmar provider Groq | NOT RUN | tela com Groq `ready` e OpenAI-compatível indisponível |
| 4 | Cadastrar/substituir a chave | NOT RUN | campo mascarado; chave digitada na UI, nunca no chat |
| 5 | Testar conexão | NOT RUN | resultado tipado; nenhuma chave no log |
| 6 | Descobrir modelos | NOT RUN | lista do serviço com `openai/gpt-oss-120b` |
| 7 | Selecionar `openai/gpt-oss-120b` | NOT RUN | seleção visível e salva |
| 8 | Salvar | NOT RUN | `provider.chat.preferred` íntegro no config |
| 9 | Fechar e reabrir o Launcher | NOT RUN | seleção restaurada na tela |
| 10 | Confirmar que a Lia usa a seleção | NOT RUN | rota do Brain/Stage = Groq/`openai/gpt-oss-120b` |
| 11 | Iniciar conversa real | NOT RUN | Stage sobe pela seleção |
| 12 | Confirmar resposta | NOT RUN | resposta real do modelo |
| 13 | Fechar e reabrir a conversa | NOT RUN | histórico preservado |
| 14 | Confirmar histórico | NOT RUN | a resposta anterior aparece |
| 15 | Encerrar a aplicação | NOT RUN | saída limpa |
| 16 | Confirmar ausência de órfãos | **PASS** (PROMPT-40) | lista de PIDs vazia |

Complementos obrigatórios:

- chave não reaparece depois de salvar; troca de host exige confirmação + chave nova;
- erro de rede/HTTP aparece como mensagem tipada, não como exceção crua;
- screenshot do AI Settings comparável ao concept `02-ai-resources.png` (Etapa 4).

## 3. Pré-requisitos

1. Sessão Windows com interação de desktop habilitada (Computer Use) **ou** Launcher
   iniciado com CDP e automação segura instalada. Se nenhum existir, o passo é BLOCKED — não
   simular.
2. Chave Groq válida digitada **diretamente no campo da interface**. Nunca por chat,
   arquivo, variável de ambiente ou log.
3. Build atual: `Lia.bat` → `pnpm dev:lia` (ou pacote), com `@lia/core` buildado.
4. `%APPDATA%\Lia` materializado com `lia-product.json`/`lia-secrets.json` (o PROMPT-38
   registrou ausência desse diretório no ambiente anterior).

## 4. Verificação de identidade do provider (antes do teste funcional)

| Pergunta | Como verificar |
|---|---|
| O `definitionId` selecionado é o mesmo do registro? | `read()` devolve `definitionId`, `connectionId`, `stageProviderId`, `engineId` |
| O Stage consome esse provider? | log de resolução de rota do Brain + transporte do Stage |
| O adapter do Brain existe para o `engineId`? | catálogo × `LIA_BRAIN_ENGINE_PROVIDER_MAPPING` (teste já cobre) |
| O modelo salvo é o enviado? | request real ao endpoint; conferir `model` no log sanitizado |
| Algum caminho usa `GROQ_API_KEY` em paralelo? | busca no código e no ambiente; a chave deve vir do vault |

Atenção registrada no plano mestre: `definitionId` **não** seleciona adapter por si só. O
genérico OpenAI-compatível continua indisponível até existir resolução completa até o Stage.

## 5. Critérios de saída

- Passos 1–16 com resultado individual (PASS/FAIL/BLOCKED/NOT RUN), sem agregar.
- Screenshot sanitizado + trecho de log sem segredo.
- `CURRENT-STATE.md` atualizado com o resultado real.
- Se qualquer passo falhar: registrar a causa e corrigir **antes** de ampliar providers.
- PROMPT-38 (tool calling) permanece gate independente: aprovar AI Settings não o aprova.

## 6. Fora de escopo

Múltiplas conexões por provider, OpenAI-compatível selecionável, roteamento por função,
model manager, download de pesos, benchmark de hardware, novos runtimes locais.
