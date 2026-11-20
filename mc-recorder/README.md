# MC Recorder (Windows)

Automatically records your screen while Minecraft is running from **Prism Launcher**,
then uploads the video to a **Google Drive** folder when you close the game.

- 360p, 24 fps, H.264 MP4, **no audio**
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

## Settings (`config.json`)

| key | default | meaning |
|---|---|---|
| `recordings_dir` | `%USERPROFILE%\Videos\MC Recordings` | where videos are saved before upload |
| `drive_folder` | `Minecraft Recordings` | Google Drive folder (created if missing) |
| `height` / `fps` | `360` / `24` | output resolution and frame rate |
| `crf` | `28` | quality (lower = better/larger) |
| `delete_after_upload` | `true` | remove local file once uploaded |

Restart the recorder after editing (log out/in, or run `uninstall.bat` then `setup.bat`).

## Troubleshooting

- `mc_recorder.log` — detection / upload log
- `ffmpeg.log` — recording errors
- Records the whole primary desktop. Minecraft in exclusive fullscreen usually still
  captures fine on Windows 10/11; if you get black video, use windowed/borderless.

## Uninstall

Run `uninstall.bat`, then delete the folder.
