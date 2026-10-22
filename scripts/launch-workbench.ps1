param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$workbenchRoot = Split-Path -Parent $PSScriptRoot
$workbenchPort = 4310
$workbenchEnvFile = Join-Path $workbenchRoot '.env'

function Test-WorkbenchReady {
    param([string]$BaseUrl)
    try {
        $probe = [System.Net.HttpWebRequest]::Create("$BaseUrl/api/health")
        $probe.Proxy = $null
        $probe.Timeout = 1500
        $probe.ReadWriteTimeout = 1500
        $response = $probe.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try { $result = $reader.ReadToEnd() | ConvertFrom-Json }
            finally { $reader.Dispose() }
            return ($result.mode -in @('demo', 'live') -and $result.model -is [string])
        } finally { $response.Dispose() }
    } catch { return $false }
}

try {
    if (Test-Path -LiteralPath $workbenchEnvFile) {
        foreach ($line in [System.IO.File]::ReadLines($workbenchEnvFile)) {
            if ($line -match '^\s*(?:export\s+)?PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') {
                $workbenchPort = [int]$Matches[1]
            }
        }
    }
    if ($workbenchPort -lt 1024 -or $workbenchPort -gt 65535) {
        throw 'PORT must be between 1024 and 65535. Check the project .env file.'
    }
    $workbenchUrl = "http://127.0.0.1:$workbenchPort"
    if (-not (Test-WorkbenchReady $workbenchUrl)) {
        $workbenchNode = (Get-Command node.exe -ErrorAction Stop).Source
        $workbenchServer = Join-Path $workbenchRoot 'dist\server.mjs'
        if (-not (Test-Path -LiteralPath $workbenchServer)) {
            throw 'Build output is missing. Run npm ci and npm run build in the project folder.'
        }
        $workbenchLogs = Join-Path $workbenchRoot 'work'
        [System.IO.Directory]::CreateDirectory($workbenchLogs) | Out-Null
        $workbenchProcess = Start-Process -FilePath $workbenchNode `
            -ArgumentList @(('"' + $workbenchServer + '"')) `
            -WorkingDirectory $workbenchRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $workbenchLogs 'desktop-launch.log') `
            -RedirectStandardError (Join-Path $workbenchLogs 'desktop-launch-error.log') `
            -PassThru
        $workbenchDeadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not (Test-WorkbenchReady $workbenchUrl)) {
            if ([DateTime]::UtcNow -gt $workbenchDeadline -or $workbenchProcess.HasExited) {
                throw 'The workbench could not start. See work\desktop-launch-error.log in the project folder.'
            }
            Start-Sleep -Milliseconds 300
        }
        [System.IO.File]::WriteAllText((Join-Path $workbenchLogs 'desktop-launch.pid'), [string]$workbenchProcess.Id)
    }
    if (-not $NoBrowser) { Start-Process -FilePath $workbenchUrl }
    Write-Output "Workbench ready: $workbenchUrl"
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Human 3.0 Workbench', 'OK', 'Error') | Out-Null
    exit 1
}
