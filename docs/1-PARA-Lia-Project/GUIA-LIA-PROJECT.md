# Guia da sessão — Lia-Project (waifu)

Para a sessão que desenvolve `BloomRX/Lia-Project`.
Escrito em 18/10/2026, lendo a branch `arena/01a10290-lia-project` (`b739a7e26b`).

Duas partes, e elas são independentes:

- **Parte A — como trabalhar.** Ferramenta de obra. Não muda produto, não avança baseline.
- **Parte B — o que construir e por quê.** Arquitetura. Muda produto, exige rodada própria.

Nada aqui autoriza tocar em Persona, secrets, TTS runtime, fallback de chat, web/pocket ou
live model discovery. `DevKit.bat` da raiz não se altera. STOP AND REPORT em vez de contornar.

---

# PARTE A — Como a sessão deve trabalhar

## A0. Regra zero: descobrir qual rulebook está carregado

**Faça isto antes de qualquer outra coisa deste guia.**

Desde a v2.1.277 o Claude Code lê `AGENTS.md` sozinho — **mas só quando não existe nenhum
`CLAUDE.md` na pasta aberta nem em nenhuma pasta acima dela.** Havendo um, ele lê o
`CLAUDE.md` e **ignora** o `AGENTS.md`.

O layout deste repositório:

```
Lia-Project/
├── AGENTS.md          58 KB   MASTER AGENT PROMPT da Lia, 99 seções
└── airi/
    ├── CLAUDE.md      11 B    conteúdo: "@AGENTS.md"
    └── AGENTS.md      31 KB   regras do AIRI upstream
```

E o `CURRENT-STATE.md` diz: *"Prefixo de código — tudo sob `airi/`"*.

| Pasta aberta no editor | O que provavelmente é carregado |
|---|---|
| `Lia-Project/` | o master prompt da Lia · zero regras do AIRI |
| `Lia-Project/airi/` | o `AGENTS.md` do AIRI · **zero regras da Lia** |

Na segunda linha somem: falar pt-BR, nunca `git reset --hard`, nunca declarar PASS sem
executar, provider nunca hardcoded, STOP AND REPORT, ler o `CURRENT-STATE.md` primeiro.
Sem erro e sem aviso. E `airi/` é a pasta natural de abrir, porque é onde está o código.

**Verificação (10 segundos):** rode `/memory` com o editor aberto na raiz, depois em `airi/`.
Ele lista os arquivos de instrução carregados. Compare com a tabela.

**Conserto, se confirmado:** um `CLAUDE.md` em `airi/` que importe os dois níveis.

```
@../AGENTS.md
@AGENTS.md
```

Ou, se preferir explícito, o `/config` tem a opção **Project instructions** com o valor
`claude-md-and-agents-md`, que manda ler os dois. O arquivo é mais confiável que a config,
porque viaja no git e vale pra qualquer máquina.

> Isto é dedução da regra documentada + o layout dos arquivos. Não foi executado nesta
> máquina. O `/memory` confirma ou derruba.

## A1. O custo fixo de contexto, e como derrubá-lo

| Arquivo | Tamanho | Estimativa | Quando é lido |
|---|---|---|---|
| `AGENTS.md` | 57.964 B · 2.862 linhas · 99 seções | ~16.000 tokens | **toda mensagem** |
| `CURRENT-STATE.md` | 47.997 B · 783 linhas | ~13.000 tokens | começo de toda tarefa (ordem da seção 0) |

~29 mil tokens antes de abrir o primeiro arquivo de código. Numa janela de 200k, ~15%.

> Estimativa por caractere (~3,6 chars/token em pt-BR). Não medida com tokenizador.

As 99 seções não são a mesma coisa. Separe em três baldes:

### Balde 1 — `CLAUDE.md`, 1 página, sempre carregado

Só o que vale em **toda** mensagem:

- as regras permanentes (seção 6 do `CURRENT-STATE.md`);
- seções 2 (princípio mais importante), 76 (Git), 90 (never assume), 94 (não fazer);
- a fronteira git: **código em `airi/` não entra no `sync` do DevKit** (`devkit.json` tem
  `"ignore_dirs": ["airi"]`) — um subagente não sabe disso e vai produzir trabalho que não
  é commitado;
- um ponteiro para o `CURRENT-STATE.md`, não o conteúdo dele.

### Balde 2 — skills, `~100 tokens` no índice, corpo sob demanda

