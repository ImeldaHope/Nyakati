"""Export approved events as static JSON for the site.

  public/data/index.json            event counts per year, the decades that have
                                    files, and who approved what (for /sources)
  public/data/decades/<1960>.json   every approved event in that decade, and its images

Only approved events are exported. The site loads a decade's file as the river
scrolls near it. Output is deterministic, so an unchanged database gives no diff.

Images carry their author and licence. Each Commons file appears once per year and
lens, under the earliest event that uses it.
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

from .db import connect

OUT = Path(__file__).resolve().parents[2] / "public" / "data"

QUERY = """
SELECT id, to_char(date, 'YYYY-MM-DD') AS date, date_precision, date_label, title, summary, lens, era,
       source_url, source_name, licence, reviewed_by
  FROM event
 WHERE status = 'approved'
 ORDER BY date, title, id
"""

# Who and where, from the entities step; both come from Wikidata and link back to it.
PEOPLE = """
SELECT ep.event_id, p.name, p.wikidata_id, ep.role
  FROM event_person ep JOIN person p ON p.id = ep.person_id
 ORDER BY ep.event_id, ep.role = 'article subject', p.name
"""
PLACES = """
SELECT e.id AS event_id, pl.name, pl.county, pl.wikidata_id
  FROM event e JOIN place pl ON pl.id = e.place_id
"""

IMAGES = """
SELECT i.event_id, e.lens, to_char(e.date, 'YYYY') AS year, i.commons_title, i.thumb_url, i.page_url,
       i.width, i.height, i.author, i.licence, i.licence_url, i.caption, i.taken
  FROM image i JOIN event e ON e.id = i.event_id
 WHERE e.status = 'approved'
 ORDER BY e.date, e.title, i.commons_title
"""


def rows(conn, query: str) -> list[dict]:
    cur = conn.execute(query)
    names = [c.name for c in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def main() -> None:
    with connect() as conn:
        events = rows(conn, QUERY)
        all_images = rows(conn, IMAGES)
        people: dict[str, list[dict]] = defaultdict(list)
        for r in rows(conn, PEOPLE):
            people[r.pop("event_id")].append(r)
        places = {r.pop("event_id"): r for r in rows(conn, PLACES)}

    images_by_decade: dict[int, list[dict]] = defaultdict(list)
    seen: set[tuple] = set()
    for img in all_images:
        key = (img["year"], img["lens"], img["commons_title"])
        if key in seen:
            continue
        seen.add(key)
        if img["taken"] is None:
            del img["taken"]
        images_by_decade[int(img["year"]) // 10 * 10].append(img)

    by_decade: dict[int, list[dict]] = defaultdict(list)
    for e in events:
        if e["date_label"] is None:
            del e["date_label"]
        if e["id"] in places:
            e["place"] = {k: v for k, v in places[e["id"]].items() if v is not None}
        if e["id"] in people:
            e["people"] = people[e["id"]]
        by_decade[int(e["date"][:4]) // 10 * 10].append(e)

    decades_dir = OUT / "decades"
    decades_dir.mkdir(parents=True, exist_ok=True)
    for stale in decades_dir.glob("*.json"):
        if int(stale.stem) not in by_decade:
            stale.unlink()
    for decade, items in sorted(by_decade.items()):
        write(decades_dir / f"{decade}.json", {"decade": decade, "events": items, "images": images_by_decade[decade]})

    years = Counter(e["date"][:4] for e in events)
    write(OUT / "index.json", {
        "decades": sorted(by_decade),
        "years": dict(sorted(years.items())),
        "approved": {"total": len(events), "by": dict(sorted(Counter(e["reviewed_by"] for e in events).items()))},
        "images": sum(len(v) for v in images_by_decade.values()),  # for /sources
    })
    # Threads: each with its events in order, for /thread/<slug> and the river's brass line.
    with connect() as conn:
        threads = rows(conn, """
            SELECT t.slug, t.title, t.description,
                   coalesce(json_agg(json_build_object('id', e.id, 'date', to_char(e.date, 'YYYY-MM-DD'),
                                                       'title', e.title, 'lens', e.lens)
                                     ORDER BY te.position) FILTER (WHERE e.id IS NOT NULL), '[]') AS events
              FROM thread t
              LEFT JOIN thread_event te ON te.thread_id = t.id
              LEFT JOIN event e ON e.id = te.event_id AND e.status = 'approved'
             GROUP BY t.id ORDER BY t.id""")
    write(OUT / "threads.json", {"threads": threads})

    n_images = sum(len(v) for v in images_by_decade.values())
    print(f"export: {len(events)} approved events and {n_images} images in {len(by_decade)} decade file(s) "
          f"-> {OUT.relative_to(OUT.parents[1])}")


def write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
