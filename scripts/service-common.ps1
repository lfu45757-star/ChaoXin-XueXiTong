$ErrorActionPreference = 'Stop'
$AgentRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$AgentServer = Join-Path $AgentRoot 'server.mjs'
$AgentTaskName = 'Codex-Chaoxing-Local-Agent'
$AgentPort = 18765

function Get-AgentHealth {
    $tokenPath = Join-Path $AgentRoot 'data\token.txt'
    if (-not (Test-Path -LiteralPath $tokenPath)) {
        return [pscustomobject]@{ ok = $false; reason = 'token_missing' }
    }
    $response = $null
    try {
        # The health check is always loopback, regardless of system/VPN proxy mode.
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$AgentPort/health")
        $request.Proxy = $null
        $request.Timeout = 1500
        $request.ReadWriteTimeout = 1500
        $request.Headers['Authorization'] = 'Bearer ' + [IO.File]::ReadAllText($tokenPath).Trim()
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream())
        try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($health.ok -ne $true -or -not $health.version) {
            return [pscustomobject]@{ ok = $false; reason = 'unexpected_response' }
        }
        return [pscustomobject]@{ ok = $true; version = $health.version; provider = $health.provider; busy = [bool]$health.busy }
    } catch [Net.WebException] {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        return [pscustomobject]@{ ok = $false; reason = $(if ($status -eq 401) { 'unauthorized' } else { 'not_connected' }) }
    } catch {
        return [pscustomobject]@{ ok = $false; reason = 'invalid_response' }
    } finally {
        if ($response) { $response.Dispose() }
    }
}

function Get-AgentListener {
    $listeners = @(Get-NetTCPConnection -LocalPort $AgentPort -State Listen -ErrorAction SilentlyContinue)
    foreach ($connection in $listeners) {
        $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
        $pattern = '(?:^|\s)"?' + [regex]::Escape($AgentServer) + '"?(?:\s|$)'
        [pscustomobject]@{
            processId = [int]$connection.OwningProcess
            owned = [bool]($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -match $pattern)
        }
    }
}

function Get-AgentStatus {
    $task = Get-ScheduledTask -TaskName $AgentTaskName -ErrorAction SilentlyContinue
    $info = if ($task) { Get-ScheduledTaskInfo -TaskName $AgentTaskName } else { $null }
    $health = Get-AgentHealth
    $listeners = @(Get-AgentListener)
    [pscustomobject]@{
        taskName = $AgentTaskName
        taskInstalled = [bool]$task
        taskState = $(if ($task) { [string]$task.State } else { 'NotInstalled' })
        lastTaskResult = $(if ($info) { $info.LastTaskResult } else { $null })
        health = $health
        listeners = $listeners
    }
}
