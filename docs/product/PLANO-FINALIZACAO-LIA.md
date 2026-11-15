# Plano de finalização do aplicativo Lia

**Tipo:** plano de produto, engenharia e aceite  
**Idioma do produto/documentação:** português brasileiro (pt-BR)  
**Repositório:** `BloomRX/Lia-Project`  
**Branch de trabalho conhecida:** `arena/01a10290-lia-project`  
**Data desta análise:** 2026-10-19  
**Regra:** este documento amplia `docs/project/QUANTO-FALTA.md`; não o substitui nem autoriza ignorar `AGENTS.md` ou `docs/project/CURRENT-STATE.md`.

> **Atenção sobre o estado:** esta análise usa a documentação versionada consultada na branch. Antes de mudar qualquer código, o Codex deve conferir HEAD, árvore de trabalho, branch, estado real dos testes e os arquivos locais. O estado local pode ter avançado desde a documentação consultada.

## 1. Visão final do produto

Lia é um aplicativo desktop de companheira virtual/personagem. AIRI é uma base técnica gerenciada, não a identidade exposta ao usuário. A experiência comum deve parecer um aplicativo de personagem bem acabado, não uma ferramenta de desenvolvimento.

Uma pessoa leiga deve conseguir instalar, abrir, configurar e usar a Lia sem terminal, Git, Node, Python, nomes de APIs ou configuração manual de arquivos. O Launcher é a autoridade de configuração do produto e deve apresentar opções compreensíveis, salvar as escolhas e explicar estados e erros em linguagem normal. Usuários avançados podem ter uma área separada de opções técnicas e diagnósticos.

### Experiência que deve existir ao final

1. **Launcher e configuração guiada:** primeira execução clara; escolher perfil de uso, modelo/cérebro, voz, microfone, aparência e presença; explicar requisitos, disponibilidade, privacidade e custo quando relevante; validar configuração e mostrar o que está pronto. As escolhas são persistidas e respeitadas nos próximos inícios.
2. **Home e conversa:** botão principal “Conversar com Lia”; conversa por texto confiável; estados de carregamento/erro recuperáveis; histórico previsível; nenhuma janela invisível ou inicialização presa.
3. **Voz:** microfone → transcrição → Brain → resposta → TTS; controles acessíveis para ativar/desativar e testar voz; a preferência explícita do usuário nunca é sobrescrita silenciosamente.
4. **Visão:** anexar imagem e, quando aprovado e permitido, capturar tela/janela; a resposta deve demonstrar que a imagem foi realmente interpretada. Não fingir suporte se o modelo/rota não tiver capacidade.
5. **Cérebro e recursos:** catálogo de motores/modelos e capacidades; seleção automática ou manual; roteamento por capacidade real; mensagens compreensíveis para credenciais ausentes, indisponibilidade, limites e falhas.
6. **Personalidade:** identidade canônica “Lia Original”, ajustes explicáveis de traços e comportamento, sem exigir edição de prompt. Preservar a identidade central.
7. **Aparência:** personagem/modelo base da Lia, roupas/variações e pré-visualização quando suportados. Não apresentar conteúdo ilustrativo como se fosse recurso funcional.
8. **Presença de desktop selecionável:** ao iniciar, usar o modo salvo pelo usuário. No mínimo, avaliar e oferecer:
   - **Tamagotchi (AIRI):** manter a experiência atual do Stage Tamagotchi, com suas capacidades reais;
   - **Livre/Andar pelo desktop (Lia):** experiência de presença própria, sem a personagem esticada ocupando a janela/tela toda, capaz de se mover por uma área delimitada e, como objetivo do produto, circular entre monitores.
   A segunda opção é uma funcionalidade da Lia, não presumir que já exista no AIRI. Se ainda não estiver implementada, registrar a lacuna e implementá-la por fases com comportamento seguro, pausa, fixar, voltar ao ponto inicial, ocultar ao passar o mouse, limites por monitor e respeito a tela cheia. Não substituir ou quebrar o modo Tamagotchi.
