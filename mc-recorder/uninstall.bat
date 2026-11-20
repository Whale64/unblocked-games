@echo off
del "%USERPROFILE%\Desktop\MC Recorder Settings.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\MC Recorder Settings.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MC Recorder.lnk" 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*mc_recorder.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo MC Recorder stopped and removed from startup.
pause
