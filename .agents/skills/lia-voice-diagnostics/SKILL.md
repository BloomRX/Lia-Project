---
name: lia-voice-diagnostics
description: Investiga falhas no caminho de voz da Lia, separando microfone/permissões, captura, VAD, STT, modelo conversacional, TTS, reprodução e interrupção. Use quando a voz não inicia, não é transcrita, não é reproduzida ou apresenta latência/erros.
compatibility: Testes completos de áudio exigem dispositivos e permissões reais; mocks e logs não substituem validação auditiva no Windows.
---

# Diagnóstico de voz da Lia

## 1. Mapear o caminho antes de mudar código

Identifique a implementação ativa e os provedores configurados. Separe as etapas:

1. permissão e seleção do microfone;
2. captura de áudio;
3. VAD/detecção de fala, quando usado;
4. STT/transcrição;
5. envio ao modelo conversacional e resposta textual;
6. TTS/geração de áudio;
7. reprodução, cancelamento e interrupção;
8. limpeza de recursos e encerramento.

Não presuma que o caminho é o mesmo entre modo de voz, chat de texto, launcher e Stage. Confirme os pontos de entrada no código.

## 2. Reproduzir e isolar

- Descreva o sintoma com passos exatos e resultado esperado/observado.
- Mude uma variável por vez: dispositivo, provedor, idioma, modo, entrada de texto/áudio ou etapa do pipeline.
- Use o harness real do componente afetado. Um teste unitário pode isolar a lógica, mas não prova captura ou reprodução física.
- Para trace de conversa/áudio, leia primeiro a skill de análise de traces do AIRI se ela existir no checkout atual; a cópia vendada atual pode não conter todas as skills do upstream.
- Compare timestamps apenas se o sistema realmente os registra; não invente latência a partir da duração total de um teste.

## 3. Privacidade e segurança

- Não registre áudio bruto, transcrições pessoais, tokens, chaves, cabeçalhos de autorização ou identificadores desnecessários.
- Prefira metadados mínimos: etapa, estado, código de erro, duração já instrumentada, provedor/modelo não sensível e correlation ID não secreto.
- Use amostras sintéticas ou consentidas. Não envie áudio privado a serviços externos sem autorização.
- Nunca introduza Web Speech ou outro fallback silencioso sem verificar os requisitos e a arquitetura de produto da Lia.

## 4. Distinguir falhas

Classifique separadamente: dispositivo/permissão, captura, detecção, transcrição, provedor/modelo, síntese, reprodução, interrupção e limpeza. Uma transcrição correta não prova que TTS funcionou; áudio gerado não prova que foi reproduzido; um mock verde não prova hardware real.

## 5. Critério de conclusão

Uma correção exige teste de regressão dirigido e execução da suíte apropriada. Quando o comportamento depende de microfone, alto-falante, permissões ou hardware que não está disponível, reporte BLOCKED/NOT RUN e descreva o teste manual exato necessário. Nunca declare a experiência de voz completa sem validação real.
