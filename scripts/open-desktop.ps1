$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'apps\desktop\src-tauri\target\debug\tayang-studio.exe'
$fileSystem = New-Object -ComObject Scripting.FileSystemObject

if (Test-Path -LiteralPath $executable) {
    $expected = $fileSystem.GetFile($executable).ShortPath
    $running = Get-CimInstance Win32_Process -Filter "Name='tayang-studio.exe'" | Where-Object {
        $_.ExecutablePath -and (Test-Path -LiteralPath $_.ExecutablePath) -and
        $fileSystem.GetFile($_.ExecutablePath).ShortPath -eq $expected
    }
    if ($running) {
        # The app's single-instance handler brings the existing window forward.
        Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -WindowStyle Hidden
        exit
    }
}

if (Get-CimInstance Win32_Process -Filter "Name='tayang-studio.exe'") {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show('Tutup Tayang Studio resmi terlebih dahulu, lalu buka Tayang Studio Pribadi lagi.', 'Tayang Studio Pribadi')
    exit
}

$existingServer = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
if ($existingServer) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($existingServer[0].OwningProcess)"
    if ($serverProcess.CommandLine -and $serverProcess.CommandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $serverProcess.CommandLine -match 'vite' -and (Test-Path -LiteralPath $executable)) {
        Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable)
    } else {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show('Port aplikasi masih dipakai. Tunggu proses pembukaan Tayang selesai; jika tetap tidak terbuka, periksa aplikasi lain yang memakai port 1420.', 'Tayang Studio Pribadi')
    }
    exit
}

$logFolder = Join-Path $env:LOCALAPPDATA 'Tayang-Studio-Pribadi\logs'
New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$pnpm = Join-Path $env:APPDATA 'npm\pnpm.cmd'
if (!(Test-Path -LiteralPath $pnpm)) { throw 'pnpm belum terpasang untuk akun Windows ini.' }
$outputLog = Join-Path $logFolder "$stamp.log"
$errorLog = Join-Path $logFolder "$stamp.error.log"
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:ComSpec
$startInfo.Arguments = '/d /c ""' + $pnpm + '" dev:desktop > "' + $outputLog + '" 2> "' + $errorLog + '""'
$startInfo.WorkingDirectory = $projectRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
[void][System.Diagnostics.Process]::Start($startInfo)
