# MC Recorder setup: installs dependencies, downloads ffmpeg + rclone,
# connects Google Drive, and makes the recorder start with Windows.
$ErrorActionPreference = "Stop"
$App   = $PSScriptRoot
$Tools = Join-Path $App "tools"
New-Item -ItemType Directory -Force -Path $Tools | Out-Null

Write-Host "== Checking Python ==" -ForegroundColor Cyan
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
    Write-Host "Python not found. Installing with winget..."
    winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    Write-Host "Python installed. Close this window and run setup.bat again." -ForegroundColor Yellow
    exit 1
}
python -m pip install --user -r (Join-Path $App "requirements.txt")
$pyw = Join-Path (Split-Path (python -c "import sys;print(sys.executable)")) "pythonw.exe"

$tmp = Join-Path $env:TEMP "mcrec_dl"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

if (-not (Test-Path (Join-Path $Tools "ffmpeg.exe"))) {
    Write-Host "== Downloading ffmpeg ==" -ForegroundColor Cyan
    $zip = Join-Path $tmp "ffmpeg.zip"
    Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath (Join-Path $tmp "ffmpeg") -Force
    Get-ChildItem (Join-Path $tmp "ffmpeg") -Recurse -Filter ffmpeg.exe | Select-Object -First 1 |
        Copy-Item -Destination $Tools
}

if (-not (Test-Path (Join-Path $Tools "rclone.exe"))) {
    Write-Host "== Downloading rclone ==" -ForegroundColor Cyan
    $zip = Join-Path $tmp "rclone.zip"
    Invoke-WebRequest "https://downloads.rclone.org/rclone-current-windows-amd64.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath (Join-Path $tmp "rclone") -Force
    Get-ChildItem (Join-Path $tmp "rclone") -Recurse -Filter rclone.exe | Select-Object -First 1 |
        Copy-Item -Destination $Tools
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$rclone = Join-Path $Tools "rclone.exe"
$remotes = & $rclone listremotes
if ($remotes -notcontains "gdrive:") {
    Write-Host "== Connecting Google Drive ==" -ForegroundColor Cyan
    Write-Host "A browser window will open. Sign in to Google and click Allow."
    & $rclone config create gdrive drive scope=drive
}

$folder = Read-Host "Google Drive folder name for recordings [Minecraft Recordings]"
if (-not $folder) { $folder = "Minecraft Recordings" }
& $rclone mkdir "gdrive:$folder"

# Write config.json (keeps any other settings you already changed)
$cfgPath = Join-Path $App "config.json"
$cfg = @{}
if (Test-Path $cfgPath) {
    (Get-Content $cfgPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value }
}
$cfg["drive_folder"]   = $folder
$cfg["ffmpeg_path"]    = (Join-Path $Tools "ffmpeg.exe")
$cfg["rclone_path"]    = $rclone
$cfg["rclone_remote"]  = "gdrive"
$cfg | ConvertTo-Json | Set-Content $cfgPath -Encoding UTF8

Write-Host "== Adding to Windows startup ==" -ForegroundColor Cyan
$startup = [Environment]::GetFolderPath("Startup")
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup "MC Recorder.lnk"))
$lnk.TargetPath       = $pyw
$lnk.Arguments        = "`"$(Join-Path $App 'mc_recorder.py')`""
$lnk.WorkingDirectory = $App
$lnk.Save()

# "MC Recorder Settings" shortcut on the Desktop and in the Start menu
$programs = [Environment]::GetFolderPath("Programs")
foreach ($dir in @([Environment]::GetFolderPath("Desktop"), $programs)) {
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $dir "MC Recorder Settings.lnk"))
    $s.TargetPath       = $pyw
    $s.Arguments        = "`"$(Join-Path $App 'settings_gui.py')`""
    $s.WorkingDirectory = $App
    $s.Save()
}

Start-Process $pyw -ArgumentList "`"$(Join-Path $App 'mc_recorder.py')`"" -WorkingDirectory $App
Write-Host ""
Write-Host "Done! MC Recorder is running in the background and will start with Windows." -ForegroundColor Green
Write-Host "Open Minecraft from Prism Launcher and it will record automatically."
Write-Host "Change quality/fps/audio etc. with the 'MC Recorder Settings' shortcut on your Desktop."
