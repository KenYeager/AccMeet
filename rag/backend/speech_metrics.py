"""
Deterministic speech metrics computed from one ~30-second transcript chunk.

Pure functions, no LLM, no dependencies — every number here is a plain count
or ratio a human can verify by hand, which is the point: these feed a report
a family member reads, so the arithmetic has to be inspectable rather than a
model's opinion.

Privacy: nothing in this module retains text. Callers pass a chunk in, get
numbers out, and the transcript is garbage-collected exactly as it is today —
the system has never stored verbatim speech and this feature doesn't change
that. In particular we deliberately do NOT return token lists, which would
amount to storing the conversation.

Signals chosen because they recur across the speech-biomarker literature:
reduced lexical diversity, more pronouns standing in for specific nouns,
more filler/hesitation, and shorter simpler utterances.
"""
import re

# Personal + demonstrative pronouns. A closed word class, so this needs no
# POS tagger and stays fully deterministic. Matters because the marker in the
# literature is pronouns *displacing* specific nouns ("she moved there" once
# the speaker can't retrieve "Priya" / "Boston").
PRONOUNS = frozenset({
    "i", "me", "my", "mine", "myself",
    "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself",
    "she", "her", "hers", "herself",
    "it", "its", "itself",
    "we", "us", "our", "ours", "ourselves",
    "they", "them", "their", "theirs", "themselves",
    "this", "that", "these", "those",
})

# Single-token hesitation markers.
FILLER_TOKENS = frozenset({"um", "uh", "erm", "er", "hmm", "mm", "uhh", "umm"})

# Multi-word fillers, matched against raw text rather than tokens.
FILLER_PHRASES = (
    "you know", "i mean", "sort of", "kind of", "how do you call it",
    "what do you call it", "you know what i mean",
)

# Below this, ratios are noise — a six-word chunk yielding "100% lexical
# diversity" would be actively misleading, so we report nothing instead.
MIN_TOKENS_FOR_RATIOS = 20

# Deliberately small. A 30-second chunk of one speaker's half of a conversation
# is often only 30-50 words, and a larger window would force a fallback to plain
# TTR on most chunks — reintroducing exactly the length-dependence MATTR exists
# to remove. Below one full window we return None rather than a number that
# isn't comparable to the others.
MATTR_WINDOW = 25

_WORD_RE = re.compile(r"[a-z']+")
_SPEAKER_RE = re.compile(r"^\s*([^:]{1,40}):\s*(.*)$")


def patient_lines(chunk_text: str) -> list[str]:
    """Extract only what the PATIENT said.

    Chunks arrive as "Patient: ..." / "<Name>: ..." lines (see
    useConversationMemory's addUtterance). Measuring the whole dialogue would
    make every metric depend on how talkative the visitor happened to be.
    """
    lines = []
    for raw in chunk_text.splitlines():
        m = _SPEAKER_RE.match(raw)
        if m and m.group(1).strip().lower() == "patient":
            body = m.group(2).strip()
            if body:
                lines.append(body)
    return lines


def tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def mattr(tokens: list[str], window: int = MATTR_WINDOW) -> float | None:
    """Moving-average type-token ratio — lexical diversity that does NOT
    depend on sample length.

    Plain TTR (unique/total) falls as a sample grows, because common words
    inevitably repeat. Using it here would have manufactured "declining
    vocabulary" out of nothing more than someone having a longer call, which
    is exactly the false signal this feature must not produce. MATTR averages
    the ratio over fixed-size sliding windows, so a 100-word and a 400-word
    sample from the same speaker score the same.
    """
    n = len(tokens)
    if n < window:
        # No plain-TTR fallback on purpose: a short-sample TTR is not on the
        # same scale as a windowed one, so averaging the two across a call
        # would make the result depend on how long each chunk happened to be.
        return None
    if n == window:
        return len(set(tokens)) / n

    counts: dict[str, int] = {}
    for t in tokens[:window]:
        counts[t] = counts.get(t, 0) + 1

    total = len(counts)
    for i in range(1, n - window + 1):
        outgoing = tokens[i - 1]
        counts[outgoing] -= 1
        if counts[outgoing] == 0:
            del counts[outgoing]
        incoming = tokens[i + window - 1]
        counts[incoming] = counts.get(incoming, 0) + 1
        total += len(counts)

    windows = n - window + 1
    return (total / windows) / window


def count_pronouns(tokens: list[str]) -> int:
    return sum(1 for t in tokens if t in PRONOUNS)


def count_fillers(text: str, tokens: list[str]) -> int:
    lowered = text.lower()
    phrase_hits = sum(lowered.count(p) for p in FILLER_PHRASES)
    token_hits = sum(1 for t in tokens if t in FILLER_TOKENS)
    return phrase_hits + token_hits


def chunk_metrics(chunk_text: str) -> dict:
    """Per-chunk counts for one 30s window.

    Returns COUNTS, not rates, because the caller accumulates across a whole
    call: summing counts and dividing once at the end gives the true call-level
    rate, whereas averaging per-chunk rates would silently weight a 10-word
    chunk the same as a 200-word one.

    `mattr` is the exception — it's already length-normalised, so it's
    returned per chunk and averaged later. That also keeps us from having to
    retain the token sequence across chunks, which would mean storing the
    conversation.
    """
    lines = patient_lines(chunk_text)
    text = " ".join(lines)
    tokens = tokenize(text)

    return {
        "token_count": len(tokens),
        "utterance_count": len(lines),
        "pronoun_count": count_pronouns(tokens),
        "filler_count": count_fillers(text, tokens),
        "mattr": mattr(tokens),
    }


def per_hundred(count: int, token_count: int) -> float | None:
    if token_count < MIN_TOKENS_FOR_RATIOS:
        return None
    return round(count / token_count * 100, 2)
