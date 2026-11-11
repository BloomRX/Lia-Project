# -*- coding: utf-8 -*-
"""Testes da bancada STT. Rodam sem pesos, sem rede e sem faster-whisper real.

    python -m unittest discover -s tools/stt-bench/tests -v
"""

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


class TextMetricsTests(unittest.TestCase):
    def test_normalizacao_preserva_acento(self):
        self.assertEqual(stt_bench.normalize_words("Ação, coração!"),
                         ["ação", "coração"])
        self.assertEqual(stt_bench.normalize_words("Ação", strip_accents=True),
                         ["acao"])

    def test_hifen_vira_separador(self):
        self.assertEqual(stt_bench.normalize_words("quinta-feira"),
                         ["quinta", "feira"])

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

    def test_cer_e_calculado(self):
        score = stt_bench.score_pair("casa", "caza")
        self.assertAlmostEqual(score["cer"], 0.25)

    def test_agregado_e_de_corpus_nao_media_de_wer(self):
        # Amostra curta com 1 erro em 1 palavra e amostra longa perfeita.
        # Média de WER daria 0.5; WER de corpus dá 1/11.
        s1 = stt_bench.score_pair("a", "b")
        s2 = stt_bench.score_pair("c d e f g h i j k l", "c d e f g h i j k l")
        agg = stt_bench.aggregate_scores([s1, s2])
        self.assertAlmostEqual(agg["corpusWer"], 1.0 / 11.0)

    def test_acento_distingue_palavras_na_metrica_principal(self):
        score = stt_bench.score_pair("a avó chegou", "a avô chegou")
        self.assertAlmostEqual(score["wer"], 1.0 / 3.0)
        self.assertAlmostEqual(score["werAccentInsensitive"], 0.0)

    def test_referencia_vazia_nao_divide_por_zero(self):
        score = stt_bench.score_pair("", "algo")
        self.assertIsNone(score["wer"])
        self.assertEqual(score["insertions"], 1)


class EnvironmentTests(unittest.TestCase):
    def test_linux_e_arena_linux(self):
        machine = {"os": "Linux", "cpuName": "x", "totalRamGb": 64}
        self.assertEqual(stt_bench.classify_environment(machine), "arena-linux")

    def test_windows_referencia_exige_os_tres_sinais(self):
        ok = {"os": "Windows", "cpuName": "AMD Ryzen 5 5500 6-Core Processor",
              "totalRamGb": 15.9}
        self.assertEqual(stt_bench.classify_environment(ok),
                         "windows-reference-machine")

    def test_windows_com_cpu_diferente_nao_e_referencia(self):
        other = {"os": "Windows", "cpuName": "AMD Ryzen 7 5800X", "totalRamGb": 15.9}
        self.assertEqual(stt_bench.classify_environment(other), "windows-other")

    def test_windows_com_ram_diferente_nao_e_referencia(self):
        other = {"os": "Windows", "cpuName": "AMD Ryzen 5 5500", "totalRamGb": 32}
        self.assertEqual(stt_bench.classify_environment(other), "windows-other")

    def test_override_invalido_falha(self):
        machine = {"os": "Linux"}
        with self.assertRaises(SystemExit):
            stt_bench.classify_environment(machine, "minha-maquina")


class VerdictTests(unittest.TestCase):
    def _summary(self, **over):
        base = {"sampleCount": 5, "totalAudioSec": 40.0, "corpusWer": 0.08,
                "rtfMedian": 0.4, "peakRssMb": 900.0}
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

    def test_wer_alto_reprova(self):
        v = stt_bench.compute_verdict(self._summary(corpusWer=0.45),
                                      "windows-reference-machine")
        self.assertEqual(v["verdict"], "rejected")
        self.assertFalse(v["catalogPromotion"]["eligible"])

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

    def test_ram_excessiva_reprova(self):
        v = stt_bench.compute_verdict(self._summary(peakRssMb=5000.0),
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

    def test_resolve_caminho_relativo(self):
        manifest = os.path.join(self.tmp, "samples.json")
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d", "license": "CC0-1.0",
                       "samples": [{"id": "s1", "audio": "a.wav",
                                    "reference": "oi"}]}, fh)
        meta, samples = stt_bench.load_manifest(manifest, self.tmp)
        self.assertEqual(meta["datasetId"], "d")
        self.assertEqual(os.path.abspath(samples[0]["audio"]),
                         os.path.abspath(self.wav))

    def test_manifesto_sem_samples_falha(self):
        manifest = os.path.join(self.tmp, "ruim.json")
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d"}, fh)
        with self.assertRaises(SystemExit):
            stt_bench.load_manifest(manifest, self.tmp)


