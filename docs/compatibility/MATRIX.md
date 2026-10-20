# Matriz de compatibilidade da Lia

Atualização: 20/10/2026. Baseline funcional permanece `3ef6d11`.
Os estados de suporte não substituem os resultados de cada verificação.

| Plataforma | GPU | Estado de suporte | Evidência |
| --- | --- | --- | --- |
| Windows | AMD RX 580, perfil do Dev | Experimental | Launcher e Stage visível pelo fluxo normal nesta rodada; encerramento gerenciado observado. Release e instalação limpa ainda não aprovadas |
| Windows | NVIDIA | Untested | NÃO EXECUTADO |
| Windows | Intel | Untested | NÃO EXECUTADO |
| Windows | CPU-only | Untested | NÃO EXECUTADO |
| Linux | NVIDIA | Untested | NÃO EXECUTADO |
| Linux | AMD | Untested | NÃO EXECUTADO |
| macOS | Apple Silicon | Untested | NÃO EXECUTADO |

## Verificações do Windows local

| Componente | Resultado | Limite da evidência |
| --- | --- | --- |
| Launcher por `Lia.bat` | PASS Windows real | Janela e Home observadas |
| Pré-requisito `core-agent` | PASS Windows real | `starting` → `succeeded`, 3,6 s, sem aumento de timeout |
| Runtime Node do Stage | PASS Windows real | `node-from-path`; processo `node.exe` observado |
| Avatar Tamagotchi | PASS Windows real | Personagem Live2D upstream renderizada, não o modelo canônico da Lia |
| Encerramento gerenciado | PASS Windows real | 606 ms; PID do Stage e processos Electron do checkout ausentes após fechar |
| Conversa de texto desta rodada | PASS Windows real | Após corrigir seleção local, nova conversa manteve sessão e resposta 42 visível |
| Imagem determinística | FAIL | Rota Qwen observada; quotas 429/413 e tentativa com log de sucesso sem resposta assistant; causa ainda em investigação |
| Cadeia de voz B1/B1.1 | PASS Windows real histórico | Baseline `3ef6d11`; esta rodada observou prewarm/síntese, sem novo teste de microfone humano |
| Lia Livre / múltiplos monitores | NÃO EXECUTADO | Implementação de produto ausente |
| Instalador e instalação limpa | NÃO EXECUTADO | Launcher ainda sem contrato de empacotamento de release |

Evidências e limitações: [relatório da rodada](../product/RELEASE-WINDOWS-2026-10-20.md).
