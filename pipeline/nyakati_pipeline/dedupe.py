"""Model-assisted duplicate merging: approved events in the same year whose titles and summaries
embed almost identically (bge-m3, cosine similarity >= the threshold) are proposed as duplicates.

Without --apply it prints the pairs for a person (or AI) to read; pairs judged to be
different events go in data/presort/not-duplicates.json and are never merged. With --apply, each pair
is merged by keeping the event with the more precise date (then the hand-written one, then the
older row) and rejecting the other with the reason "Duplicate of <kept title>".
"""

import argparse
import json
import os
from collections import defaultdict
from datetime import date

import httpx

from .db import connect
from .presort import PRESORT

OLLAMA = os.environ.get("OLLAMA_URL", "http://ollama:11434")
PRECISION = {"day": 0, "month": 1, "year": 2}


def embed(texts: list[str]) -> list[list[float]]:
    out = []
    with httpx.Client() as client:
        for i in range(0, len(texts), 16):
            r = client.post(f"{OLLAMA}/api/embed", json={"model": "bge-m3", "input": texts[i : i + 16]}, timeout=300)
            r.raise_for_status()
            out += r.json()["embeddings"]
    return out


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    parser.add_argument("--threshold", type=float, default=0.86)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, title, summary, date, date_precision, origin, created_at FROM event "
            "WHERE status = 'approved' AND date >= %s AND date < %s ORDER BY date",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        ).fetchall()
        vectors = embed([f"{r[1]}. {r[2] or ''}" for r in rows])
        by_year = defaultdict(list)
        for r, v in zip(rows, vectors):
            by_year[r[3].year].append((r, v))

        # Pairs a reviewer judged to be different events.
        distinct_file = PRESORT / "not-duplicates.json"
        distinct = {frozenset(p) for p in json.loads(distinct_file.read_text())["pairs"]} if distinct_file.exists() else set()
        pairs, gone = [], set()
        for items in by_year.values():
            for i in range(len(items)):
                for j in range(i + 1, len(items)):
                    (a, va), (b, vb) = items[i], items[j]
                    score = cosine(va, vb)
                    if score >= args.threshold and frozenset((a[0], b[0])) not in distinct:
                        keep, drop = sorted(
                            (a, b), key=lambda r: (PRECISION[r[4]], r[5] != "hand", r[6])
                        )
                        pairs.append((score, keep, drop))
        for score, keep, drop in sorted(pairs, key=lambda p: -p[0]):
            print(f"{score:.3f}  keep {keep[0]} \"{keep[1]}\"  |  drop {drop[0]} \"{drop[1]}\"")
            if args.apply and drop[0] not in gone and keep[0] not in gone:
                conn.execute(
                    "UPDATE event SET status = 'rejected', reviewed_by = 'presort', curated = true, reviewed_at = now(), "
                    "review_note = %s, updated_at = now() WHERE id = %s",
                    (f"Duplicate of \"{keep[1]}\" (merged by embedding similarity {score:.2f}).", drop[0]),
                )
                gone.add(drop[0])
        conn.commit()
    print(f"dedupe {args.start}–{args.end}: {len(rows)} approved events, {len(pairs)} pairs at >= {args.threshold}"
          + (f", {len(gone)} merged" if args.apply else " (dry run)"))


if __name__ == "__main__":
    main()
