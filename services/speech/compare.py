"""Runs test recordings through both models and writes the results to a CSV file.

Usage:
    python compare.py --service <space-or-local-url> --recordings recordings

Set SPEECH_API_KEY in the environment first. To score accuracy, add recordings/references.csv
with the columns `file` and `reference`, where reference is what was actually said.
"""

import argparse
import csv
import os
import sys
from pathlib import Path

from gradio_client import Client, handle_file

from scoring import character_error_rate, word_error_rate

AUDIO_TYPES = {".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".opus", ".webm", ".flac", ".aac", ".amr", ".3gp"}
MODELS = ["small", "medium"]


def load_references(folder):
    path = folder / "references.csv"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as file:
        return {row["file"]: row["reference"] for row in csv.DictReader(file)}


def percent(rate):
    return f"{rate * 100:.1f}%"


def main():
    # The Windows console can't print Tamil by default.
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", required=True, help="Space name or URL, such as user/tamil-speech")
    parser.add_argument("--recordings", type=Path, default=Path("recordings"))
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    api_key = os.environ.get("SPEECH_API_KEY")
    if not api_key:
        sys.exit("Set SPEECH_API_KEY first")

    files = sorted(p for p in args.recordings.iterdir() if p.suffix.lower() in AUDIO_TYPES)
    if not files:
        sys.exit(f"No recordings found in {args.recordings}")

    references = load_references(args.recordings)
    client = Client(args.service, verbose=False)
    rows = []

    for path in files:
        reference = references.get(path.name)
        for model in MODELS:
            result = client.predict(handle_file(str(path)), model, api_key, api_name="/transcribe")
            row = {
                "file": path.name,
                "model": model,
                "audio_seconds": result["duration_seconds"],
                "processing_seconds": result["processing_seconds"],
                "text": result["text"],
                "reference": reference or "",
                "word_error": percent(word_error_rate(reference, result["text"])) if reference else "",
                "character_error": percent(character_error_rate(reference, result["text"])) if reference else "",
            }
            rows.append(row)
            print(f"{path.name} [{model}] {row['processing_seconds']}s: {row['text']}")

    # utf-8-sig so Excel shows Tamil correctly.
    output = args.output or args.recordings / "results.csv"
    with output.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nSaved {output}\n")
    for model in MODELS:
        model_rows = [row for row in rows if row["model"] == model]
        audio = sum(row["audio_seconds"] for row in model_rows)
        spent = sum(row["processing_seconds"] for row in model_rows)
        line = f"{model}: {spent:.1f}s to process {audio:.1f}s of audio"
        scored = [row for row in model_rows if row["reference"]]
        if scored:
            average = sum(character_error_rate(row["reference"], row["text"]) for row in scored) / len(scored)
            line += f", average character error {percent(average)}"
        print(line)


if __name__ == "__main__":
    main()
