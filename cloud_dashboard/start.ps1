param(
    [string]$EnvFile = 'C:\wjw\soclaas.env',
    [switch]$LAN,
    [ValidateRange(1024, 65535)][int]$Port = 8000,
    [switch]$NoSimulator,
    [switch]$Install,
    [switch]$Test
)
$ErrorActionPreference = 'Stop'
$taskPreviousEnvFile = $env:SOCLAAS_ENV_FILE
$taskPreviousSimulator = $env:GREENHOUSE_SIMULATOR
Push-Location $PSScriptRoot
try {
    $taskPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $taskPython)) {
        Write-Host 'Creating the local Python 3.11 environment...'
        & py -3.11 -m venv (Join-Path $PSScriptRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required. Install it or repair its Windows launcher registration.' }
        $Install = $true
    }
    if ($Install) {
        & $taskPython -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $taskPython -c 'import fastapi, uvicorn, httpx, dotenv'
    if ($LASTEXITCODE -ne 0) { throw 'Dependencies are missing. Run .\start.ps1 -Install.' }
    if ($Test) {
        & $taskPython -m pytest -q
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard tests failed.' }
        return
    }
    if ($EnvFile) {
        $env:SOCLAAS_ENV_FILE = [System.IO.Path]::GetFullPath($EnvFile)
        if (-not (Test-Path -LiteralPath $EnvFile)) { Write-Host 'The .env file was not found. Dashboard and simulation can run without AI.' }
    }
    $env:GREENHOUSE_SIMULATOR = if ($NoSimulator) { '0' } else { '1' }
    $taskBindAddress = if ($LAN) { '0.0.0.0' } else { '127.0.0.1' }
    Write-Host "Dashboard: http://127.0.0.1:$Port"
    if ($LAN) { Write-Host 'LAN enabled: ESP32 uses your laptop network address, not localhost.' }
    Write-Host 'Press Ctrl+C to stop.'
    & $taskPython -m uvicorn backend.app:app --host $taskBindAddress --port $Port --workers 1
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard server could not start or exited with an error.' }
} finally {
    $env:SOCLAAS_ENV_FILE = $taskPreviousEnvFile
    $env:GREENHOUSE_SIMULATOR = $taskPreviousSimulator
    Pop-Location
}
