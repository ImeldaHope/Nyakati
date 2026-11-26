"""Model-assisted lens tagging: the shared model picks politics, culture or places for each
approved event whose lens nobody set on purpose. News is kept for the GDELT feed (Phase 7).

The model's answer is stored in lens_model, and the lens is set from it with lens_source =
'model'. Events whose lens a person, a hand-written file or a pre-sort rule set are left alone.
How often the model is wrong is measured by `lenscheck` on a 100-event sample. That check
found the model's habits (universities as places, wars as places, crashes as politics), so a
rules pass then corrects those patterns, and the checked sample takes its checked lens; both
are recorded as lens_source = 'rule'. `--rules-only` runs just that pass.
"""

import json
from pathlib import Path

import argparse
import os
import re
from datetime import date

import httpx

from .db import connect

MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:1b")
OLLAMA = os.environ.get("OLLAMA_URL", "http://ollama:11434")

SYSTEM = (
    "You sort events from Kenyan history into one of three lenses. "
    "politics: government, elections, parties, laws, courts, war, conflict, security, diplomacy, the economy. "
    "culture: arts, books, film, music, religion, churches, education, universities, media, science, heritage. "
    "places: national parks, reserves, the environment, wildlife, cities, land, infrastructure, natural disasters. "
    "Reply with one word: politics, culture or places."
)
EXAMPLES = [
    ("KANU wins the general election", "politics"),
    ("Meru National Park is established", "places"),
    ("An anthem from a Pokomo lullaby", "culture"),
    ("Floods hit the Tana River delta", "places"),
]


def tag(client: httpx.Client, title: str, summary: str) -> str:
    messages = [{"role": "system", "content": SYSTEM}]
    for t, lens in EXAMPLES:
        messages += [{"role": "user", "content": t}, {"role": "assistant", "content": lens}]
    messages.append({"role": "user", "content": f"{title}. {summary[:300]}"})
    r = client.post(f"{OLLAMA}/api/chat", json={
        "model": MODEL, "stream": False, "messages": messages, "options": {"temperature": 0, "num_predict": 4},
    }, timeout=180)
    r.raise_for_status()
    m = re.search(r"politics|culture|places", r.json()["message"]["content"].lower())
    return m.group(0) if m else "politics"


# The model's systematic mistakes, from the 100-event check. First match wins.
CORRECTIONS = [
    ("culture", re.compile(r"universit|school|college|archbishop|cardinal|church|mosque|literary|festival|novel|"
                           r"album|film|music|education|exam|assessment|space agency|satellite", re.I)),
    ("politics", re.compile(r"\bwar\b|battle|massacre|insurgenc|attack|ambush|clash|militant|al-shabaab|mungiki|"
                            r"\bkilled by (the )?police|shot dead|kipande|white paper|commission|authority", re.I)),
    ("places", re.compile(r"crash|collide|collision|accident|derail|capsize|sinks|flood|landslide|fire\b|drought", re.I)),
]
SAMPLE = Path(__file__).resolve().parents[2] / "data" / "eval" / "lens-sample.json"


def correct(conn) -> int:
    """Rules over the model's tags, then the checked sample. Returns rows changed."""
    changed = 0
    with conn.cursor() as cur:
        rows = cur.execute(
            "SELECT id, title, summary, lens FROM event WHERE status = 'approved' AND lens_source = 'model'"
        ).fetchall()
        for eid, title, summary, lens in rows:
            for right, pattern in CORRECTIONS:
                if pattern.search(title) or pattern.search((summary or "")[:160]):
                    if right != lens:
                        cur.execute("UPDATE event SET lens = %s, lens_source = 'rule', updated_at = now() WHERE id = %s",
                                    (right, eid))
                        changed += cur.rowcount
                    break
        if SAMPLE.exists():
            for item in json.loads(SAMPLE.read_text())["items"]:
                if item.get("check"):
                    cur.execute(
                        "UPDATE event SET lens = %s, lens_source = 'rule', updated_at = now() "
                        "WHERE id = %s AND lens_source IN ('model', 'rule') AND lens <> %s",
                        (item["check"], item["id"], item["check"]),
                    )
                    changed += cur.rowcount
    conn.commit()
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, default=1895)
    parser.add_argument("--to", dest="end", type=int, default=2100)
    parser.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()
    if args.rules_only:
        with connect() as conn:
            print(f"lenstag rules: {correct(conn)} lenses corrected")
        return
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, title, summary FROM event WHERE status = 'approved' AND origin <> 'hand' "
            "AND lens_source IS NULL AND date >= %s AND date < %s ORDER BY date",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        ).fetchall()
        with httpx.Client() as client, conn.cursor() as cur:
            for eid, title, summary in rows:
                lens = tag(client, title, summary or "")
                cur.execute(
                    "UPDATE event SET lens = %s, lens_model = %s, lens_source = 'model', updated_at = now() WHERE id = %s",
                    (lens, lens, eid),
                )
        conn.commit()
        fixed = correct(conn)
    print(f"lenstag {args.start}–{args.end}: {len(rows)} events tagged by {MODEL}; {fixed} corrected by rules")


if __name__ == "__main__":
    main()
