# Fluxo integrado Windows da retomada

Roteiro Playwright/Electron com ações na UI, serviço HTTP local sintético e
relatório JSON. Não usa setters de stores para aprovar funcionalidades.

Na raiz, com Launcher/Stage fechados e dependências existentes:

```powershell
cd airi/apps/lia-app
corepack pnpm run build
cd ../../..
node Tests/windows/completion-runtime.mjs --without-key --benchmark
```

O Stage é iniciado pelo Launcher no modo de desenvolvimento e executa seu
pré-requisito real de build do core-agent. Não execute builds, instalações ou
testes que limpem `core-agent/dist` durante este roteiro. O Electron instalado
deve ser o oficial 43.4.1, com integridade conferida pelo gate de componentes.

Por padrão, as evidências ficam em `%TEMP%/lia-completion-evidence/`, numa
subpasta nova por execução. `LIA_EVIDENCE_ROOT` permite escolher outra raiz.
`--without-key` seleciona explicitamente o serviço local sem chave na UI.
Sem essa opção, é usada uma credencial sintética efêmera. Essa variante detectou
falha de descriptografia entre Launcher e Stage; depois da correção do canal
Main, passou em 08/11. Não aprova uma credencial ou serviço externo real.

Depois de gerar o pacote privado, `node Tests/windows/completion-runtime.mjs
--packaged` abre `dist/windows/win-unpacked/Lia.exe` e o Stage incluído nele.
Não executa o instalador NSIS nem prova instalação limpa. Preserve o pacote
testado e não o reconstrua enquanto o roteiro estiver ativo.

O perfil de produto e o Chromium do Stage são novos. O Launcher preserva seu
perfil original quando existente, ou usa o perfil separado `Lia/launcher-profile`:
**não é isolamento completo de todos os perfis**.
Feche qualquer Launcher do usuário antes de rodar; a trava de instância única
continua ativa. O roteiro não apaga perfis nem migra credenciais.

O fixture confirma seleção de modelo, transporte SSE, resposta visível,
memória opt-in/opt-out na requisição e mudança do contexto de personalidade.
Não avalia inteligência de um modelo externo nem áudio físico.

Presença valida dimensões, pausa e retorno ao Tamagotchi. `--presence-more`
exercita movimento, gravação de Home e colocação no segundo monitor conectado,
quando disponível. Não aprova jogos, hover/click-through, mudanças de DPI ou
recuperação por desconexão.
`--benchmark` coleta uma amostra exploratória dos PIDs observados no
desenvolvimento ou pacote, conferindo criação do pai e com CDP ativo; não mede FPS/GPU/impacto em jogos nem compara
engines. O relatório indica falha com código de saída diferente de zero.

Não copie perfis, logs brutos ou credenciais para o Git. A evidência resumida
e as limitações da rodada estão em
`docs/product/RELEASE-WINDOWS-2026-11-07-COMPLETION.md`.
