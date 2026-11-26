"""Candidate events from Wikipedia's "<year> in Kenya" articles.

Only the Events section is read (not Births or Deaths). Each line that starts with a date,
"4 January – …", "January 4 - …" or "March – …", becomes a candidate dated to that day or
month and citing the year's article. Sport is skipped. The line's first sentence is the
title, shortened at a comma if it is long, and the line itself is the summary.
"""

import argparse
import re
from datetime import date

from .common import Candidate, Http, first_sentences, guess_lens, upsert
from .db import connect

API = "https://en.wikipedia.org/w/api.php"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
M = "|".join(MONTHS)
DAY_MONTH = re.compile(rf"^(\d{{1,2}}) ({M})\s*[–—-]\s*(.+)$")
MONTH_DAY = re.compile(rf"^({M}) (\d{{1,2}})\s*[–—-]\s*(.+)$")
MONTH_ONLY = re.compile(rf"^({M})\s*[–—-]\s*(.+)$")
SPORT = re.compile(r"athlet|marathon|football|rugby|olympic|\bcup\b|medal|\bF\.?C\.?\b|championship|tournament|"
                   r"cricket|volleyball|boxing|safari rally|wins (gold|silver|bronze)|runner|world record|"
                   r"\bmetres\b|\bsprint|\bAFCON\b|\bFIFA\b", re.I)


def title_from(text: str) -> str:
    """The whole first sentence, so the title says what happened; trimmed only if very long."""
    first = first_sentences(text, 1).rstrip(".")
    return first if len(first) <= 140 else first[: first.rfind(" ", 0, 136)] + "…"


def events_section(extract: str) -> list[str]:
    lines, inside = [], False
    for line in extract.split("\n"):
        heading = re.fullmatch(r"(=+)\s*(.*?)\s*=+", line.strip())
        if heading and len(heading.group(1)) == 2:
            inside = heading.group(2).lower().startswith("event")
            continue
        if inside and line.strip():
            lines.append(line.strip())
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()
    http = Http(pause=0.5)
    candidates = []
    for year in range(args.start, args.end + 1):
        data = http.get_json(API, {"action": "query", "format": "json", "titles": f"{year} in Kenya",
                                   "prop": "extracts", "explaintext": "1"})
        page = next(iter(data["query"]["pages"].values()))
        if "missing" in page:
            continue
        url = f"https://en.wikipedia.org/wiki/{year}_in_Kenya"
        for line in events_section(page.get("extract", "")):
            if m := DAY_MONTH.match(line):
                day, month, text = int(m.group(1)), MONTHS.index(m.group(2)) + 1, m.group(3)
            elif m := MONTH_DAY.match(line):
                month, day, text = MONTHS.index(m.group(1)) + 1, int(m.group(2)), m.group(3)
            elif m := MONTH_ONLY.match(line):
                month, day, text = MONTHS.index(m.group(1)) + 1, None, m.group(2)
            else:
                continue
            text = " ".join(text.split())
            if SPORT.search(text) or len(text) < 30:
                continue
            try:
                when = date(year, month, day or 1)
            except ValueError:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", text.lower())[:40].strip("-")
            summary = first_sentences(text, 2)
            candidates.append(Candidate(
                id=f"yl-{when.isoformat()}-{slug}",
                date=when,
                date_precision="day" if day else "month",
                title=title_from(text),
                summary=summary if summary.endswith((".", "!", "?", "\"")) else summary + ".",
                lens=guess_lens(text),
                source_url=url,
                source_name=f"Wikipedia: {year} in Kenya",
                licence="CC BY-SA 4.0",
                origin="wikipedia",
            ))
    with connect() as conn:
        written = upsert(conn, candidates)
        # Only year-list rows are pruned here; other Wikipedia candidates belong to the category step.
        pruned = conn.execute(
            "DELETE FROM event WHERE id LIKE 'yl-%%' AND status = 'unreviewed' AND NOT curated "
            "AND date >= %s AND date < %s AND NOT (id = ANY(%s))",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1), [c.id for c in candidates]),
        ).rowcount
        conn.commit()
    print(f"yearlists {args.start}–{args.end}: {len(candidates)} dated entries, {written} rows written, {pruned} stale removed")


if __name__ == "__main__":
    main()
