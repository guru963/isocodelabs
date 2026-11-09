"""Tamil speech-to-text service, deployed on its own as a Hugging Face Space.

The main API sends it a recording and gets Tamil text back. The heavy model lives
here so the main app stays small. Run it locally with `python app.py`.
"""

import hmac
import os
import threading
import time

import av
import gradio as gr
import numpy as np
import torch
from transformers import pipeline

MODELS = {
    "small": "vasista22/whisper-tamil-small",
    "medium": "vasista22/whisper-tamil-medium",
}
SAMPLE_RATE = 16_000
MAX_AUDIO_SECONDS = 180  # A supervisor's note is short. This protects the free CPU.
SILENCE_PEAK = 0.01  # Whisper can invent words from silence, so it never sees silence.

# Matches the free Space's 2 CPU cores, so local timings stay comparable.
torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))

_pipelines = {}
_load_lock = threading.Lock()


def get_pipeline(model_name):
    """Loads a model on first use. Most requests only ever need one of them."""
    with _load_lock:
        if model_name not in _pipelines:
            transcriber = pipeline(
                "automatic-speech-recognition",
                model=MODELS[model_name],
                chunk_length_s=30,
                device="cpu",
            )
            # Always read the audio as Tamil. This is the model card's method. These models
            # are too old for the newer `language` option, so the library versions are pinned.
            transcriber.model.config.forced_decoder_ids = None
            transcriber.model.generation_config.forced_decoder_ids = (
                transcriber.tokenizer.get_decoder_prompt_ids(language="ta", task="transcribe")
            )
            _pipelines[model_name] = transcriber
        return _pipelines[model_name]


def decode_audio(path):
    """Decodes any recording to 16 kHz mono. Handles the webm, ogg and m4a phones produce."""
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    chunks = []
    with av.open(path) as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError("The file has no audio")
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().flatten())
        for resampled in resampler.resample(None):
            chunks.append(resampled.to_ndarray().flatten())
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


def key_is_valid(supplied):
    expected = os.environ.get("SPEECH_API_KEY", "")
    # With no key configured, the service refuses everyone rather than serving everyone.
    return bool(expected) and hmac.compare_digest(supplied.encode(), expected.encode())


def transcribe(audio_path, model_name, api_key):
    """Returns the Tamil text with timings, so recordings can be compared across models."""
    if not key_is_valid(api_key or ""):
        raise gr.Error("Invalid API key")
    if model_name not in MODELS:
        raise gr.Error(f"Model must be one of: {', '.join(MODELS)}")
    if not audio_path:
        raise gr.Error("No recording was received")

    try:
        audio = decode_audio(audio_path)
    except (ValueError, av.FFmpegError) as error:
        # The decoder's own message contains server file paths, so it stays in the logs.
        print(f"Could not decode a recording: {error}")
        raise gr.Error("Could not read this recording") from error

    duration = len(audio) / SAMPLE_RATE
    if duration == 0:
        raise gr.Error("The recording is empty")
    if duration > MAX_AUDIO_SECONDS:
        raise gr.Error(f"Recordings can be at most {MAX_AUDIO_SECONDS} seconds long")

    result = {"model": MODELS[model_name], "language": "ta", "duration_seconds": round(duration, 2)}

    if np.abs(audio).max() < SILENCE_PEAK:
        return {**result, "text": "", "no_speech": True, "processing_seconds": 0}

    started = time.perf_counter()
    output = get_pipeline(model_name)({"array": audio, "sampling_rate": SAMPLE_RATE})
    return {
        **result,
        "text": output["text"].strip(),
        "no_speech": False,
        "processing_seconds": round(time.perf_counter() - started, 2),
    }


demo = gr.Interface(
    fn=transcribe,
    inputs=[
        gr.Audio(type="filepath", label="Tamil recording"),
        gr.Dropdown(choices=list(MODELS), value="small", label="Model"),
        gr.Textbox(type="password", label="API key"),
    ],
    outputs=gr.JSON(label="Result"),
    title="Tamil speech-to-text",
    description="Record or upload a Tamil note to see the text and how long it took.",
    flagging_mode="never",
    api_name="transcribe",
)

if __name__ == "__main__":
    # One at a time: two CPU cores gain nothing from running two transcriptions at once.
    demo.queue(default_concurrency_limit=1).launch()
