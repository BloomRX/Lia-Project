# -*- coding: utf-8 -*-
"""Testes da bancada STT. Rodam sem pesos, sem rede e sem faster-whisper real.

    python -m unittest discover -s tools/stt-bench/tests -v

Cada teste de regressão referencia o defeito que o originou (D1..D18) no
relatório REVIEW-2026-11-11.md.
"""

import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL_DIR = os.path.dirname(HERE)
sys.path.insert(0, TOOL_DIR)
sys.path.insert(0, os.path.join(HERE, "stubs"))

import stt_bench  # noqa: E402
import faster_whisper  # noqa: E402


def declared_from(files=None, revision="rev-test"):
    files = files or faster_whisper.FILES
    return {
        "modelId": "stub/model",
        "revision": revision,
        "license": "MIT",
        "source": "stub://model",
        "checkedAt": "2026-11-11",
        "files": {
            name: {"size": len(content),
                   "sha256": hashlib.sha256(content).hexdigest()
                   if name == "model.bin" else None}
            for name, content in files.items()
        },
    }


def write_fake_cache(root, files=None, revision="rev-test", repo="stub/model"):
    files = files or faster_whisper.FILES
    snap = os.path.join(root, "models--" + repo.replace("/", "--"),
                        "snapshots", revision)
    os.makedirs(snap)
    for name, content in files.items():
        with open(os.path.join(snap, name), "wb") as fh:
            fh.write(content)
    return snap


class TextMetricsTests(unittest.TestCase):
    def test_normalizacao_preserva_acento(self):
        self.assertEqual(stt_bench.normalize_words("Ação, coração!"),
                         ["ação", "coração"])
        self.assertEqual(stt_bench.normalize_words("Ação", strip_accents=True),
                         ["acao"])

    def test_hifen_vira_separador(self):
        self.assertEqual(stt_bench.normalize_words("quinta-feira"),
                         ["quinta", "feira"])

    def test_pontuacao_nao_afeta_wer_nem_cer(self):
        # D7: antes, o WER ignorava pontuação e o CER não.
        base = stt_bench.score_pair("bom dia pessoal", "bom dia pessoal")
        punctuation = stt_bench.score_pair("Bom dia, pessoal!",
                                           "bom dia pessoal.")
        self.assertEqual(base["wer"], punctuation["wer"])
        self.assertEqual(base["cer"], punctuation["cer"])
        self.assertEqual(punctuation["cer"], 0.0)

    def test_cer_conta_erro_de_letra(self):
        score = stt_bench.score_pair("casa", "caza")
        self.assertAlmostEqual(score["cer"], 0.25)

    def test_edit_distance_conta_s_d_i(self):
        dist, sub, dele, ins = stt_bench.edit_distance(
            ["a", "b", "c"], ["a", "x", "c"])
        self.assertEqual((dist, sub, dele, ins), (1, 1, 0, 0))

        dist, sub, dele, ins = stt_bench.edit_distance(["a", "b"], ["a"])
        self.assertEqual((dist, sub, dele, ins), (1, 0, 1, 0))

        dist, sub, dele, ins = stt_bench.edit_distance(["a"], ["a", "b"])
        self.assertEqual((dist, sub, dele, ins), (1, 0, 0, 1))

    def test_wer_identico_e_zero(self):
        score = stt_bench.score_pair("bom dia", "Bom dia.")
        self.assertEqual(score["wer"], 0.0)
        self.assertTrue(score["exactMatch"])

    def test_wer_uma_palavra_errada_em_cinco(self):
        score = stt_bench.score_pair("a b c d e", "a b x d e")
        self.assertAlmostEqual(score["wer"], 0.2)

    def test_insercao_aumenta_wer(self):
        score = stt_bench.score_pair("a b", "a b c")
        self.assertAlmostEqual(score["wer"], 0.5)
        self.assertEqual(score["insertions"], 1)

    def test_acento_distingue_palavras_na_metrica_principal(self):
        score = stt_bench.score_pair("a avó chegou", "a avô chegou")
        self.assertAlmostEqual(score["wer"], 1.0 / 3.0)
        self.assertAlmostEqual(score["werAccentInsensitive"], 0.0)

    def test_referencia_vazia_nao_divide_por_zero(self):
        score = stt_bench.score_pair("", "algo")
        self.assertIsNone(score["wer"])
        self.assertEqual(score["insertions"], 1)

    def test_referencia_e_hipotese_vazias(self):
        score = stt_bench.score_pair("", "")
        self.assertIsNone(score["wer"])
        self.assertIsNone(score["cer"])
        self.assertTrue(score["exactMatch"])

    def test_agregado_e_de_corpus_nao_media_de_wer(self):
        s1 = stt_bench.score_pair("a", "b")
        s2 = stt_bench.score_pair("c d e f g h i j k l", "c d e f g h i j k l")
        agg = stt_bench.aggregate_scores([s1, s2])
        self.assertAlmostEqual(agg["corpusWer"], 1.0 / 11.0)


