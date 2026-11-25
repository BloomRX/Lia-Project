---
name: lia-pnpm-workspaces
description: Trabalha com pnpm, dependências e workspaces no repositório Lia. Use antes de alterar dependências, filtros ou builds.
---
# pnpm e workspaces
- Confira os manifests e lockfiles dos pacotes em `lia/` e o preparo feito por `Lia.bat -PrepareOnly` antes de propor comandos.
- Execute a partir do diretório correto e use nomes reais dos pacotes. Confirme filtros com comandos de inspeção disponíveis.
- Prefira builds/testes direcionados. Use `--frozen-lockfile` em CI e não regenere lockfile sem mudança intencional.
- Não execute install/update/add/dlx ou scripts de instalação como exploração sem autorização; podem baixar código e executar scripts.
- Não assuma que `--ignore-scripts` deixa o workspace pronto; alguns pacotes precisam de build.
- Antes de limpar outputs/caches, confirme caminho e que não contêm trabalho do usuário.
- Registre diretório, comando, código de saída e artefatos.
