param(
    [Parameter(Mandatory=$true)][string]$ConfigPath,
    [switch]$Apply,
    [switch]$InstallDependencies,
    [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
# Resolve the caller's project path before Push-Location changes the working directory.
if (-not [System.IO.Path]::IsPathRooted($ConfigPath)) { $ConfigPath = Join-Path (Get-Location).Path $ConfigPath }
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js >=20.12 first, then rerun this command. Setup does not install Node or modify PATH.' }
Write-Output "Rift setup scope: package-local dependencies/build/credential/bootstrap and Rift registration in $ConfigPath only. No model/provider settings or Windows services are changed."
if (-not (Test-Path (Join-Path $Root 'node_modules/typescript'))) {
    if (-not ($Apply -and $InstallDependencies)) { throw 'Dependencies are missing. Review package-lock.json, then explicitly add -Apply -InstallDependencies to authorize npm ci in this folder.' }
    Push-Location $Root
    try { & npm.cmd ci; if ($LASTEXITCODE) { throw 'npm ci failed; setup did not edit OpenCode configuration.' } } finally { Pop-Location }
}
Push-Location $Root
try {
    & npm.cmd run build
    if ($LASTEXITCODE) { throw 'Build failed; setup did not edit OpenCode configuration.' }
    $Arguments = @((Join-Path $Root 'dist/cli.js'), $(if ($Rollback) { 'migrate' } else { 'setup' }), '--config', $ConfigPath)
    if ($Apply) { $Arguments += '--apply' }
    if ($Rollback) { $Arguments += '--rollback' }
    & node @Arguments
    if ($LASTEXITCODE) { throw 'Rift setup stopped. Inspect the diagnostic; existing credentials are retained.' }
} finally { Pop-Location }