class EnvironmentTests(unittest.TestCase):
    def test_linux_e_arena_linux(self):
        machine = {"os": "Linux", "cpuName": "x", "totalRamGib": 64}
        self.assertEqual(stt_bench.classify_environment(machine), "arena-linux")

    def test_windows_referencia_exige_os_tres_sinais(self):
        ok = {"os": "Windows", "cpuName": "AMD Ryzen 5 5500 6-Core Processor",
              "totalRamGib": 15.9}
        self.assertEqual(stt_bench.classify_environment(ok),
                         "windows-reference-machine")

    def test_windows_com_cpu_diferente_nao_e_referencia(self):
        other = {"os": "Windows", "cpuName": "AMD Ryzen 7 5800X", "totalRamGib": 15.9}
        self.assertEqual(stt_bench.classify_environment(other), "windows-other")

    def test_windows_com_ram_diferente_nao_e_referencia(self):
        other = {"os": "Windows", "cpuName": "AMD Ryzen 5 5500", "totalRamGib": 32}
        self.assertEqual(stt_bench.classify_environment(other), "windows-other")

    def test_override_nao_promove_linux_a_referencia(self):
        # D1: antes, --machine-id windows-reference-machine em Linux virava
        # catalogPromotion.eligible=true.
        machine = {"os": "Linux", "cpuName": "Xeon", "totalRamGib": 4}
        with self.assertRaises(SystemExit) as ctx:
            stt_bench.classify_environment(machine, "windows-reference-machine")
        self.assertIn("nao corresponde", str(ctx.exception))

    def test_override_nao_promove_windows_comum_a_referencia(self):
        machine = {"os": "Windows", "cpuName": "Ryzen 7 5800X", "totalRamGib": 32}
        with self.assertRaises(SystemExit):
            stt_bench.classify_environment(machine, "windows-reference-machine")

    def test_override_pode_rebaixar(self):
        machine = {"os": "Linux", "cpuName": "Xeon", "totalRamGib": 4}
        self.assertEqual(
            stt_bench.classify_environment(machine, "linux-other"), "linux-other")

    def test_override_invalido_falha(self):
        with self.assertRaises(SystemExit):
            stt_bench.classify_environment({"os": "Linux"}, "minha-maquina")

    def test_reference_signals_expoe_o_motivo(self):
        signals = stt_bench.reference_signals(
            {"os": "Windows", "cpuName": "AMD Ryzen 5 5500", "totalRamGib": 15.9})
        self.assertTrue(all(signals.values()))


