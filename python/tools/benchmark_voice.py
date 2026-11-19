#!/usr/bin/env python3
"""Compare installed faster-whisper models/beam sizes using private local WAVs.

Manifest format: {"name":"my set","items":[{"audio":"a.wav",
"reference":"open settings","silence":false}]}. Paths are relative to the
manifest. The aggregate report never contains audio paths or transcripts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import time
import wave
from pathlib import Path
from typing import Any


def words(text: str) -> list[str]:
    return re.findall(r"[\w']+", text.casefold(), flags=re.UNICODE)


def edit_counts(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    # Dynamic-programming Levenshtein with operation labels for WER.
    table: list[list[tuple[int, int, int, int]]] = [[(i, i, 0, 0) for i in range(len(reference) + 1)]]
    for j in range(1, len(hypothesis) + 1):
        table.append([(j, 0, j, 0)] + [(0, 0, 0, 0) for _ in reference])
    for i in range(1, len(reference) + 1):
        for j in range(1, len(hypothesis) + 1):
            if reference[i - 1] == hypothesis[j - 1]:
                table[j][i] = table[j - 1][i - 1]
                continue
            candidates = [
                (table[j - 1][i - 1][0] + 1, table[j - 1][i - 1][1], table[j - 1][i - 1][2], table[j - 1][i - 1][3] + 1),
                (table[j][i - 1][0] + 1, table[j][i - 1][1] + 1, table[j][i - 1][2], table[j][i - 1][3]),
                (table[j - 1][i][0] + 1, table[j - 1][i][1], table[j - 1][i][2] + 1, table[j - 1][i][3]),
            ]
            table[j][i] = min(candidates, key=lambda item: item[0])
    distance, deletions, insertions, substitutions = table[-1][-1]
    del distance
    return deletions, insertions, substitutions


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, ref in enumerate(reference, 1):
        current = [i]
        for j, hyp in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (ref != hyp)))
        previous = current
    return previous[-1]


def process_rss_bytes() -> int | None:
    if os.name != "nt":
        try:
            with open("/proc/self/status", encoding="utf-8") as status:
                for line in status:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1]) * 1024
        except OSError:
            return None
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        ctypes.windll.kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        process = ctypes.windll.kernel32.GetCurrentProcess()
        if ctypes.windll.psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
            return int(counters.WorkingSetSize)
    except Exception:
        return None
    return None


def load_manifest(path: Path) -> tuple[str, list[dict[str, Any]]]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    items = manifest.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("Manifest must contain a non-empty items array.")
    checked = []
    for item in items:
        audio = (path.parent / item["audio"]).resolve()
        reference = item.get("reference")
        is_silence = bool(item.get("silence"))
        if not isinstance(reference, str) or (not is_silence and not reference.strip()):
            raise ValueError("Every speech item needs a manually verified reference; silence items may use an empty reference.")
        with wave.open(str(audio), "rb") as stream:
            if stream.getnchannels() != 1 or stream.getframerate() != 16_000 or stream.getsampwidth() != 2:
                raise ValueError(f"Audio must be mono PCM16 at 16 kHz: {audio.name}")
            seconds = stream.getnframes() / stream.getframerate()
        checked.append({"audio": str(audio), "reference": reference, "silence": is_silence, "seconds": seconds})
    return str(manifest.get("name", "local corpus")), checked


def evaluate(model_path: Path, model_name: str, items: list[dict[str, Any]], beam_size: int) -> dict[str, Any]:
    from faster_whisper import WhisperModel

    load_started = time.perf_counter()
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=max(1, min(os.cpu_count() or 1, 4)), num_workers=1, local_files_only=True)
    load_ms = round((time.perf_counter() - load_started) * 1000)
    warmup_started = time.perf_counter()
    warmup_segments, _ = model.transcribe(str(items[0]["audio"]), language="en", beam_size=beam_size, vad_filter=True,
                                          condition_on_previous_text=False, no_speech_threshold=0.6)
    list(warmup_segments)
    warmup_ms = round((time.perf_counter() - warmup_started) * 1000)
    elapsed: list[float] = []
    references: list[str] = []
    hypotheses: list[str] = []
    silence_total = 0
    silence_false_positives = 0
    duplicate_words = 0
    hypothesis_word_count = 0
    cpu_started = time.process_time()
    for item in items:
        started = time.perf_counter()
        segments, _ = model.transcribe(str(item["audio"]), language="en", beam_size=beam_size, vad_filter=True,
                                       condition_on_previous_text=False, no_speech_threshold=0.6)
        transcript = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        duration = time.perf_counter() - started
        elapsed.append(duration)
        if item["silence"]:
            silence_total += 1
            silence_false_positives += bool(transcript)
        references.extend(words(item["reference"]))
        transcript_words = words(transcript)
        hypotheses.extend(transcript_words)
        duplicate_words += sum(1 for left, right in zip(transcript_words, transcript_words[1:]) if left == right)
        hypothesis_word_count += len(transcript_words)
    cpu_seconds = time.process_time() - cpu_started
    deletions, insertions, substitutions = edit_counts(references, hypotheses)
    ref_count = max(1, len(references))
    chars_ref = " ".join(references)
    chars_hyp = " ".join(hypotheses)
    total_audio = sum(item["seconds"] for item in items)
    return {
        "model": model_name,
        "beamSize": beam_size,
        "samples": len(items),
        "audioSeconds": round(total_audio, 3),
        "modelLoadMs": load_ms,
        "warmupRequestMs": warmup_ms,
        "medianWarmRequestMs": round(statistics.median(elapsed) * 1000),
        "realTimeFactor": round(sum(elapsed) / max(total_audio, 0.001), 4),
        "cpuSeconds": round(cpu_seconds, 3),
        "workingSetBytesAfterRun": process_rss_bytes(),
        "wer": round((deletions + insertions + substitutions) / ref_count, 4),
        "cer": round(edit_distance(list(chars_ref), list(chars_hyp)) / max(1, len(chars_ref)), 4),
        "omissionRate": round(deletions / ref_count, 4),
        "repetitionRate": round(duplicate_words / max(1, hypothesis_word_count), 4),
        "silenceSamples": silence_total,
        "silenceHallucinations": silence_false_positives,
        "transcriptsIncluded": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model", required=True, action="append", metavar="ID=PATH", help="Repeat to compare installed models")
    parser.add_argument("--beam", type=int, action="append", choices=(1, 3, 5), help="Repeat; default compares 1, 3 and 5")
    parser.add_argument("--output", type=Path, default=Path("voice-benchmark-results.json"))
    args = parser.parse_args()
    corpus_name, items = load_manifest(args.manifest)
    model_specs = []
    for spec in args.model:
        name, separator, raw_path = spec.partition("=")
        if not separator or not name or not raw_path:
            parser.error("--model must use ID=PATH")
        model_specs.append((name, Path(raw_path)))
    rows = [evaluate(path, name, items, beam) for name, path in model_specs for beam in (args.beam or [1, 3, 5])]
    output = {"corpus": corpus_name, "sampleCount": len(items), "aggregateOnly": True, "results": rows}
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output.resolve()), "corpus": corpus_name, "sampleCount": len(items), "configurations": len(rows)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
