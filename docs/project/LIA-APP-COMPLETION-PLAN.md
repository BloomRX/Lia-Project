# Lia — conclusão funcional e critérios de entrega

Retomada em 07/11/2026 sobre `40326d7`, branch `arena/01a10290-lia-project`.
Baseline funcional preservado: `3ef6d11`. Este documento organiza a missão;
não aprova release, segurança global nem serviço externo.

Continuação beta de 08/11: [gates, correções e dependências atuais](../product/LIA-BETA-READINESS-2026-11-08.md).
A auditoria classificou famílias legadas alcançáveis de credenciais, ainda não
migradas integralmente; são P0 antes de beta. Baseline de uma hora disponível,
sem aprovar baixo consumo. Instalação limpa e direitos de assets continuam abertos.

## Inventário da execução interrompida

O preflight encontrou 19 arquivos rastreados modificados, mais novos arquivos
de implementação/testes. Nenhum arquivo estava staged. HEAD e upstream local
coincidiam. Os três agentes recuperáveis estavam concluídos ou interrompidos,
nenhum em execução. Processos Node preexistentes foram inventariados sem
encerrá-los. Os nomes históricos de agentes não disponíveis nesta árvore não
foram tratados como prova de entrega: seus arquivos e testes foram examinados.

| Frente recuperada | Estado da implementação | Validação e limite |
| --- | --- | --- |
| Configuração IA no Launcher | Integrada ao host/Main, cofre e transporte; descoberta e teste completo de ferramenta | Testes HTTP locais e concorrência; serviço externo pendente |
| Personalidade | Edição dos dez atributos e contexto, preservando identidade, regras e preset | Testes de projeção/Chromium e mudança de contexto na requisição Windows local; qualidade de modelo externo pendente |
| Memória | CRUD Main persistido, opt-in, consulta por turno e contexto só na requisição | Testes e fluxo Windows local opt-in/opt-out; política global e serviço externo pendentes |
| Presença | Contrato Core, serviço Main, preferência canônica e painel | Corpo inteiro aprovado; movimento, pausa, Home e segundo monitor conectado PASS Windows; desconexão/DPI/jogos pendentes |
| Editor genérico de credenciais | Usa porta segura nos provedores já migrados, preserva legado/web | Testes de draft e Chromium; não fecha credenciais de todos os protocolos |
| Distribuição Windows | Pipeline privado Launcher + Stage, resolução sem Node/pnpm no destino | NSIS gerado; dois gates dos executáveis empacotados PASS Windows com HTTP sintético; instalação limpa e assinatura pendentes |
| Home | Asset oficial da Lia e feedback de falha | Build e testes; comparação completa com sete concepts pendente |

O agente da configuração IA foi interrompido por quota antes da revisão final.
A retomada corrigiu concorrência entre save/start e recuperação insegura de
credenciais. A presença também tinha restauração fora da tela após remoção de
monitor; regressão reproduzida e corrigida. Nenhuma afirmação de subagente foi
usada como substituto de teste ou runtime.

## Pendências por dependência e impacto

1. Validar o fluxo contra serviço de IA real autorizado. Configuração → descoberta
   → ferramenta → abrir Stage → conversa → encerramento já passou com HTTP
   sintético no Windows, em desenvolvimento e nos executáveis empacotados.
   Produto e Stage usam dados novos; perfil Chromium Launcher é preservado.
2. Validar instalação limpa, atualização e desinstalação. Build, geração de NSIS
   privado e ciclo de vida dos executáveis incluídos passaram; não equivalem à
   execução do instalador em Windows limpo.
3. Completar migração de chat fora do catálogo e STT de sessão por protocolo;
   revisar consumidores remanescentes de credenciais. Não declarar cofre global
   fechado enquanto esses caminhos existirem.
4. Validar voz física, interrupção, imagem + texto e falhas contra serviços
   autorizados. O endereço informado anteriormente não garante serviço ativo.
5. Fechar presença Livre: proporções e interação reais, ocultação e input,
   pausa com jogo externo, recuperação entre monitores/DPI e execução prolongada.
6. Completar Aparência, Ferramentas, privacidade, acessibilidade e tradução;
   controles decorativos ou páginas somente contratuais continuam parciais.
7. Definir licenças de produto/assets, atualização própria, assinatura e gates
   de instalação limpa/atualização/desinstalação antes da distribuição pública.
8. Medir custo do produto atual; só abrir protótipo de engine por hipótese
   mensurável. A frente de engines não substitui a conclusão funcional.
   A decisão de runtime de 12/11 ([relatório](../reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md))
   manteve Electron no Cenário C (híbrido), com gatilhos objetivos e um
   experimento de runtime único antes de qualquer migração. O plano funcional
   do AI Settings está em [LIA-AI-SETTINGS-END-TO-END-PLAN](LIA-AI-SETTINGS-END-TO-END-PLAN.md).

## Definition of Done

- [ ] Instalação limpa Windows, abertura e configuração sem terminal, demonstradas.
- [ ] Serviço real: modelos descobertos, seleção persistida e ida/volta de ferramenta.
- [ ] Conversa texto/imagem e voz física, com cancelamento e falha recuperável.
- [ ] Presença e monitores reais, foco/jogos, ociosidade e recuperação validados.
- [ ] Preferências com efeito real, persistência e feedback em pt-BR/en.
- [ ] Memória/privacidade/permissões e segredos validados no produto integrado.
- [ ] Licenças/assets, instalador, atualização e troubleshooting aprovados.
- [ ] Testes, lint, typecheck, build e gates Windows correspondentes ao código final.

Evidências da retomada e comandos ficam no relatório
[`RELEASE-WINDOWS-2026-11-07-COMPLETION.md`](../product/RELEASE-WINDOWS-2026-11-07-COMPLETION.md).
Estudo de arquitetura separado em
[`LIA-DESKTOP-ENGINE-EVALUATION.md`](../architecture/LIA-DESKTOP-ENGINE-EVALUATION.md).