class VerdictTests(unittest.TestCase):
    def _summary(self, **over):
        base = {"sampleCount": 5, "totalAudioSec": 40.0, "corpusWer": 0.08,
                "rtfMedian": 0.4, "peakRssMib": 900.0}
        base.update(over)
        return base

    def test_validado_na_referencia_e_elegivel(self):
        v = stt_bench.compute_verdict(self._summary(), "windows-reference-machine")
        self.assertEqual(v["verdict"], "validated")
        self.assertTrue(v["catalogPromotion"]["eligible"])

    def test_validado_em_linux_nao_promove(self):
        v = stt_bench.compute_verdict(self._summary(), "arena-linux")
        self.assertEqual(v["verdict"], "validated")
        self.assertFalse(v["catalogPromotion"]["eligible"])
        self.assertIn("arena-linux", v["catalogPromotion"]["reason"])

    def test_wer_alto_com_evidencia_suficiente_reprova(self):
        v = stt_bench.compute_verdict(self._summary(corpusWer=0.45),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "rejected")

    def test_uma_amostra_com_wer_alto_nao_reprova(self):
        # D9: evidência insuficiente vem antes de reprovação.
        v = stt_bench.compute_verdict(
            self._summary(sampleCount=1, totalAudioSec=8.0, corpusWer=0.9),
            "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")
        self.assertTrue(any("indicativo" in r for r in v["reasons"]))

    def test_poucas_amostras_e_inconclusivo(self):
        v = stt_bench.compute_verdict(self._summary(sampleCount=3),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")

    def test_audio_curto_e_inconclusivo(self):
        v = stt_bench.compute_verdict(self._summary(totalAudioSec=10.0),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")

    def test_rtf_lento_nao_valida(self):
        v = stt_bench.compute_verdict(self._summary(rtfMedian=2.5),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")

    def test_sem_rtf_nao_valida(self):
        # D9: sem duração não há RTF; não pode validar só com WER.
        v = stt_bench.compute_verdict(self._summary(rtfMedian=None),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")

    def test_ram_excessiva_reprova(self):
        v = stt_bench.compute_verdict(self._summary(peakRssMib=5000.0),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "rejected")

    def test_sem_referencia_e_inconclusivo(self):
        v = stt_bench.compute_verdict(self._summary(corpusWer=None),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "inconclusive")

    def test_self_test_nunca_promove(self):
        v = stt_bench.compute_verdict(self._summary(), "windows-reference-machine",
                                      plumbing_only=True)
        self.assertEqual(v["verdict"], "inconclusive")
        self.assertFalse(v["catalogPromotion"]["eligible"])


class WeightsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stt-weights-")
        self._old = stt_bench.DECLARED_WEIGHTS
        stt_bench.DECLARED_WEIGHTS = declared_from()

    def tearDown(self):
        stt_bench.DECLARED_WEIGHTS = self._old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_cache_completo_e_usavel(self):
        write_fake_cache(self.tmp)
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp)
        self.assertTrue(w["present"])
        self.assertTrue(w["revisionMatch"])
        self.assertTrue(w["hashChecked"])
        self.assertTrue(w["integrityOk"])
        self.assertTrue(w["usable"])

    def test_revisao_diferente_nao_cai_para_outro_snapshot(self):
        # D4: antes, qualquer snapshot era aceito como "present".
        write_fake_cache(self.tmp, revision="outra-revisao")
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp)
        self.assertFalse(w["present"])
        self.assertFalse(w["revisionMatch"])
        self.assertFalse(w["usable"])

    def test_hash_divergente_invalida(self):
        # D5: antes, o hash nunca era conferido de verdade.
        files = dict(faster_whisper.FILES)
        files["model.bin"] = b"conteudo-diferente!!"
        write_fake_cache(self.tmp, files=files)
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp)
        self.assertTrue(w["present"])
        self.assertFalse(w["integrityOk"])
        self.assertFalse(w["usable"])
        self.assertTrue(any("sha256" in n for n in w["notes"]))

    def test_arquivo_auxiliar_ausente_invalida(self):
        # D18: model.bin sozinho não basta.
        files = dict(faster_whisper.FILES)
        del files["tokenizer.json"]
        write_fake_cache(self.tmp, files=files)
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp)
        self.assertFalse(w["present"])
        self.assertFalse(w["usable"])
        self.assertTrue(any("tokenizer.json" in n for n in w["notes"]))

    def test_no_hash_mantem_integridade_por_tamanho(self):
        write_fake_cache(self.tmp)
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp,
                                      verify_hash=False)
        self.assertFalse(w["hashChecked"])
        self.assertTrue(w["integrityOk"])
        self.assertTrue(w["usable"])

    def test_detecta_download_incompleto(self):
        write_fake_cache(self.tmp)
        blobs = os.path.join(self.tmp, "models--stub--model", "blobs")
        os.makedirs(blobs)
        with open(os.path.join(blobs, "abc.incomplete"), "wb") as fh:
            fh.write(b"x")
        w = stt_bench.inspect_weights("stub/model", "rev-test", self.tmp)
        self.assertEqual(w["incompleteDownloads"], 1)


class PrivacyTests(unittest.TestCase):
    def test_home_e_redigido(self):
        home = os.path.expanduser("~")
        self.assertEqual(stt_bench.redact_path(os.path.join(home, "a", "b")),
                         "~" + os.sep + os.path.join("a", "b"))

    def test_caminho_fora_do_home_fica_intacto(self):
        path = os.path.join(os.sep, "dados", "audio.wav")
        self.assertEqual(stt_bench.redact_path(path), path)

    def test_vazio_continua_vazio(self):
        self.assertIsNone(stt_bench.redact_path(None))


class LimitsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stt-limits-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _sparse(self, name, size_bytes):
        path = os.path.join(self.tmp, name)
        with open(path, "wb") as fh:
            fh.truncate(size_bytes)
        return path

    def _sample(self, path, ref="texto"):
        return {"id": os.path.basename(path), "audio": path, "reference": ref,
                "condition": "clean", "speaker": "x", "license": "CC0-1.0"}

    def test_mais_de_dez_amostras_falha(self):
        samples = [self._sample(self._sparse("a%d.wav" % i, 10)) for i in range(11)]
        errors, _, _ = stt_bench.validate_samples(samples)
        self.assertTrue(any("amostras demais" in e for e in errors))

    def test_mais_de_cem_mb_falha(self):
        big = self._sparse("grande.wav", 60 * 1024 * 1024)
        samples = [self._sample(big), self._sample(big)]
        errors, _, stats = stt_bench.validate_samples(samples)
        self.assertTrue(any("dados demais" in e for e in errors))
        self.assertEqual(stats["totalBytes"], 120 * 1024 * 1024)

    def test_arquivo_ausente_falha(self):
        samples = [self._sample(os.path.join(self.tmp, "nao-existe.wav"))]
        errors, _, _ = stt_bench.validate_samples(samples)
        self.assertTrue(any("inexistente" in e for e in errors))

    def test_sem_referencia_gera_aviso_e_nao_erro(self):
        p = self._sparse("ok.wav", 100)
        samples = [self._sample(p, ref=None)]
        errors, warnings, stats = stt_bench.validate_samples(samples)
        self.assertEqual(errors, [])
        self.assertTrue(any("sem texto de referencia" in w for w in warnings))
        self.assertEqual(stats["withReference"], 0)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stt-manifest-")
        self.wav = os.path.join(self.tmp, "a.wav")
        with open(self.wav, "wb") as fh:
            fh.truncate(100)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _manifest(self, samples):
        path = os.path.join(self.tmp, "samples.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d", "license": "CC0-1.0",
                       "samples": samples}, fh)
        return path

    def test_resolve_caminho_relativo(self):
        manifest = self._manifest([{"id": "s1", "audio": "a.wav",
                                    "reference": "oi"}])
        meta, samples = stt_bench.load_manifest(manifest, self.tmp)
        self.assertEqual(meta["datasetId"], "d")
        self.assertEqual(os.path.abspath(samples[0]["audio"]),
                         os.path.abspath(self.wav))

    def test_manifesto_sem_samples_falha(self):
        path = os.path.join(self.tmp, "ruim.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d"}, fh)
        with self.assertRaises(SystemExit):
            stt_bench.load_manifest(path, self.tmp)

    def test_id_duplicado_falha(self):
        # D11: antes, dois registros com o mesmo id passavam.
        manifest = self._manifest([
            {"id": "s1", "audio": "a.wav", "reference": "oi"},
            {"id": "s1", "audio": "a.wav", "reference": "oi"},
        ])
        with self.assertRaises(SystemExit) as ctx:
            stt_bench.load_manifest(manifest, self.tmp)
        self.assertIn("duplicado", str(ctx.exception))

    def test_referencia_nao_textual_falha(self):
        manifest = self._manifest([{"id": "s1", "audio": "a.wav",
                                    "reference": 123}])
        with self.assertRaises(SystemExit):
            stt_bench.load_manifest(manifest, self.tmp)


