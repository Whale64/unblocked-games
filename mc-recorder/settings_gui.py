"""
MC Recorder settings window.
Changes are saved to config.json and apply the next time Minecraft is launched.
"""
import os
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import mc_recorder as mr

RESOLUTIONS = {"Native (screen size)": 0, "360p": 360, "480p": 480, "720p": 720,
               "900p": 900, "1080p": 1080, "1440p": 1440}
FPS_CHOICES = ["15", "20", "24", "30", "48", "60"]
ENCODER_LABELS = {
    "libx264": "H.264 (CPU, x264)",
    "libx265": "H.265/HEVC (CPU, x265)",
    "h264_nvenc": "H.264 (NVIDIA GPU)",
    "hevc_nvenc": "H.265 (NVIDIA GPU)",
    "h264_qsv": "H.264 (Intel Quick Sync)",
    "h264_amf": "H.264 (AMD GPU)",
}
CREATE_NO_WINDOW = 0x08000000


class SettingsApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MC Recorder Settings")
        self.resizable(False, False)
        self.cfg = mr.load_config()
        self.v = {}  # tk variables

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=10, pady=(10, 0))
        nb.add(self._video_tab(nb), text="Video")
        nb.add(self._audio_tab(nb), text="Audio")
        nb.add(self._output_tab(nb), text="Output & Upload")

        bar = ttk.Frame(self)
        bar.pack(fill="x", padx=10, pady=10)
        self.status = ttk.Label(bar, text="", foreground="gray")
        self.status.pack(side="left")
        ttk.Button(bar, text="Save", command=self.save).pack(side="right")
        ttk.Button(bar, text="Test recording (5 s)", command=self.test_record).pack(side="right", padx=6)
        ttk.Button(bar, text="Reset defaults", command=self.reset).pack(side="right")

        self._update_states()

    # ---------- helpers ----------
    def _var(self, key, kind=tk.StringVar):
        var = kind(value=self.cfg[key])
        self.v[key] = var
        return var

    @staticmethod
    def _row(parent, r, label, widget, hint=None):
        ttk.Label(parent, text=label).grid(row=r, column=0, sticky="w", padx=(0, 12), pady=4)
        widget.grid(row=r, column=1, sticky="we", pady=4)
        if hint:
            ttk.Label(parent, text=hint, foreground="gray").grid(row=r, column=2, sticky="w", padx=8)

    # ---------- tabs ----------
    def _video_tab(self, nb):
        f = ttk.Frame(nb, padding=12)
        f.columnconfigure(1, minsize=220)

        res_label = next((k for k, h in RESOLUTIONS.items() if h == int(self.cfg["height"])), None)
        self.res = tk.StringVar(value=res_label or f"{self.cfg['height']}p")
        self._row(f, 0, "Resolution", ttk.Combobox(f, textvariable=self.res, values=list(RESOLUTIONS)),
                  "or type e.g. 540p")

        self.fps = tk.StringVar(value=str(self.cfg["fps"]))
        self._row(f, 1, "Frame rate (fps)", ttk.Combobox(f, textvariable=self.fps, values=FPS_CHOICES))

        self.enc = tk.StringVar(value=ENCODER_LABELS.get(self.cfg["encoder"], self.cfg["encoder"]))
        cb = ttk.Combobox(f, textvariable=self.enc, values=list(ENCODER_LABELS.values()), state="readonly")
        cb.bind("<<ComboboxSelected>>", lambda e: self._update_states())
        self._row(f, 2, "Encoder", cb, "GPU encoders use less CPU")

        self.preset_cb = ttk.Combobox(f, textvariable=self._var("preset"), values=mr.X264_PRESETS,
                                      state="readonly")
        self._row(f, 3, "Speed preset", self.preset_cb, "faster = less CPU, bigger file")

        rc = self._var("rate_control")
        rcf = ttk.Frame(f)
        ttk.Radiobutton(rcf, text="Constant quality", value="crf", variable=rc,
                        command=self._update_states).pack(side="left")
        ttk.Radiobutton(rcf, text="Fixed bitrate", value="bitrate", variable=rc,
                        command=self._update_states).pack(side="left", padx=8)
        self._row(f, 4, "Rate control", rcf)

        qf = ttk.Frame(f)
        crf = self._var("crf", tk.IntVar)
        self.crf_scale = ttk.Scale(qf, from_=15, to=40, variable=crf, length=170,
                                   command=lambda x: crf.set(round(float(x))))
        self.crf_scale.pack(side="left")
        ttk.Label(qf, textvariable=crf, width=3).pack(side="left", padx=4)
        self._row(f, 5, "Quality (CRF/CQ)", qf, "lower = better & bigger")

        self.br_spin = ttk.Spinbox(f, from_=200, to=50000, increment=250,
                                   textvariable=self._var("video_bitrate_kbps", tk.IntVar))
        self._row(f, 6, "Video bitrate (kbps)", self.br_spin, "360p≈800-1500, 720p≈2500-5000")

        self._row(f, 7, "Show mouse cursor",
                  ttk.Checkbutton(f, variable=self._var("draw_mouse", tk.BooleanVar)))
        return f

    def _audio_tab(self, nb):
        f = ttk.Frame(nb, padding=12)
        f.columnconfigure(1, minsize=260)
        self._row(f, 0, "Record audio",
                  ttk.Checkbutton(f, variable=self._var("audio_enabled", tk.BooleanVar),
                                  command=self._update_states))

        df = ttk.Frame(f)
        self.dev_cb = ttk.Combobox(df, textvariable=self._var("audio_device"), width=34)
        self.dev_cb.pack(side="left")
        ttk.Button(df, text="↻", width=3, command=self.refresh_devices).pack(side="left", padx=4)
        self._row(f, 1, "Audio device", df)

        self.abr = ttk.Combobox(f, textvariable=self._var("audio_bitrate_kbps", tk.IntVar),
                                values=["64", "96", "128", "160", "192", "256", "320"])
        self._row(f, 2, "Audio bitrate (kbps)", self.abr)

        ttk.Label(f, foreground="gray", wraplength=420, justify="left", text=(
            "To record game sound, pick \"Stereo Mix\" (enable it in Windows Sound settings → "
            "Recording devices) or a virtual cable / screen-capture audio device. "
            "Picking a microphone records your voice.")).grid(row=3, column=0, columnspan=3,
                                                              sticky="w", pady=(10, 0))
        self.after(100, self.refresh_devices)
        return f

    def _output_tab(self, nb):
        f = ttk.Frame(nb, padding=12)
        f.columnconfigure(1, minsize=260)

        self._row(f, 0, "Format", ttk.Combobox(f, textvariable=self._var("container"),
                                                values=mr.CONTAINERS, state="readonly"),
                  "mp4 = previews in Drive")

        df = ttk.Frame(f)
        ttk.Entry(df, textvariable=self._var("recordings_dir"), width=34).pack(side="left")
        ttk.Button(df, text="Browse…", command=self.browse_dir).pack(side="left", padx=4)
        self._row(f, 1, "Save recordings to", df)

        self._row(f, 2, "Upload to Google Drive",
                  ttk.Checkbutton(f, variable=self._var("upload_enabled", tk.BooleanVar),
                                  command=self._update_states))
        self.folder_entry = ttk.Entry(f, textvariable=self._var("drive_folder"))
        self._row(f, 3, "Drive folder", self.folder_entry, "created if missing")
        self.delete_cb = ttk.Checkbutton(f, variable=self._var("delete_after_upload", tk.BooleanVar))
        self._row(f, 4, "Delete local file after upload", self.delete_cb)

        bf = ttk.Frame(f)
        ttk.Button(bf, text="Open recordings folder", command=self.open_dir).pack(side="left")
        ttk.Button(bf, text="Open log", command=lambda: self._open(mr.LOG_PATH)).pack(side="left", padx=6)
        bf.grid(row=5, column=0, columnspan=3, sticky="w", pady=(12, 0))
        return f

    # ---------- behaviour ----------
    def _update_states(self):
        enc = self._encoder_key()
        self.preset_cb.configure(state="readonly" if enc in ("libx264", "libx265") else "disabled")
        crf_mode = self.v["rate_control"].get() == "crf"
        self.crf_scale.state(["!disabled"] if crf_mode else ["disabled"])
        self.br_spin.configure(state="disabled" if crf_mode else "normal")
        a = "normal" if self.v["audio_enabled"].get() else "disabled"
        self.dev_cb.configure(state=a)
        self.abr.configure(state=a)
        u = self.v["upload_enabled"].get()
        self.folder_entry.configure(state="normal" if u else "disabled")
        self.delete_cb.state(["!disabled"] if u else ["disabled"])

    def _encoder_key(self):
        label = self.enc.get()
        return next((k for k, l in ENCODER_LABELS.items() if l == label), label)

    def refresh_devices(self):
        def work():
            devs = mr.list_audio_devices(self.cfg["ffmpeg_path"])
            self.after(0, lambda: self.dev_cb.configure(values=devs))
            if devs and not self.v["audio_device"].get():
                stereo = next((d for d in devs if "stereo mix" in d.lower()), "")
                self.after(0, lambda: self.v["audio_device"].set(stereo))
        threading.Thread(target=work, daemon=True).start()

    def browse_dir(self):
        d = filedialog.askdirectory(initialdir=self.v["recordings_dir"].get())
        if d:
            self.v["recordings_dir"].set(os.path.normpath(d))

    def open_dir(self):
        p = Path(self.v["recordings_dir"].get())
        p.mkdir(parents=True, exist_ok=True)
        self._open(p)

    @staticmethod
    def _open(path):
        try:
            os.startfile(str(path))
        except Exception as e:
            messagebox.showerror("MC Recorder", str(e))

    def collect(self):
        """Read the form into a config dict; raise ValueError on bad input."""
        cfg = dict(self.cfg)
        for k, var in self.v.items():
            cfg[k] = var.get()
        res = self.res.get().strip()
        if res in RESOLUTIONS:
            cfg["height"] = RESOLUTIONS[res]
        else:
            h = int(res.lower().rstrip("p"))
            if h < 0 or h > 4320:
                raise ValueError("Resolution must be between 0 and 4320p")
            cfg["height"] = h
        fps = int(self.fps.get())
        if not 1 <= fps <= 240:
            raise ValueError("FPS must be between 1 and 240")
        cfg["fps"] = fps
        cfg["encoder"] = self._encoder_key()
        cfg["crf"] = int(cfg["crf"])
        cfg["video_bitrate_kbps"] = int(cfg["video_bitrate_kbps"])
        cfg["audio_bitrate_kbps"] = int(cfg["audio_bitrate_kbps"])
        if cfg["audio_enabled"] and not cfg["audio_device"]:
            raise ValueError("Pick an audio device or turn audio off")
        return cfg

    def save(self):
        try:
            cfg = self.collect()
        except (ValueError, tk.TclError) as e:
            messagebox.showerror("MC Recorder", f"Invalid setting: {e}")
            return False
        mr.save_config(cfg)
        self.cfg = cfg
        self.status.configure(text="Saved — applies next time Minecraft starts.")
        return True

    def reset(self):
        if messagebox.askyesno("MC Recorder", "Reset all settings to defaults?"):
            keep = {k: self.cfg[k] for k in ("ffmpeg_path", "rclone_path", "rclone_remote", "drive_folder")}
            mr.save_config({**mr.DEFAULT_CONFIG, **keep})
            self.destroy()
            SettingsApp().mainloop()

    def test_record(self):
        try:
            cfg = self.collect()
        except (ValueError, tk.TclError) as e:
            messagebox.showerror("MC Recorder", f"Invalid setting: {e}")
            return
        out_dir = Path(cfg["recordings_dir"])
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"test_recording.{cfg['container']}"
        cmd = mr.build_ffmpeg_cmd(cfg, out, duration=5)
        self.status.configure(text="Recording 5 second test…")

        def work():
            r = subprocess.run(cmd, capture_output=True, text=True, errors="replace",
                               creationflags=CREATE_NO_WINDOW)
            def done():
                if r.returncode == 0 and out.exists():
                    mb = out.stat().st_size / 1e6
                    self.status.configure(
                        text=f"Test: {mb:.2f} MB / 5 s ≈ {mb * 720:.0f} MB per hour")
                    self._open(out)
                else:
                    self.status.configure(text="Test failed")
                    messagebox.showerror("Test recording failed",
                                         (r.stderr or "unknown error")[-1500:])
            self.after(0, done)
        threading.Thread(target=work, daemon=True).start()


if __name__ == "__main__":
    SettingsApp().mainloop()
