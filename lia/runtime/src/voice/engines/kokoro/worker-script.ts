/**
 * The Kokoro worker script, embedded as source so the package has NO
 * runtime asset to ship: the installer (or the dev flow) materializes it
 * under the engine's own runtime tree, and the shipped bytes are exactly
 * this string - one source of truth, versioned with the adapter.
 *
 * Protocol v1: newline-delimited JSON on stdio. fd 1 carries ONLY protocol
 * frames (python `print` is redirected to stderr before any model import,
 * because espeak/onnxruntime bindings may write to the real stdout at odd
 * times). Node writes `cmd` frames; python replies `event` frames.
 */

export const KOKORO_WORKER_PY = `# -*- coding: utf-8 -*-
"""
Lia Kokoro voice worker (protocol v1) - generated module, do not hand-edit.

Frames (one JSON object per line, UTF-8):
  host -> worker: {"cmd":"init","protocol":1,"model":...,"voicesNpz":...,"voice":...,"language":...,"providers":[...]}
                  {"cmd":"synthesize","id":N,"text":...,"voice":...,"language":...,"speed":1.0,"out":...}
                  {"cmd":"health","id":N}
                  {"cmd":"shutdown"}
  worker -> host: {"event":"ready","facts":{...}}
                  {"event":"result","id":N,"ok":true,"wav":...,"generationMs":...,"audioMs":...,"sampleRate":...,"channels":1}
                  {"event":"result","id":N,"ok":false,"errorKind":...,"error":...}
                  {"event":"init-failed","error":...}
                  {"event":"health-ok","id":N,"modelLoaded":...,"facts":{...}}
                  {"event":"shutdown-ok"}

The venv this worker runs in is pinned by the engine manifest:
kokoro-onnx==0.6.1 (kokoro_onnx, misaki/espeak) + soundfile. Nothing else.
"""
import json
import os
import sys

sys.stdout = sys.stderr  # keep fd 1 protocol-pure; prints/log noise go to stderr

FRAME_VERSION = 1


def send(frame):
    os.write(1, (json.dumps(frame, ensure_ascii=False) + "\\n").encode("utf-8"))


class KokoroWorker:
    def __init__(self):
        self.kokoro = None
        self.facts = {}
        self.default_voice = "pf_dora"
        self.default_language = "pt-br"

    def handle_init(self, msg):
        if msg.get("protocol") != FRAME_VERSION:
            raise RuntimeError("protocol mismatch: worker speaks v%d, host asked %r" % (FRAME_VERSION, msg.get("protocol")))
        providers = list(msg.get("providers") or ["CPUExecutionProvider"])
        # Hard guard (Phase 7.9B evidence): this build drives the CPU provider
        # only. If a future host frame ever asks for something else, the worker
        # refuses instead of silently running an untested accelerator.
        if providers != ["CPUExecutionProvider"]:
            raise RuntimeError("provider set %r is not declared by this build" % (providers,))

        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3  # errors only; anything ORT has to say stays off stdout
        import time
        t0 = time.perf_counter()
        session = ort.InferenceSession(msg["model"], sess_options=opts, providers=providers)
        from kokoro_onnx import Kokoro
        self.kokoro = Kokoro.from_session(session, msg["voicesNpz"])
        load_ms = int((time.perf_counter() - t0) * 1000)

        self.default_voice = str(msg.get("voice") or "pf_dora")
        self.default_language = str(msg.get("language") or "pt-br")
        active = session.get_providers()  # fact: what ORT actually bound
        self.facts = {
            "device": "cpu" if active == ["CPUExecutionProvider"] else "other",
            "loadMs": load_ms,
            "model": os.path.basename(msg["model"]).encode("ascii", "replace").decode("ascii"),
            "ortVersion": ort.__version__,
            "providersActive": active,
            "sampleRate": 24000,
            "voice": self.default_voice,
        }
        send({"event": "ready", "facts": self.facts})

    def handle_synthesize(self, msg):
        if self.kokoro is None:
            raise RuntimeError("engine-not-ready")
        import time
        t0 = time.perf_counter()
        audio, sample_rate = self.kokoro.create(
            str(msg.get("text") or ""),
            voice=str(msg.get("voice") or self.default_voice),
            speed=float(msg.get("speed") or 1.0),
            lang=str(msg.get("language") or self.default_language),
        )
        generation_ms = int((time.perf_counter() - t0) * 1000)
        out = str(msg["out"])
        import soundfile as sf
        sf.write(out, audio, sample_rate, subtype="PCM_16")
        audio_ms = int(round(len(audio) * 1000.0 / float(sample_rate)))
        send({
            "event": "result",
            "id": msg.get("id"),
            "ok": True,
            "wav": out,
            "generationMs": generation_ms,
            "audioMs": audio_ms,
            "sampleRate": int(sample_rate),
            "channels": 1,
        })

    def handle_health(self, msg):
        send({
            "event": "health-ok",
            "id": msg.get("id"),
            "modelLoaded": self.kokoro is not None,
            "facts": self.facts,
        })

    def handle(self, msg):
        cmd = msg.get("cmd")
        if cmd == "init":
            self.handle_init(msg)
        elif cmd == "synthesize":
            self.handle_synthesize(msg)
        elif cmd == "health":
            self.handle_health(msg)
        elif cmd == "shutdown":
            send({"event": "shutdown-ok"})
            raise SystemExit(0)
        else:
            raise RuntimeError("unknown cmd %r" % (cmd,))


def main():
    worker = KokoroWorker()
    stdin = sys.stdin.buffer
    for raw in iter(stdin.readline, b""):
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            send({"event": "protocol-error", "error": "%s: %s" % (type(exc).__name__, exc)})
            continue
        if not isinstance(msg, dict):
            send({"event": "protocol-error", "error": "frame is not an object"})
            continue
        try:
            worker.handle(msg)
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 - the host needs the failure, not a dead stream
            frame = {"event": "result", "id": msg.get("id"), "ok": False,
                     "errorKind": "engine-error", "error": "%s: %s" % (type(exc).__name__, exc)}
            if msg.get("cmd") == "init":
                frame = {"event": "init-failed", "error": frame["error"]}
            send(frame)
    # stdin closed: the parent died; never linger as an orphan.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`

const BUILD_BODY = `"""Builds voices-pt.npz from the shipped voice .bin packs (install-time step)."""
import sys
import os

import numpy as np

def main():
    voices_dir, out_path = sys.argv[1], sys.argv[2]
    names = [name[:-4] for name in sorted(os.listdir(voices_dir)) if name.endswith(".bin")]
    if not names:
        raise SystemExit("no voice packs found in %s" % voices_dir)
    parts = {}
    for name in names:
        raw = os.path.join(voices_dir, name + ".bin")
        parts[name] = np.fromfile(raw, dtype=np.float32).reshape(-1, 1, 256)
    np.savez(out_path, **parts)
    print("voices npz:", out_path, "voices:", ",".join(names))


if __name__ == "__main__":
    main()
`

export const KOKORO_NPZ_BUILDER_PY = BUILD_BODY
