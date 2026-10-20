# Finalização Windows — rodada de 20/10/2026

**Estado: release incompleta.** Esta rodada começou em `7bf9bf9`, na branch
`arena/01a10290-lia-project`. O remoto estava em `8436f91`, com um commit
exclusivo de cada lado. Foi feito fetch para leitura, sem merge ou push.

Mudanças preexistentes preservadas: remoção de
`docs/Concepts/LauncherConcept.png` e plano novo em
`docs/product/PLANO-FINALIZACAO-LIA.md`. O caminho do plano citado no prompt,
`docs/project/PLANO-FINALIZACAO-LIA.md`, não existia.

## Inventário de recursos e comparação dos sete concepts

Os sete PNGs foram abertos. As telas existentes foram localizadas no renderer
do launcher. Home foi observada no Windows. As outras páginas existentes ainda
exigem comparação visual de runtime. Não existem telas de produção para os
concepts restantes.

| Concept | Página/contrato existente | Classificação | Lacuna |
| --- | --- | --- | --- |
| 01 Home | `HomeView.vue`, `home-vm.ts`, IPC `conversar` | parcial | Home real usa monograma L; falta hero canônico, atalhos e composição do concept |
| 02 IA & Recursos | Campos técnicos de IA em `ConfigView.vue`; Brain registry/router em `lia-core` | parcial | Sem página própria; escolhas normais ainda expõem IDs técnicos |
| 03 Voz | `VoiceView.vue`, card de engine, serviços de instalação/perfis | existente sem validação visual completa | Comparar página real; preservar parâmetros suportados e opt-outs |
| 04 Personalidade | `persona.activeCardId` em Configuração | parcial | Sem tela de traços, presets e preview de comportamento |
| 05 Aparência | Stores/seleção de modelo do Stage | parcial | Sem página no Launcher; modelo observado é upstream, não Lia canônica |
| 06 Presença | Controles de janela/hover do Stage | ausente como contrato de produto | Sem escolha persistente Tamagotchi/Livre, movimento e recuperação multi-monitor |
| 07 Ferramentas | Infraestrutura AIRI e permissões de mídia | parcial | Sem página Lia, catálogo de maturidade ou controle canônico de permissões |
| Diagnósticos | `DiagnosticsView.vue`, health/timing/bridge IPC | existente sem validação visual completa | Revisar tradução, logs e informações de privacidade |
| Memória/privacidade | Histórico local e Cloud Sync do AIRI | parcial | Sem promessa de memória semântica; sync v1 tem limitações de imagem/falha |
| Distribuição | Config de electron-builder do Stage | parcial | Launcher sem instalador; feed upstream ainda presente no runtime |

O README dos concepts dizia que Personalidade, Presença e Ferramentas ainda
precisavam ser criados, embora os PNGs já existissem. Isso descrevia referências
visuais, não funcionalidades implementadas.

## Baseline automatizado

Logs locais ficam em `Tests/runs/release-20261019/` (ignorado pelo Git).
O nome da pasta corresponde ao início da sessão no dia 19.

| Comando | Resultado |
| --- | --- |
| `corepack pnpm install --ignore-scripts`, em `airi/` | PASS automatizado, pnpm 11.24.0 |
| `corepack pnpm --filter @lia/core run build`, em `airi/` | PASS automatizado |
| `python3 -m unittest discover -s . -p "test_*.py" -t .`, em `tools/` | FAIL: 487 casos, 1 erro de limpeza `WinError 32`, 10 skips |
| `node --test Tests/tools/*.test.mjs` | PASS automatizado: 267 aprovados |
| `vitest run`, em `airi/apps/lia-app/` | PASS automatizado: baseline 246 + 2 skips; após correção 247 + 2 skips |
| Vitest: `airi-stage-manager`, `node-runtime`, `stage-build-prerequisite` | PASS automatizado: 43 aprovados |
| `moeru-lint` nos arquivos alterados do Stage manager e seleção de sessão | PASS automatizado |
| Vitest da seleção de sessão: projeto browser / projeto node | PASS automatizado: 5 / 20 aprovados |
| `pnpm --filter @proj-airi/stage-ui typecheck` | PASS automatizado |
| `tsc --noEmit -p apps/lia-app/tsconfig.json`, em `airi/` | PASS automatizado |
| `pnpm --filter @lia/lia-app build`, em `airi/` | PASS automatizado; build de aplicação, não instalador |

O patch `stage-node-runtime-c52c995.patch` foi lido e comparado ao código.
A reversão de teste com `git apply --reverse --check` não se aplica integralmente
porque há correções posteriores. Não foi reaplicado. `node-runtime.ts`, a
seleção de Node real e a remoção da variável Electron no filho já existem.

## Fase 1 — inicialização e erro terminal

Roteiro executado no Windows:

1. Executar o `Lia.bat` original, sem alterá-lo.
2. Observar a Home e clicar em “Conversar com Lia”.
3. Observar o término do build e a personagem no Stage.
4. Abrir a janela Chat pelo controle do Stage.
5. Fechar o Launcher pelo fluxo normal.
6. Observar os logs de shutdown e verificar os processos do checkout.

