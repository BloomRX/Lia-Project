# Reproduções sintéticas — auditoria `ae46c4`

Os quatro arquivos desta pasta são **bancadas de auditoria**, não código do produto. Executam módulos reais obtidos do SHA auditado com dependências e fronteiras externas controladas; não acessam rede ou credenciais reais. Os testes têm assertions do comportamento observado, não de um comportamento de segurança desejado.

A partir da raiz do repositório, em shell Linux com Node 22, npm, tar e acesso ao registry npm, prepare um diretório temporário isolado:

```sh
set -eu
SHA=ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6
D=$(mktemp -d)
cp docs/reports/evidence/lia-audit-ae46c4/{tools-probe.ts,tools-build.mjs,auth-probe.ts,auth-build.mjs} "$D"/
git archive "$SHA" airi/packages/stage-ui/src/stores | tar -x -C "$D"
printf '{"type":"module","private":true}\n' > "$D/package.json"
npm install --prefix "$D" --ignore-scripts --no-audit --no-fund --package-lock=false pinia@4.0.3 vue@3.5.26 esbuild@0.25.12 es-toolkit@1.39.10
(cd "$D" && node tools-build.mjs && node tools-bundle.mjs && node auth-build.mjs && node auth-bundle.mjs)
```

`tools-build.mjs` substitui as importações de fontes não relevantes ao experimento; as duas fontes de ferramentas injetadas e os executores são sintéticos. Store, resolvedor e rerun são os reais do SHA. A saída esperada demonstra guarda do executor capturado, apresentação após mudança concorrente e colisão de uma segunda fonte com o mesmo nome. A segunda fonte é distinta: **não** demonstra que o executor desabilitado rodou.

`auth-build.mjs` substitui timers, rede/issuer, dependências de interface e `localStorage` por fixtures. Logout falha por rede sintética; refresh atrasado e validação de sessão são simulados como sucesso. A saída esperada demonstra o estado local reintroduzido; não demonstra que issuer real aceite uma sessão revogada. O erro `Server sign-out failed synthetic offline logout` é deliberado.

Na execução desta rodada, ambos os programas retornaram 0. `tools-probe.ts` reportou `disabled=true`, `byName=0`, `capturedRejected=true`, `raceSchema=["synthetic_tool"]`, `raceRejected=true`, `rawCalls=0` e `altCalls=1`. `auth-probe.ts` reportou `clearedAfterLogout=true`, `restoredToken=true`, `restoredRefresh=true`, `clientIdAfterLogout=false`, `authenticated=true`.
