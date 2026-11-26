"""Candidate events from Wikidata for a span of years.

Widens the plan's starting query: items tied to Kenya by country (Kenya or Kenya
Colony), by jurisdiction, or by location, with a point in time, start time,
publication date or inception in range. Noise is filtered by type, every
exclusion is written to data/raw so the filter can be checked, and everything
that survives lands as unreviewed rows for a person to approve or reject.
"""

import argparse
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import unquote

from .common import EXCLUDE, Candidate, Http, guess_lens, prune, upsert
from .db import connect

SPARQL = "https://query.wikidata.org/sparql"
RAW = Path(__file__).resolve().parents[2] / "data" / "raw"

QUERY = """
SELECT ?item ?itemLabel ?itemDescription ?prop ?date ?precision ?enwiki
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types) WHERE {
  { ?item wdt:P17 ?country . VALUES ?country { wd:Q114 wd:Q2538511 } }   # Kenya, Kenya Colony
  UNION { ?item wdt:P1001 wd:Q114 }                                       # applies to jurisdiction
  UNION { ?item wdt:P131+ wd:Q114 }                                       # located in Kenya
  VALUES (?prop ?ps ?psv) {
    ("P585" p:P585 psv:P585)   # point in time
    ("P580" p:P580 psv:P580)   # start time
    ("P577" p:P577 psv:P577)   # publication date
    ("P571" p:P571 psv:P571)   # inception
  }
  ?item ?ps ?st . ?st ?psv ?v . ?v wikibase:timeValue ?date ; wikibase:timePrecision ?precision .
  FILTER(?date >= "%(start)s-01-01T00:00:00Z"^^xsd:dateTime && ?date < "%(end)s-01-01T00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,sw". }
}
GROUP BY ?item ?itemLabel ?itemDescription ?prop ?date ?precision ?enwiki
"""

# Prefer the date that says when something happened over when it was founded.
PROP_ORDER = ["P585", "P580", "P577", "P571"]
PRECISION = {11: "day", 10: "month", 9: "year"}


def fetch(http: Http, start: int, end: int) -> list[dict]:
    data = http.get_json(
        SPARQL,
        params={"query": QUERY % {"start": start, "end": end + 1}},
        headers={"Accept": "application/sparql-results+json"},
    )
    return data["results"]["bindings"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()

    rows = fetch(Http(), args.start, args.end)

    # One row per item and dated property; keep the preferred, most precise date per item.
    items: dict[str, dict] = {}
    for r in rows:
        qid = r["item"]["value"].rsplit("/", 1)[1]
        precision = int(r["precision"]["value"])
        if precision not in PRECISION:
            continue
        rank = (PROP_ORDER.index(r["prop"]["value"]), -precision)
        if qid in items and items[qid]["rank"] <= rank:
            continue
        items[qid] = {
            "rank": rank,
            "qid": qid,
            "label": r["itemLabel"]["value"],
            "description": r.get("itemDescription", {}).get("value", ""),
            "prop": r["prop"]["value"],
            "date": r["date"]["value"][:10],
            "precision": PRECISION[precision],
            "types": [t for t in r["types"]["value"].split("|") if t],
            "enwiki": r.get("enwiki", {}).get("value"),
        }

    kept, excluded = [], []
    for item in sorted(items.values(), key=lambda i: i["date"]):
        reason = None
        if re.fullmatch(r"Q\d+", item["label"]):
            reason = "no English or Swahili label"
        elif hits := [t for t in item["types"] if EXCLUDE.search(t)]:
            reason = f"type: {', '.join(hits)}"
        elif EXCLUDE.search(item["label"]) and not item["types"]:
            reason = "untyped, label looks like sport or infrastructure"
        (excluded if reason else kept).append({**item, "reason": reason} if reason else item)

    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / f"wikidata-{args.start}-{args.end}.json"
    out.write_text(json.dumps({"kept": kept, "excluded": excluded}, indent=2, ensure_ascii=False, default=str))

    candidates = []
    for item in kept:
        y, m, d = (int(p) for p in item["date"].split("-"))
        when = date(y, m if item["precision"] != "year" else 1, d if item["precision"] == "day" else 1)
        article = item["enwiki"]
        description = item["description"]
        candidates.append(
            Candidate(
                id=f"wd-{item['qid']}",
                date=when,
                date_precision=item["precision"],
                title=item["label"],
                # Replaced by the article's opening sentences in the Wikipedia step, where there is one.
                summary=(description[:1].upper() + description[1:] + ".") if description else "",
                lens=guess_lens(item["label"], description, *item["types"]),
                source_url=article or f"https://www.wikidata.org/wiki/{item['qid']}",
                source_name=f"Wikipedia: {unquote(article.rsplit('/', 1)[1]).replace('_', ' ')}"
                if article
                else f"Wikidata: {item['qid']}",
                licence="CC BY-SA 4.0" if article else "CC0 1.0",
                wikidata_id=item["qid"],
                wikidata_types=item["types"],
                origin="wikidata",
            )
        )

    with connect() as conn:
        written = upsert(conn, candidates)
        pruned = prune(conn, "wikidata", args.start, args.end, {c.id for c in candidates})
    print(f"wikidata {args.start}–{args.end}: {len(items)} items, {len(kept)} kept, {len(excluded)} excluded "
          f"(see {out.relative_to(RAW.parents[1])}), {written} rows written, {pruned} stale removed")


if __name__ == "__main__":
    main()
