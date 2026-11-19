import os
import tempfile
import unittest
import wave
from pathlib import Path
import sys

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


if __name__ == "__main__":
    unittest.main()