class PowerShellStaticTests(unittest.TestCase):
    """Regressões do primeiro contato real com Windows (11/11/2026).

    Não substituem execução: pegam a classe de erro que já apareceu.
    """

    def setUp(self):
        with open(os.path.join(TOOL_DIR, "run-stt-bench.ps1"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_ascii_puro(self):
        for ch in self.src:
            self.assertLess(ord(ch), 128, "caractere nao-ASCII no .ps1")

    def test_delimitadores_balanceados(self):
        for opening, closing, name in (("{", "}", "chaves"),
                                       ("(", ")", "parenteses"),
                                       ("[", "]", "colchetes")):
            self.assertEqual(self.src.count(opening), self.src.count(closing),
                             "%s desbalanceados" % name)

    def test_sem_operadores_de_ps7(self):
        for token in ("?.", "??", "ForEach-Object -Parallel"):
            self.assertNotIn(token, self.src)

    def test_sem_splatting_inline(self):
        # & $exe @(...) passaria o array como UM argumento.
        import re
        self.assertIsNone(re.search(r"&\s+\$\w+(\.\w+)?\s+@\(", self.src))

    def test_argumento_nativo_nao_tem_aspas_duplas(self):
        # Regressão exata do bug: PowerShell 5.1 remove aspas duplas de
        # argumentos passados a executáveis nativos, e o -c chegou como
        # print(%d.%d % (...)) -> SyntaxError.
        import re
        probe_lines = [l for l in self.src.splitlines() if "'-c'" in l]
        self.assertTrue(probe_lines, "nenhuma sonda -c encontrada")
        for line in probe_lines:
            self.assertNotIn('"', line, "aspas duplas em argumento nativo: " + line.strip())

    def test_mensagem_aponta_py_install(self):
        self.assertIn("py install 3.12", self.src)

    def test_gitattributes_fixa_fim_de_linha(self):
        # Sem isto, abrir o .ps1 no Notepad no Windows pode marcar o arquivo
        # como modificado e bloquear o git pull (aconteceu em 11/11/2026).
        path = os.path.join(TOOL_DIR, ".gitattributes")
        self.assertTrue(os.path.isfile(path), ".gitattributes ausente")
        with open(path, encoding="utf-8") as fh:
            attrs = fh.read()
        self.assertIn("*.ps1 text eol=crlf", attrs)
        self.assertIn("*.bat text eol=crlf", attrs)
        self.assertIn("*.py  text eol=lf", attrs)


class EndToEndStubTests(unittest.TestCase):
    """Ponta a ponta com faster-whisper falso e cache declarado pequeno."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stt-e2e-")
        self.out = os.path.join(self.tmp, "result.json")
        self.cache = os.path.join(self.tmp, "hf")
        self._saved = (stt_bench.DECLARED_WEIGHTS, stt_bench.DEFAULT_MODEL,
                       stt_bench.DEFAULT_REVISION, stt_bench.MIN_PYTHON)
        stt_bench.DECLARED_WEIGHTS = declared_from()
        stt_bench.DEFAULT_MODEL = "stub/model"
        stt_bench.DEFAULT_REVISION = "rev-test"
        # O sandbox pode ter Python < 3.12; o gate tem teste proprio.
        stt_bench.MIN_PYTHON = (3, 0)
        faster_whisper.CALLS.clear()
        faster_whisper.FAIL_TRANSCRIBE = False

    def tearDown(self):
        (stt_bench.DECLARED_WEIGHTS, stt_bench.DEFAULT_MODEL,
         stt_bench.DEFAULT_REVISION, stt_bench.MIN_PYTHON) = self._saved
        faster_whisper.FAIL_TRANSCRIBE = False
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _manifest(self, count=5, seconds=8.0, reference="teste sintetico do encanamento"):
        manifest = os.path.join(self.tmp, "m.json")
        samples = []
        for i in range(count):
            name = "a%d.wav" % i
            stt_bench.make_synthetic_wav(os.path.join(self.tmp, name),
                                         seconds=seconds)
            samples.append({"id": "s%d" % i, "audio": name,
                            "reference": reference, "condition": "clean",
                            "speaker": "x", "license": "CC0-1.0"})
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "stub", "license": "CC0-1.0",
                       "source": "gerado", "samples": samples}, fh)
        return manifest

    def _read(self):
        with open(self.out, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_self_test_gera_json_de_encanamento(self):
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        result = self._read()
        self.assertEqual(result["schema"], "lia.stt-bench.result/v1")
        self.assertEqual(result["status"], "completed")
        self.assertTrue(result["plumbingOnly"])
        self.assertEqual(result["environment"], "arena-linux")
        self.assertEqual(result["verdict"], "inconclusive")
        self.assertFalse(result["catalogPromotion"]["eligible"])
        self.assertEqual(result["summary"]["sampleCount"], 1)
        self.assertIsNone(result["summary"]["corpusWer"])
        self.assertEqual(result["limits"]["maxSamples"], 10)

    def test_download_explicito_fixa_revisao_e_mede_separado(self):
        # D2/D3: revisao era ignorada e o download entrava no tempo de carga.
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        loads = [c for c in faster_whisper.CALLS if c["event"] == "load"]
        self.assertEqual(loads[0]["revision"], "rev-test")
        self.assertTrue(loads[0]["localFilesOnly"])
        result = self._read()
        self.assertIsNotNone(result["summary"]["downloadMs"])
        self.assertTrue(result["weights"]["usable"])

    def test_sem_allow_download_nao_baixa_e_grava_erro(self):
        rc = stt_bench.main(["--self-test", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 3)
        result = self._read()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["stage"], "weights")
        self.assertFalse(result["catalogPromotion"]["eligible"])
        self.assertFalse(any(c["event"] == "load" for c in faster_whisper.CALLS))

    def test_manifesto_invalido_grava_json_de_erro(self):
        manifest = self._manifest(count=1)
        with open(manifest, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        data["samples"][0]["audio"] = "nao-existe.wav"
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--output", self.out])
        self.assertEqual(rc, 1)
        result = self._read()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["stage"], "manifest")

    def test_falha_de_runtime_grava_json_de_erro(self):
        faster_whisper.FAIL_TRANSCRIBE = True
        manifest = self._manifest(count=1, seconds=2.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 6)
        result = self._read()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["stage"], "runtime")
        self.assertEqual(result["samples"], [])

    def test_execucao_completa_valida_para_o_ambiente_medido(self):
        manifest = self._manifest(count=5, seconds=8.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        result = self._read()
        self.assertEqual(result["summary"]["sampleCount"], 5)
        self.assertGreaterEqual(result["summary"]["totalAudioSec"], 30.0)
        self.assertAlmostEqual(result["summary"]["corpusWer"], 0.0)
        self.assertAlmostEqual(result["summary"]["corpusCer"], 0.0)
        self.assertEqual(result["verdict"], "validated")
        self.assertFalse(result["catalogPromotion"]["eligible"])
        self.assertEqual(result["environment"], "arena-linux")

    def test_memoria_inicial_carga_final_e_pico(self):
        # D8/D32: antes só havia pico e memória pós-carga.
        manifest = self._manifest(count=1, seconds=2.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        summary = self._read()["summary"]
        for key in ("memoryBeforeLoad", "memoryAfterLoad",
                    "memoryAfterLastSample"):
            self.assertIn(key, summary)
        self.assertIn("peakRssMib", summary)
        self.assertNotIn("peakRssMb", summary)

    def test_limites_sao_teto_mesmo_se_pedirem_mais(self):
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux",
                             "--max-samples", "50", "--max-bytes", "999999999"])
        self.assertEqual(rc, 0)
        result = self._read()
        self.assertEqual(result["limits"]["maxSamples"], 10)
        self.assertEqual(result["limits"]["maxBytes"], 100 * 1024 * 1024)

    def test_python_antigo_aborta_com_2_e_json_de_erro(self):
        stt_bench.MIN_PYTHON = (99, 0)
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 2)
        result = self._read()
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"]["stage"], "python")

    def test_override_de_referencia_e_recusado(self):
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--download-root", self.cache,
                             "--output", self.out,
                             "--machine-id", "windows-reference-machine"])
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(self.out))

    def test_resultado_valida_contra_o_schema_quando_jsonschema_existe(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema nao instalado")
        manifest = self._manifest(count=5, seconds=8.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        schema = json.load(open(os.path.join(TOOL_DIR, "results.schema.json"),
                                encoding="utf-8"))
        jsonschema.validate(self._read(), schema)

    def test_json_de_erro_valida_contra_o_schema(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema nao instalado")
        rc = stt_bench.main(["--self-test", "--download-root", self.cache,
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 3)
        schema = json.load(open(os.path.join(TOOL_DIR, "results.schema.json"),
                                encoding="utf-8"))
        jsonschema.validate(self._read(), schema)

    def test_dry_run_nao_gera_resultado(self):
        manifest = self._manifest(count=1, seconds=0.2)
        rc = stt_bench.main(["--dry-run", "--manifest", manifest,
                             "--samples-dir", self.tmp, "--output", self.out])
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(self.out))


if __name__ == "__main__":
    unittest.main()
