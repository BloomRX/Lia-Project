# Proposta — AI Settings do Launcher (PROMPT-39)

**Data:** 12/11/2026
**Status:** aprovada para o MVP; escopo delimitado pelas três decisões abaixo.
**Objetivo:** tornar o Launcher a primeira central de configuração de IA realmente
utilizável — não uma tela demonstrativa. O Groq é o primeiro caso completo.

## 1. Problema

O Launcher já tinha uma tela de conexão única (endereço, chave, modelos, teste), mas ela
não representava o produto:

- não listava os provedores que o produto suporta nem distinguia os que ainda não têm
  cadeia completa;
- não deixava explícito qual provider do Stage e qual engine do Brain a seleção alimenta;
- não separava identidade de definição, conexão, provedor de execução, engine e modelo;
- não tinha uma regra de segurança de endpoint verificável no Main;
- não provava a recuperação da seleção depois de reabrir o Launcher.

## 2. Decisão 1 — uma conexão por provedor lógico

No MVP, cada provedor lógico tem **uma única conexão**, persistida no registro de
transporte existente (`lia-transports.json`). Os identificadores são separados por
contrato e nunca inferidos por igualdade de string na UI:

| Campo | Significado | Groq (hoje) |
| --- | --- | --- |
| `definitionId` | identidade de produto da entrada do catálogo | `groq` |
| `connectionId` | id do registro de transporte | `groq` |
| `stageProviderId` | provider de execução conhecido pelo Stage | `groq` |
| `engineId` | engine de roteamento conhecido pelo Brain | `groq` |
| `credentialRef` | par `{ scope, key }` do vault | `{ scope: 'groq', key: 'apiKey' }` |
| `modelId` | modelo escolhido, gravado no registro e na seleção canônica | `openai/gpt-oss-120b` |

O mapeamento `engineId → providerId` é uma **tabela auditada** no Stage
(`LIA_BRAIN_ENGINE_PROVIDER_MAPPING`), não uma regra de igualdade. O Brain e o Stage
consomem a seleção salva em `provider.chat.preferred`; **não** existe uma segunda seleção
concorrente em `brain.*`. `brain.mode = 'automatic'` continua sendo o modo materializado
pelo Launcher para o roteamento normal.

Consequências aceitas:

- trocar de provedor no MVP significa trocar a conexão daquele provedor, não manter
  várias conexões simultâneas;
- múltiplas conexões por provider ficam explicitamente fora de escopo.

## 3. Decisão 2 — reutilizar os adapters existentes

Nenhum protocolo novo foi criado. A resolução completa precisa existir de ponta a ponta:

`Launcher (catálogo + vault + config) → registro de transporte → provider do Stage →
engine/adapter do Brain`.

- O Groq usa o adapter que o Brain já tem (`brain/adapters/groq.ts`) e o provider de chat
  que o Stage já conhece (`groq`). A igualdade dos ids é um fato auditado, com teste.
- O provedor genérico **OpenAI-compatível** aparece no catálogo apenas para transparência:
  fica `unavailable` e **nunca selecionável** enquanto a resolução completa até o Stage
  não estiver implementada e testada.
- Um protocolo novo só entra com adapter registrado e testado; o MVP não cria um sistema
  universal de adapters.

## 4. Decisão 3 — segurança conservadora de endpoints

A política é aplicada no **Main**, não na UI, e vale para salvar, descobrir modelos e
testar:

1. **HTTPS** em qualquer host; **HTTP** somente em loopback (`localhost`, `127.0.0.1`,
   `::1`).
2. URL sem usuário, senha, query ou fragmento — nada de credencial escondida na URL.
3. Nenhum redirecionamento automático: toda requisição usa `redirect: 'error'`.
4. Mudança de host exige **confirmação explícita** (`confirmHostChange`) **e** uma
   credencial nova na mesma gravação. Uma chave guardada nunca é encaminhada para outro
   host; mudar o caminho no mesmo host também exige a chave.
5. Limites de rede: timeout de 30 s e corpo de resposta de até 1 MB.
6. Segredos só no vault existente. O Renderer recebe `hasKey`, nunca a chave; o envelope
   de gravação é copiado antes de entrar na fila e o campo é limpo depois do save.
7. Falha de gravação é *fail-closed*: o registro fica `enabled: false` antes de trocar
   credencial/seleção e só volta a `true` no sucesso; rollback restaura chave, seleção e
   registro quando possível.

## 5. Arquitetura entregue

**Main/Core — autoridade única**

- `lia/core/src/providers/catalog.ts`: catálogo das definições (Groq `ready`;
  OpenAI-compatível `unavailable` com motivo), lookups por definição, Stage e engine.
- `airi/apps/lia-app/src/main/ai-connection-service.ts`: catálogo exposto sem segredos,
  `read`, `save`, `discover`, `probe`, `isSafeToStart`. Toda validação, escrita de vault,
  gravação do transporte e seleção canônica acontece aqui.
- `ipc.ts` / `preload/index.ts`: superfície tipada mínima, sempre com `providerId`.

**Renderer — somente dados não secretos e resultados tipados**

- Lista os provedores do catálogo, mostra os indisponíveis com o motivo e desabilita a
  configuração.
- Permite cadastrar/trocar a chave, testar a conexão, descobrir modelos, escolher da lista
  ou digitar o `modelId` manualmente, salvar e reabrir com a seleção recuperada.

## 6. Escopo do MVP e não-objetivos

Dentro do MVP: listar provedores; cadastrar/editar API key; persistir no vault; testar
conexão; descobrir modelos; `modelId` manual; selecionar modelo; salvar em
`provider.chat.preferred`; recuperar a seleção ao reabrir.

Fora de escopo (não implementar nesta rodada): download de pesos, Model Manager,
benchmark automático de hardware, múltiplas conexões por provider, roteamento avançado por
função, sistema universal de adapters, novos runtimes locais, segunda seleção em `brain.*`.

## 7. Critério de aceite

Automatizado: catálogo sem segredos; Groq resolvendo até o adapter do Brain; genérico nunca
selecionável; CRUD de chave sem retorno do segredo; 401 → `http`; descoberta e persistência
após restart; `modelId` manual validado; confirmação de host; integração
produto → Brain → mapeamento → transporte; testes de interlock preservados.

Runtime (Windows real, 9 passos — **não executado neste ambiente**):

1. abrir o Launcher;
2. cadastrar uma chave Groq válida;
3. testar a conexão;
4. consultar os modelos;
5. selecionar `openai/gpt-oss-120b`;
6. salvar;
7. abrir "Conversar com Lia";
8. enviar uma mensagem e receber resposta;
9. reabrir a conversa e confirmar a persistência.

A sonda de conexão **não** substitui a conversa real. O tool calling do PROMPT-38 continua
sendo um gate independente.
