$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'scripts\manage-service.ps1') -Action Start