9. **Ferramentas e permissões:** mostrar o que a Lia consegue fazer e o que o usuário autorizou; permissões mínimas; confirmação para ações destrutivas/sensíveis; atividade e erros visíveis; nunca confundir “recurso disponível” com “permissão concedida”.
10. **Memória e dados:** explicar o que é salvo, permitir controles de privacidade e exclusão compatíveis com a arquitetura real. Não alegar memória persistente que não esteja implementada.
11. **Diagnóstico e recuperação:** logs técnicos protegidos atrás de área avançada; estados de prontidão; instruções acionáveis; sem segredos, prompts privados, conteúdo de imagens, áudio ou transcrições em logs de diagnóstico.
12. **Distribuição:** caminho repetível para build/empacotamento/instalação/atualização, identificação de versão, dependências e licenças, e teste de instalação limpa no Windows.

## 2. Fonte de verdade e referências que o Codex deve ler

Na raiz do repositório, antes de trabalhar:

- `AGENTS.md` — regras globais e restrições obrigatórias.
- `docs/project/CURRENT-STATE.md` — ler primeiro o §0; ler §6 antes de qualquer alteração de código e abrir outras seções quando necessárias.
- `docs/project/QUANTO-FALTA.md` — itens pendentes conhecidos, testes e gates que exigem Windows.
- `docs/product/lia-ui-implementation-roadmap.md` — fases existentes e limites do planejamento anterior.
- `docs/design/LIA-UI-DESIGN-SYSTEM.md` — design system e arquitetura visual.
- `docs/design/concepts/README.md` e **todos os sete PNGs** em `docs/design/concepts/`.
- `docs/airi-modificacoes-registro.md` e `docs/patches/stage-node-runtime-c52c995.patch` — histórico e reaplicação das alterações da Lia no AIRI/Stage.
- `docs/README.md` e documentação de arquitetura, privacidade, QA e release que seja relevante.
- `airi/AGENTS.md` para regras específicas do upstream quando tocar no subprojeto AIRI; ele não substitui o `AGENTS.md` da raiz.

Os concepts definem composição, hierarquia, clima visual e vocabulário; não autorizam controles sem backend. O UI deve ser orientado por capacidades reais. A marca apresentada ao usuário é Lia, não AIRI.

## 3. Estado conhecido na documentação consultada

### Já comprovado em Windows no baseline registrado

- Conversa por texto.
- Cadeia de voz gerenciada: microfone → STT → Brain → resposta → Kokoro TTS, sem configuração manual em AIRI Settings > Hearing.
- Bootstrap/seleção de rota do Brain (M2).

O último baseline de código validado em Windows registrado no `CURRENT-STATE.md` é `3ef6d11618f787dae6d197645d440a5775a60ad6`. Isso não prova que todo commit posterior esteja validado.

### Fase 8.0D — ainda não pode ser declarada concluída segundo o estado registrado

- Visão: transporte/roteamento já implementados e seleção da rota Qwen provada, mas falta um gate Windows de conteúdo: resposta correta baseada na imagem.
- O turno com imagem deve usar `groq` + `qwen/qwen3.8-27b`; texto sem requisito visual deve continuar usando `openai/gpt-oss-120b`, respeitando o contexto efetivo.
- Há correção de retenção de turnos falhos; falta preflight para limitar imagens ao máximo suportado sem descartar imagens silenciosamente.
- Tool calling: parcial; o loop real precisa ser comprovado.
- Failure behavior: faltam testes dirigidos para falha recuperável → failover e falha permanente → sem failover.
- Latência e impacto de região/rede ainda não medidos no Brain.
- A compreensão nativa de áudio pelo Brain não é a mesma coisa que STT; está registrada como não iniciada.
- Cloud Sync v1 não representa totalmente imagens e falhas/semântica de mensagens.
- `docs/compatibility/MATRIX.md` é uma dívida conhecida exigida por `AGENTS.md`.
- Há dívida de documentação/contexto de agente e scripts `.bat` que precisam de validação real no Windows.

### Stage/Launcher: risco prioritário

