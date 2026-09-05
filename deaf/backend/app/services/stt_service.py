import tempfile
import sys
import os
import speech_recognition as sr

recognizer = sr.Recognizer()
recognizer.energy_threshold = 120
recognizer.dynamic_energy_threshold = True

def transcribe_wav_bytes(audio_bytes: bytes, speaker_name: str = "Speaker") -> str:
    """
    Transcribes 16-bit PCM WAV audio bytes to text using Python's speech_recognition.
    Prints the transcript to sys.stdout so it shows live in uvicorn terminal console.
    """
    if not audio_bytes or len(audio_bytes) < 1000:
        return ""

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        text = ""
        try:
            with sr.AudioFile(temp_path) as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.1)
                audio_data = recognizer.record(source)
                text = recognizer.recognize_google(audio_data)
        except sr.UnknownValueError:
            # Audio was received but speech was not clear/recognized
            sys.stdout.write(f"[STT API] Audio slice received from {speaker_name} ({len(audio_bytes)} bytes) — no speech detected\n")
            sys.stdout.flush()
        except Exception as err:
            sys.stdout.write(f"[STT Error] {err}\n")
            sys.stdout.flush()

        if text and text.strip():
            sys.stdout.write(f"\n========================================\n🗣️  SPEAKER ({speaker_name}): {text.strip()} [LIVE TRANSCRIPT]\n========================================\n\n")
            sys.stdout.flush()

        return text.strip() if text else ""

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
