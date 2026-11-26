"""The current year's News lens, from the GDELT Project's DOC 2.0 API.

Fetches recent English-language reports about Kenya (the API covers roughly the last three
months) and writes public/data/news-<year>.json: headline, link, outlet and date only. No
article text is stored. These are headlines that link to the original reports; they are not
reviewed events, and the room labels them that way. GDELT's terms ask every use to cite the
GDELT Project and link to https://www.gdeltproject.org/, which the room and /sources do.
"""

import json
import re
import time
from datetime import date, datetime
from pathlib import Path

import httpx

from .common import USER_AGENT

API = "https://api.gdeltproject.org/api/v2/doc/doc"
OUT = Path(__file__).resolve().parents[2] / "public" / "data"
QUERY = "(Kenya OR Kenyan OR Nairobi) sourcecountry:kenya sourcelang:english"
# The API matches anywhere in the article; keep reports whose headline is about Kenya.
ABOUT_KENYA = re.compile(
    r"\bkenya|nairobi|mombasa|kisumu|nakuru|eldoret|\bruto\b|gachagua|odinga|\bkindiki|\bkdf\b|\biebc\b|\bknec\b|"
    r"\bcbk\b|\bkra\b|national assembly|senate|county|mps?\b|\bsh\s?[\d.]+",
    re.I,
)


def fetch() -> dict:
    """GDELT allows one request every 5 seconds and answers faster ones with plain text."""
    params = {"query": QUERY, "mode": "artlist", "format": "json", "maxrecords": "250", "sort": "hybridrel",
              "timespan": "3months"}
    for attempt in range(4):
        r = httpx.get(API, params=params, headers={"User-Agent": USER_AGENT}, timeout=60)
        if r.headers.get("content-type", "").startswith("application/json") or r.text.lstrip().startswith("{"):
            return r.json()
        time.sleep(10 * (attempt + 1))
    raise SystemExit("news: GDELT kept refusing (rate limit); try again in a minute")


def main() -> None:
    year = date.today().year
    data = fetch()
    raw = OUT.parents[1] / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    (raw / f"gdelt-{year}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False))
    returned = len(data.get("articles", []))
    seen, items = set(), []
    for a in data.get("articles", []):
        title = " ".join((a.get("title") or "").split())
        key = title.lower()[:80]
        if not title or key in seen or not ABOUT_KENYA.search(title):
            continue
        when = datetime.strptime(a["seendate"][:8], "%Y%m%d").date()
        if when.year != year:
            continue
        seen.add(key)
        items.append({"title": title, "url": a["url"], "outlet": a.get("domain", ""), "date": when.isoformat()})
    items = sorted(items, key=lambda i: i["date"], reverse=True)[:60]
    out = OUT / f"news-{year}.json"
    out.write_text(json.dumps({
        "year": year,
        "source": "The GDELT Project",
        "source_url": "https://www.gdeltproject.org/",
        "fetched": date.today().isoformat(),
        "items": items,
    }, indent=1, ensure_ascii=False) + "\n")
    print(f"news {year}: GDELT returned {returned} articles; {len(items)} headlines kept -> {out.relative_to(OUT.parents[1])}")


if __name__ == "__main__":
    main()
