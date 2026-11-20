# MC Recorder (Windows)

Automatically records your screen while Minecraft is running from **Prism Launcher**,
then uploads the video to a **Google Drive** folder when you close the game.

- Defaults: 360p, 24 fps, H.264 MP4, no audio (all adjustable in the settings window)
- Starts recording when the game window process launches, stops when it exits
- Uploads in the background with rclone; failed uploads retry on next launch
- Deletes the local copy after a successful upload (configurable)

## Install

1. Copy the `mc-recorder` folder somewhere permanent (e.g. `C:\Users\you\mc-recorder`).
2. Double-click **`setup.bat`**. It will:
   - install Python via winget if needed (re-run setup afterwards) and `psutil`
   - download `ffmpeg.exe` and `rclone.exe` into `tools\`
   - open a browser so you can sign in to Google Drive
   - ask for the Drive folder name (default `Minecraft Recordings`)
   - add itself to Windows startup and start running

That's it — launch any instance from Prism Launcher and it records.

## Settings

Open **MC Recorder Settings** (Desktop / Start menu shortcut, or `settings.bat`).
Changes apply the next time you launch Minecraft, so there's no need to restart.

| Tab | Options |
|---|---|
| **Video** | resolution (native, 360p–1440p or custom), fps, encoder (x264, x265, NVIDIA, Intel, AMD), speed preset, constant quality (CRF) **or** fixed bitrate (kbps), show cursor |
| **Audio** | on/off (off by default), input device (Stereo Mix / mic / virtual cable), audio bitrate |
| **Output & Upload** | format (mp4/mkv), local save folder, upload on/off, Drive folder, delete after upload |

**Test recording (5 s)** records a short clip with the current settings, opens it, and
estimates the file size per hour, so you can check quality before you play.

All settings live in `config.json` if you prefer editing by hand.

## Troubleshooting

- `mc_recorder.log` — detection / upload log
- `ffmpeg.log` — recording errors
- Records the whole primary desktop. Minecraft in exclusive fullscreen usually still
  captures fine on Windows 10/11; if you get black video, use windowed/borderless.

## Uninstall

Run `uninstall.bat`, then delete the folder.
