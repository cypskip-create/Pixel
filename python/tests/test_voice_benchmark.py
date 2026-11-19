import json
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import benchmark_voice


class VoiceBenchmarkHarnessTests(unittest.TestCase):
    def test_word_error_components_are_counted(self):
        self.assertEqual(benchmark_voice.edit_counts(["open", "settings", "now"], ["open", "the", "setting"]), (0, 0, 2))

    def test_character_error_is_exact(self):
        self.assertEqual(benchmark_voice.edit_distance(list("pixel"), list("pixel")), 0)
        self.assertEqual(benchmark_voice.edit_distance(list("pixel"), list("pixle")), 2)

    def test_manifest_requires_mono_16khz_pcm16_and_verified_references(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            audio = root / "known.wav"
            with wave.open(str(audio), "wb") as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(16_000)
                stream.writeframes(b"\0\0" * 1600)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"name": "private corpus", "items": [
                {"audio": "known.wav", "reference": "Known words", "silence": False},
                {"audio": "known.wav", "reference": "", "silence": True},
            ]}), encoding="utf-8")
            name, items = benchmark_voice.load_manifest(manifest)
            self.assertEqual(name, "private corpus")
            self.assertEqual(items[0]["seconds"], 0.1)
            self.assertNotIn("text", items[0])
            self.assertEqual(items[1]["reference"], "")
            self.assertTrue(items[1]["silence"])


if __name__ == "__main__":
    unittest.main()
