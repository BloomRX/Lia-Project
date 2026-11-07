# Lia — conclusão funcional e critérios de entrega

Retomada em 07/11/2026 sobre `40326d7`, branch `arena/01a10290-lia-project`.
Baseline funcional preservado: `3ef6d11`. Este documento organiza a missão;
não aprova release, segurança global nem serviço externo.

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
| Personalidade | Edição dos dez atributos e contexto, preservando identidade, regras e preset | Testes de projeção, persistência e Chromium; conversa real pendente |
| Memória | CRUD Main persistido, opt-in, consulta por turno e contexto só na requisição | Testes de armazenamento/privacidade/Chromium; gate integrado pendente |
| Presença | Contrato Core, serviço de janela Main, preferência canônica e painel | Limites e recuperação simulados; multimonitor físico/jogos pendentes |
| Editor genérico de credenciais | Usa porta segura nos provedores já migrados, preserva legado/web | Testes de draft e Chromium; não fecha credenciais de todos os protocolos |
| Distribuição Windows | Pipeline privado Launcher + Stage, resolução sem Node/pnpm no destino | Testes de contrato; instalação limpa ainda precisa gate real |
| Home | Asset oficial da Lia e feedback de falha | Build e testes; comparação completa com sete concepts pendente |

O agente da configuração IA foi interrompido por quota antes da revisão final.
A retomada corrigiu concorrência entre save/start e recuperação insegura de
credenciais. A presença também tinha restauração fora da tela após remoção de
monitor; regressão reproduzida e corrigida. Nenhuma afirmação de subagente foi
usada como substituto de teste ou runtime.

## Pendências por dependência e impacto

1. Validar configuração → descoberta → ferramenta → abrir Stage → personagem
   visível → conversa → encerramento, em perfil isolado Windows. Serviço HTTP
   sintético prova integração local; não aprova um serviço de IA real.
2. Executar build, pacote privado, abertura instalada e ciclo de vida sem
   ferramentas de desenvolvimento no caminho de execução.
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
