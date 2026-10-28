---
name: lia-vue-development
description: Desenvolve e revisa Vue 3, TypeScript, Pinia e VueUse na Lia, quando a área afetada realmente usa essa stack.
---
# Desenvolvimento Vue na Lia
- Leia regras locais e confirme versões e padrões dos componentes vizinhos.
- Prefira Composition API e `<script setup lang="ts">` quando compatível com o padrão local; não converta Options API em massa sem necessidade.
- Para funcionalidade com vários componentes, defina responsabilidades, props, emits e estado antes de implementar.
- Mantenha uma única fonte de verdade; derive valores com `computed` em vez de duplicar estado.
- Use `ref`/`reactive` conforme a necessidade observada; não troque por `shallowRef` só por preferência.
- Mantenha fluxo explícito: props para baixo, eventos para cima. Use `v-model` quando o contrato for realmente bidirecional.
- Extraia composables quando a lógica for reutilizada, stateful ou tiver efeitos colaterais; evite abstração prematura.
- Verifique se Pinia/VueUse já estão instalados antes de usar suas APIs. Ao desestruturar estado/getters Pinia, preserve reatividade com `storeToRefs()`.
- Reutilize tokens, componentes e atalhos do projeto; regras do AIRI não substituem o design system da Lia.
- Preserve foco acessível, semântica, teclado e estados de loading/erro/vazio. Não use `v-html` com conteúdo não confiável sem sanitização.
- Rode typecheck, lint e testes pertinentes. Registre o que não foi possível executar.
