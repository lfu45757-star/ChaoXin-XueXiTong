param([Parameter(Mandatory = $true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'service-common.ps1')
$guard = New-Object Threading.Mutex($false, 'Local\Codex-Chaoxing-Local-Agent-18765')
$acquired = $false
try {
    try { $acquired = $guard.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { exit 0 }
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Configured Node.js executable is unavailable.' }
    Set-Location -LiteralPath $AgentRoot
    $data = Join-Path $AgentRoot 'data'
    [IO.Directory]::CreateDirectory($data) | Out-Null
    $log = Join-Path $data 'service-lifecycle.log'
    if (-not $env:CODEX_EXE) {
        $codex = Get-Command codex.exe -ErrorAction SilentlyContinue
        if ($codex) { $env:CODEX_EXE = $codex.Source }
    }
    # This only enables Node's support for existing per-process proxy variables.
    # It does not change the user's proxy variables, registry, or VPN bridge.
    $env:NODE_USE_ENV_PROXY = '1'
    # The extension's authenticated loopback protocol uses this fixed port.
    $env:PORT = [string]$AgentPort
    $arguments = '"' + $AgentServer + '"'
    while ($true) {
        # Adopt an already-running instance without spawning a duplicate. The
        # supervisor remains alive and takes over when that exact instance exits.
        while ($true) {
            $listeners = @(Get-AgentListener)
            if (-not $listeners.Count) { break }
            if (@($listeners | Where-Object { -not $_.owned }).Count) { throw 'Port 18765 belongs to another program; no process was stopped.' }
            Start-Sleep -Seconds 2
        }
        Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' starting local service') -Encoding UTF8
        $child = Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $AgentRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'service-stdout.log') -RedirectStandardError (Join-Path $data 'service-stderr.log') -PassThru
        $null = $child.Handle
        $child.WaitForExit()
        $child.Refresh()
        $code = if ($null -eq $child.ExitCode) { 'unknown' } else { [string]$child.ExitCode }
        Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + " service exited: $code; restarting in 60 seconds") -Encoding UTF8
        $child.Dispose()
        # Keep the parent task running while restarting the child. This avoids
        # relying solely on Task Scheduler's failure classification for wrappers.
        Start-Sleep -Seconds 60
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($acquired) { $guard.ReleaseMutex() }
    $guard.Dispose()
}
