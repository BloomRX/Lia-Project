# Origem e manutenção

## Patches locais de segurança — 28/10/2026

Sobre v19, comparada anteriormente com `c36c341c34360f970a07fe3e2d2600ca2bba8ed2`:
editor com DOM/textContent e filtro de URL; runner com reserva atômica de
estimativas e diagnóstico de excedentes. Não é nova versão upstream.
Preservar esses patches ao comparar atualizações. Testes e limites em
`docs/architecture/ALETHE-HARDENING-2026-10-28.md` na raiz do repositório Lia.

- Projeto original: https://github.com/Kc1t/alethe-orchestrate-skill
- Versão upstream: 19 (2026-10-23)
- Licença: MIT; cópia em `LICENSE`
- Skill instalada em: `.agents/skills/alethe/`
- Fonte consultada: branch `main`, em 2026-10-28
- Tutorial complementar: https://github.com/anthropics/claude-cookbooks/blob/main/managed_agents/CMA_plan_big_execute_small.ipynb

## Escopo desta cópia

A skill, seus scripts, playbooks, referências, esquema de plano e templates HTML foram copiados para preservar o funcionamento local. O app desktop Alethe e o dashboard da demonstração não são dependências da skill e não foram incorporados.

Antes de atualizar, comparar o upstream por conteúdo, rever alterações em scripts executáveis e manter as regras específicas da Lia no catálogo de skills. A cópia no repositório não instala CLIs, não configura credenciais e não comprova que o Codex local detecta ou executa a skill.