Resultados: abertura e encerramento **PASS Windows real**. O build passou de
`starting` para `succeeded` entre `02:47:08.363Z` e `02:47:11.985Z`.
O Stage foi filho de um Node real, PID 17716. A personagem apareceu depois do
carregamento do renderer. O encerramento levou 606 ms e terminou com código 0.
Após encerrar, não havia o PID 17716, filhos diretos ou Electron do checkout.

Arquivos de evidência local: `launcher-runtime.log`, `home-before.png` e
`stage-visible.png`. A imagem do Stage transparente inclui o fundo visível;
isso não representa a composição final do Launcher.

Bug adicional reproduzido: uma rejeição inesperada de `prerequisite.run()`
escapava sem estado terminal. O novo teste falhou antes da correção. Agora o
manager retorna erro, emite `state=failed reason=unexpected-error`, não registra
o corpo da exceção e permite nova tentativa. O teste também prova o retry.

## Seleção local de conversa — corrigida

Um snapshot do índice sincronizado reaplicava a sessão padrão do líder à janela
Chat, substituindo a escolha local. Agora o índice só restaura a seleção quando
a sessão local não é válida para o usuário e a personagem atuais. Não foi
alterado nem apagado o histórico do Dev.

O teste com dois contextos Pinia e sincronização real reproduziu o erro antes
da correção e passou depois. No Electron, uma conversa nova respondeu **42**
a “19 + 23” e permaneceu selecionada: **PASS Windows real**. Evidências:
`text-after-selection-fix.png`, `launcher-debug-runtime.log`, correlação
`b8e7c765` às `03:11:08.543Z` na rota GPT-OSS.

## Problemas ativos

- **Imagem — FAIL:** anexo sintético de 240×160, retângulo vermelho à esquerda
  e círculo azul à direita, com pergunta determinística. A rota Qwen foi
  selecionada. Tentativas com contexto receberam limites Groq HTTP 429
  (saída: 1000 tokens/minuto) e HTTP 413 (entrada: 7000 tokens/minuto).
  Em conversa nova, correlação `93e70252-ebbf-41cf-8a8f-c88c88565d0b`
  às `03:18:57.782Z`, o log registrou sucesso, mas **não houve mensagem
  assistant** no store nem resposta visível. Causa ainda não confirmada;
  investigar metadados do stream sem registrar prompts, imagens ou chaves.
  Evidências: `image-preview.png`, `image-first-result.png` e log do runtime.
- **9router — BLOCKED para envio:** catálogo acessível em
  `http://localhost:20128/v1/models`; requisição com a mesma imagem sintética ao
  modelo `visao` respondeu HTTP 401. Nenhuma credencial foi lida ou exposta.
  O Dev foi solicitado a configurar a autenticação por mecanismo local.
  Isso não substitui o gate original da Groq.
- **Python — FAIL:** `python3` da Store: 487 casos, 1 erro de limpeza e
  10 skips. `python` nativo: 487 casos, 3 erros de limpeza e 10 skips.
  Os testes GitFlow isolados variam entre aprovação e erro WinError 32/5
  ao remover fixtures. Uma sondagem imediata com Handle em uma execução
  com falha não encontrou detentor. A causa dos locks continua desconhecida;
  a diferença entre os interpretadores não a comprova. Logs:
  `python-native-full.log`, `lock-probe-repeat-1.log`.
- **Lint da raiz:** permanece a dívida registrada no preflight anterior. Nenhum
  arquivo Node de ferramentas foi alterado nesta rodada. O lint dos arquivos
  TypeScript alterados passou pela configuração própria do workspace.

## Checklist de aceite

- [x] PASS Windows real: Launcher abre por `Lia.bat`.
- [x] PASS Windows real: build termina e Stage aparece.
- [x] PASS automatizado: rejeição do pré-requisito termina em erro e permite retry.
- [x] PASS Windows real: encerramento gerenciado sem processo do checkout remanescente.
- [x] PASS Windows real: conversa de texto isolada mantém sessão e resposta 42 visível.
- [ ] FAIL: imagem determinística sem resposta visível; texto após imagem ainda NÃO EXECUTADO.
- [ ] NÃO EXECUTADO: novo teste humano de microfone; baseline de voz preservado.
- [ ] NÃO EXECUTADO: failover recuperável/permanente e preflight numérico de imagens.
- [ ] NÃO EXECUTADO: loop real de ferramentas e medições de latência/rede.
- [ ] PARCIAL: Launcher corresponde aos concepts e oferece apenas controles funcionais.
- [ ] NÃO EXECUTADO: presença Livre e multi-monitor, persistência e recuperação.
- [ ] PARCIAL: páginas de personalidade, aparência, ferramentas, memória e privacidade.
- [ ] NÃO EXECUTADO: instalador, instalação limpa, atualização e desinstalação.
- [ ] PARCIAL: revisão final de licenças/assets, acessibilidade e DPI.

O baseline funcional permanece `3ef6d11`. Esta rodada não aprova a release.
