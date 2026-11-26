"""Load the hand-written Phase 0 events (data/events-*.json) as unreviewed rows."""

from datetime import date
from pathlib import Path
import json

from .common import Candidate, upsert
from .db import connect

DATA = Path(__file__).resolve().parents[2] / "data"


def parse_date(value: str) -> date:
    parts = [int(p) for p in value.split("-")]
    return date(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)


def main() -> None:
    candidates = []
    for path in sorted(DATA.glob("events-*.json")):
        for e in json.loads(path.read_text())["events"]:
            candidates.append(
                Candidate(
                    id=e["id"],
                    date=parse_date(e["date"]),
                    date_precision=e["date_precision"],
                    date_label=e.get("date_label"),
                    title=e["title"],
                    summary=e["summary"],
                    lens=e["lens"],
                    source_url=e["source_url"],
                    source_name=e["source_name"],
                    licence=e["licence"],
                    origin="hand",
                )
            )
    with connect() as conn:
        print(f"hand-written: {upsert(conn, candidates)} of {len(candidates)} written")


if __name__ == "__main__":
    main()
