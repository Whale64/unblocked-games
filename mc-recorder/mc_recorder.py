"""
MC Recorder - watches for Minecraft launched from Prism Launcher, records the
screen (360p, 24fps, no audio) while it runs, then uploads the video to Google
Drive with rclone.

Runs silently in the background (start it with pythonw.exe).
Logs go to mc_recorder.log next to this script.
"""
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import psutil

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"
LOG_PATH = APP_DIR / "mc_recorder.log"

DEFAULT_CONFIG = {
    "recordings_dir": str(Path.home() / "Videos" / "MC Recordings"),
    "ffmpeg_path": str(APP_DIR / "tools" / "ffmpeg.exe"),
    "rclone_path": str(APP_DIR / "tools" / "rclone.exe"),
    "rclone_remote": "gdrive",
    "drive_folder": "Minecraft Recordings",
    "height": 360,
    "fps": 24,
    "crf": 28,
    "delete_after_upload": True,
    "poll_seconds": 3,
}

# Java main classes Prism Launcher (and MultiMC forks) use to start the game.
LAUNCHER_ENTRYPOINTS = ("org.prismlauncher.entrypoint", "org.multimc.entrypoint")
LAUNCHER_NAMES = ("prismlauncher.exe", "prismlauncher")
JAVA_NAMES = ("java.exe", "javaw.exe")

CREATE_NO_WINDOW = 0x08000000

logging.basicConfig(
    filename=LOG_PATH,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("mc_recorder")


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception as e:  # keep running with defaults
            log.error("Bad config.json, using defaults: %s", e)
    else:
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
    return cfg


def single_instance_lock():
    """Bind a localhost port so only one copy runs at a time."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 47653))
    except OSError:
        log.info("Another instance is already running; exiting.")
        sys.exit(0)
    return s


def find_minecraft():
    """Return the psutil.Process of a Minecraft game started by Prism, or None."""
    for p in psutil.process_iter(["name", "cmdline", "ppid"]):
        try:
            name = (p.info["name"] or "").lower()
            if name not in JAVA_NAMES:
                continue
            cmd = " ".join(p.info["cmdline"] or []).lower()
            if any(ep in cmd for ep in LAUNCHER_ENTRYPOINTS):
                return p
            parent = psutil.Process(p.info["ppid"])
            if parent.name().lower() in LAUNCHER_NAMES:
                return p
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return None


class Recorder:
    def __init__(self, cfg):
        self.cfg = cfg
        self.proc = None
        self.path = None

    def start(self):
        out_dir = Path(self.cfg["recordings_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        self.path = out_dir / f"minecraft_{datetime.now():%Y-%m-%d_%H-%M-%S}.mp4"
        cmd = [
            self.cfg["ffmpeg_path"],
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "gdigrab",
            "-framerate", str(self.cfg["fps"]),
            "-draw_mouse", "1",
            "-i", "desktop",
            "-vf", f"scale=-2:{self.cfg['height']}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(self.cfg["crf"]),
            "-pix_fmt", "yuv420p",
            "-an",  # no audio
            # fragmented mp4: file stays playable even if the PC crashes mid-game
            "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
            str(self.path) + ".part",
        ]
        log.info("Starting recording: %s", self.path)
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=open(APP_DIR / "ffmpeg.log", "ab"),
            creationflags=CREATE_NO_WINDOW,
        )

    def stop(self):
        if not self.proc:
            return None
        log.info("Stopping recording")
        try:
            self.proc.stdin.write(b"q")  # graceful stop so the file is finalized
            self.proc.stdin.flush()
            self.proc.wait(timeout=20)
        except Exception:
            self.proc.kill()
            self.proc.wait()
        self.proc = None
        part = Path(str(self.path) + ".part")
        if part.exists() and part.stat().st_size > 0:
            part.replace(self.path)
            return self.path
        log.warning("Recording file missing or empty")
        return None


_upload_lock = threading.Lock()


def upload_pending(cfg):
    """Upload every finished .mp4 in the recordings folder (retries old failures too)."""
    with _upload_lock:
        out_dir = Path(cfg["recordings_dir"])
        if not out_dir.exists():
            return
        dest = f"{cfg['rclone_remote']}:{cfg['drive_folder']}"
        for f in sorted(out_dir.glob("minecraft_*.mp4")):
            log.info("Uploading %s -> %s", f.name, dest)
            r = subprocess.run(
                [cfg["rclone_path"], "copy", str(f), dest, "--retries", "5"],
                capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
            )
            if r.returncode != 0:
                log.error("Upload failed (will retry later): %s", r.stderr.strip())
                continue
            log.info("Uploaded %s", f.name)
            if cfg["delete_after_upload"]:
                f.unlink(missing_ok=True)


def upload_in_background(cfg):
    threading.Thread(target=upload_pending, args=(cfg,), daemon=True).start()


def main():
    _lock = single_instance_lock()  # noqa: F841 (keep socket alive)
    cfg = load_config()
    log.info("MC Recorder started")
    upload_in_background(cfg)  # retry anything left from last time

    rec = Recorder(cfg)
    game = None
    while True:
        try:
            if game is None:
                game = find_minecraft()
                if game is not None:
                    log.info("Minecraft detected (pid %s)", game.pid)
                    rec.start()
            elif not game.is_running():
                log.info("Minecraft closed")
                game = None
                if rec.stop():
                    upload_in_background(cfg)
            elif rec.proc and rec.proc.poll() is not None:
                log.error("ffmpeg exited unexpectedly (see ffmpeg.log); restarting")
                rec.stop()
                upload_in_background(cfg)
                rec.start()
        except Exception:
            log.exception("Unexpected error")
        time.sleep(cfg["poll_seconds"])


if __name__ == "__main__":
    main()
