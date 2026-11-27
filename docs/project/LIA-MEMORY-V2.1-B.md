# Lia Memory V2.1-B — notas Markdown locais

Base `df8aa959`, worktree isolado em J:/Lia/_worktrees/Lia-Project/memory-v21b.
As mudanças locais de organização do coletor e as alterações anteriores da
V2 ficaram nos checkouts de origem.

A implementação adapta o núcleo de leitura do [LR-CMP-006](https://github.com/BloomRX/Lia-Research/blob/05c89fd0b5d1723b8c77559e28f164bb9dab42d6/comparisons/MD-NOTES-INTEGRATION.md).
O painel de Memória do Stage permite conectar uma pasta por projeto via
seletor nativo. O Main deduz o projeto pelo contexto existente, mantém
a escolha no perfil e permite revogação. Sem projeto não há acesso. A
escolha armazena caminho e identidade da pasta, sem gravar trechos.

A busca manual monta um índice descartável para aquela consulta. Lê
Markdown UTF-8 e devolve caminhos relativos, SHA-256, tamanho, modificação,
linha e trecho. O resultado é uma fotografia daquela consulta. Repetir a
busca reconcilia alterações e exclusões na pasta sem usar hits anteriores.
Os tetos são 4.096 entradas visitadas, 12 níveis, 400.000 bytes por arquivo,
8.000.000 bytes por consulta, 12 resultados e 240 caracteres por trecho.
Entradas ocultas por nome, diretórios internos, links, junctions e arquivos
com múltiplos hard links ficam fora da busca. A abertura e a leitura
verificam identidade, metadados e caminho canônico. O mecanismo não é
uma sandbox contra outro processo local alterando simultaneamente o filesystem.

O painel exibe texto literal. O caminho de Markdown não chama o provedor,
não inclui trechos no chat e não altera o armazenamento da memória interna.
A V2.1-A permanece responsável pelos escopos da memória interna. Não há
escrita de notas, embeddings, sincronização ou integração com serviços.

## Gates

- Node. Dois testes focados, incluindo 4.200 notas, caminho relativo,
  travessia, junction, diretórios proibidos, nota longa, mudança, remoção,
  indisponibilidade e persistência por projeto. A suíte do Stage passou com 60.
- Windows. Build e typecheck do Stage e lint do desktop passaram.
- Electron Windows. `node lia/desktop/scripts/check-native-markdown.mjs`
  passou com filesystem real e retorno injetado do seletor de pasta,
  sem serviço de modelo. Confirmou seleção, proveniência, texto literal,
  isolamento, reabertura, mudança da fonte, indisponibilidade e revogação.
  Relatório e captura em J:/Lia/_evidence/memory-v21b.
- Regressão de histórico e memória V2.1-A. `check-native-history.mjs`
  passou no Electron Windows com serviço HTTP local sintético.
