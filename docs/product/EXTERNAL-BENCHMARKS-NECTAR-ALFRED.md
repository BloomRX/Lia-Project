# LIA — Benchmarks externos: Néctar e ALFRED

**Data do registro:** 2026-10-09  
**Status:** referência de produto/arquitetura — não é especificação nem autorização de implementação.

Este documento registra duas referências externas levantadas durante o desenvolvimento da Lia:

- Néctar — https://www.meu-nectar.com/
- ALFRED — https://alfredcursos.com.br/

O objetivo é preservar ideias úteis para o roadmap sem transformar nenhum dos produtos em modelo a ser copiado. A identidade, UX, arquitetura e prioridades continuam pertencendo à Lia.

---

## 1. Regra de uso deste benchmark

Estas referências servem para:

- identificar padrões de UX e capacidades que podem fortalecer a Lia;
- comparar o roadmap existente com produtos reais;
- gerar perguntas de produto para fases futuras;
- evitar redescobrir ideias já observadas.

Elas **não** significam:

- copiar interface, marca, conteúdo, código ou assets;
- importar código de terceiros sem revisão de licença;
- alterar automaticamente o roadmap;
- abrir nova implementação antes de fechar o gate corrente;
- transformar a Lia em um clone de outro assistente.

Antes de qualquer uso de código, asset, SDK ou material de terceiros, revalidar licença/termos e a compatibilidade com a distribuição da Lia.

---

## 2. Néctar — principal valor como benchmark

O Néctar é especialmente relevante como referência de **continuidade pessoal, proatividade e UX de assistente que acompanha a vida do usuário**.

Na análise de 2026-10-09, o material público do produto destacava:

- conversa por voz e texto;
- contexto/memória para reduzir repetição;
- tarefas, projetos, hábitos, metas, lembretes e finanças;
- uma única mensagem gerando várias ações estruturadas;
- automações recorrentes;
- avisos proativos;
- widgets e notificações;
- integração de diferentes áreas e fontes de contexto;
- presença em mais de uma superfície/dispositivo.

### Ideias que podem agregar à Lia

#### 2.1 Persistent Personal Context

O padrão interessante não é armazenar tudo, e sim permitir que informação útil sobreviva entre conversas para que a pessoa não precise reexplicar:

- preferências;
- projetos;
- rotinas;
- compromissos;
- objetivos;
- contexto recente relevante.

Para a Lia, isso deve permanecer separado de Persona: **quem a Lia é** e **o que ela sabe sobre o usuário** são domínios diferentes.

#### 2.2 Proactive Companion

O Néctar demonstra bem a diferença entre:

- responder quando chamado;
- acompanhar condições e chamar o usuário quando algo relevante acontece.

Possível direção futura da Lia:

```
estado/evento
    ↓
regra ou condição autorizada
    ↓
contexto da Lia
    ↓
decisão
    ↓
notificação / fala / ação
```

A proatividade deve ser opt-in, controlável e não intrusiva.

#### 2.3 Natural multi-action commands

Referência de UX:

> um pedido natural pode virar várias ações estruturadas.

Exemplo conceitual para a Lia:

```
"Lia, organiza isso, abre o documento e me lembra amanhã."
          ↓
       planejar
          ↓
 ┌────────┼─────────┐
 arquivo  ação   lembrete
```

Isso se relaciona diretamente ao futuro Tool Registry e à orchestration, mas não deve ser implementado como parsing ad-hoc de frases.

#### 2.4 Presence beyond the chat

Widgets, notificações e superfícies persistentes reforçam uma ideia importante para a Lia:

**a companion não deve existir apenas dentro de uma caixa de chat.**

Na Lia, essa ideia pode se combinar com avatar, voz e Presence Modes em vez de reproduzir os mesmos widgets do Néctar.

---

## 3. ALFRED — principal valor como benchmark

O ALFRED é especialmente relevante como referência de **agente que percebe o computador e executa ações**.

Na análise inicial do produto foram observadas referências a capacidades como:

- percepção via câmera;
- análise da tela do computador;
- leitura de arquivos/documentos;
- interação por voz;
- escrita/ação em outros aplicativos;
- memória/contexto persistente;
- automação do computador.

Esses itens devem ser revalidados no produto/termos antes de qualquer decisão que dependa de detalhe comercial ou técnico específico.

### Ideias que podem agregar à Lia

#### 3.1 Perception Loop

O padrão arquitetural útil é:

```
capturar
   ↓
normalizar percepção
   ↓
Capability Router
   ↓
Brain elegível
   ↓
interpretação
```

Entradas futuras da Lia podem incluir:

- microfone;
- screenshot;
- window capture;
- câmera/vídeo quando autorizado.

Isso se alinha diretamente com **8.0E — Perception Foundation**.

#### 3.2 Action Loop

O benchmark mais interessante do ALFRED não é apenas “ver a tela”, e sim a cadeia:

```
perceber
   ↓
entender
   ↓
decidir
   ↓
usar ferramenta
   ↓
observar resultado
   ↓
continuar ou parar
```

Para a Lia, isso deve respeitar:

- permissões explícitas;
- escopo mínimo;
- auditabilidade;
- possibilidade de cancelar;
- nenhuma ação escondida;
- separação entre percepção e ferramenta.

Isso se conecta principalmente com **8.0F — Tool Registry**.

#### 3.3 Screen-aware assistance

Um futuro gate de produto valioso para a Lia:

> “Lia, olha minha tela e me ajuda com isso.”

Mas “olhar” não deve significar acesso contínuo e irrestrito. A experiência precisa tornar visível:

- quando a Lia está capturando;
- o que está sendo capturado;
- por quanto tempo;
- para qual finalidade;
- como interromper.

---

## 4. Relação com o roadmap atual

| Benchmark / ideia | Relação com Lia | Estado hoje |
| --- | --- | --- |
| conversa por voz | Voice/STT/TTS | já validado em Windows |
| imagem anexada entendida pelo Brain | 8.0D multimodal | implementação landed; gate Windows pendente |
| screenshot / window capture | 8.0E Perception Foundation | roadmap |
| câmera | 8.0E Perception Foundation | futuro / não iniciado |
| action loop no computador | 8.0F Tool Registry | roadmap |
| multi-action natural | 8.0F + orchestration | futuro |
| contexto pessoal persistente | Memory / Personality boundary | precisa de design próprio |
| personalidade estável | 8.0G Personality Foundation | roadmap |
| proatividade | automações/eventos + Presence | futuro |
| notificações / presença persistente | 8.0I/J Presence Modes + futuro | roadmap/futuro |
| avatar/personagem persistente | diferencial central da Lia | projeto próprio |
| módulos completos de finanças/hábitos/projetos | não são prioridade automática | benchmark, não compromisso |

---

## 5. Diferenciação da Lia

A Lia não deve competir tentando acumular a maior quantidade de módulos de produtividade.

A oportunidade é combinar três dimensões:

### Companion

- personalidade;
- memória contextual;
- voz;
- relação contínua;
- comportamento coerente.

### Perception + Agency

- perceber tela/janela/áudio;
- entender o contexto;
- escolher ferramentas permitidas;
- agir;
- observar o resultado.

### Embodied Desktop Presence

- avatar persistente;
- presença visual;
- reações;
- modos Static / Free;
- integração natural com o desktop.

Síntese:

> **Néctar é uma boa referência de continuidade e proatividade.**
>
> **ALFRED é uma boa referência de percepção + ação no computador.**
>
> **A Lia deve absorver os padrões úteis mantendo sua própria identidade: uma AI Companion visual, persistente, perceptiva e capaz de agir.**

---

## 6. Coisas que NÃO devemos copiar automaticamente

- transformar a Lia em um super-app genérico de produtividade;
- adicionar módulos completos de finanças, hábitos ou projetos sem necessidade clara;
- esconder ações autônomas do usuário;
- usar captura contínua de tela/câmera como default;
- misturar memória do usuário com Persona;
- criar um monólito “agent faz tudo” sem Capability Router e Tool Registry;
- copiar UI, textos, identidade, assets ou código;
- incorporar material de terceiros sem revisão de licença.

---

## 7. Perguntas para revisitar nas fases futuras

### 8.0E — Perception Foundation

- Qual é a menor unidade de percepção: screenshot, janela ou stream?
- Quem inicia a captura: usuário, evento autorizado ou Lia?
- Como o usuário vê que a percepção está ativa?
- Como representar provenance e timestamp da percepção?
- Como evitar captura desnecessária de informação sensível?

### 8.0F — Tool Registry

- Como uma intenção vira uma ou várias ações?
- Como exibir um plano antes de ações de maior impacto?
- Quais ferramentas podem rodar sem confirmação?
- Como a Lia observa o resultado e decide continuar/parar?
- Como desfazer ou auditar ações?

### 8.0G — Personality / contexto

- O que pertence à Persona da Lia?
- O que pertence à memória/contexto do usuário?
- Que dados expiram?
- O que o usuário pode revisar ou corrigir?
- Como evitar que contexto antigo domine decisões novas?

### Presence / proatividade

- Quando a Lia pode iniciar uma interação?
- Como controlar frequência e prioridade?
- Como representar “não me interrompa”?
- A proatividade aparece como fala, balão, notificação ou animação?
- Como garantir que a Lia continue parecendo uma personagem, não um dashboard?

---

## 8. Próxima ação associada a este documento

**Nenhuma implementação nasce deste benchmark agora.**

O gate corrente continua sendo o Windows E2E da rota multimodal entregue em `1126ee7`:

```
imagem anexada
  → requisito imageInput
  → groq / qwen/qwen3.8-27b
  → resposta baseada no conteúdo da imagem
```

Depois de fechar o gate corrente, este documento pode alimentar uma rodada read-only de comparação:

```
JÁ TEMOS
ROADMAP
VALE ADICIONAR
NÃO FAZ SENTIDO
```

Essa classificação deve refinar o roadmap da Lia — não substituí-lo.

---

## 9. Fontes

- Néctar: https://www.meu-nectar.com/
- ALFRED: https://alfredcursos.com.br/

As páginas externas podem mudar. Revalidar fatos específicos quando uma decisão de implementação, integração ou licença depender deles.
