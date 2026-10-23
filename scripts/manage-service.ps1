[CmdletBinding(SupportsShouldProcess = $true)]
param([ValidateSet('Start', 'Install', 'Status', 'Restart', 'Stop')][string]$Action = 'Start')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'service-common.ps1')

if ($Action -eq 'Status') {
    Get-AgentStatus | ConvertTo-Json -Depth 5
    exit 0
}

if ($Action -eq 'Stop' -or $Action -eq 'Restart') {
    if ($PSCmdlet.ShouldProcess($AgentTaskName, 'Stop local course service')) {
        $task = Get-ScheduledTask -TaskName $AgentTaskName -ErrorAction SilentlyContinue
        if ($task) {
            Stop-ScheduledTask -TaskName $AgentTaskName
            $stopDeadline = (Get-Date).AddSeconds(8)
            while ([string](Get-ScheduledTask -TaskName $AgentTaskName).State -eq 'Running') {
                if ((Get-Date) -ge $stopDeadline) { throw 'Service task is still stopping; no second instance was started.' }
                Start-Sleep -Milliseconds 200
            }
        }
        # Only an exact absolute server argument proves ownership of a legacy
        # manually-started Node listener. Never terminate another port owner.
        foreach ($listener in @(Get-AgentListener)) {
            if (-not $listener.owned) { throw 'Port 18765 belongs to another program; no process was stopped.' }
            Stop-Process -Id $listener.processId -ErrorAction SilentlyContinue
        }
    }
    if ($Action -eq 'Stop') { Get-AgentStatus | ConvertTo-Json -Depth 5; exit 0 }
}

$task = Get-ScheduledTask -TaskName $AgentTaskName -ErrorAction SilentlyContinue
if (-not $task -or $Action -eq 'Install') {
    $node = Get-Command node.exe -ErrorAction Stop
    $runner = Join-Path $PSScriptRoot 'run-service.ps1'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -NodePath "' + $node.Source + '"'
    $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $AgentRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    if ($PSCmdlet.ShouldProcess($AgentTaskName, 'Register current-user login startup and one-minute failure restart')) {
        Register-ScheduledTask -TaskName $AgentTaskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local Chaoxing agent on 127.0.0.1:18765. Current user only; no credentials stored.' -Force | Out-Null
    }
}
if ($PSCmdlet.ShouldProcess($AgentTaskName, 'Start local course service')) {
    $task = Get-ScheduledTask -TaskName $AgentTaskName
    if ([string]$task.State -ne 'Running') { Start-ScheduledTask -TaskName $AgentTaskName }
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $health = Get-AgentHealth
        if ($health.ok) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    $status = Get-AgentStatus
    $status | ConvertTo-Json -Depth 5
    if (-not $status.health.ok) {
        throw 'Local service did not become healthy. Check data\service-stderr.log and Task Scheduler.'
    }
}
