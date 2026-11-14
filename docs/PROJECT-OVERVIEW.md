# Lia — visão do produto

Lia é um aplicativo desktop de AI Companion/personagem virtual. Deve ser um produto independente, fácil de instalar e usar por pessoas leigas, mas configurável por usuários avançados.

## Princípios
- A experiência deve esconder complexidade técnica no fluxo comum (o “Grandma Test”).
- O usuário deve poder escolher entre opções locais, gratuitas e pagas, com transparência sobre capacidades e custos.
- A arquitetura deve ser orientada a capacidades e contratos próprios da Lia, sem amarrar o produto a um fornecedor.
- AIRI é referência técnica externa para estudo, não runtime obrigatório, dependência estrutural ou identidade do produto.
- Não aumentar acoplamento com a pasta `airi/`; a direção é possuir Stage, domínio, IPC e experiência próprios.
- Hardware agnóstico: considerar NVIDIA, AMD, Intel, Apple e CPU-only; não presumir CUDA ou ROCm.
- Segurança: credenciais pertencem ao lado confiável do host; renderer não deve receber tokens nem autoridade indevida.
- A experiência deve suportar personagens e personalidades múltiplas, mesmo que Lia seja a personagem padrão.

## Áreas de produto
Launcher/configuração, Stage/personagem, Core/contratos, providers de IA, memória, voz (STT/TTS), visão, ferramentas/integrações, permissões, distribuição e atualização.

## Regra de interpretação
Este documento registra direção de produto. Não é prova de que cada capacidade já esteja implementada.
