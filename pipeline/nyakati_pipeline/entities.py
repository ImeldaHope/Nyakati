"""Fill person, event_person and place from Wikidata, for approved events.

Each event is matched to a Wikidata item: the item it came from, or the item behind the
Wikipedia article it cites. Year-list entries and hand-written events cite no single
article, so they are left without people or a place. From the item:

- People are humans named as participant, organiser, winner, founder or author. Chair and
  head of state are left out: Wikidata gives today's holder, not the one at the time. An
  item that is itself a human is the event's subject; a human whose article the event
  cites is only that ("article subject"), since the article may be about someone else in
  the event. People are keyed on their Wikidata id, so two people with one name stay two.
- The place is the item's location, else the area it is located in. Its county is the
  first county of Kenya above it, when Wikidata's chain of areas reaches one.

Rerunnable: each event's Wikidata roles are replaced, and place_id is set only where it is
empty. Every response is saved to data/raw/entities.json so the links can be checked.
"""

import json
from pathlib import Path
from urllib.parse import unquote

from .common import Http
from .db import connect

SPARQL = "https://query.wikidata.org/sparql"
WIKI_API = "https://en.wikipedia.org/w/api.php"
RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
COUNTY = "Q269218"  # county of Kenya

ROLES = {
    "P710": "participant", "P664": "organiser", "P1346": "winner", "P112": "founder",
    "P50": "author", "subject": "subject",
}
# Every role this step has written, so a rerun replaces its own links and no others.
OWN_ROLES = [*ROLES.values(), "article subject", "chair", "head of state", "head of government"]

# One branch per property, run in the order written: left to plan it, the query service
# starts from every human on Wikidata and times out.
BRANCHES = " UNION ".join(
    f'{{ ?event wdt:{p} ?person . BIND("{p}" AS ?prop) }}' for p in ROLES if p != "subject"
)
PEOPLE = """
SELECT ?event ?prop ?person ?personLabel ?born ?died WHERE {
  hint:Query hint:optimizer "None" .
  VALUES ?event { %(items)s }
  { """ + BRANCHES + """
    UNION { ?event wdt:P31 wd:Q5 . BIND(?event AS ?person) BIND("subject" AS ?prop) } }
  ?person wdt:P31 wd:Q5 .
  OPTIONAL { ?person wdt:P569 ?born }
  OPTIONAL { ?person wdt:P570 ?died }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,sw,mul". }
}
"""

PLACES = """
SELECT ?event ?rank ?place ?placeLabel ?coord ?county ?countyLabel WHERE {
  hint:Query hint:optimizer "None" .
  VALUES ?event { %(items)s }
  { ?event wdt:P276 ?place . BIND(1 AS ?rank) }
  UNION { ?event wdt:P131 ?place . BIND(2 AS ?rank) }
  OPTIONAL { ?place wdt:P625 ?coord }
  OPTIONAL { ?place wdt:P131* ?county . ?county wdt:P31 wd:%(county)s }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,sw,mul". }
}
"""


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[1]


def date_of(value: str | None) -> str | None:
    """Wikidata's xsd:dateTime to a date; skips BCE and unknown ('t…') values."""
    if not value or value.startswith(("-", "t")):
        return None
    return value[:10].replace("-00", "-01")


def point(wkt: str | None) -> tuple[float, float] | tuple[None, None]:
    """'Point(lon lat)' to (lat, lon)."""
    if not wkt or not wkt.startswith("Point("):
        return None, None
    lon, lat = wkt[6:-1].split()
    return float(lat), float(lon)


def article_items(http: Http, urls: list[str]) -> dict[str, str]:
    """English Wikipedia article URL -> its Wikidata item, following redirects."""
    titles = {unquote(u.rsplit("/wiki/", 1)[1]).replace("_", " "): u for u in urls}
    found: dict[str, str] = {}
    names = list(titles)
    for i in range(0, len(names), 50):
        data = http.get_json(WIKI_API, {"action": "query", "format": "json", "prop": "pageprops",
                                        "ppprop": "wikibase_item", "redirects": "1",
                                        "titles": "|".join(names[i:i + 50])})["query"]
        renamed = {r["to"]: r["from"] for r in data.get("normalized", []) + data.get("redirects", [])}
        for page in data.get("pages", {}).values():
            item = page.get("pageprops", {}).get("wikibase_item")
            title = page.get("title", "")
            while title in renamed:
                title = renamed[title]
            if item and title in titles:
                found[titles[title]] = item
    return found


