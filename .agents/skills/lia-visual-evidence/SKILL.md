---
name: lia-visual-evidence
description: Produz evidência visual repetível de fluxos da Lia em Electron ou navegador usando Vishot quando disponível. Use ao registrar um gate visual com a ferramenta disponível.
compatibility: Requer Vishot e runtime disponível; não instala Playwright/Chromium sem autorização.
---
# Evidência visual reproduzível
1. Identifique aplicação, rota/janela, estado, viewport, tema, idioma, fixtures e diretório de saída.
2. Procure cenários de captura do produto antes de criar automação temporária.
3. Se necessário, crie o menor cenário descartável fora das pastas versionadas, salvo autorização para productizá-lo.
4. Em Electron, identifique a janela por URL/título e estado, não pela ordem de criação. Use dimensões nativas quando a captura precisa refletir a janela visível.
5. Em navegador, configure viewport antes da captura. Captura web não prova UI nativa.
6. Espere uma condição específica e visível; o tempo de settle é complemento, não substituto da prontidão.
7. Use fixtures locais e dados sintéticos. Não use páginas remotas não confiáveis nem dados pessoais.
8. Inspecione cada imagem. Rejeite tela branca, carregamento, erro, permissão, onboarding ou estado instável, exceto se esse for o estado solicitado.
9. Retorne manifesto com ID, título, runtime, viewport e caminho absoluto. Se falhar, reporte motivo sem inventar caminho.
10. Para comparação antes/depois, mantenha viewport, idioma, tema, fixtures e prontidão iguais.
Capturas demonstram aparência do estado capturado, não acessibilidade, teclado, lógica ou funcionamento em produção.
