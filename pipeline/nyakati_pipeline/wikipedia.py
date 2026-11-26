"""Candidate events and summaries from English Wikipedia for a span of years.

1. Walks "Category:<year> in Kenya" and its event-like subcategories (establishments,
   crimes, elections and so on, but not sport) for articles the Wikidata step has not
   already loaded or filtered out.
   Each article's date comes from its Wikidata item when one falls in that year,
   otherwise it is dated to the year of its category.
2. Gives every unreviewed candidate that cites a Wikipedia article the opening two
   sentences of that article as its summary, replacing the one-line Wikidata description.
"""

import argparse
import json
import re
from datetime import date
from urllib.parse import quote, unquote

from .common import EXCLUDE, Candidate, Http, first_sentences, guess_lens, prune, upsert
from .db import connect
from .wikidata import RAW

API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

SUBCATEGORY = re.compile(r"establishments|disestablishments|crimes|elections|conflicts|disasters|treaties|protests|riots|massacres", re.I)
DATE_PROPS = ["P585", "P580", "P577", "P571"]
PRECISION = {11: "day", 10: "month", 9: "year"}


def article_url(title: str) -> str:
    return "https://en.wikipedia.org/wiki/" + quote(title.replace(" ", "_"), safe="()_,'-")


def category_members(http: Http, category: str, kind: str) -> list[str]:
    titles, cont = [], {}
    while True:
        data = http.get_json(API, {
            "action": "query", "format": "json", "list": "categorymembers", "cmtitle": category,
            "cmtype": kind, "cmlimit": "500", **cont,
        })
        titles += [m["title"] for m in data["query"]["categorymembers"]]
        if "continue" not in data:
            return titles
        cont = data["continue"]


def articles_by_year(http: Http, start: int, end: int) -> dict[str, int]:
    found: dict[str, int] = {}
    for year in range(start, end + 1):
        top = f"Category:{year} in Kenya"
        cats = [top] + [c for c in category_members(http, top, "subcat") if SUBCATEGORY.search(c) and "sport" not in c.lower()]
        for cat in cats:
            for title in category_members(http, cat, "page"):
                if not title.startswith("List of") and not EXCLUDE.search(title):
                    found.setdefault(title, year)
    return found


def intros(http: Http, titles: list[str]) -> dict[str, dict]:
    """Opening text and Wikidata id per requested title (redirects followed)."""
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 20):
        batch = titles[i : i + 20]
        data = http.get_json(API, {
            "action": "query", "format": "json", "redirects": "1", "titles": "|".join(batch),
            "prop": "extracts|pageprops", "exintro": "1", "explaintext": "1", "exlimit": "20",
            "ppprop": "wikibase_item|disambiguation",
        })
        q = data["query"]
        alias = {r["from"]: r["to"] for q_part in ("normalized", "redirects") for r in q.get(q_part, [])}
        pages = {p["title"]: p for p in q["pages"].values() if "missing" not in p}
        for title in batch:
            target = alias.get(alias.get(title, title), alias.get(title, title))
            page = pages.get(target)
            if page and "disambiguation" not in page.get("pageprops", {}):
                out[title] = {
                    "title": page["title"],
                    "extract": page.get("extract", ""),
                    "qid": page.get("pageprops", {}).get("wikibase_item"),
                }
    return out