def sparql(http: Http, query: str, items: list[str]) -> list[dict]:
    rows: list[dict] = []
    for i in range(0, len(items), 80):
        values = " ".join(f"wd:{q}" for q in items[i:i + 80])
        rows += http.get_json(SPARQL, {"query": query % {"items": values, "county": COUNTY}},
                              {"Accept": "application/sparql-results+json"})["results"]["bindings"]
    return rows


def main() -> None:
    http = Http()
    with connect() as conn, conn.cursor() as cur:
        events = cur.execute(
            "SELECT id, wikidata_id, source_url FROM event WHERE status = 'approved' ORDER BY date, id"
        ).fetchall()
        articles = sorted({url for _, wd, url in events
                           if not wd and url.startswith("https://en.wikipedia.org/wiki/")
                           and not url.endswith("_in_Kenya")})
        by_article = article_items(http, articles)
        # One item may stand behind several events (an article cited twice).
        item_events: dict[str, list[str]] = {}
        via_article: set[str] = set()
        for eid, wd, url in events:
            item = wd or by_article.get(url)
            if item:
                item_events.setdefault(item, []).append(eid)
                if not wd:
                    via_article.add(eid)
        items = sorted(item_events)

        people_rows = sparql(http, PEOPLE, items)
        place_rows = sparql(http, PLACES, items)
        RAW.mkdir(parents=True, exist_ok=True)
        (RAW / "entities.json").write_text(json.dumps(
            {"articles": by_article, "people": people_rows, "places": place_rows}, indent=1))

        person_ids: dict[str, int] = {}
        links: set[tuple[str, int, str]] = set()
        for r in people_rows:
            pq = qid(r["person"]["value"])
            if pq not in person_ids:
                person_ids[pq] = cur.execute(
                    "INSERT INTO person (name, wikidata_id, born, died) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (wikidata_id) DO UPDATE SET name = EXCLUDED.name, born = EXCLUDED.born, "
                    "died = EXCLUDED.died RETURNING id",
                    (r["personLabel"]["value"], pq, date_of(r.get("born", {}).get("value")),
                     date_of(r.get("died", {}).get("value"))),
                ).fetchone()[0]
            role = ROLES[r["prop"]["value"]]
            for eid in item_events[qid(r["event"]["value"])]:
                links.add((eid, person_ids[pq], "article subject" if role == "subject" and eid in via_article else role))

        linked = [eid for eids in item_events.values() for eid in eids]
        cur.execute("DELETE FROM event_person WHERE event_id = ANY(%s) AND role = ANY(%s)",
                    (linked, OWN_ROLES))
        for link in sorted(links):
            cur.execute("INSERT INTO event_person (event_id, person_id, role) VALUES (%s, %s, %s) "
                        "ON CONFLICT DO NOTHING", link)

        # Best place per item: lowest rank, then one with coordinates, then one with a county.
        best: dict[str, dict] = {}
        for r in place_rows:
            key = (int(r["rank"]["value"]), "coord" not in r, "county" not in r)
            item = qid(r["event"]["value"])
            if item not in best or key < best[item]["key"]:
                best[item] = {"key": key, **r}
        placed = 0
        for item, r in best.items():
            lat, lon = point(r.get("coord", {}).get("value"))
            place_id = cur.execute(
                "INSERT INTO place (name, lat, lon, county, wikidata_id) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT (wikidata_id) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, "
                "lon = EXCLUDED.lon, county = EXCLUDED.county RETURNING id",
                (r["placeLabel"]["value"], lat, lon, r.get("countyLabel", {}).get("value"),
                 qid(r["place"]["value"])),
            ).fetchone()[0]
            placed += cur.execute("UPDATE event SET place_id = %s WHERE id = ANY(%s) AND place_id IS NULL",
                                  (place_id, item_events[item])).rowcount
        cur.execute("DELETE FROM person p WHERE NOT EXISTS (SELECT 1 FROM event_person WHERE person_id = p.id)")
        cur.execute("DELETE FROM place p WHERE NOT EXISTS (SELECT 1 FROM event WHERE place_id = p.id)")
        conn.commit()
    print(f"entities: {len(events)} approved events, {len(linked)} matched to {len(items)} Wikidata items "
          f"({len(by_article)} through their article); {len(person_ids)} people in {len(links)} links; "
          f"{len({qid(r['place']['value']) for r in best.values()})} places, {placed} events placed")


if __name__ == "__main__":
    main()