O histórico documenta um defeito onde `process.execPath` dentro do processo principal Electron foi tratado como Node real. Isso deixou o pré-requisito de build preso em `starting` e impediu o Stage de abrir. Há um patch documentado em `docs/patches/stage-node-runtime-c52c995.patch`, mas o estado consultado afirma que a correção ainda precisava ser validada no Windows. A conversa recente também registrou que o usuário executou:

```powershell
cd J:\Lia-Project\airi\apps\lia-app
pnpm exec vitest run src/main/airi-stage-manager.test.ts src/main/node-runtime.test.ts src/main/stage-build-prerequisite.test.ts
```

O resultado final dessa execução não está presente no registro disponível. Verificar o resultado real e o código local antes de assumir PASS ou reaplicar o patch. Não aplicar o patch cegamente se as alterações já existirem.

## 4. Plano de trabalho ordenado

Cada fase deve ter escopo limitado, testes, critérios de aceite e registro de estado. Não pular para recursos novos enquanto o fluxo básico estiver quebrado.

### Fase 0 — Preflight, inventário e proteção do trabalho existente

- Confirmar diretório raiz, branch, `git rev-parse HEAD`, `git status --short`, tip remoto e diferenças.
- Não descartar, restaurar, limpar, resetar, rebasear ou sobrescrever mudanças locais do usuário.
- Ler os documentos da seção 2.
- Fazer inventário real de páginas do Launcher, settings, IPC, schema canônico, Stage lifecycle, builds, testes, assets, distribuição e modos de presença existentes.
- Abrir e comparar visualmente todos os concepts com as telas de produção; montar matriz “concept → página atual → estado real → lacunas”.
- Registrar os comandos disponíveis e executar baseline de testes sem alterar código.
- Atualizar este plano/um relatório de auditoria com evidências, não suposições.

**Aceite:** branch/HEAD/worktree e testes iniciais documentados; nada do usuário perdido; mapa de funcionalidades reais e ausentes criado.

### Fase 1 — Launcher e Stage iniciam de forma confiável

- Resolver o problema de pré-requisito Node/ Electron com a estratégia já documentada, após verificar se o patch está aplicado.
- Garantir que o build do `core-agent` termine com estado final explícito (sucesso ou erro); nenhum estado infinito `starting`.
- Garantir que o Stage inicie, a janela apareça e o botão “Conversar com Lia” responda sem congelar.
- Corrigir estados de carregamento, timeout apenas quando houver justificativa, encerramento/limpeza de processos e mensagens acionáveis.
- Manter o ambiente do processo filho corretamente; não vazar `ELECTRON_RUN_AS_NODE` para o Stage que precisa lançar uma janela Electron.
- Executar os testes direcionados e testes relacionados. Não declarar gate Windows aprovado com testes Linux.

**Aceite:** fluxo `Lia.bat → Launcher → Conversar com Lia → Stage visível` funciona no Windows real, com log terminal claro e sem processos órfãos.

### Fase 2 — Fechar a fase multimodal 8.0D

- Implementar preflight do limite de imagens (limite por modelo/capacidade, sem descartar imagens silenciosamente; erro de produto claro antes da chamada ao provider).
- Adicionar testes dirigidos para failover recuperável e não-failover permanente.
- Validar que turnos falhos continuam visíveis/retryable, mas não vazam para o contexto futuro do provider; erros não entram como mensagens de usuário.
- Completar `docs/compatibility/MATRIX.md` e registrar a dívida de Cloud Sync v1 com decisão de compatibilidade explícita.
- Executar suíte direcionada, lint/typecheck e testes de regressão existentes.
- No Windows: abrir via fluxo normal, anexar imagem, fazer pergunta determinística, confirmar rota `groq` + `qwen/qwen3.8-27b` e resposta factual correta; depois testar texto e confirmar GPT-OSS quando o contexto efetivo não exigir imagem. Registrar logs metadata-only e resultado.
- Medir latência e comportamento de erro/rede na máquina alvo; não escolher defaults definitivos sem evidência.

