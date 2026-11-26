"""Find a Wikimedia Commons image for each approved event, with its author and licence.

Where an image comes from, in order:
  1. the event's own Wikidata item, if it has an image (P18)
  2. the lead image of the Wikipedia article the event cites

Only files hosted on Commons under a free licence (CC0, CC BY, CC BY-SA or public
domain) and with a stated author are kept: no row without author and licence. Generic
locator maps are skipped, and so are files listed in data/presort/images-<from>-<to>.json
with a reason; that file can also replace a caption. Each event's images are replaced on every run, so a rerun reflects
Commons as it is now.
"""

import argparse
import html
import json
import re
from datetime import date
from urllib.parse import quote, unquote

from .common import Http
from .db import connect
from .presort import PRESORT

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
THUMB_WIDTH = 800

FREE_LICENCE = re.compile(r"^(CC0|CC BY(-SA)? \d(\.\d)?|Public domain|PD\b)", re.I)
# Maps that only show where a country is say nothing about the event.
FILLER = re.compile(r"locator|location", re.I)


def plain(value: str) -> str:
    """Commons metadata is HTML; keep the text."""
    text = re.sub(r"<[^>]+>", " ", value or "")
    return " ".join(html.unescape(text).split())


def author_from(meta: dict) -> str:
    text = plain(meta.get("Artist", {}).get("value", ""))
    text = re.sub(r"\(\s*https?://[^)]*\)?", "", text).strip(" ,")
    text = re.sub(r"^(.+?)\s+\1$", r"\1", text)  # "Unknown author Unknown author"
    return text[:160]


def taken_year(meta: dict) -> int | None:
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", plain(meta.get("DateTimeOriginal", {}).get("value", "")))
    return int(m.group(1)) if m else None


def caption_from(meta: dict, title: str) -> str:
    text = plain(meta.get("ImageDescription", {}).get("value", "")) or plain(meta.get("ObjectName", {}).get("value", ""))
    if not text:
        text = re.sub(r"\.\w+$", "", title.removeprefix("File:")).replace("_", " ")
    first = re.split(r"(?<=[.!?])\s", text)[0]
    return first if len(first) <= 180 else first[:177].rstrip() + "…"


def wikidata_images(http: Http, qids: list[str]) -> dict[str, str]:
    out = {}
    for i in range(0, len(qids), 50):
        data = http.get_json(WIKIDATA_API, {
            "action": "wbgetentities", "format": "json", "ids": "|".join(qids[i : i + 50]), "props": "claims",
        })
        for qid, entity in data.get("entities", {}).items():
            claims = entity.get("claims", {}).get("P18", [])
            value = claims[0]["mainsnak"].get("datavalue", {}).get("value") if claims else None
            if value:
                out[qid] = "File:" + value
    return out


def lead_images(http: Http, titles: list[str]) -> dict[str, str]:
    out = {}
    for i in range(0, len(titles), 50):
        data = http.get_json(WIKIPEDIA_API, {
            "action": "query", "format": "json", "redirects": "1", "titles": "|".join(titles[i : i + 50]),
            "prop": "pageimages", "piprop": "name",
        })
        q = data["query"]
        alias = {r["from"]: r["to"] for part in ("normalized", "redirects") for r in q.get(part, [])}
        by_title = {p["title"]: p.get("pageimage") for p in q["pages"].values()}
        for t in titles[i : i + 50]:
            name = by_title.get(alias.get(alias.get(t, t), alias.get(t, t)))
            if name:
                out[t] = "File:" + name
    return out


def commons_info(http: Http, files: list[str]) -> dict[str, dict]:
    out = {}
    for i in range(0, len(files), 40):
        data = http.get_json(COMMONS_API, {
            "action": "query", "format": "json", "titles": "|".join(files[i : i + 40]),
            "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": str(THUMB_WIDTH),
            "iiextmetadatalanguage": "en",
        })
        q = data["query"]
        alias = {r["to"]: r["from"] for r in q.get("normalized", [])}
        for page in q["pages"].values():
            info = (page.get("imageinfo") or [None])[0]
            # Files that exist only on English Wikipedia (often non-free) are missing here.
            if "missing" in page or not info:
                continue
            out[alias.get(page["title"], page["title"])] = info
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()
    http = Http(pause=0.5)

    with connect() as conn:
        events = conn.execute(
            "SELECT id, wikidata_id, source_url FROM event WHERE status = 'approved' AND date >= %s AND date < %s",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        ).fetchall()

        by_item = wikidata_images(http, sorted({q for _, q, _ in events if q}))
        # A "<year> in Kenya" list's lead image (usually the flag) says nothing about its events.
        article = {
            eid: unquote(url.rsplit("/", 1)[1]).replace("_", " ")
            for eid, _, url in events
            if url.startswith("https://en.wikipedia.org/wiki/") and not eid.startswith("yl-")
        }
        by_article = lead_images(http, sorted(set(article.values())))

        rejects_file = PRESORT / f"images-{args.start}-{args.end}.json"
        curation = json.loads(rejects_file.read_text()) if rejects_file.exists() else {}
        rejects = {r["file"] for r in curation.get("reject", [])}
        captions = {c["file"]: c["caption"] for c in curation.get("caption", [])}
        chosen = {}
        for eid, qid, _ in events:
            file = by_item.get(qid or "") or by_article.get(article.get(eid, ""))
            if file and file not in rejects and not FILLER.search(file):
                chosen[eid] = file
        info = commons_info(http, sorted(set(chosen.values())))

        kept, skipped = 0, {"not on Commons": 0, "licence not free": 0, "no author": 0}
        with conn.cursor() as cur:
            cur.execute("DELETE FROM image WHERE event_id = ANY(%s)", ([e[0] for e in events],))
            for eid, file in chosen.items():
                ii = info.get(file)
                if not ii:
                    skipped["not on Commons"] += 1
                    continue
                meta = ii.get("extmetadata", {})
                licence = plain(meta.get("LicenseShortName", {}).get("value", ""))
                author = author_from(meta)
                if not FREE_LICENCE.match(licence):
                    skipped["licence not free"] += 1
                    continue
                if not author:
                    skipped["no author"] += 1
                    continue
                page_url = ii.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{quote(file.replace(' ', '_'))}"
                # A date only means something for photographs, not for drawings of flags and logos.
                photo = re.search(r"\.(jpe?g|tiff?)$", file, re.I)
                taken = str(taken_year(meta)) if photo and taken_year(meta) else None
                cur.execute(
                    """INSERT INTO image (event_id, commons_title, file_url, thumb_url, page_url, width, height,
                                          author, licence, licence_url, caption, taken)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        # Commons appends tracking parameters to thumbnail links; the image needs none.
                        eid, file, ii["url"], (ii.get("thumburl") or ii["url"]).split("?")[0], page_url,
                        ii.get("thumbwidth") or ii.get("width"), ii.get("thumbheight") or ii.get("height"),
                        author, licence,
                        # Public-domain files often have no licence URL; the Commons page states the status.
                        meta.get("LicenseUrl", {}).get("value") or page_url,
                        captions.get(file) or caption_from(meta, file), taken,
                    ),
                )
                kept += 1
        conn.commit()

    print(f"images {args.start}–{args.end}: {len(events)} approved events, {len(chosen)} with a candidate file, "
          f"{kept} kept; skipped: " + ", ".join(f"{v} {k}" for k, v in skipped.items()))


if __name__ == "__main__":
    main()
