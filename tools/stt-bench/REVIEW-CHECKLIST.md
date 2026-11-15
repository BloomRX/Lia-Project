# Checklist de revisão independente

> **Preenchido em 11/11/2026:** resultado item a item, defeitos encontrados
> e evidências em [`REVIEW-2026-11-11.md`](REVIEW-2026-11-11.md). Este
> arquivo continua como roteiro para uma segunda revisão.

Antes da primeira execução no Windows real, um revisor que **não escreveu** estes
arquivos deve confirmar os pontos abaixo. Cada item é verificável por leitura ou
por comando; nenhum depende de confiar no autor.

## 1. O script não faz mais do que promete

- [ ] `stt_bench.py` não tem cliente HTTP além do `huggingface_hub` usado pelo
      `faster-whisper` (`grep -n "requests\|urllib\|http" stt_bench.py`).
- [ ] Sem `--allow-download`, o caminho de execução termina em `return 3` antes
      de importar o modelo.
- [ ] Nenhum `subprocess`, `os.system` ou shell é invocado pelo Python.
- [ ] Nenhum serviço residente, tarefa agendada ou alteração de registro.

## 2. Os limites são reais

- [ ] `--max-samples` e `--max-bytes` são **clampados** (não apenas default):
      passar 50 resulta em 10 no JSON.
- [ ] `validate_samples` recusa arquivo inexistente, extensão estranha (aviso) e
      total acima de 100 MB (erro).
- [ ] Nenhum `.wav`/`.mp3`/`.flac` está versionado
      (`git ls-files tools/stt-bench`).

## 3. O resultado é honesto

- [ ] `compute_verdict` só devolve `validated` com ≥5 amostras, ≥30 s, WER ≤0,15
      e RTF ≤1,0.
- [ ] `catalogPromotion.eligible` exige `environment ==
      "windows-reference-machine"`.
- [ ] `--self-test` nunca produz `validated`.
- [ ] WER agregado é de corpus, não média de WERs (ver `aggregate_scores`).
- [ ] O JSON grava as versões instaladas (`runtime.dependencies`) e a revisão
      dos pesos (`weights.revision`).
- [ ] O caminho pessoal do cache é redigido para `~`.

## 4. O Windows é plausível

- [ ] `run-stt-bench.ps1` é ASCII puro (PS 5.1 lê sem BOM como ANSI).
- [ ] Não usa `?.`, `??` nem ternário.
- [ ] Splatting só com variável de array (nunca `@(...)` inline após comando).
- [ ] `Invoke-Python` usa `Out-Host` para a saída não virar valor de retorno.
- [ ] Chaves, parênteses e colchetes balanceados.
- [ ] `run-stt-bench.bat` usa CRLF e ASCII.

## 5. O que continua sem prova (não marcar como resolvido)

- [ ] PowerShell 5.1 executando de verdade.
- [ ] `pip install -r requirements-stt-bench.txt` concluindo em Windows.
- [ ] `faster-whisper` importando com `huggingface-hub==2.4.0`.
- [ ] Qualquer número de WER, RTF ou RAM.

Enquanto algum item desta seção estiver aberto, o catálogo permanece com
**0 validados** para STT.

## Como reportar

Se um item falhar, o relatório precisa de: comando exato, saída completa, versão
de Python, `pip freeze` e o JSON produzido (ou a ausência dele). "Não funcionou"
não é reproduzível; o comando é.