**Aceite:** todos os critérios da 8.0D têm evidência e status claro; o baseline funcional só avança após gate de runtime real.

### Fase 3 — Launcher final, compreensível para leigos

Usar os concepts e design system existentes; não redesenhar sem motivo documentado.

- Implementar shell/navegação e cada página necessária: Início, Conversar, IA & Recursos, Voz, Personalidade, Aparência, Presença, Ferramentas/Extensões, Diagnósticos e Configurações globais.
- Separar configuração normal e avançada. Esconder jargão em Advanced/Diagnostics.
- Conectar cada controle ao schema canônico e a um serviço real via IPC seguro; salvar e reler preferências; evitar estado duplicado entre UI e backend.
- Estados de loading, vazio, sucesso, indisponibilidade, erro e recuperação em todas as páginas.
- Primeira execução guiada com teste de voz/microfone e escolha de presença. Credenciais são inseridas de forma segura; nunca mostrar/logar o valor de segredo.
- A tela inicial deve continuar character-first e ter “Conversar com Lia” como ação principal, sem virar dashboard técnico.
- Atualizar `docs/design/concepts/README.md` caso o inventário local confirme discrepâncias de status entre PNGs existentes e texto do README.

**Aceite:** nenhuma opção decorativa ou sem efeito; preferências persistem após reinício; todos os controles exibidos correspondem a capacidades disponíveis e têm texto compreensível.

### Fase 4 — Modos de presença: Tamagotchi e Lia Livre

- Preservar o modo AIRI Tamagotchi atual como uma opção identificada e funcional.
- Definir um contrato de presença separado da aparência: `Tamagotchi` e `Livre` são modos de comportamento/ocupação do desktop, não skins.
- Implementar seleção e persistência do modo; ao iniciar, carregar a preferência do usuário. Se o modo selecionado não estiver disponível, explicar e oferecer fallback explícito, sem trocar silenciosamente a escolha.
- Para Livre, fazer primeiro um protótipo controlado: janela/personagem com proporção correta, limites, mover/andar, pausa, fixar, voltar para Home, ocultar ao passar o mouse, comportamento com fullscreen e restauração após reinício.
- Depois, adicionar suporte multi-monitor: descobrir monitores, coordenadas/DPI, área de trabalho útil, transições entre monitores, recuperação se um monitor desconectar ou resolução mudar, não ficar fora da tela. Nunca mover/roubar foco de janelas do usuário.
- Oferecer controles simples: “Ficar no lugar”, “Andar pelo desktop”, “Pausar”, “Voltar ao ponto inicial”, “Escolher monitor”, “Ocultar ao passar o mouse”.
- Não tratar o modo Livre como pronto só porque existe uma animação ou um mockup; provar comportamento real no Windows.

**Aceite:** o usuário escolhe qualquer modo disponível; reiniciar mantém o modo escolhido; o modo Tamagotchi não regressa; Livre funciona em um e múltiplos monitores, com pause/home/pin e sem interferir em fullscreen.

### Fase 5 — Identidade, voz, aparência e recursos

- Confirmar que Voz expõe apenas opções suportadas pelo engine selecionado; preview real e estado de prontidão.
- Manter STT/TTS gerenciados, respeitando `voice.enabled === false` e preferências explícitas.
- Implementar Personality com preset Lia Original, traços simples, comportamento e preview; não expor prompt bruto como configuração normal.
- Implementar Appearance com modelo/asset canônico e outfits somente quando de fato suportados; separar claramente referências visuais e assets de runtime.
- Exibir capacidades do Brain de forma neutra em relação ao provider; roteamento baseado em capacidades declaradas, não heurísticas de UI.
- Não assumir suporte nativo a áudio, vídeo, ferramentas ou modelo local sem implementação e testes.

**Aceite:** páginas conectadas ao backend, configurações persistidas e verificadas, nenhum controle fictício; a identidade da Lia permanece consistente.

### Fase 6 — Ferramentas, permissões, memória e segurança

