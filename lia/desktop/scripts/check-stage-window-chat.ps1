$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Wait-StageElement([string]$Name, $ControlType, [int]$Seconds) {
  $deadline = [datetime]::UtcNow.AddSeconds($Seconds)
  do {
    $stageProcess.Refresh()
    if ($stageProcess.HasExited) { throw 'O Stage encerrou antes de completar o ensaio.' }
    if ($stageProcess.MainWindowHandle -ne [IntPtr]::Zero) {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($stageProcess.MainWindowHandle)
      $conditions = @(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ControlType)
      )
      $match = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]$conditions))
      if ($null -ne $match) { return $match }
    }
    Start-Sleep -Milliseconds 150
  } while ([datetime]::UtcNow -lt $deadline)
  throw "Controle do Stage indisponível: $Name"
}

$stageProcess = Get-Process -Id ([int]$env:LIA_UIA_STAGE_PID)
$message = Wait-StageElement 'Mensagem' ([System.Windows.Automation.ControlType]::Edit) 8
$value = $message.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue($env:LIA_UIA_MESSAGE)
$send = Wait-StageElement 'Enviar' ([System.Windows.Automation.ControlType]::Button) 4
$send.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
$null = Wait-StageElement $env:LIA_UIA_REPLY ([System.Windows.Automation.ControlType]::Text) ([int]$env:LIA_UIA_REPLY_SECONDS)
