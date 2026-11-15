#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bancada STT — primeiro experimento do catálogo de capacidades da Lia.

Mede faster-whisper pequeno em CPU, int8, português (pt), sobre um conjunto
pequeno de amostras locais. Grava um JSON que pode ser anexado ao catálogo
como ``validation.evidence``.

Princípios desta ferramenta:

* **Nenhum download implícito.** Se os pesos não estiverem em cache e
  ``--allow-download`` não for passado, o script para e explica.
* **Nenhum áudio sai da máquina.** Não há cliente HTTP de áudio; o único
  tráfego possível é o download explícito dos pesos do Hugging Face.
* **Nenhum resultado é promoção automática.** O veredito é calculado, mas a
  entrada no catálogo só é elegível quando o ambiente é a máquina de
  referência e o veredito é ``validated``.
* **Linux não fala pelo Windows.** ``environment`` é detectado, não escolhido.

Uso rápido (o wrapper PowerShell chama isto):

    python stt_bench.py --doctor
    python stt_bench.py --dry-run --manifest samples.json --samples-dir .
    python stt_bench.py --manifest samples.json --samples-dir . --output out/result.json
"""

import argparse
import ctypes
import hashlib
import json
import os
import platform
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import uuid
import wave
from datetime import datetime, timezone

SCHEMA_ID = "lia.stt-bench.result/v1"
DEFAULT_MODEL = "Systran/faster-whisper-small"
DEFAULT_REVISION = "536b0662742c02347bc0e980a01041f333bce120"
MAX_SAMPLES = 10
MAX_BYTES = 100 * 1024 * 1024  # 100 MB — limite do enunciado da bancada

# av==19 e numpy==2.5 exigem 3.12. Falhar cedo, com mensagem clara, é melhor
# que deixar o pip resolver e quebrar no meio da instalação.
MIN_PYTHON = (3, 12)

# Resultado esperado dos pesos, conferido na API do HF em 11/11/2026.
# Não é medição: é declaração, com origem e data.
DECLARED_WEIGHTS = {
    "modelId": DEFAULT_MODEL,
    "revision": DEFAULT_REVISION,
    "license": "MIT",
    "files": {
        "model.bin": {"size": 483546902,
                      "sha256": "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"},
        "tokenizer.json": {"size": 2203239, "sha256": None},
        "vocabulary.txt": {"size": 459861, "sha256": None},
        "config.json": {"size": 2370, "sha256": None},
    },
    "source": "https://huggingface.co/api/models/Systran/faster-whisper-small",
    "checkedAt": "2026-11-11",
}

AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac", ".m4a", ".ogg", ".opus", ".webm")


# --------------------------------------------------------------------------
# Texto: normalização, distância, WER/CER
# --------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+", re.UNICODE)


def normalized_text(text, strip_accents=False):
    """Normalização única para WER e CER.

    Minúsculas, hífen e sublinhado viram espaço, pontuação vira espaço,
    espaços colapsados. Acentos são preservados por padrão — em pt-BR "avó" e
    "avô" são palavras diferentes. `strip_accents=True` serve só à métrica
    secundária.

    WER e CER usam **a mesma** normalização de propósito: se o CER removesse
    pontuação e o WER não, uma vírgula mudaria um número e não o outro.
    """
    if text is None:
        return ""
    s = str(text).lower().replace("-", " ").replace("_", " ")
    s = _PUNCT_RE.sub(" ", s)
    s = _SPACE_RE.sub(" ", s).strip()
    if strip_accents:
        s = "".join(c for c in unicodedata.normalize("NFD", s)
                    if unicodedata.category(c) != "Mn")
    return s


def normalize_words(text, strip_accents=False):
    s = normalized_text(text, strip_accents)
    return s.split(" ") if s else []


def normalize_chars(text, strip_accents=True):
    """Caracteres da mesma string normalizada (com espaços entre palavras)."""
    return list(normalized_text(text, strip_accents))


def edit_distance(a, b):
    """Levenshtein com custo uniforme. Retorna (distância, S, D, I)."""
    n, m = len(a), len(b)
    if n == 0:
        return m, 0, 0, m
    if m == 0:
        return n, n, 0, 0
    # matriz de custos + contagem de substituições/inserções/deleções
    prev = list(range(m + 1))
    prev_ops = [(0, 0, i) for i in range(m + 1)]  # (sub, del, ins)
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        cur_ops = [(0, i, 0)] + [(0, 0, 0)] * m
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                cur[j] = prev[j - 1]
                cur_ops[j] = prev_ops[j - 1]
            else:
                del_cost = prev[j] + 1
                ins_cost = cur[j - 1] + 1
                sub_cost = prev[j - 1] + 1
                best = min(sub_cost, del_cost, ins_cost)
                if best == sub_cost:
                    s, d, ins = prev_ops[j - 1]
                    cur_ops[j] = (s + 1, d, ins)
                elif best == del_cost:
                    s, d, ins = prev_ops[j]
                    cur_ops[j] = (s, d + 1, ins)
                else:
                    s, d, ins = cur_ops[j - 1]
                    cur_ops[j] = (s, d, ins + 1)
                cur[j] = best
        prev, prev_ops = cur, cur_ops
    s, d, ins = prev_ops[m]
    return prev[m], s, d, ins


def _wer_from_counts(ref_len, dist):
    if ref_len == 0:
        return None
    return dist / float(ref_len)


def score_pair(reference, hypothesis):
    """Métricas de uma amostra. Retorna dict pronto para o JSON."""
    ref = normalize_words(reference)
    hyp = normalize_words(hypothesis)
    dist, sub, dele, ins = edit_distance(ref, hyp)
    ref_na = normalize_words(reference, strip_accents=True)
    hyp_na = normalize_words(hypothesis, strip_accents=True)
    dist_na, _, _, _ = edit_distance(ref_na, hyp_na)
    ref_c = normalize_chars(reference)
    hyp_c = normalize_chars(hypothesis)
    dist_c, _, _, _ = edit_distance(ref_c, hyp_c)
    return {
        "referenceWords": len(ref),
        "hypothesisWords": len(hyp),
        "substitutions": sub,
        "deletions": dele,
        "insertions": ins,
        "editDistance": dist,
        "accentInsensitiveEditDistance": dist_na,
        "wer": _wer_from_counts(len(ref), dist),
        "werAccentInsensitive": _wer_from_counts(len(ref_na), dist_na),
        "referenceChars": len(ref_c),
        "charEditDistance": dist_c,
        "cer": _wer_from_counts(len(ref_c), dist_c),
        "exactMatch": ref == hyp,
    }


def aggregate_scores(sample_scores):
    """WER de corpus: total de edições / total de palavras de referência.

    Não é a média dos WERs — média de razões superestima amostras curtas.
    """
    total_ref = sum(s["referenceWords"] for s in sample_scores)
    total_dist = sum(s["editDistance"] for s in sample_scores)
    total_ref_na = sum(s["referenceWords"] for s in sample_scores)
    total_chars = sum(s["referenceChars"] for s in sample_scores)
    total_char_dist = sum(s["charEditDistance"] for s in sample_scores)
    total_dist_na = sum(s["accentInsensitiveEditDistance"] for s in sample_scores)
    return {
        "corpusWer": _wer_from_counts(total_ref, total_dist),
        "corpusWerAccentInsensitive": _wer_from_counts(total_ref_na, total_dist_na),
        "corpusCer": _wer_from_counts(total_chars, total_char_dist),
        "exactMatchRate": (sum(1 for s in sample_scores if s["exactMatch"]) /
                           float(len(sample_scores))) if sample_scores else None,
    }


# --------------------------------------------------------------------------
# Ambiente
# --------------------------------------------------------------------------

def _windows_memory():
    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        return None, None
    return stat.ullTotalPhys, stat.ullAvailPhys


def _linux_memory():
    total = avail = None
    try:
        with open("/proc/meminfo", "r") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    avail = int(line.split()[1]) * 1024
    except OSError:
        pass
    return total, avail


def total_memory_bytes():
    if sys.platform.startswith("win"):
        return _windows_memory()[0]
    if sys.platform.startswith("linux"):
        return _linux_memory()[0]
    return None


class MemoryProbe(object):
    """Pico de memória residente do processo, sem dependências externas."""

    def __init__(self):
        self.supported = True
        self._impl = None
        if sys.platform.startswith("win"):
            self._impl = "windows-peak-working-set"
        elif sys.platform.startswith("linux"):
            self._impl = "linux-vmhwm"
        else:
            self.supported = False
            self._impl = "unsupported"

    def current_rss_bytes(self):
        if self._impl == "linux-vmhwm":
            try:
                with open("/proc/self/status", "r") as fh:
                    for line in fh:
                        if line.startswith("VmRSS:"):
                            return int(line.split()[1]) * 1024
            except OSError:
                return None
        if self._impl == "windows-peak-working-set":
            return self._windows_counters()[0]
        return None

    def peak_rss_bytes(self):
        if self._impl == "linux-vmhwm":
            try:
                with open("/proc/self/status", "r") as fh:
                    for line in fh:
                        if line.startswith("VmHWM:"):
                            return int(line.split()[1]) * 1024
            except OSError:
                return None
        if self._impl == "windows-peak-working-set":
            return self._windows_counters()[1]
        return None

    def _windows_counters(self):
        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_ = [("cb", ctypes.c_ulong),
                        ("PageFaultCount", ctypes.c_ulong),
                        ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t),
                        ("PeakPagefileUsage", ctypes.c_size_t)]

        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        try:
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            ok = ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb)
            if not ok:
                return None, None
            return int(counters.WorkingSetSize), int(counters.PeakWorkingSetSize)
        except (AttributeError, OSError):
            return None, None

    def snapshot(self):
        return {"currentRssBytes": self.current_rss_bytes(),
                "peakRssBytes": self.peak_rss_bytes(),
                "method": self._impl}


def _linux_cpu_name():
    try:
        with open("/proc/cpuinfo", "r") as fh:
            for line in fh:
                if line.lower().startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return None


def collect_machine(cpu_name=None, gpu_name=None):
    """Fatos do ambiente. Nada aqui é inferido além do que foi lido."""
    mem_total = total_memory_bytes()
    return {
        "os": platform.system(),
        "osRelease": platform.release(),
        "osVersion": platform.version(),
        "architecture": platform.machine(),
        "python": platform.python_version(),
        "cpuName": cpu_name or _linux_cpu_name() or platform.processor() or "unknown",
        "cpuCount": os.cpu_count(),
        "totalRamBytes": mem_total,
        "totalRamGib": round(mem_total / float(1024 ** 3), 2) if mem_total else None,
        "gpuName": gpu_name or "unknown",
    }


ENVIRONMENTS = ("arena-linux", "windows-reference-machine", "windows-other",
                "macos-other", "linux-other")


def reference_signals(machine):
    """Os três sinais exigidos para chamar a máquina de referência."""
    cpu = (machine.get("cpuName") or "").lower()
    ram = machine.get("totalRamGib") or 0
    return {
        "osIsWindows": (machine.get("os") or "").lower() == "windows",
        "cpuIsRyzen5500": ("ryzen" in cpu and "5500" in cpu),
        "ramIs16Gib": 14.0 <= float(ram or 0) <= 18.0,
    }


def detect_environment(machine):
    """Detecta sem override. Linux nunca é a máquina de referência."""
    osname = (machine.get("os") or "").lower()
    if osname == "windows":
        signals = reference_signals(machine)
        if all(signals.values()):
            return "windows-reference-machine"
        return "windows-other"
    if sys.platform.startswith("linux") or osname == "linux":
        return "arena-linux"
    if osname == "darwin":
        return "macos-other"
    return "linux-other"


def classify_environment(machine, override=None):
    """Classifica o ambiente. Override pode **rebaixar**, nunca promover.

    Antes desta correção, `--machine-id windows-reference-machine` em Linux
    fazia `catalogPromotion.eligible` virar true. Agora o rótulo de
    referência só existe se os três sinais forem detectados; qualquer
    tentativa de forjá-lo aborta.
    """
    detected = detect_environment(machine)
    if not override:
        return detected
    if override not in ENVIRONMENTS:
        raise SystemExit("--machine-id invalido: %s (use um de %s)"
                         % (override, ", ".join(ENVIRONMENTS)))
    if override == "windows-reference-machine" and detected != override:
        signals = reference_signals(machine)
        raise SystemExit(
            "recusado: --machine-id windows-reference-machine nao corresponde "
            "aos fatos detectados (os=%s, cpu5500=%s, ram16=%s). "
            "A maquina de referencia nao pode ser declarada, so medida."
            % (signals["osIsWindows"], signals["cpuIsRyzen5500"],
               signals["ramIs16Gib"]))
    return override


# --------------------------------------------------------------------------
# Pesos e cache
# --------------------------------------------------------------------------

def redact_path(path):
    """Troca o diretorio pessoal por ~ para o JSON poder ser publicado."""
    if not path:
        return path
    try:
        home = os.path.abspath(os.path.expanduser("~"))
        absolute = os.path.abspath(path)
        if absolute.lower().startswith(home.lower()):
            return "~" + absolute[len(home):]
    except (OSError, ValueError):
        pass
    return path


def hf_cache_dir():
    for env in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        if os.environ.get(env):
            return os.environ[env]
    home = os.environ.get("HF_HOME")
    if home:
        return os.path.join(home, "hub")
    return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def model_cache_dir(repo_id, revision=None, cache_root=None):
    """Devolve (diretorio, revisaoExata).

    Se uma revisão foi pedida, NÃO cai para outro snapshot. Aceitar "qualquer
    snapshot" faria o inspetor declarar presente um peso que não é o fixado —
    e o resultado diria que rodou a revisão X quando rodou Y.
    """
    base = cache_root or hf_cache_dir()
    folder = "models--" + repo_id.replace("/", "--")
    path = os.path.join(base, folder)
    if not os.path.isdir(path):
        return None, False
    snaps = os.path.join(path, "snapshots")
    if revision:
        snap = os.path.join(snaps, revision)
        if os.path.isdir(snap):
            return snap, True
        return None, False
    if os.path.isdir(snaps):
        children = sorted(os.listdir(snaps))
        if children:
            return os.path.join(snaps, children[-1]), False
    return path, False


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _declared_file_names():
    return list(DECLARED_WEIGHTS["files"].keys())


def _count_incomplete(cache_root, repo_id):
    folder = os.path.join(cache_root or hf_cache_dir(),
                          "models--" + repo_id.replace("/", "--"), "blobs")
    if not os.path.isdir(folder):
        return 0
    try:
        return sum(1 for n in os.listdir(folder) if n.endswith(".incomplete"))
    except OSError:
        return 0


def inspect_weights(repo_id, revision, cache_root=None, verify_hash=True):
    """Confere o que está em cache. Não baixa nada e não falha por ausência.

    `present` diz que os arquivos existem; `integrityOk` diz que tamanhos (e o
    hash do model.bin, quando verificado) conferem com o declarado; `usable`
    exige os dois mais a revisão exata.
    """
    out = {
        "modelId": repo_id,
        "revision": revision,
        "revisionMatch": False,
        "declaredLicense": DECLARED_WEIGHTS["license"],
        "declaredSource": DECLARED_WEIGHTS["source"],
        "declaredCheckedAt": DECLARED_WEIGHTS["checkedAt"],
        "cacheRoot": redact_path(cache_root) if cache_root else redact_path(hf_cache_dir()),
        "cacheDir": None,
        "present": False,
        "integrityOk": False,
        "usable": False,
        "hashChecked": False,
        "files": [],
        "incompleteDownloads": _count_incomplete(cache_root, repo_id),
        "notes": [],
    }
    cache, exact = model_cache_dir(repo_id, revision, cache_root)
    out["revisionMatch"] = bool(exact)
    if not cache:
        out["notes"].append("nenhum snapshot da revisao fixada em cache")
        return out
    out["cacheDir"] = redact_path(cache)

    all_present = True
    all_sizes = True
    for name in _declared_file_names():
        declared = DECLARED_WEIGHTS["files"][name]
        path = os.path.join(cache, name)
        exists = os.path.isfile(path)
        size = os.path.getsize(path) if exists else None
        entry = {
            "path": name,
            "required": True,
            "present": exists,
            "sizeBytes": size,
            "expectedSizeBytes": declared.get("size"),
            "sha256Expected": declared.get("sha256"),
            "sha256Actual": None,
            "sizeMatches": (size == declared.get("size")) if exists else False,
            "hashMatches": None,
        }
        if name == "model.bin" and exists and verify_hash:
            actual = sha256_file(path)
            entry["sha256Actual"] = actual
            entry["hashMatches"] = (actual == declared.get("sha256"))
            out["hashChecked"] = True
        out["files"].append(entry)
        all_present = all_present and exists
        if exists and entry["expectedSizeBytes"] is not None:
            all_sizes = all_sizes and entry["sizeMatches"]

    out["present"] = all_present
    if not all_present:
        missing = [f["path"] for f in out["files"] if not f["present"]]
        out["notes"].append("arquivos ausentes: " + ", ".join(missing))
        return out

    hash_ok = True
    if out["hashChecked"]:
        hash_ok = all(f["hashMatches"] for f in out["files"]
                      if f["hashMatches"] is not None)
        if not hash_ok:
            out["notes"].append("sha256 do model.bin diverge do declarado")
        else:
            out["notes"].append("sha256 do model.bin confere")
    else:
        out["notes"].append("hash nao verificado (--no-hash ou arquivo ausente)")

    out["integrityOk"] = bool(all_sizes and hash_ok)
    if not all_sizes:
        out["notes"].append("tamanho de arquivo diverge do declarado")
    out["usable"] = bool(out["present"] and out["integrityOk"] and out["revisionMatch"])
    if not out["revisionMatch"]:
        out["notes"].append("revisao em cache difere da fixada")
    return out


# --------------------------------------------------------------------------
# Manifest e áudio
# --------------------------------------------------------------------------

def load_manifest(path, samples_dir):
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict) or "samples" not in data:
        raise SystemExit("manifesto invalido: falta a chave 'samples'")
    samples = data.get("samples") or []
    if not isinstance(samples, list):
        raise SystemExit("manifesto invalido: 'samples' deve ser lista")
    resolved = []
    seen_ids = set()
    for idx, item in enumerate(samples):
        if not isinstance(item, dict):
            raise SystemExit("manifesto invalido: amostra %d nao e objeto" % idx)
        audio = item.get("audio")
        if not audio or not isinstance(audio, str):
            raise SystemExit("manifesto invalido: amostra %d sem 'audio' textual" % idx)
        sid = item.get("id")
        if sid is not None and (not isinstance(sid, str) or not sid.strip()):
            raise SystemExit("manifesto invalido: amostra %d tem 'id' invalido" % idx)
        sid = (sid or ("s%02d" % (idx + 1))).strip()
        if sid in seen_ids:
            raise SystemExit("manifesto invalido: id duplicado %r" % sid)
        seen_ids.add(sid)
        reference = item.get("reference")
        if reference is not None and not isinstance(reference, str):
            raise SystemExit("manifesto invalido: amostra %s tem referencia nao textual" % sid)
        full = audio if os.path.isabs(audio) else os.path.join(samples_dir, audio)
        resolved.append({
            "id": sid,
            "audio": full,
            "reference": reference,
            "condition": item.get("condition") or "unspecified",
            "speaker": item.get("speaker") or "unnamed",
            "license": item.get("license") or data.get("license") or "unknown",
        })
    return data, resolved


def validate_samples(samples, max_samples=MAX_SAMPLES, max_bytes=MAX_BYTES):
    """Erros que impedem a execução. Devolve (erros, avisos, estatísticas)."""
    errors, warnings = [], []
    if len(samples) > max_samples:
        errors.append("amostras demais: %d > %d" % (len(samples), max_samples))
    if len(samples) == 0:
        errors.append("nenhuma amostra no manifesto")
    total_bytes = 0
    with_reference = 0
    for s in samples:
        path = s["audio"]
        if not os.path.isfile(path):
            errors.append("%s: arquivo inexistente (%s)" % (s["id"], path))
            continue
        ext = os.path.splitext(path)[1].lower()
        if ext not in AUDIO_EXTENSIONS:
            warnings.append("%s: extensao %s fora da lista conhecida" % (s["id"], ext))
        total_bytes += os.path.getsize(path)
        if s["reference"]:
            with_reference += 1
        else:
            warnings.append("%s: sem texto de referencia; WER fica nulo" % s["id"])
    if total_bytes > max_bytes:
        errors.append("dados demais: %.1f MB > %.1f MB"
                      % (total_bytes / 1e6, max_bytes / 1e6))
    stats = {"sampleCount": len(samples), "totalBytes": total_bytes,
             "totalMb": round(total_bytes / 1e6, 2),
             "withReference": with_reference,
             "maxSamples": max_samples, "maxBytes": max_bytes}
    return errors, warnings, stats


def wav_duration_seconds(path):
    if os.path.splitext(path)[1].lower() != ".wav":
        return None
    try:
        with wave.open(path, "rb") as wf:
            frames, rate = wf.getnframes(), wf.getframerate()
            return frames / float(rate) if rate else None
    except (wave.Error, OSError, EOFError):
        return None


def make_synthetic_wav(path, seconds=2.0, sample_rate=16000, freq=440.0):
    """Tom simples para testar o encanamento. Não mede qualidade de STT."""
    import math
    import struct
    n = int(seconds * sample_rate)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(n):
            # amplitude baixa + rampa para nao saturar
            val = int(3000 * math.sin(2 * math.pi * freq * i / sample_rate))
            frames += struct.pack("<h", val)
        wf.writeframes(bytes(frames))
    return path


# --------------------------------------------------------------------------
# Verdicto
# --------------------------------------------------------------------------

THRESHOLDS = {
    "minSamples": 5,
    "minAudioSec": 30.0,
    "werPass": 0.15,
    "werFail": 0.30,
    "rtfPass": 1.0,
    "peakRamMibFail": 4096,
}


def compute_verdict(summary, environment, plumbing_only=False):
    """Critérios objetivos. Nada de 'parece bom'.

    Evidência insuficiente vem **antes** de aprovação ou reprovação: uma única
    amostra com WER alto é indício, não reprovação. `rejected` exige o mínimo
    de amostras e de áudio; `validated` exige ainda RTF medido.
    """
    if plumbing_only:
        return {"verdict": "inconclusive",
                "reasons": ["modo --self-test: valida encanamento, nao qualidade"],
                "catalogPromotion": {"eligible": False,
                                     "reason": "smoke test de encanamento"}}

    n = summary.get("sampleCount") or 0
    audio = summary.get("totalAudioSec") or 0.0
    wer = summary.get("corpusWer")
    rtf = summary.get("rtfMedian")
    peak = summary.get("peakRssMib")

    insufficient = []
    if n < THRESHOLDS["minSamples"]:
        insufficient.append("amostras insuficientes: %d < %d"
                            % (n, THRESHOLDS["minSamples"]))
    if audio < THRESHOLDS["minAudioSec"]:
        insufficient.append("audio insuficiente: %.1fs < %.1fs"
                            % (audio, THRESHOLDS["minAudioSec"]))
    if wer is None:
        insufficient.append("sem referencia: WER nao calculavel")
    if rtf is None:
        insufficient.append("sem duracao: RTF nao calculavel")

    if insufficient:
        reasons = list(insufficient)
        if wer is not None:
            reasons.append("WER observado %.3f (indicativo, nao decisorio)" % wer)
        if peak is not None:
            reasons.append("RAM de pico observada %.0f MiB" % peak)
        return {"verdict": "inconclusive", "reasons": reasons,
                "catalogPromotion": {"eligible": False,
                                     "reason": "evidencia insuficiente para decidir"}}

    if wer > THRESHOLDS["werFail"] or (peak is not None and peak > THRESHOLDS["peakRamMibFail"]):
        reasons = []
        if wer > THRESHOLDS["werFail"]:
            reasons.append("WER %.3f > %.2f" % (wer, THRESHOLDS["werFail"]))
        if peak is not None and peak > THRESHOLDS["peakRamMibFail"]:
            reasons.append("RAM de pico %.0f MiB > %.0f MiB"
                           % (peak, THRESHOLDS["peakRamMibFail"]))
        verdict = "rejected"
    elif wer <= THRESHOLDS["werPass"] and rtf <= THRESHOLDS["rtfPass"]:
        verdict = "validated"
        reasons = ["WER %.3f <= %.2f e RTF %.3f <= %.1f"
                   % (wer, THRESHOLDS["werPass"], rtf, THRESHOLDS["rtfPass"])]
    else:
        verdict = "inconclusive"
        reasons = []
        if wer > THRESHOLDS["werPass"]:
            reasons.append("WER %.3f entre %.2f e %.2f"
                           % (wer, THRESHOLDS["werPass"], THRESHOLDS["werFail"]))
        if rtf > THRESHOLDS["rtfPass"]:
            reasons.append("RTF %.3f > %.1f: nao acompanha tempo real"
                           % (rtf, THRESHOLDS["rtfPass"]))

    eligible = environment == "windows-reference-machine" and verdict == "validated"
    if environment != "windows-reference-machine":
        promo_reason = ("ambiente '%s' nao e a maquina de referencia; "
                        "resultado vale so para este ambiente" % environment)
    elif verdict != "validated":
        promo_reason = "veredito '%s' nao promove" % verdict
    else:
        promo_reason = "elegivel: maquina de referencia + validated"
    return {"verdict": verdict, "reasons": reasons,
            "catalogPromotion": {"eligible": eligible, "reason": promo_reason}}


# --------------------------------------------------------------------------
# Execução
# --------------------------------------------------------------------------

def _median(values):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def _percentile(values, p):
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    k = (len(vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


def check_dependencies():
    info = {"fasterWhisper": None, "ctranslate2": None, "error": None}
    try:
        import faster_whisper  # noqa: F401
        info["fasterWhisper"] = getattr(faster_whisper, "__version__", "unknown")
    except Exception as exc:  # noqa: BLE001 - queremos reportar, não explodir
        info["error"] = "%s: %s" % (type(exc).__name__, exc)
        return info
    try:
        import ctranslate2
        info["ctranslate2"] = getattr(ctranslate2, "__version__", "unknown")
    except Exception:  # noqa: BLE001
        info["ctranslate2"] = "unknown"
    return info


def frozen_dependencies():
    """Registra as versões efetivas. Reprodução exige saber o que rodou."""
    try:
        from importlib import metadata
    except ImportError:  # pragma: no cover - py<3.8
        return {}
    names = ["faster-whisper", "ctranslate2", "huggingface-hub", "tokenizers",
             "onnxruntime", "av", "numpy"]
    out = {}
    for name in names:
        try:
            out[name] = metadata.version(name)
        except Exception:  # noqa: BLE001
            out[name] = None
    return out


def download_weights(args):
    """Baixa os pesos de forma explícita e mede o tempo separadamente.

    O download NUNCA entra em `modelLoadMs`: misturar rede com carga de modelo
    faria o número de carga depender da velocidade da internet.
    """
    from faster_whisper.utils import download_model
    t0 = time.perf_counter()
    path = download_model(
        args.model,
        revision=args.revision,
        cache_dir=args.download_root or None,
        local_files_only=False,
    )
    return path, round((time.perf_counter() - t0) * 1000, 1)


def run_benchmark(samples, args, download_ms=None):
    from faster_whisper import WhisperModel  # import tardio: --dry-run não exige

    probe = MemoryProbe()
    mem_before = probe.snapshot()
    result_samples = []
    timings = {"modelLoadMs": None, "firstTranscribeMs": None,
               "perSampleMs": [], "rtf": []}

    t0 = time.perf_counter()
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type=args.compute_type,
        cpu_threads=args.threads,
        download_root=args.download_root or None,
        local_files_only=True,
        revision=args.revision,
    )
    timings["modelLoadMs"] = round((time.perf_counter() - t0) * 1000, 1)
    mem_after_load = probe.snapshot()

    for idx, s in enumerate(samples):
        path = s["audio"]
        declared_dur = wav_duration_seconds(path)
        t_start = time.perf_counter()
        segments, info = model.transcribe(
            path,
            language=args.language,
            task="transcribe",
            beam_size=args.beam_size,
            vad_filter=args.vad,
            condition_on_previous_text=False,
            word_timestamps=False,
        )
        collected = list(segments)  # consome o gerador: aqui ocorre a inferência
        elapsed = time.perf_counter() - t_start
        text = " ".join(seg.text.strip() for seg in collected).strip()
        duration = declared_dur
        if duration is None:
            duration = float(getattr(info, "duration", 0.0) or 0.0) or None
        rtf = (elapsed / duration) if duration else None
        entry = {
            "id": s["id"],
            "file": os.path.basename(path),
            "bytes": os.path.getsize(path),
            "condition": s["condition"],
            "speaker": s["speaker"],
            "license": s["license"],
            "audioDurationSec": round(duration, 3) if duration else None,
            "transcribeMs": round(elapsed * 1000, 1),
            "rtf": round(rtf, 4) if rtf is not None else None,
            "detectedLanguage": getattr(info, "language", None),
            "languageProbability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 4),
            "hypothesis": text,
            "reference": s["reference"],
            "scores": score_pair(s["reference"], text) if s["reference"] else None,
            "memoryAfter": probe.snapshot(),
        }
        result_samples.append(entry)
        timings["perSampleMs"].append(entry["transcribeMs"])
        if rtf is not None:
            timings["rtf"].append(rtf)
        if idx == 0:
            timings["firstTranscribeMs"] = entry["transcribeMs"]

    mem_final = probe.snapshot()
    peak = probe.peak_rss_bytes()
    scores = [s["scores"] for s in result_samples if s["scores"]]
    agg = aggregate_scores(scores) if scores else {
        "corpusWer": None, "corpusWerAccentInsensitive": None,
        "corpusCer": None, "exactMatchRate": None}
    durations = [s["audioDurationSec"] for s in result_samples if s["audioDurationSec"]]
    summary = {
        "sampleCount": len(result_samples),
        "samplesWithReference": len(scores),
        "totalAudioSec": round(sum(durations), 2) if durations else 0.0,
        "meanAudioSec": round(sum(durations) / len(durations), 2) if durations else None,
        "downloadMs": download_ms,
        "modelLoadMs": timings["modelLoadMs"],
        "firstTranscribeMs": timings["firstTranscribeMs"],
        "transcribeMsMedian": _median(timings["perSampleMs"]),
        "transcribeMsP95": _percentile(timings["perSampleMs"], 0.95),
        "rtfMedian": _median(timings["rtf"]),
        "rtfP95": _percentile(timings["rtf"], 0.95),
        "memoryBeforeLoad": mem_before,
        "memoryAfterLoad": mem_after_load,
        "memoryAfterLastSample": mem_final,
        "peakRssBytes": peak,
        "peakRssMib": round(peak / float(1024 ** 2), 1) if peak else None,
        "peakScope": "processo inteiro (inclui download e carga)",
    }
    summary.update(agg)
    return result_samples, summary


def runtime_block(args):
    return {
        "id": "faster-whisper",
        "backend": "cpu",
        "computeType": args.compute_type,
        "language": args.language,
        "beamSize": args.beam_size,
        "vadFilter": bool(args.vad),
        "cpuThreads": args.threads,
        "python": platform.python_version(),
        "dependencies": frozen_dependencies(),
    }


def make_run_id(started_at, environment):
    return "%s-%s-%s" % (started_at.replace(":", "").replace("-", ""),
                         environment, uuid.uuid4().hex[:6])


def resolve_output(args, started_at, environment):
    if args.output:
        output = args.output
        parent = os.path.dirname(os.path.abspath(output))
        if parent:
            os.makedirs(parent, exist_ok=True)
        return output
    os.makedirs(args.output_dir, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "-", environment)
    return os.path.join(args.output_dir,
                        "stt-bench-%s-%s.json"
                        % (started_at.replace(":", ""), safe))


def write_json(output, obj):
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def empty_meta():
    return {"datasetId": "unknown", "license": "unknown", "source": "unknown",
            "sampleCount": 0, "totalBytes": 0, "totalMb": 0.0,
            "withReference": 0}


def empty_summary():
    return {
        "sampleCount": 0, "samplesWithReference": 0, "totalAudioSec": 0.0,
        "meanAudioSec": None, "downloadMs": None, "modelLoadMs": None,
        "firstTranscribeMs": None, "transcribeMsMedian": None,
        "transcribeMsP95": None, "rtfMedian": None, "rtfP95": None,
        "memoryBeforeLoad": None, "memoryAfterLoad": None,
        "memoryAfterLastSample": None, "peakRssBytes": None,
        "peakRssMib": None, "peakScope": "processo inteiro (inclui download e carga)",
        "corpusWer": None, "corpusWerAccentInsensitive": None,
        "corpusCer": None, "exactMatchRate": None,
    }


def build_result(args, machine, environment, weights, sample_meta, run_summary,
                 samples_out, verdict, warnings, started_at):
    return {
        "schema": SCHEMA_ID,
        "status": "completed",
        "runId": make_run_id(started_at, environment),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "environment": environment,
        "plumbingOnly": bool(args.self_test),
        "machine": machine,
        "runtime": runtime_block(args),
        "weights": weights,
        "dataset": sample_meta,
        "summary": run_summary,
        "samples": samples_out,
        "verdict": verdict["verdict"],
        "verdictReasons": verdict["reasons"],
        "catalogPromotion": verdict["catalogPromotion"],
        "warnings": warnings,
        "limits": {"maxSamples": args.max_samples, "maxBytes": args.max_bytes,
                   "enforced": True},
    }


def error_result(args, machine, environment, weights, sample_meta, warnings,
                 started_at, stage, exc):
    """Resultado de erro. Nunca pode ser confundido com evidência."""
    message = str(exc)[:2000]
    return {
        "schema": SCHEMA_ID,
        "status": "error",
        "runId": make_run_id(started_at, environment),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "environment": environment,
        "plumbingOnly": bool(getattr(args, "self_test", False)),
        "machine": machine or {},
        "runtime": runtime_block(args) if args else {},
        "weights": weights or {},
        "dataset": sample_meta or empty_meta(),
        "summary": empty_summary(),
        "samples": [],
        "verdict": "inconclusive",
        "verdictReasons": ["erro na etapa %s: %s" % (stage, message)],
        "catalogPromotion": {"eligible": False,
                             "reason": "execucao com erro nao promove"},
        "warnings": warnings or [],
        "limits": {"maxSamples": getattr(args, "max_samples", MAX_SAMPLES),
                   "maxBytes": getattr(args, "max_bytes", MAX_BYTES),
                   "enforced": True},
        "error": {"stage": stage, "type": type(exc).__name__, "message": message},
    }


def cmd_doctor(args):
    machine = collect_machine(args.cpu_name, args.gpu_name)
    machine["referenceSignals"] = reference_signals(machine)
    deps = check_dependencies()
    weights = inspect_weights(args.model, args.revision, args.download_root,
                              verify_hash=not args.no_hash)
    try:
        free = shutil.disk_usage(os.path.abspath(args.output_dir or "."))
        disk = {"freeBytes": free.free, "freeGib": round(free.free / float(1024 ** 3), 1)}
    except OSError:
        disk = {"freeBytes": None, "freeGib": None}
    supported = sys.version_info[:2] >= MIN_PYTHON
    try:
        environment = classify_environment(machine, args.machine_id)
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2
    report = {
        "schema": "lia.stt-bench.doctor/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pythonSupported": supported,
        "requiredPython": ">=%d.%d" % MIN_PYTHON,
        "environment": environment,
        "machine": machine,
        "dependencies": deps,
        "weights": weights,
        "disk": disk,
        "ready": bool(deps["fasterWhisper"]) and weights["usable"],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not supported:
        print("\n[python] %s e anterior ao exigido (>=%d.%d); as versoes fixadas "
              "nao instalam nele." % (platform.python_version(),
                                      MIN_PYTHON[0], MIN_PYTHON[1]),
              file=sys.stderr)
    if not deps["fasterWhisper"]:
        print("\n[falta] faster-whisper nao importavel. Rode run-stt-bench.ps1 -Setup.",
              file=sys.stderr)
    if not weights["present"]:
        print("\n[falta] pesos nao estao em cache: %s" % weights["cacheRoot"],
              file=sys.stderr)
        print("[download] %.1f MB no total, comando explicito: run-stt-bench.ps1 -AllowModelDownload"
              % (declared_total_bytes() / 1e6), file=sys.stderr)
    elif not weights["integrityOk"]:
        print("\n[integridade] pesos presentes mas divergentes do declarado:",
              file=sys.stderr)
        for note in weights["notes"]:
            print("  - " + note, file=sys.stderr)
    return 0 if report["ready"] else 5


def declared_total_bytes():
    return sum(v.get("size") or 0 for v in DECLARED_WEIGHTS["files"].values())


def _force_utf8_stdio():
    """Console cp1252 no Windows quebra ao imprimir acento. Nao falha se nao der."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv=None):
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(
        description="Bancada STT (faster-whisper, CPU, int8, pt) — Lia")
    parser.add_argument("--manifest", help="JSON com as amostras e referencias")
    parser.add_argument("--samples-dir", default=".",
                        help="diretorio base dos audios relativos")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--language", default="pt")
    parser.add_argument("--compute-type", default="int8",
                        choices=["int8", "int8_float32", "float32"],
                        help="float16 nao e suportado em CPU pelo CTranslate2")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--threads", type=int, default=0,
                        help="0 = deixar o ctranslate2 decidir")
    parser.add_argument("--vad", action="store_true",
                        help="filtro de VAD (silero embutido no pacote, sem download)")
    parser.add_argument("--max-samples", type=int, default=MAX_SAMPLES)
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    parser.add_argument("--output", help="arquivo JSON de resultado")
    parser.add_argument("--output-dir", default="out")
    parser.add_argument("--download-root", default=None,
                        help="diretorio de cache dos pesos")
    parser.add_argument("--allow-download", action="store_true",
                        help="permite baixar pesos ausentes (etapa explicita)")
    parser.add_argument("--no-hash", action="store_true",
                        help="nao recalcula o sha256 do model.bin (mais rapido)")
    parser.add_argument("--machine-id", default=None,
                        help="rebaixa o rotulo do ambiente; nunca promove a referencia")
    parser.add_argument("--cpu-name", default=None)
    parser.add_argument("--gpu-name", default=None)
    parser.add_argument("--dry-run", action="store_true",
                        help="valida entradas e emite o plano; nao importa modelo")
    parser.add_argument("--self-test", action="store_true",
                        help="tom sintetico: valida encanamento, nao qualidade")
    parser.add_argument("--doctor", action="store_true",
                        help="inspeciona ambiente, dependencias e cache")
    args = parser.parse_args(argv)

    # Os limites do enunciado sao teto, nao sugestao: nao adianta passar
    # --max-samples 50 e furar o contrato do schema.
    args.max_samples = min(max(1, args.max_samples), MAX_SAMPLES)
    args.max_bytes = min(max(1, args.max_bytes), MAX_BYTES)
    args.threads = max(0, args.threads)
    args.beam_size = max(1, args.beam_size)

    if args.doctor:
        return cmd_doctor(args)

    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    machine = collect_machine(args.cpu_name, args.gpu_name)
    machine["referenceSignals"] = reference_signals(machine)
    try:
        environment = classify_environment(machine, args.machine_id)
    except SystemExit as exc:
        print(str(exc), file=sys.stderr)
        return 2

    weights = inspect_weights(args.model, args.revision, args.download_root,
                              verify_hash=not args.no_hash)
    try:
        output = resolve_output(args, started_at, environment)
    except OSError as exc:
        print("[erro] nao foi possivel preparar a saida: %s" % exc, file=sys.stderr)
        return 2

    def fail(stage, exc, code, sample_meta=None, warnings=None):
        result = error_result(args, machine, environment, weights,
                              sample_meta, warnings, started_at, stage, exc)
        # --dry-run promete nao gerar resultado; vale tambem para erro.
        if not args.dry_run:
            write_json(output, result)
        print(json.dumps({"output": os.path.abspath(output),
                          "status": "error", "stage": stage,
                          "message": str(exc)}, ensure_ascii=False, indent=2))
        return code

    warnings = []
    tmpdir = None
    sample_meta = None
    try:
        if args.self_test:
            tmpdir = tempfile.mkdtemp(prefix="lia-stt-selftest-")
            wav = make_synthetic_wav(os.path.join(tmpdir, "synthetic-440hz.wav"))
            samples = [{"id": "synthetic", "audio": wav, "reference": None,
                        "condition": "synthetic-tone", "speaker": "none",
                        "license": "generated"}]
            sample_meta = {"datasetId": "synthetic-selftest", "license": "generated",
                           "source": "tom senoidal gerado pelo script",
                           "sampleCount": 1, "totalBytes": os.path.getsize(wav),
                           "totalMb": round(os.path.getsize(wav) / 1e6, 2),
                           "withReference": 0}
            errors = []
        else:
            if not args.manifest:
                raise SystemExit("--manifest e obrigatorio (ou use --self-test)")
            meta, samples = load_manifest(args.manifest, args.samples_dir)
            errors, warnings, sample_meta = validate_samples(
                samples, args.max_samples, args.max_bytes)
            sample_meta = dict(sample_meta)
            sample_meta["datasetId"] = meta.get("datasetId") or "unnamed"
            sample_meta["license"] = meta.get("license") or "unknown"
            sample_meta["source"] = meta.get("source") or "unknown"
    except SystemExit as exc:
        return fail("manifest", exc, 1)
    except (OSError, ValueError) as exc:
        return fail("manifest", exc, 1)

    plan = {
        "schema": "lia.stt-bench.plan/v1",
        "environment": environment,
        "machine": machine,
        "model": {"modelId": args.model, "revision": args.revision,
                  "computeType": args.compute_type, "language": args.language},
        "weights": weights,
        "downloadRequired": not weights["usable"],
        "downloadBytes": None if weights["usable"] else declared_total_bytes(),
        "dataset": sample_meta,
        "errors": errors,
        "warnings": warnings,
    }

    if args.dry_run:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return 1 if errors else 0

    if errors:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        print("\n[abortado] corrija os erros acima.", file=sys.stderr)
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return fail("manifest", ValueError("; ".join(errors)), 1, sample_meta, warnings)

    if sys.version_info[:2] < MIN_PYTHON:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        print("\n[abortado] Python %s < %d.%d. Instale Python %d.%d x64."
              % (platform.python_version(), MIN_PYTHON[0], MIN_PYTHON[1],
                 MIN_PYTHON[0], MIN_PYTHON[1]), file=sys.stderr)
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return fail("python", RuntimeError("Python %s < %d.%d"
                                           % (platform.python_version(),
                                              MIN_PYTHON[0], MIN_PYTHON[1])),
                    2, sample_meta, warnings)

    download_ms = None
    if not weights["usable"]:
        if not args.allow_download:
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            print("\n[abortado] pesos ausentes ou divergentes em %s"
                  % weights["cacheRoot"], file=sys.stderr)
            print("[download] total desta bancada: %.1f MB, um unico destino "
                  "(Hugging Face), comando explicito"
                  % (declared_total_bytes() / 1e6), file=sys.stderr)
            print("[download] rode com --allow-download (ou -AllowModelDownload no .ps1)",
                  file=sys.stderr)
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)
            return fail("weights", RuntimeError("pesos ausentes ou divergentes"),
                        3, sample_meta, warnings)
        try:
            _, download_ms = download_weights(args)
        except Exception as exc:  # noqa: BLE001 - baixar pode falhar de N formas
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)
            return fail("download", exc, 6, sample_meta, warnings)
        weights = inspect_weights(args.model, args.revision, args.download_root,
                                  verify_hash=not args.no_hash)
        if not weights["usable"]:
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)
            return fail("weights", RuntimeError(
                "pesos baixados nao conferem: " + "; ".join(weights["notes"])),
                6, sample_meta, warnings)

    try:
        samples_out, run_summary = run_benchmark(samples, args, download_ms)
    except Exception as exc:  # noqa: BLE001 - queremos JSON de erro, nao traceback
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)
        return fail("runtime", exc, 6, sample_meta, warnings)
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)

    weights = inspect_weights(args.model, args.revision, args.download_root,
                              verify_hash=not args.no_hash)
    verdict = compute_verdict(run_summary, environment, plumbing_only=args.self_test)
    result = build_result(args, machine, environment, weights, sample_meta,
                          run_summary, samples_out, verdict, warnings, started_at)
    write_json(output, result)

    print(json.dumps({
        "output": os.path.abspath(output),
        "status": "completed",
        "environment": environment,
        "verdict": verdict["verdict"],
        "corpusWer": run_summary.get("corpusWer"),
        "rtfMedian": run_summary.get("rtfMedian"),
        "peakRssMib": run_summary.get("peakRssMib"),
        "catalogPromotion": verdict["catalogPromotion"],
    }, ensure_ascii=False, indent=2))
    return 0 if verdict["verdict"] != "rejected" else 4


if __name__ == "__main__":
    sys.exit(main())