- Fazer inventário de ferramentas reais e sua maturidade; habilitar apenas as implementadas.
- Separar capacidade, permissão e disponibilidade.
- Permissões explícitas e mínimas para arquivos, tela, microfone, navegador, aplicações e terminal, conforme o que for realmente suportado.
- Confirmar operações destrutivas/sensíveis; nunca elevar privilégio automaticamente.
- Mostrar atividade, resultado e falhas; cancelar operações quando suportado.
- Documentar claramente memória de sessão vs memória persistente vs memória de projeto; fornecer controles compatíveis com implementação real.
- Revisar logs, secrets, IPC, armazenamento local, atualização e acesso a arquivos.
- Documentar Cloud Sync e seus limites; não afirmar sincronização completa de imagens/erros até protocolo suportar.

**Aceite:** permissões testadas, ações sensíveis protegidas, segredos não expostos e as promessas de privacidade correspondem ao código.

### Fase 7 — Distribuição e qualidade de release

- Definir/buildar artefato instalável de Windows e validar caminho de instalação limpa.
- Testar inicialização após instalação, criação de dados, upgrades/migração de config, desinstalação e recuperação de falha.
- Confirmar assets, runtimes gerenciados, licenças e atribuições de dependências.
- Testar em hardware Windows de referência e documentar limitações de hardware; não otimizar arquitetura exclusivamente para uma máquina.
- Medir tempos de startup, primeira resposta de texto/voz e primeira análise de imagem; definir metas após medições, não inventar números.
- Verificar acessibilidade básica, escala/DPI, múltiplos monitores, tela cheia, tema e resoluções comuns.
- Criar release checklist, notas de versão e troubleshooting em linguagem leiga.

**Aceite:** uma pessoa consegue instalar e iniciar a Lia em uma máquina Windows limpa sem terminal; o artefato e o processo de atualização foram realmente testados.

### Fase 8 — Fechamento, baseline e documentação

- Executar todas as suítes aplicáveis, build, lint e typecheck com comandos reais do repositório.
- Executar testes E2E de Windows para launcher, Stage, texto, voz, visão, modos de presença, persistência de configuração e instalação.
- Atualizar `CURRENT-STATE.md`, `QUANTO-FALTA.md`, roadmap, docs de design, matriz de compatibilidade e release checklist no mesmo conjunto lógico de alterações.
- Distinguir sempre: PASS automatizado, PASS em runtime Windows, NÃO EXECUTADO, FAIL e BLOCKED.
- Listar limitações remanescentes. “Pronto” significa cumprir os critérios acordados, não afirmar que todo recurso futuro imaginável existe.

**Aceite final:** nenhuma lacuna P0/P1 conhecida sem decisão explícita; fluxo básico e funções anunciadas aprovados no Windows real; docs e estado do Git coerentes; release instalável validado.

## 5. Critérios de aceite globais (Definition of Done)

- [ ] `Lia.bat` abre o Launcher sem intervenção de terminal.
- [ ] “Conversar com Lia” abre o Stage visível, sem congelamento nem estado infinito.
- [ ] Texto funciona; erros são recuperáveis e não contaminam o contexto futuro.
- [ ] Voz STT → Brain → TTS funciona no Windows e respeita opt-out/configuração.
- [ ] Imagem é realmente interpretada e roteada para modelo visual compatível.
- [ ] O texto puro não é enviado por engano a um modelo visual se o contexto efetivo não exigir isso.
- [ ] Limites de entrada são validados antes da chamada ao provider e explicados claramente.
- [ ] Launcher corresponde aos concepts e usa linguagem pt-BR simples.
- [ ] As opções persistem e são lidas da autoridade canônica após reiniciar.
- [ ] Usuário pode escolher Tamagotchi ou Livre; a preferência salva é respeitada.
- [ ] Livre não estica a personagem, tem pausa/fixar/Home e suporte real a múltiplos monitores.
- [ ] Controles de personalidade, voz, aparência, ferramentas e memória refletem funcionalidades reais.
- [ ] Permissões, privacidade, segredos e logs foram revisados.
- [ ] Ferramentas, failover, compatibilidade, latência e limitações estão documentados com evidência.
- [ ] Build de release/instalador e instalação limpa passaram em Windows.
- [ ] Todos os gates estão rotulados honestamente; nenhuma execução ausente é chamada de PASS.

