"""
doctor_matching.py

Two approaches for scoring patient condition → doctor compatibility:
  - BM25   : keyword overlap against doctors.json `keywords` field
  - Embedding: cosine similarity against doctors.json `description` field

Both return a dict {doctor_name: score_0_to_1} for every doctor.
The score for the slot's doctor is used as the doctor_match component
in the ranker — replacing the old hard filter.
"""

import json
import math
import re
from functools import lru_cache

# ── BM25 ───────────────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list:
    return re.findall(r"\b\w+\b", text.lower())


def _bm25_raw(query_tokens: list, doc_token_lists: list, k1: float = 1.5, b: float = 0.75) -> list:
    from collections import Counter
    N = len(doc_token_lists)
    avgdl = sum(len(d) for d in doc_token_lists) / N

    scores = []
    for doc in doc_token_lists:
        counter = Counter(doc)
        dl = len(doc)
        score = 0.0
        for term in query_tokens:
            tf = counter.get(term, 0)
            df = sum(1 for d in doc_token_lists if term in Counter(d))
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
            score += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avgdl))
        scores.append(score)
    return scores


def doctor_scores_bm25(condition: str, doctors: list) -> dict:
    """BM25 scores for condition against each doctor's keyword field. Returns 0-1 normalised."""
    query = _tokenize(condition)
    doc_tokens = [_tokenize(d["keywords"]) for d in doctors]
    raw = _bm25_raw(query, doc_tokens)
    total = sum(raw) or 1.0
    return {d["name"]: round(s / total, 4) for d, s in zip(doctors, raw)}


# ── Embeddings ─────────────────────────────────────────────────────────────────

_embedding_model = None
_doctor_embeddings: dict = {}


def _get_model():
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


def _encode_doctors(doctors: list) -> None:
    import numpy as np
    global _doctor_embeddings
    model = _get_model()
    descriptions = [d["description"] for d in doctors]
    vecs = model.encode(descriptions, normalize_embeddings=True)
    _doctor_embeddings = {d["name"]: vecs[i] for i, d in enumerate(doctors)}


def doctor_scores_embedding(condition: str, doctors: list) -> dict:
    """Cosine similarity for condition against each doctor's description. Returns 0-1 normalised."""
    import numpy as np

    if not _doctor_embeddings:
        _encode_doctors(doctors)

    model = _get_model()
    query_vec = model.encode([condition], normalize_embeddings=True)[0]

    raw = {name: float(np.dot(query_vec, vec)) for name, vec in _doctor_embeddings.items()}

    lo, hi = min(raw.values()), max(raw.values())
    if hi > lo:
        return {name: round((s - lo) / (hi - lo), 4) for name, s in raw.items()}
    return {name: 1.0 for name in raw}


# ── Convenience: score for a single slot doctor ────────────────────────────────

def doctor_match_score(condition: str, slot_doctor: str, doctors: list, method: str) -> float:
    """Return the compatibility score [0-1] between condition and slot_doctor using method.

    BM25 mode: falls back to embeddings when BM25 returns 0 (no keyword overlap),
    so a correct match is never silently zeroed out.
    """
    if method == "bm25":
        scores = doctor_scores_bm25(condition, doctors)
        score = scores.get(slot_doctor, 0.0)
        if score == 0.0:
            scores = doctor_scores_embedding(condition, doctors)
            score = scores.get(slot_doctor, 0.0)
        return score
    elif method == "embedding":
        scores = doctor_scores_embedding(condition, doctors)
    else:
        raise ValueError(f"Unknown method: {method!r}. Use 'bm25' or 'embedding'.")
    return scores.get(slot_doctor, 0.0)