def dates_from_wikidata(http: Http, qids: list[str]) -> dict[str, list[tuple[str, date, str]]]:
    """(property, date, precision) for each item's dated statements."""
    out: dict[str, list[tuple[str, date, str]]] = {}
    for i in range(0, len(qids), 50):
        data = http.get_json(WIKIDATA_API, {
            "action": "wbgetentities", "format": "json", "ids": "|".join(qids[i : i + 50]), "props": "claims",
        })
        for qid, entity in data.get("entities", {}).items():
            found = []
            for prop in DATE_PROPS:
                for claim in entity.get("claims", {}).get(prop, []):
                    value = claim["mainsnak"].get("datavalue", {}).get("value", {})
                    precision = PRECISION.get(value.get("precision"))
                    m = re.match(r"\+(\d{4})-(\d\d)-(\d\d)", value.get("time", ""))
                    if precision and m:
                        y, mo, d = (int(g) for g in m.groups())
                        found.append((prop, date(y, mo or 1, d or 1), precision))
            out[qid] = found
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()
    http = Http(pause=0.5)

    with connect() as conn:
        # Items already held from another origin, or that the Wikidata step filtered out as noise.
        known_qids = {
            r[0] for r in conn.execute("SELECT wikidata_id FROM event WHERE wikidata_id IS NOT NULL AND origin <> 'wikipedia'")
        }
        raw = RAW / f"wikidata-{args.start}-{args.end}.json"
        if raw.exists():
            known_qids |= {i["qid"] for i in json.loads(raw.read_text())["excluded"]}

        # 1. Candidates from the year categories.
        by_year = articles_by_year(http, args.start, args.end)
        fresh = by_year
        info = intros(http, list(fresh))
        new_qids = [i["qid"] for i in info.values() if i["qid"] and i["qid"] not in known_qids]
        dated = dates_from_wikidata(http, new_qids)

        candidates = []
        for title, year in fresh.items():
            page = info.get(title)
            if not page or (page["qid"] and page["qid"] in known_qids):
                continue
            # A date from Wikidata in the category's year, best property first; otherwise the year alone.
            options = sorted(
                (d for d in dated.get(page["qid"] or "", []) if d[1].year == year),
                key=lambda d: (DATE_PROPS.index(d[0]), ["day", "month", "year"].index(d[2])),
            )
            when, precision = (options[0][1], options[0][2]) if options else (date(year, 1, 1), "year")
            if precision == "year":
                when = date(when.year, 1, 1)
            elif precision == "month":
                when = when.replace(day=1)
            summary = first_sentences(page["extract"])
            candidates.append(Candidate(
                id=f"wd-{page['qid']}" if page["qid"] else "enwiki-" + re.sub(r"[^a-z0-9]+", "-", page["title"].lower()).strip("-"),
                date=when,
                date_precision=precision,
                title=page["title"],
                summary=summary,
                lens=guess_lens(page["title"], summary),
                source_url=article_url(page["title"]),
                source_name=f"Wikipedia: {page['title']}",
                licence="CC BY-SA 4.0",
                wikidata_id=page["qid"],
                origin="wikipedia",
            ))
            if page["qid"]:
                known_qids.add(page["qid"])
        written = upsert(conn, candidates)
        pruned = prune(conn, "wikipedia", args.start, args.end, {c.id for c in candidates})

        # 2. Article openings for Wikidata candidates that cite Wikipedia.
        rows = conn.execute(
            "SELECT id, source_url FROM event WHERE status = 'unreviewed' AND NOT curated AND origin = 'wikidata' "
            "AND source_url LIKE 'https://en.wikipedia.org/wiki/%%' AND date >= %s AND date < %s",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        ).fetchall()
        titles = {unquote(url.rsplit("/", 1)[1]).replace("_", " "): event_id for event_id, url in rows}
        texts = intros(http, list(titles))
        updated = 0
        with conn.cursor() as cur:
            for title, event_id in titles.items():
                summary = first_sentences(texts.get(title, {}).get("extract", ""))
                if summary:
                    cur.execute(
                        "UPDATE event SET summary = %s, updated_at = now() "
                        "WHERE id = %s AND status = 'unreviewed' AND NOT curated",
                        (summary, event_id),
                    )
                    updated += cur.rowcount
        conn.commit()

    print(f"wikipedia {args.start}–{args.end}: {len(by_year)} category articles, {len(candidates)} candidates, "
          f"{written} rows written, {pruned} stale removed, {updated} summaries from article openings")


if __name__ == "__main__":
    main()