## 6. Regras de trabalho para Codex

1. Trabalhar a partir da **raiz** `J:\Lia-Project`, nunca iniciar a sessão dentro de `airi/`.
2. Seguir `AGENTS.md` e `CURRENT-STATE.md`, inclusive proibições de alterar `Lia.bat`/`DevKit.bat`, fazer merge em `main`, mudar áreas restritas sem autorização ou promover baseline sem gate real.
3. Não criar branch, fazer push, merge, rebase, reset, clean ou descartar mudanças sem autorização explícita.
4. Não reaplicar patches às cegas. Conferir o diff atual e aplicar somente o que estiver ausente.
5. Um conjunto lógico por vez: testes antes/depois, diff revisado, documentação atualizada.
6. Não substituir uma implementação real por mock, stub, botão decorativo ou sucesso simulado.
7. Não ampliar escopo com 8.0E ou recursos futuros sem definir requisitos/aceite; para esta finalização, propor e documentar as decisões necessárias, implementar o escopo definido e sinalizar os bloqueios reais.
8. Quando depender de interação do usuário, hardware, credenciais ou confirmação visual do Windows, preparar roteiro e coletar evidência; nunca fingir que foi executado. Como o Codex está rodando no PC Windows do usuário, executar o que for possível localmente e separar os gates que realmente exigem confirmação manual.
9. Proteger segredos; não solicitar ou imprimir API keys em logs/chat; nunca colocar segredos no repositório.
10. Não parar depois de produzir apenas uma auditoria/plano. Depois do preflight, executar as fases na ordem até terminar ou chegar a um bloqueio real. Ao bloquear, entregar a menor ação necessária para desbloquear e continuar depois.
11. Ao fim de cada fase: informar arquivos alterados, comandos executados, resultados reais, gates ainda pendentes e próximo passo. Atualizar docs de estado.
12. Não declarar a aplicação concluída até todos os critérios obrigatórios terem evidência. Se uma funcionalidade não puder ser concluída, não escondê-la: marcar como bloqueada, explicar causa/evidência e oferecer uma decisão concreta.

## 7. Definição de “pronto” nesta iniciativa

A Lia estará pronta para uma primeira release pública quando uma pessoa leiga conseguir instalar, configurar e usar a experiência prometida sem terminal; Launcher, Stage, texto e voz forem confiáveis; visão funcionar de ponta a ponta; modos de presença forem selecionáveis e persistentes; as telas forem coerentes com os concepts; permissões e erros forem claros; e a distribuição Windows tiver sido validada. Recursos explicitamente fora desse release devem ser identificados como futuros, não simulados como concluídos.

---

# Prompt mestre para Codex

Copie o prompt abaixo para uma sessão Codex iniciada na raiz `J:\Lia-Project`.