Uma skill por assunto, em `.claude/skills/<nome>/SKILL.md`. Candidatas diretas:

| Seções do `AGENTS.md` | Skill | `paths` sugerido |
|---|---|---|
| 20–28 (Voice, TTS, AllTalk, RVC, Voice Customization, Colab, STT, VAD, Barge-in) | `lia-voz` | caminhos de voz/áudio |
| 70 (Design System), 68–69 (acessibilidade, responsivo) | `lia-ui` | `**/*.vue`, `**/*.css` |
| 80 (Testing), 79 (definition of done) | `lia-testes` | `**/*.test.*`, `Tests/**` |
| 98 (i18n) | `lia-i18n` | arquivos de locale |
| 13 (Execution Profiles), 14–15 (hardware) | `lia-perfis` | — |
| 17–19 (OpenAI-compatible, Provider Routing, Task Router) | `lia-roteamento` | — |
| 59–62 (Diagnostics, Repair, Safe Mode, Crash Recovery) | `lia-recuperacao` | — |

A sessão que mexe em i18n deixa de pagar por RVC em toda mensagem. Com `paths`, a skill
nem entra no índice quando os arquivos daquele tipo não estão em jogo.

**Ganho estimado:** de ~16.000 tokens fixos por mensagem para ~2.000–3.000.

### Balde 3 — `memory-bank/`, consultado e não carregado

O conteúdo do `CURRENT-STATE.md`. Ele já é exatamente isso: estado, não narrativa — o
próprio arquivo diz isso na abertura. Só precisa parar de ser lido inteiro por ordem direta
da seção 0.

### Regras de execução deste balde

- **O `AGENTS.md` não é apagado.** Ele continua sendo a fonte. Só deixa de ser carregado
  inteiro a cada respiração. Mantenha-o como índice que aponta pras skills.
- **Frontmatter inválido = falha silenciosa.** YAML quebrado não dá erro: a skill
  simplesmente não aparece em `/skills`.
- `name` em minúsculas com hífen, idêntico ao nome da pasta. `description` em terceira
  pessoa dizendo **o que faz e quando usar** — descrição vaga é a causa nº 1 de skill que
  nunca dispara.
- **Profundidade exata de 1 nível.** `.claude/skills/SKILL.md` solto não é encontrado.
- **Skill só é descoberta na inicialização.** Criou ou editou? Reinicie o Claude Code.
- Regras críticas no **topo** do corpo: depois de autocompactação, só os primeiros ~5.000
  tokens de cada skill são reanexados.

## A2. As 28 skills do AIRI que ninguém está usando

`airi/.agents/skills/` tem 28 skills do upstream, com hash fixado em `skills-lock.json`:

`vue` · `vue-best-practices` · `vue-testing-best-practices` · `vueuse-functions` · `pinia` ·
`unocss` · `pnpm` · `tsdown` · `xsai` · `eventa` · `agent-browser` · `agent-browser-electron` ·
`create-pr` · `release-note-writer` · `enforce-rules-for-unocss` · `enforce-rules-for-vitest` ·
`simple-english` · `stage-tamagotchi-godot-csharp` · `upload-github-attachment` ·
os sete `use-vishot*` · `web-design-guidelines`.

É a stack exata do AIRI, escrita por quem mantém a stack. **O Claude Code não lê
`.agents/skills/`** — ele lê `.claude/skills/`. Então hoje elas estão no repositório e
nenhum agente as usa.

Conserto no Windows, sem admin e sem duplicar arquivo:

```
# 1) ANTES DE TUDO: ignorar, senão o Git commita tudo duplicado
Add-Content -Path "airi\.gitignore" -Value "`n# Espelho das skills para o Claude Code (junction, nao versionar)`n.claude/skills/"

# 2) o junction
New-Item -ItemType Junction -Path "airi\.claude\skills" -Target "airi\.agents\skills"

