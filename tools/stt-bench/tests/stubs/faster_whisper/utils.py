"""download_model falso: escreve os FILES num cache no formato do HF Hub."""

import os

from . import FILES


def download_model(size_or_id, output_dir=None, local_files_only=False,
                   cache_dir=None, revision=None, use_auth_token=None):
    if local_files_only:
        raise RuntimeError("stub: download chamado com local_files_only=True")
    import stt_bench
    root = cache_dir or stt_bench.hf_cache_dir()
    snap = os.path.join(root, "models--" + size_or_id.replace("/", "--"),
                        "snapshots", revision or "main")
    os.makedirs(snap, exist_ok=True)
    for name, content in FILES.items():
        with open(os.path.join(snap, name), "wb") as fh:
            fh.write(content)
    return snap
