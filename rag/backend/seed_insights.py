"""
Generates a plausible multi-call metric history for ONE clearly-labelled sample
patient, so the caregiver report can be shown without waiting weeks for real
calls to accumulate.

This only ever writes under SAMPLE_PATIENT_ID. It cannot touch a real patient's
record, and the UI labels anything under that id as sample data — a report about
someone's actual cognition must never be synthesised.

    python seed_insights.py          # create sample history
    python seed_insights.py --clear  # remove it
"""
import json
import random
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv

# conversation_memory constructs its Gemini client at import time, which needs
# GOOGLE_API_KEY present. Loaded here because this script runs standalone,
# outside the FastAPI app that would normally have loaded it.
load_dotenv()

from conversation_memory import metrics_log_path, _dyad_file_path  # noqa: E402

SAMPLE_PATIENT_ID = "sample-demo-patient"
SAMPLE_OTHER_ID = "sample-demo-daughter"
SAMPLE_OTHER_NAME = "Priya"
SAMPLE_PATIENT_NAME = "Margaret (sample)"

N_CALLS = 8


def _clear() -> None:
    path = metrics_log_path(SAMPLE_PATIENT_ID, SAMPLE_OTHER_ID, SAMPLE_OTHER_NAME)
    path.unlink(missing_ok=True)
    dyad = _dyad_file_path(SAMPLE_PATIENT_ID, SAMPLE_OTHER_ID, SAMPLE_OTHER_NAME)
    dyad.unlink(missing_ok=True)
    print(f"cleared {path}")


def _seed() -> None:
    random.seed(20260906)
    path = metrics_log_path(SAMPLE_PATIENT_ID, SAMPLE_OTHER_ID, SAMPLE_OTHER_NAME)
    start = datetime.now() - timedelta(days=N_CALLS * 7)

    lines = []
    for i in range(N_CALLS):
        # A stable baseline for most of the history, with the final couple of
        # calls drifting — so the report has something real to detect rather
        # than every call looking identical.
        drift = max(0, i - (N_CALLS - 3)) / 2

        record = {
            "timestamp": (start + timedelta(days=i * 7)).isoformat(),
            "meeting_code": f"SAMPLE{i:02d}",
            "other_name": SAMPLE_OTHER_NAME,
            "patient_name": SAMPLE_PATIENT_NAME,
            "chunks": random.randint(8, 14),
            "word_count": random.randint(320, 480),
            "repetition_count": round(random.uniform(0, 1.4) + drift * 3),
            "pronoun_rate": round(random.uniform(9.0, 11.5) + drift * 2.6, 2),
            "filler_rate": round(random.uniform(1.0, 2.2) + drift * 0.9, 2),
            "words_per_utterance": round(random.uniform(11.0, 13.5) - drift * 2.4, 1),
            "lexical_diversity": round(random.uniform(0.70, 0.76) - drift * 0.06, 3),
            "observations": [],
        }
        if drift and record["repetition_count"] >= 3:
            record["observations"].append(
                "[word_finding] Paused looking for 'kettle' and said 'the thing for tea' instead"
            )
        lines.append(json.dumps(record))

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"seeded {N_CALLS} sample calls -> {path}")
    print(f"patient_id={SAMPLE_PATIENT_ID} other_id={SAMPLE_OTHER_ID} other_name={SAMPLE_OTHER_NAME}")


if __name__ == "__main__":
    _clear() if "--clear" in sys.argv else _seed()