> Você é o engenheiro responsável por levar o aplicativo Lia até uma primeira release funcional e verificável no Windows. Trabalhe diretamente no repositório local, na raiz `J:\Lia-Project`.
>
> **Objetivo:** implementar e validar o app Lia de ponta a ponta, não apenas escrever um plano. A visão, fases, Definition of Done e restrições estão em `docs/project/PLANO-FINALIZACAO-LIA.md`. Leia integralmente esse arquivo e siga `AGENTS.md`. Antes de qualquer código, leia `docs/project/CURRENT-STATE.md` §0 e §6, `docs/project/QUANTO-FALTA.md`, `docs/product/lia-ui-implementation-roadmap.md`, `docs/design/LIA-UI-DESIGN-SYSTEM.md`, `docs/design/concepts/README.md`, abra os sete concepts PNG e leia `docs/airi-modificacoes-registro.md` e o patch de runtime Node do Stage.
>
> **Regra de segurança do repositório:** comece verificando `pwd`, branch, HEAD, `git status --short`, tip remoto e diferenças. Não apague nem sobrescreva mudanças do usuário. Não faça reset, clean, rebase, merge, push, nem crie outra branch. Não altere `Lia.bat` ou `DevKit.bat` sem autorização explícita. Não promova baseline funcional sem gate real em Windows. Nunca reaplique um patch sem conferir se as mudanças já existem.
>
> **Como executar:**
> 1. Faça inventário do estado real local e compare cada concept com a tela real. Gere uma matriz de recursos: existente e validado / existente sem validação / parcial / ausente / bloqueado. Execute o baseline de testes e guarde os resultados reais.
> 2. Conserte primeiro o caminho `Lia.bat → Launcher → Conversar com Lia → Stage visível`, incluindo o pré-requisito de build do `core-agent`, o runtime Node/Electron e a ausência de estado infinito `starting`. Investigue causa raiz com logs/processos/testes; não aumente timeout como paliativo.
> 3. Feche a fase 8.0D: preflight do limite de imagens, testes de failover recuperável e erro permanente, matriz de compatibilidade, correção de bugs e gate visual real em Windows para imagem + texto. Preserve a cadeia de voz já validada salvo evidência concreta de regressão.
> 4. Complete o Launcher usando `docs/design/concepts/` e `LIA-UI-DESIGN-SYSTEM.md` como referência visual. A UI deve ser em pt-BR e fácil para leigos. A autoridade canônica do produto deve ser a fonte das preferências; toda opção deve ter efeito real, persistir após reinício e mostrar estados de loading/erro/sucesso. Separe opções comuns de avançadas. Não implemente controles decorativos.
> 5. Implemente a seleção de presença persistente: **Tamagotchi (AIRI)** e **Livre (Lia)**. Preserve o Tamagotchi. Para Livre, crie comportamento real de personagem em tamanho/proporção corretos, movimento delimitado, pausa, fixar, voltar a Home, hover-hide, fullscreen e suporte a múltiplos monitores com recuperação a mudanças de monitor/resolução. Não confunda aparência com presença; não declare multi-monitor pronto sem testar no Windows.
> 6. Complete as páginas e os contratos reais de IA & Recursos, Voz, Personalidade, Aparência, Ferramentas, Diagnósticos, privacidade e memória. Não prometa recursos inexistentes. Respeite opt-outs, permissões explícitas, proteção de segredos e confirmação de ações sensíveis.
> 7. Complete o fluxo de build/empacotamento/instalação/atualização para Windows e teste instalação limpa. Revise documentação, licenças, assets e troubleshooting.
> 8. Depois de cada conjunto lógico, execute os testes pertinentes, lint, typecheck e build disponíveis; revise o diff; atualize `CURRENT-STATE.md`, `QUANTO-FALTA.md`, matriz de compatibilidade, docs de design e checklist de release. Continue automaticamente para o próximo item executável em vez de parar após um relatório.
>
> **Qualidade e honestidade:** não invente comandos, resultados, recursos ou testes. Não trate teste unitário como gate de runtime. Marque cada verificação como PASS automatizado, PASS Windows real, FAIL, NÃO EXECUTADO ou BLOCKED. Se um teste falhar, investigue a causa raiz e corrija antes de seguir, a menos que seja uma falha externa documentada. Se houver ambiguidade de produto que afete arquitetura ou comportamento, examine o código e a documentação; escolha o comportamento mínimo reversível coerente com este plano e registre a decisão. Só interrompa para pedir algo ao usuário quando realmente depender de credencial/decisão irreversível, quando houver risco de perda de dados, ou quando uma confirmação física/visual não puder ser automatizada. Como você roda no PC Windows, execute localmente os gates que forem possíveis.
>
> **Entrega final obrigatória:** app e testes alterados; documentação atualizada; lista de arquivos; comandos e resultados; roteiro e evidência dos gates Windows; estado do build/instalador; lista objetiva de limitações conhecidas; e um checklist de Definition of Done marcado com evidências. Não diga “finalizado” se algum requisito obrigatório não passou. Comece agora pelo preflight e prossiga fase a fase até concluir tudo que for possível sem violar as regras.
