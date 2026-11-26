"""Apply a pre-sort file (data/presort/<from>-<to>.json) to the candidates.

Each decision is one of:
  keep    an event; any suggested title, summary, date or lens is applied
  hold    needs a person's judgement; only its note is shown
  reject  rejected, with the reason shown on the review screen
  approve approved by AI at the owner's request, marked reviewed_by = 'claude'

With --trust-wikidata, kept candidates that came from Wikidata are approved at once
and marked reviewed_by = 'wikidata-trust', so the site can say which events no
person checked. Everything else stays unreviewed for a person. Rows a person has
already decided are never touched, and pre-sorted rows are protected from pipeline reruns.
"""

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from .common import Lens, era_for
from .db import connect

PRESORT = Path(__file__).resolve().parents[2] / "data" / "presort"


class Decision(BaseModel):
    id: str
    action: Literal["keep", "hold", "reject", "approve"]
    reason: str | None = None
    note: str | None = None
    title: str | None = None
    summary: str | None = None
    date: str | None = None
    lens: Lens | None = None
    # A corrected source, when the cited article was renamed or redirects elsewhere.
    source_url: str | None = None
    source_name: str | None = None


def parse_date(value: str) -> tuple[date, str]:
    """"1963", "1963-05" or "1963-05-26": the form sets the precision."""
    parts = [int(p) for p in value.split("-")]
    precision = ["year", "month", "day"][len(parts) - 1]
    return date(parts[0], *(parts[1:] + [1] * (3 - len(parts)))), precision


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    parser.add_argument("--trust-wikidata", action="store_true")
    args = parser.parse_args()

    path = PRESORT / f"{args.start}-{args.end}.json"
    decisions = [Decision(**d) for d in json.loads(path.read_text())["decisions"]]
    counts = {"keep": 0, "hold": 0, "reject": 0, "approve": 0, "trusted": 0, "already decided": 0, "missing": 0}

    with connect() as conn, conn.cursor() as cur:
        for d in decisions:
            row = cur.execute(
                "SELECT origin, status, reviewed_by, coalesce(review_note, '') FROM event WHERE id = %s", (d.id,)
            ).fetchone()
            if row is None:
                counts["missing"] += 1
                print(f"  missing: {d.id}")
                continue
            origin, status, reviewed_by, note = row
            # A person's decision, and a duplicate merged by `make dedupe`, both stand.
            if reviewed_by == "person" or note.startswith("Duplicate of"):
                counts["already decided"] += 1
                continue

            fields: dict = {"curated": True, "review_note": d.reason if d.action == "reject" else d.note}
            for name in ("title", "summary", "lens", "source_url", "source_name"):
                if getattr(d, name):
                    fields[name] = getattr(d, name)
            if d.lens:
                fields["lens_source"] = "rule"  # chosen on purpose; the model's tagger leaves it alone
            if d.date:
                fields["date"], fields["date_precision"] = parse_date(d.date)
                fields["era"] = era_for(fields["date"])

            if d.action == "reject":
                fields |= {"status": "rejected", "reviewed_by": "presort"}
            elif d.action == "approve":
                fields |= {"status": "approved", "reviewed_by": "claude"}
            elif d.action == "keep" and origin == "wikidata" and args.trust_wikidata:
                fields |= {"status": "approved", "reviewed_by": "wikidata-trust"}
                counts["trusted"] += 1
            else:
                fields |= {"status": "unreviewed", "reviewed_by": None}

            assignments = ", ".join(f"{k} = %({k})s" for k in fields)
            reviewed_at = "now()" if fields["status"] != "unreviewed" else "NULL"
            cur.execute(
                f"UPDATE event SET {assignments}, reviewed_at = {reviewed_at}, updated_at = now() WHERE id = %(id)s",
                {**fields, "id": d.id},
            )
            counts[d.action] += 1
        conn.commit()

    print(f"presort {args.start}–{args.end}: " + ", ".join(f"{v} {k}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
