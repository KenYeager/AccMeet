"""
Converts spoken/typed caption text into ASL gloss order (TIME -> SUBJECT ->
VERB -> OBJECT -> OTHER) and matches each gloss token to a sign GIF in
deaf/gif, so deaf users get a sign-language playback alongside the raw
caption text — not just English word order re-flowed as captions.

Adapted from the standalone prototype at AccMeet/app.py (same dependency-
parse-based reordering), but scoped to this module's actual GIF vocabulary
and using en_core_web_sm instead of en_core_web_trf — the transformer model
pulls in torch and is far heavier than this lightweight, best-effort gloss
step needs.
"""
import sys
from pathlib import Path

import spacy

_GIF_DIR = Path(__file__).resolve().parents[3] / "gif"

TIME_WORDS = {
    "yesterday", "today", "tomorrow", "evening", "morning", "night",
    "now", "later", "soon", "always", "never", "sometimes",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
}


def _build_gif_index() -> dict[str, str]:
    index: dict[str, str] = {}
    if not _GIF_DIR.exists():
        print(f"[ASL] GIF directory not found: {_GIF_DIR}", file=sys.stderr)
        return index
    for gif_file in _GIF_DIR.glob("*.gif"):
        index[gif_file.stem.lower()] = gif_file.name
    print(f"[ASL] Built GIF index with {len(index)} entries from {_GIF_DIR}")
    return index


GIF_INDEX = _build_gif_index()

try:
    # Keep "ner" — its DATE/TIME entity tags feed the gloss-ordering check
    # below. "lemmatizer" is dropped: we match raw lowercase words against
    # GIF filenames (e.g. "working.gif"), and a lemma would miss those.
    _nlp = spacy.load("en_core_web_sm", disable=["lemmatizer"])
    print("[ASL] spaCy model loaded")
except OSError:
    print("[ASL] en_core_web_sm not found — run: python -m spacy download en_core_web_sm", file=sys.stderr)
    _nlp = None


def _extract_gloss_tokens(doc) -> list[str]:
    """Reorder a parsed sentence into ASL gloss order, keeping all spoken words."""
    time_words, subject, verb, obj, other = [], [], [], [], []
    all_words = []

    for token in doc:
        if token.is_punct or token.is_space:
            continue

        word = token.text.lower()
        all_words.append(word)

        if word in TIME_WORDS or token.ent_type_ in ("DATE", "TIME"):
            time_words.append(word)
        elif token.dep_ == "nsubj":
            subject.append(word)
        elif token.dep_ == "ROOT" and token.pos_ == "VERB":
            verb.append(word)
        elif token.dep_ in ("dobj", "pobj") and token.pos_ in ("NOUN", "PROPN", "PRON"):
            obj.append(word)
        elif token.dep_ == "neg" or word in ("not", "never", "no"):
            verb.insert(0, word)
        else:
            other.append(word)

    ordered = time_words + subject + verb + obj + other
    for w in all_words:
        if w not in ordered:
            ordered.append(w)

    seen: set[str] = set()
    unique: list[str] = []
    for w in ordered:
        if w not in seen:
            seen.add(w)
            unique.append(w)
    return unique


def gloss_to_gifs(tokens: list[str]) -> list[dict]:
    """Map ASL gloss tokens to available GIFs. Words without a GIF receive gif=None for word display fallback."""
    result = []
    for word in tokens:
        gif_name = GIF_INDEX.get(word)
        result.append({"word": word.upper(), "gif": gif_name if gif_name else None})
    return result


def caption_to_asl(text: str) -> dict:
    """
    Convert a caption sentence into ASL gloss tokens + matched sign GIFs/fallback words.
    Returns {"tokens": [...], "gifs": [{"word", "gif"}, ...]}
    """
    text = (text or "").strip()
    if not text:
        return {"tokens": [], "gifs": []}

    if _nlp is not None:
        doc = _nlp(text)
        tokens = _extract_gloss_tokens(doc)
    else:
        import re
        tokens = [w.lower() for w in re.findall(r"\b\w+\b", text)]

    gifs = gloss_to_gifs(tokens)
    return {"tokens": [t.upper() for t in tokens], "gifs": gifs}