# 3) reiniciar o Claude Code e conferir
#    /skills
```

⚠ **O passo 1 é obrigatório e vem primeiro.** Nem o `.gitignore` da raiz nem o do `airi/`
ignoram `.claude/` hoje. O Git no Windows enxerga junction como pasta normal, e o DevKit
tem varredura de stage — você descobriria isso do jeito chato.

## A3. Os quatro subagents neste repositório

| Subagent | Para quê, aqui |
|---|---|
| `explore` | **Use sempre antes de abrir arquivo na conversa principal.** São 7.322 arquivos e um `pnpm-lock.yaml` de 1,3 MB. Haiku, só `Read/Grep/Glob`, devolve ≤20 linhas e nunca cola código. É a diferença entre gastar 200 e 20.000 tokens pra achar onde mexer. |
| `reviewer` | Roda `git diff` e devolve `[ALTO\|MEDIO\|BAIXO] arquivo:linha`, no máximo 10 itens. Combina com a regra de commits separados por responsabilidade. |
| `test-runner` | Pega o comando em `memory-bank/padroes.md`. Nunca conserta — só reporta `RESULTADO: N passaram, M falharam`. Casa direto com *"nunca declarar PASS sem ter executado"*. |
| `visual-qa` | Modelo separado que **só lê `captures/` e se recusa a ler código**. Responde `VEREDITO:` ou `NAO CONSIGO VER A IMAGEM`. Ver A4. |

O princípio por trás do `visual-qa` vem do godogen e vale repetir: **agente de código é
enviesado a favor do próprio output.** Quem escreveu não pode ser quem aprova. Por isso o
juiz visual é outro modelo, com outras ferramentas, sem acesso ao código.

## A4. `vishot` produz o print, `visual-qa` julga o print

A skill `use-vishot-for-airi` do upstream termina assim:

> *"Treat the capture as failed when it still shows a preset model, an import dialog, a
> blank stage, or a loading state. **Inspect every generated image.**"*

"Inspecione cada imagem gerada" — e hoje quem inspeciona é um humano, no olho.

O circuito completo:

```
vishot capture  →  .vishot/**/*.png  →  visual-qa  →  VEREDITO  →  devflow/report.py
```

O `tools/devflow/` já coleta evidência e imprime PASS/FAIL. Isso é **um passo a mais num
pipeline que já existe**, não um pipeline novo. O lugar natural é depois da coleta de
evidência e antes do veredito final, em `runner.py`.

Critério de reprovação que o `visual-qa` deve aplicar, tirado da própria skill: modelo
preset no lugar do importado, diálogo de import aberto, stage em branco, estado de loading.

## A5. Travas de verdade para as regras permanentes

A regra nº 2 do `CURRENT-STATE.md` proíbe `git reset --hard`, `restore`, `clean`, `stash`,
`rebase`, `--amend` e force push. Hoje ela existe **só como texto** — e texto o modelo pode
ignorar sob pressão.

Transforme em trava. Em `permissions`, a ordem é **deny → ask → allow**, e `deny` vence
sempre. Dois pontos que mordem:

- **Subagente não exibe prompt.** Um `ask` dentro de subagente vira negação na prática.
  Para subagente, use `deny` explícito, não `ask`.
- `tools` é allowlist: omitir `Write`/`Edit` já trava escrita. `Bash(git *)` é conceito de
  **permissions**, não de `tools` — não confunda os dois campos.

Segredo: a chave do gateway vai em `.claude/settings.local.json`, nunca no
`settings.json` versionado, e `.claude/` inteiro no `.gitignore`. Passe a varredura do
próprio DevKit depois.

## A6. O gateway na bancada

Na bancada (construir a Lia), o 9Router é indicado sem ressalva: multi-provider, barato,
já funciona. Ligação por ambiente, nada no repositório:

- `ANTHROPIC_BASE_URL` apontando pro gateway (o valor em uso tem sufixo `/v1` e funciona)
- `ANTHROPIC_AUTH_TOKEN` com a chave — tem precedência sobre `ANTHROPIC_API_KEY`
- `settings.json` **sobrescreve** o env do shell; se der conflito, é aí
- **Nunca** clicar "Sign in". **Não** usar o Claude Desktop (ele não lê `ANTHROPIC_BASE_URL`)

Verificação real de uso é o **dashboard → Usage**. Ignore o `/cost`: ele mostra preço de
tabela da Anthropic, que neste setup é ficção.

**Antes de tentar o gate visual, cheque o provider.** No canário de 18/10/2026 o `groq`
respondeu **503**, e o gate exige rota `groq` + `qwen/qwen3.8-27b`. Sem essa checagem você
gasta uma sessão debugando código que não está quebrado. Vale registrar a disponibilidade
do provider como **pré-condição declarada do gate** no `CURRENT-STATE.md`.

## A7. Onde o token vai embora, em ordem de impacto

1. **Subagente em vez de conversa principal** — 50 a 100× em tarefa de busca.
2. **Instrução curta** — é relida a cada mensagem; é o único custo que se multiplica.
3. **Perguntar à memória (~200 tokens) em vez de reler 10 arquivos (~20.000).**
4. **Sessão nova + handoff** quando o assunto muda.
5. **Cache de prefixo** — não mexer no começo do contexto à toa.

O gargalo aqui não é dinheiro, é **quota e qualidade**: contexto cheio é contexto burro.

---

# PARTE B — O que construir, e por quê

## B1. A Lia já é um agente na metade que roteia

As seções 16 a 19 (`LLM — O CÉREBRO`, `OPENAI-COMPATIBLE`, `PROVIDER ROUTING`,
`TASK ROUTER`) descrevem comportamento de agente, e o `CURRENT-STATE.md` mostra isso
rodando: turno de texto vai pro GPT-OSS, turno com imagem vai pro `groq`/`qwen`. Decisão
automática por tipo de tarefa é exatamente o que um agente faz.

**O que falta é a outra metade: conferir se deu certo.** Hoje a Lia age e responde. Não
existe uma etapa que pergunte *"o que eu disse que fiz, aconteceu mesmo?"*.

E aqui vai o limite, que é importante:

> **Conversa não é tarefa.** O que faz o setup de desenvolvimento funcionar — subagente que
> devolve 20 linhas e some — é economia de contexto para tarefa técnica longa. Aplicado ao
> papo da Lia, isso a deixa lenta e fria.

A disciplina de agente entra **só onde ela age**: ver a tela, mexer no mouse, operar um
app, gravar memória. Aí "funcionou?" é obrigatório. No papo, não.

## B2. O launcher é um contrato de capacidade — e esse é o risco principal

O launcher deixa o usuário montar a Lia que quiser: completa, só texto, estática sem
personagem, e combinações no meio. Isso significa que **cada instalação é uma Lia
diferente**, e o cérebro não pode presumir nada.

O modo de falhar é concreto e vai acontecer: a Lia com voz desligada tenta falar; a Lia sem
personagem renderizada tenta "andar pela tela"; a Lia só-texto promete olhar um print. O
resultado não é um erro limpo — é a Lia **dizendo que fez** algo que o perfil dela não
permite. Que é exatamente o tipo de mentira plausível que o resto do projeto combate.

Você já tem os pedaços: seções 13 (`EXECUTION PROFILES`), 14 (`HARDWARE AGNOSTIC`) e 15
(`HARDWARE DETECTION`). O que falta é a ponte entre o perfil e o cérebro.

**Proposta — o perfil vira um contrato, não uma configuração:**

1. O launcher grava a lista de capacidades **ligadas** (`voz`, `stt`, `avatar`, `visao_de_tela`,
   `controle_de_mouse`, `memoria_longa`, …), com a origem de cada estado: escolha do
   usuário, hardware ausente, dependência faltando.
2. O cérebro recebe **só** as capacidades ligadas, na montagem do prompt. Capacidade
   desligada não existe — não é mencionada e não é oferecida.
3. Capacidade pedida e ausente tem **uma** resposta possível: dizer que está desligada e
   onde ligar. Nunca tentar, nunca simular, nunca descrever como se tivesse feito.
4. O launcher mostra o perfil resultante em linguagem de gente antes de abrir a Lia
   (*"esta Lia fala, não escuta e não vê a tela"*). Isso é o `grandma test` da seção 3.

Curiosamente, a regra que você precisa aqui **já está escrita no Lia Studio**, no
`AI-AGENTS-ARCHITECTURE.md` §15:

> *"Se não houver capacidade suficiente, a tarefa deve parar ou solicitar intervenção, em
> vez de inventar uma ferramenta."*

É a mesma regra. Vale nos dois produtos.

## B3. 9Router: suporte o formato, não o produto

A recomendação é dividida, e a divisão importa:

| Onde | Veredito |
|---|---|
| Bancada — construir a Lia | **Sim, sem ressalva** |
| Dentro do produto Lia | **Não como dependência** |

Três motivos pra não embarcar:

1. **Versão 0.5.** Projeto de terceiro, pré-1.0 — a forma pode mudar a qualquer momento.
2. **Grandma test.** Se pra usar a Lia a pessoa precisa instalar e configurar um roteador
   separado, você perdeu o público que a seção 3 define.
3. **Sua própria regra.** Provider e model nunca hardcoded; `lia-product.json` é a única
   autoridade de produto. Um roteador de terceiro embutido fura isso.

**Mas existe a saída boa, e metade dela já existe:** a seção 17 chama-se
`OPENAI-COMPATIBLE`. O 9Router fala exatamente essa língua.

> **Não cole o adaptador no aparelho. Faça o aparelho aceitar qualquer tomada.**

Se a Lia aceitar um **endereço de servidor digitado pelo usuário** — com teste de conexão e
listagem dos modelos que aquele endereço anuncia — então:

- o 9Router funciona, **sem uma linha de código dedicada a ele**;
- qualquer outro gateway compatível também funciona;
- o usuário leigo nunca vê esse campo e não é afetado;
- você não herda dependência nenhuma.

Isso também atende "nuvem ou local" sem esforço extra: endereço é endereço. O que **não**
pode é `localhost` fixo no código — se a Lia rodar em outro lugar que não a máquina do
modelo, `localhost` deixa de existir.

## B4. Se a Lia for comandar o Lia Studio

O desenho que você descreveu é: o usuário pede pra Lia, a Lia usa o Studio, o Studio usa o
agente de código. Três níveis de delegação.

```
Usuário → Lia (coordenadora) → Studio (líder) → agente de código (trabalhador)
```

Dois fatos que ajudam: o `AI-AGENTS-ARCHITECTURE.md` §4.7 já exige **limite de profundidade**
e dá exatamente esse exemplo de três níveis. E a profundidade documentada de subagentes do
próprio Claude Code também é 3. Os números batem — não é coincidência, é o limite prático
onde a cadeia ainda é auditável.

**O risco real é lavagem de permissão**, e ele é sutil:

> O usuário confia na Lia porque ela é a companheira dele. Essa confiança **não pode virar
> permissão de escrita em disco** porque a frase passou por três camadas.

Regras mínimas, se essa ponte for construída:

1. **Consentimento de conversa ≠ consentimento de execução.** Falar com a Lia nunca
   autoriza, sozinho, gravar arquivo, rodar comando ou publicar.
2. A autorização pertence ao **Studio**, não à Lia. Ela pede; quem concede é o dono do
   projeto, na interface do Studio, com o escopo à vista.
3. **A cadeia inteira aparece no pedido.** *"A Lia está pedindo, em seu nome, que o Studio
   altere `X` no projeto `Y`"* — nunca um pedido anônimo.
4. O `LIA-PROJECT-INTEGRATION.md` já manda **não** enviar toda a memória de convivência pros
   agentes. Vale a volta também: o que acontece no projeto de jogo não precisa virar memória
   de convivência.
5. Se a ponte cair, os dois continuam funcionando sozinhos. Já é a regra final do seu doc.

## B5. O gate visual, com dois ajustes

O roteiro da seção 5 do `CURRENT-STATE.md` está certo no princípio — pede resposta correta
sobre o conteúdo da imagem, *"não uma resposta genérica plausível"*. Dois ajustes:

**(a) "cor dominante" é o exemplo mais fraco dos três.** Um modelo **sem** visão acerta cor
dominante por chute plausível com frequência alta — e o teste precisa ser falsificável, ou
ele aprova um cego. Texto legível e contagem exata são bem mais duros.

Sugestão concreta, já validada como legível: PNG pequeno com um número de **4 dígitos**
renderizado grande, e aprovação só se a resposta contiver os 4 dígitos exatos. Gere o número
aleatoriamente a cada execução — número fixo acaba memorizado pelo repositório.

**(b) A disponibilidade do provider vira pré-condição declarada do gate.** Ver A6.

---

## O que não foi verificado

- **Nada foi executado nesta máquina.** Tudo é leitura de código e documentação.
- **A precedência `CLAUDE.md` × `AGENTS.md` (A0)** é dedução da regra documentada mais o
  layout dos arquivos. O `/memory` resolve em 10 segundos.
- **As contagens de token são estimativas** por caractere, não medidas com tokenizador.
- **`groq` em 503** é o canário de 18/10/2026. Pode ter voltado.
- **O tier de visão segue sem prova** de que algum modelo enxerga de fato.
- **Não foram lidos os 7.175 arquivos dentro de `airi/`.** Foram lidos: a árvore completa,
  o `AGENTS.md`, o `CURRENT-STATE.md`, o `DEVFLOW.md`, o `README`, o `skills-lock.json`, o
  `devkit.json` e as skills do upstream.
