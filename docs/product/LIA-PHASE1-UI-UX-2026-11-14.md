# Lia — Fase 1 UI/UX: confiança e verdade

**Data:** 14/11/2026
**Branch:** `arena/250b337a-lia-project`
**Base da implementação:** `1d2bbc500233bde5e9b8609d43a6ba4ce0267ec0`
**Escopo:** L-01, S-01/S-02, L-02, L-03, A-01/A-02 e regressão A-1, conforme a auditoria UI/UX e o plano de prontidão.

> **Resultado:** implementação publicada para revisão. Testes automatizados direcionados, typechecks e build do Launcher passaram. **Não é PASS de runtime, não aprova beta e não promove o baseline Windows.** Browser/Chromium, build completo do Stage e validação Windows permanecem bloqueados.

## 1. O que mudou

### L-01 — Home não promete conversa antes da prontidão

- O view-model distingue IA pronta, configuração ausente e estados ocupados/desconhecidos.
- O CTA fica desabilitado enquanto iniciar/parar ou quando a prontidão não permite conversar.
- Sem IA pronta, o destino normal é **IA & Recursos**, não uma tela técnica nem uma conversa vazia.
- A explicação de prontidão é associada ao CTA e anunciada por região de status.

### S-01/S-02 — confirmação antes de apagar

`DoubleCheckButton` agora tem nome acessível inicial/confirmatório, Cancelar localizado, descrição de consequência, foco inicial em Cancelar, retorno de foco no cancelamento/Escape e fechamento quando desabilitado. O primeiro clique nunca emite a ação destrutiva.

Aplicações:

- limpar conversa no Stage desktop e nos layouts compartilhados/mobile;
- excluir conversa na lista de sessões (o drawer reutiliza o diálogo);
- remover provedor/configuração de IA;
- apagar uma lembrança e apagar todas;
- remover uma voz importada.

Excluir **uma mensagem** usa um AlertDialog separado do menu de contexto. O menu apenas solicita a exclusão; fechar o menu não cancela nem confirma a solicitação. Cancelar/Escape não emitem delete; Confirmar emite uma vez. A descrição informa que somente aquela mensagem daquela conversa será removida.

O teste de integração do chat verifica cancelar sem limpeza e confirmar uma chamada para a sessão ativa. O teste do store verifica que a limpeza preserva a mensagem de sistema e a conversa irmã. O teste DOM-emulado não substitui o teste browser/Windows.

### L-02 — uma porta normal para IA

- Configurações do Launcher oferece **Abrir IA & Recursos**.
- Campos técnicos legados de IA/voz e caminho do arquivo ficam em disclosure avançado fechado.
- No Stage gerenciado, a seção de IA mostra um resumo somente leitura da seleção do Launcher. Não renderiza campos/ações de escrita e não consulta cofre nem discovery para controles ocultos.
- O editor legado continua disponível para compatibilidade; nenhuma nova autoridade de configuração, IPC ou escrita de segredo foi criada.

### L-03 — voz derivada da capacidade

- O snapshot de capacidade do Main continua a fonte de verdade; o store agora também expõe uma projeção reativa **somente leitura**.
- O LED de voz do Home e o aviso da seção de voz distinguem desconhecido, não configurado, configurado mas indisponível e pronto.
- A página de voz do Launcher recebe a prontidão já mantida pelo shell e usa o view-model existente.
- Cópias de voz evitam prometer nuvem/local sem capacidade. Nenhum runtime TTS/STT, fallback de chat ou discovery foi alterado.

### A-01/A-02 — contraste, teclado, nomes e movimento

