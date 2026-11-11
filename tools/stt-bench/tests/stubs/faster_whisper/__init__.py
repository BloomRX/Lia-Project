"""Stub de faster_whisper para testar o encanamento da bancada.

Não transcreve nada de verdade: devolve texto fixo e metadados fixos. Existe
para que os testes possam exercitar medição, JSON e veredito sem baixar pesos
e sem instalar o runtime real.
"""

__version__ = "0.0.0-stub"

CALLS = []

# Conteúdo usado pelo download falso. Os testes derivam os tamanhos e o hash
# declarados daqui, então a verificação de integridade é exercitada de verdade.
FILES = {
    "model.bin": b"model-bin-stub-content",
    "tokenizer.json": b'{"stub": true}',
    "vocabulary.txt": b"a\nb\n",
    "config.json": b'{"stub": true}',
}

FAIL_TRANSCRIBE = False


class _Segment(object):
    def __init__(self, text, start=0.0, end=1.0):
        self.text = text
        self.start = start
        self.end = end


class _Info(object):
    def __init__(self):
        self.language = "pt"
        self.language_probability = 0.99
        self.duration = 2.0


class WhisperModel(object):
    def __init__(self, model_size_or_path, device="auto", compute_type="default",
                 cpu_threads=0, num_workers=1, download_root=None,
                 local_files_only=False, revision=None, **kwargs):
        self.model_size_or_path = model_size_or_path
        self.device = device
        self.compute_type = compute_type
        self.cpu_threads = cpu_threads
        self.download_root = download_root
        self.local_files_only = local_files_only
        self.revision = revision
        CALLS.append({"event": "load", "path": model_size_or_path,
                      "device": device, "computeType": compute_type,
                      "localFilesOnly": local_files_only,
                      "revision": revision})

    def transcribe(self, audio, language=None, **kwargs):
        if FAIL_TRANSCRIBE:
            raise RuntimeError("falha simulada na inferencia")
        CALLS.append({"event": "transcribe", "audio": audio,
                      "language": language})
        return iter([_Segment("teste sintetico do encanamento")]), _Info()
