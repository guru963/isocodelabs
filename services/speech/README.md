---
title: Tamil Speech to Text
emoji: 🎙️
colorFrom: gray
colorTo: gray
sdk: gradio
sdk_version: 6.31.0
python_version: "3.11"
app_file: app.py
pinned: false
preload_from_hub:
  - vasista22/whisper-tamil-small
---

# Tamil speech-to-text service

Turns a supervisor's Tamil voice note into Tamil text. It runs apart from the main API so the large model never ships with the main app.

## API

Gradio endpoint `/transcribe`:

| Input | Meaning |
|---|---|
| `audio` | The recording: webm, ogg, m4a, mp3, wav and others |
| `model_name` | `small` or `medium` |
| `api_key` | Must match the `SPEECH_API_KEY` secret |

It returns `text`, `no_speech`, `model`, `language`, `duration_seconds` and `processing_seconds`. Silence returns empty text and never reaches the model. Recordings over 180 seconds are refused.

## Deploy on Hugging Face

1. Create a free account at [huggingface.co](https://huggingface.co/join).
2. Create a [new Space](https://huggingface.co/new-space) with the **Gradio** SDK and the free **CPU Basic** hardware.
3. Open the Space's **Files** tab and upload `app.py`, `requirements.txt` and `README.md`. Those three are all it needs.
4. Open **Settings**, then **Variables and secrets**, and add a secret named `SPEECH_API_KEY` with a long random value.
5. Wait for the status to show **Running**. The first build downloads the model and takes several minutes.

## Compare the models on your own recordings

Install the tools on your computer, from this folder:

```bash
python -m venv .venv
```

```bash
.venv\Scripts\python -m pip install gradio_client
```

Put 5 to 10 recordings in a `recordings` folder here. Git ignores it, so voices stay out of the repository. To score accuracy, add `recordings/references.csv` with the columns `file` and `reference`, where `reference` is what was actually said.

Set the key, then run the comparison with your Space's name:

```bash
$env:SPEECH_API_KEY="your key"
```

```bash
.venv\Scripts\python compare.py --service your-username/your-space --recordings recordings
```

It prints each result and saves `recordings/results.csv`, which opens correctly in Excel.

## Limits

- A free Space has 2 CPU cores and sleeps after 48 hours without use, so the first request after that is slow.
- Free hosting has no uptime promise, so callers must be able to retry or fall back.
- It is slow on CPU, so callers must run it in the background. Limited to 2 cores on a development machine that was also busy with other work, a 2-second clip took 25 to 66 seconds with `small` and 84 to 281 seconds with `medium`. Expect different speeds on the Space.

## Test

```bash
python -m unittest test_scoring
```