- Ação magenta ajustada para `#a62b90` sobre branco: **6,2320:1**; hover `#8f247c`. Neon permanece em borda/foco, não como texto normal.
- CTAs com alvo mínimo de 40px; controles pequenos compartilhados com mínimo de 32px onde aplicado.
- Foco visível em botões, tabs, composer, ilhas e controles de visão.
- Tabs de configuração usam ativação manual: setas/Home/End movem foco; Enter/Space selecionam.
- Ilha expõe `aria-expanded`/`aria-controls`; controles de áudio/visão têm nomes localizados.
- Composer tem label, ajuda e erro associados; Enter durante composição IME não envia mensagem.
- Strings novas de chat/ações/voz têm en/pt-BR. Títulos mobile deixaram de apontar para chaves `settings.*` ausentes em pt-BR.
- Preferência por movimento reduzido é respeitada nos primitivos, menus, ilhas e animações JS dos layouts tocados.

## 2. Verificação executada

Comandos executados em `airi/`, com o shim pnpm do ambiente QA. Logs e hashes: [`evidence/lia-phase1-ui-ux-2026-11-14/manifest.json`](../reports/evidence/lia-phase1-ui-ux-2026-11-14/manifest.json).

| Verificação | Resultado |
|---|---|
| Launcher | **360/360**, 36 arquivos, exit 0 |
| Stage node direcionado | **72/72**, 8 arquivos, exit 0 |
| stage-ui node direcionado | **56/56**, 5 arquivos, exit 0 |
| Regressão A-1 incluída acima | **31/31** (tools 13, resolver 11, rerun 7) |
| stage-layouts | **41/41**, 4 arquivos, exit 0 |
| Typechecks ui/app/stage/stage-ui/stage-layouts | **PASS**, exit 0; Stage com heap 3072 MiB, sequencial |
| Build Launcher | **PASS**, exit 0 |
| Build i18n | **PASS**, exit 0 |
| ESLint dos arquivos da tarefa | **0 erros**; 2 CSS fora da configuração ESLint |
| `git diff --check` | **PASS**, exit 0 |
| Delta de produção A-1 / manifests de dependência / Lia.bat / DevKit.bat | **vazio** |

Os totais são de execuções diferentes e não devem ser somados como uma suíte única.

## 3. FAIL / BLOCKED / não executado

1. **Lint global FAIL:** 78 erros em 48 arquivos não alterados nesta tarefa. Nenhum caminho com erro intersecta o patch. Não foi feito cleanup global.
2. **Build Stage BLOCKED:** `ECONNRESET` em `dist.ayaka.moe/live2d-models/hiyori_free_zh.zip` (QA-03). Não foi criado mirror nem contornado o download.
3. **Browser BLOCKED:** `chromium_headless_shell-1234` ausente. O teste de exclusão de mensagem foi tentado e falhou antes de executar assertions. Testes browser de sessões, memória e resumo gerenciado foram preparados/atualizados, mas não executados.
4. **Runtime Windows NÃO EXECUTADO:** sem boot oficial, conversa real, voz real, leitor de tela, captura de pixels, multi-monitor/DPI ou medição C0–C4.
5. **Beta NÃO APROVADA:** critérios visuais/funcionais ainda exigem evidência real. AC-03 tem cálculo de token, não amostragem de pixels; AC-05/06 têm implementação e checks direcionados, não prova de 100% dos navegáveis em runtime.
6. A suíte node completa de stage-ui não foi reexecutada nesta rodada; o exit 1 por `updateCredits` registrado anteriormente permanece histórico, não resultado novo.

## 4. Próximo gate

- Disponibilizar Chromium autorizado e executar os browser tests de confirmação, sessões, memória e resumo gerenciado.
- Resolver o acesso/licenciamento/mirror dos assets pelo fluxo aprovado e repetir build do Stage.
- Executar a matriz Windows oficial no SHA publicado: primeiro uso, cancelar/confirmar com fixture, troca Launcher→Stage, voz indisponível, teclado/leitor, temas e locales.
- Corrigir o lint global em tarefa própria, sem misturar cleanup com esta entrega.
- Manter X-04 (UI/persistência de ferramentas) adiado; nenhuma promessa de controle total foi adicionada.