class EndToEndStubTests(unittest.TestCase):
    """Exercita main() de ponta a ponta com um faster-whisper falso."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="stt-e2e-")
        self.out = os.path.join(self.tmp, "result.json")
        # O sandbox de teste pode ter Python < 3.12; o gate de versao tem teste
        # proprio, entao aqui ele e neutralizado para exercitar o resto.
        self._old_min = stt_bench.MIN_PYTHON
        stt_bench.MIN_PYTHON = (3, 0)

    def tearDown(self):
        stt_bench.MIN_PYTHON = self._old_min
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_python_antigo_aborta_com_2(self):
        stt_bench.MIN_PYTHON = (99, 0)
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(self.out))

    def test_self_test_gera_json_de_encanamento(self):
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--output", self.out, "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        with open(self.out, "r", encoding="utf-8") as fh:
            result = json.load(fh)
        self.assertEqual(result["schema"], "lia.stt-bench.result/v1")
        self.assertTrue(result["plumbingOnly"])
        self.assertEqual(result["environment"], "arena-linux")
        self.assertEqual(result["verdict"], "inconclusive")
        self.assertFalse(result["catalogPromotion"]["eligible"])
        self.assertEqual(result["summary"]["sampleCount"], 1)
        self.assertIsNone(result["summary"]["corpusWer"])
        self.assertEqual(result["limits"]["maxSamples"], 10)
        self.assertTrue(result["runtime"]["dependencies"] is not None)

    def test_limites_sao_teto_mesmo_se_pedirem_mais(self):
        rc = stt_bench.main(["--self-test", "--allow-download",
                             "--output", self.out, "--machine-id", "arena-linux",
                             "--max-samples", "50", "--max-bytes", "999999999"])
        self.assertEqual(rc, 0)
        with open(self.out, "r", encoding="utf-8") as fh:
            result = json.load(fh)
        self.assertEqual(result["limits"]["maxSamples"], 10)
        self.assertEqual(result["limits"]["maxBytes"], 100 * 1024 * 1024)

    def _manifest_valido(self, count=5, seconds=8.0):
        manifest = os.path.join(self.tmp, "m.json")
        samples = []
        for i in range(count):
            name = "a%d.wav" % i
            stt_bench.make_synthetic_wav(os.path.join(self.tmp, name),
                                         seconds=seconds)
            samples.append({"id": "s%d" % i, "audio": name,
                            # o stub devolve exatamente esta frase
                            "reference": "teste sintetico do encanamento",
                            "condition": "clean", "speaker": "x",
                            "license": "CC0-1.0"})
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "stub", "license": "CC0-1.0",
                       "source": "gerado", "samples": samples}, fh)
        return manifest

    def test_execucao_completa_valida_para_o_ambiente_medido(self):
        manifest = self._manifest_valido(count=5, seconds=8.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--output", self.out,
                             "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        with open(self.out, "r", encoding="utf-8") as fh:
            result = json.load(fh)
        self.assertEqual(result["summary"]["sampleCount"], 5)
        self.assertGreaterEqual(result["summary"]["totalAudioSec"], 30.0)
        self.assertAlmostEqual(result["summary"]["corpusWer"], 0.0)
        self.assertEqual(result["verdict"], "validated")
        # mediu em arena-linux: valida para este ambiente, nao promove
        self.assertFalse(result["catalogPromotion"]["eligible"])
        self.assertEqual(result["environment"], "arena-linux")

    def test_resultado_valida_contra_o_schema_quando_jsonschema_existe(self):
        try:
            import jsonschema
        except ImportError:
            self.skipTest("jsonschema nao instalado")
        manifest = self._manifest_valido(count=5, seconds=8.0)
        rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                             "--allow-download", "--output", self.out,
                             "--machine-id", "arena-linux"])
        self.assertEqual(rc, 0)
        schema_path = os.path.join(TOOL_DIR, "results.schema.json")
        with open(schema_path, "r", encoding="utf-8") as fh:
            schema = json.load(fh)
        with open(self.out, "r", encoding="utf-8") as fh:
            result = json.load(fh)
        jsonschema.validate(result, schema)

    def test_dry_run_nao_gera_resultado(self):
        manifest = os.path.join(self.tmp, "m.json")
        wav = os.path.join(self.tmp, "a.wav")
        stt_bench.make_synthetic_wav(wav, seconds=0.2)
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d", "license": "CC0-1.0",
                       "samples": [{"id": "s1", "audio": "a.wav",
                                    "reference": "oi"}]}, fh)
        rc = stt_bench.main(["--dry-run", "--manifest", manifest,
                             "--samples-dir", self.tmp, "--output", self.out])
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(self.out))

    def test_dry_run_com_manifesto_invalido_retorna_1(self):
        manifest = os.path.join(self.tmp, "m.json")
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d", "license": "CC0-1.0",
                       "samples": [{"id": "s1", "audio": "nao-existe.wav"}]}, fh)
        rc = stt_bench.main(["--dry-run", "--manifest", manifest,
                             "--samples-dir", self.tmp])
        self.assertEqual(rc, 1)

    def test_pesos_ausentes_sem_allow_download_retorna_3(self):
        manifest = os.path.join(self.tmp, "m.json")
        wav = os.path.join(self.tmp, "a.wav")
        stt_bench.make_synthetic_wav(wav, seconds=0.2)
        with open(manifest, "w", encoding="utf-8") as fh:
            json.dump({"datasetId": "d", "license": "CC0-1.0",
                       "samples": [{"id": "s1", "audio": "a.wav",
                                    "reference": "oi"}]}, fh)
        # cache apontado para um diretório vazio e garantidamente sem pesos
        empty = os.path.join(self.tmp, "hf-empty")
        os.makedirs(empty, exist_ok=True)
        old = os.environ.get("HF_HUB_CACHE")
        os.environ["HF_HUB_CACHE"] = empty
        try:
            rc = stt_bench.main(["--manifest", manifest, "--samples-dir", self.tmp,
                                 "--output", self.out])
        finally:
            if old is None:
                os.environ.pop("HF_HUB_CACHE", None)
            else:
                os.environ["HF_HUB_CACHE"] = old
        self.assertEqual(rc, 3)
        self.assertFalse(os.path.exists(self.out))


if __name__ == "__main__":
    unittest.main()
