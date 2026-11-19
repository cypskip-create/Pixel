import os
import sys
import tempfile
import types
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pixel_worker import worker


class LocalVoiceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pixel-voice-worker-test-")
        self.root = Path(self.temp.name) / "models"
        self.root.mkdir()
        self.previous_root = os.environ.get("PIXEL_VOICE_MODEL_ROOT")
        os.environ["PIXEL_VOICE_MODEL_ROOT"] = str(self.root)
        self.wav = Path(self.temp.name) / "speech.wav"
        with wave.open(str(self.wav), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\0\0" * 4000)

    def tearDown(self):
        if self.previous_root is None:
            os.environ.pop("PIXEL_VOICE_MODEL_ROOT", None)
        else:
            os.environ["PIXEL_VOICE_MODEL_ROOT"] = self.previous_root
        self.temp.cleanup()

    def test_stt_refuses_model_path_outside_controlled_user_data(self):
        outside = Path(self.temp.name) / "other-model"
        outside.mkdir()
        with self.assertRaises(worker.WorkerError) as caught:
            worker.transcribe_audio({"path": str(self.wav), "model": "base.en", "model_path": str(outside)})
        self.assertEqual(caught.exception.code, "BAD_REQUEST")

    def test_stt_requires_a_pixel_managed_download_instead_of_hub_auto_download(self):
        managed_path = self.root / "base.en"
        with self.assertRaises(worker.WorkerError) as caught:
            worker.transcribe_audio({"path": str(self.wav), "model": "base.en", "model_path": str(managed_path)})
        self.assertEqual(caught.exception.code, "MODEL_UNAVAILABLE")
        self.assertIn("Download", caught.exception.message)

    def test_stt_accepts_the_bounded_120_second_audio_size(self):
        wav_120 = Path(self.temp.name) / "maximum.wav"
        wav_120.write_bytes(b"0" * (44 + 16_000 * 2 * 120))
        with self.assertRaises(worker.WorkerError) as caught:
            worker.transcribe_audio({"path": str(wav_120), "model": "base.en", "model_path": str(self.root / "base.en")})
        self.assertEqual(caught.exception.code, "MODEL_UNAVAILABLE")

    def test_stt_rejects_audio_over_120_seconds_before_model_loading(self):
        wav_121 = Path(self.temp.name) / "oversized.wav"
        wav_121.write_bytes(b"0" * (44 + 16_000 * 2 * 121))
        with self.assertRaises(worker.WorkerError) as caught:
            worker.transcribe_audio({"path": str(wav_121), "model": "base.en", "model_path": str(self.root / "base.en")})
        self.assertEqual(caught.exception.code, "TOO_LARGE")

    def test_tts_rejects_unlisted_voice_names_before_loading_any_runtime(self):
        with self.assertRaises(worker.WorkerError) as caught:
            worker.synthesize_kokoro({"text": "hello", "voice": "unlisted-voice", "speed": 1.0})
        self.assertEqual(caught.exception.code, "BAD_REQUEST")
        self.assertNotIn("hello", caught.exception.message)

    def test_unload_clears_persistent_model_caches(self):
        result = worker.unload_voice_models({})
        self.assertEqual(result, {"unloaded": True})
        self.assertEqual(worker._load_whisper_model.cache_info().currsize, 0)
        self.assertEqual(worker._load_kokoro.cache_info().currsize, 0)

    def test_runtime_smoke_imports_native_dependencies_and_checks_cpu_provider(self):
        class EspeakBackend:
            def __init__(self, language):
                self.language = language

            def phonemize(self, lines):
                return ["pɪksəl"] if lines else []

        configured = {}

        class EspeakWrapper:
            @staticmethod
            def set_library(path):
                configured["library"] = path

            @staticmethod
            def set_data_path(path):
                configured["data"] = path

        phonemizer = types.ModuleType("phonemizer")
        phonemizer_backend = types.ModuleType("phonemizer.backend")
        phonemizer_backend.EspeakBackend = EspeakBackend
        phonemizer_espeak = types.ModuleType("phonemizer.backend.espeak")
        phonemizer_wrapper = types.ModuleType("phonemizer.backend.espeak.wrapper")
        phonemizer_wrapper.EspeakWrapper = EspeakWrapper

        modules = {
            "ctranslate2": types.SimpleNamespace(__version__="test"),
            "onnxruntime": types.SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"]),
            "faster_whisper": types.SimpleNamespace(WhisperModel=type("WhisperModel", (), {})),
            "kokoro_onnx": types.SimpleNamespace(Kokoro=type("Kokoro", (), {})),
            "espeakng_loader": types.SimpleNamespace(
                get_library_path=lambda: "bundled/espeak-ng.dll",
                get_data_path=lambda: "bundled/espeak-ng-data",
            ),
            "phonemizer": phonemizer,
            "phonemizer.backend": phonemizer_backend,
            "phonemizer.backend.espeak": phonemizer_espeak,
            "phonemizer.backend.espeak.wrapper": phonemizer_wrapper,
        }
        with patch.dict(sys.modules, modules), patch.object(worker, "_retain_espeak_dll_directory"):
            result = worker.runtime_smoke_test({})

        self.assertTrue(result["onnxCpuProvider"])
        self.assertTrue(result["fasterWhisper"])
        self.assertTrue(result["kokoro"])
        self.assertTrue(result["espeakReady"])
        self.assertEqual(configured, {"library": "bundled/espeak-ng.dll", "data": "bundled/espeak-ng-data"})

    def test_runtime_smoke_reports_the_failing_native_initialization_stage(self):
        class BrokenEspeakWrapper:
            @staticmethod
            def set_library(_path):
                raise RuntimeError("unable to load C:\\private\\eSpeak\\espeak-ng.dll")

        modules = {
            "ctranslate2": types.SimpleNamespace(__version__="test"),
            "onnxruntime": types.SimpleNamespace(get_available_providers=lambda: ["CPUExecutionProvider"]),
            "faster_whisper": types.SimpleNamespace(WhisperModel=type("WhisperModel", (), {})),
            "kokoro_onnx": types.SimpleNamespace(Kokoro=type("Kokoro", (), {})),
            "espeakng_loader": types.SimpleNamespace(
                get_library_path=lambda: "bundled/espeak-ng.dll",
                get_data_path=lambda: "bundled/espeak-ng-data",
            ),
            "phonemizer": types.ModuleType("phonemizer"),
            "phonemizer.backend": types.ModuleType("phonemizer.backend"),
            "phonemizer.backend.espeak": types.ModuleType("phonemizer.backend.espeak"),
            "phonemizer.backend.espeak.wrapper": types.SimpleNamespace(EspeakWrapper=BrokenEspeakWrapper),
        }
        with patch.dict(sys.modules, modules):
            with patch.object(worker.os, "name", "posix"):
                with self.assertRaises(worker.WorkerError) as caught:
                    worker.runtime_smoke_test({})

        self.assertEqual(caught.exception.code, "RUNTIME_SMOKE_FAILED")
        self.assertIn("configure_bundled_espeak", caught.exception.message)
        self.assertIn("RuntimeError", caught.exception.message)
        self.assertNotIn("C:\\private", caught.exception.message)

    def test_runtime_smoke_rejects_missing_onnx_cpu_provider(self):
        modules = {
            "ctranslate2": types.SimpleNamespace(__version__="test"),
            "onnxruntime": types.SimpleNamespace(get_available_providers=lambda: []),
            "faster_whisper": types.SimpleNamespace(WhisperModel=type("WhisperModel", (), {})),
            "kokoro_onnx": types.SimpleNamespace(Kokoro=type("Kokoro", (), {})),
            "phonemizer": types.ModuleType("phonemizer"),
            "phonemizer.backend": types.SimpleNamespace(EspeakBackend=object),
        }
        with patch.dict(sys.modules, modules):
            with self.assertRaises(worker.WorkerError) as caught:
                worker.runtime_smoke_test({})
        self.assertEqual(caught.exception.code, "RUNTIME_SMOKE_FAILED")


if __name__ == "__main__":
    unittest.main()
