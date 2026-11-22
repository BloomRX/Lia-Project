# Skills gerenciadas pelo Lia Agent Hub

O Lia-Project fixa 28 Skills por revisão e hash. Depois de clonar o
projeto, use a CLI Windows do Agent Hub e o canal local de pacotes
para preparar as cópias que o host descobre em `.agents/skills`.
Os caminhos gerados são ignorados pelo Git.

Na raiz do Lia-Project, com PowerShell:

```powershell
$hubCli = 'J:/Lia/Lia-AgentHub-Workspace/arena/a92004be-lia-agenthub/dist/LiaAgentHubCli.exe'
$channel = 'J:/Lia/migration/agent-hub/private-consumption-v2/lia-project'
$eventa = @(Get-ChildItem -LiteralPath $channel -Recurse -File -Filter 'lia-eventa-ipc-*.lia-capability')
if ($eventa.Count -ne 1) { throw 'O canal deve conter exatamente um pacote Eventa.' }
& ./tools/prepare_eventa_skill.ps1 -HubCli $hubCli -PackagePath $eventa[0].FullName
& ./tools/prepare_airi_hub_skills.ps1 -HubCli $hubCli -BundleDirectory "$channel/airi"
python tools/verify_hub_skills.py
```

Ajuste os dois caminhos ao seu ambiente. Para um checkout já preparado,
execute apenas o verificador. Os scripts de preparação esperam destinos
novos. Mudanças nas Skills gerenciadas devem passar pelo Hub e pela
atualização explícita dos pins no Lia-Project.
