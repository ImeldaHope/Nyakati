"""Source passages for the guide: paragraphs of the articles approved events cite, embedded with bge-m3.

For each year, every Wikipedia article cited by that year's approved events is split into
paragraphs. Short articles are kept whole; long ones keep their opening and the paragraphs
that mention the year, so a biography does not flood the year with other decades. Each
paragraph is tied to the earliest event of that year that cites the article. Passages for
the span are replaced on every run.
"""

import argparse
import os
import re
from collections import defaultdict
from datetime import date
from urllib.parse import unquote

from .common import Http
from .db import connect

API = "https://en.wikipedia.org/w/api.php"
EMBED_MODEL = "bge-m3"
SKIP_SECTIONS = re.compile(r"^(references|notes|see also|external links|further reading|bibliography|sources|citations)$", re.I)
WHOLE_ARTICLE_UP_TO = 12  # paragraphs
MAX_PER_ARTICLE_YEAR = 12
MAX_CHARS = 900


def paragraphs(extract: str) -> list[str]:
    """Body paragraphs of a plain-text extract, without headings or back matter."""
    out, skipping = [], False
    for line in extract.split("\n"):
        line = line.strip()
        heading = re.fullmatch(r"=+\s*(.*?)\s*=+", line)
        if heading:
            skipping = bool(SKIP_SECTIONS.match(heading.group(1)))
            continue
        if skipping or len(line) < 80:
            continue
        out.extend(chunk(line))
    return out


def chunk(paragraph: str) -> list[str]:
    """Split a long paragraph at sentence ends into pieces of at most MAX_CHARS."""
    if len(paragraph) <= MAX_CHARS:
        return [paragraph]
    pieces, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", paragraph):
        if current and len(current) + len(sentence) + 1 > MAX_CHARS:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    return pieces + ([current] if current else [])


def select(paras: list[str], year: int) -> list[str]:
    if len(paras) <= WHOLE_ARTICLE_UP_TO:
        return paras
    lead = paras[:2]
    dated = [p for p in paras[2:] if str(year) in p]
    return (lead + dated)[:MAX_PER_ARTICLE_YEAR]


def embed(http: Http, url: str, texts: list[str]) -> list[list[float]]:
    vectors = []
    for i in range(0, len(texts), 16):
        r = http.client.post(f"{url}/api/embed", json={"model": EMBED_MODEL, "input": texts[i : i + 16]}, timeout=300)
        r.raise_for_status()
        vectors += r.json()["embeddings"]
    return vectors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()
    http = Http(pause=0.5)
    ollama = os.environ.get("OLLAMA_URL", "http://ollama:11434")

    with connect() as conn:
        events = conn.execute(
            "SELECT id, date, source_url, licence FROM event WHERE status = 'approved' AND date >= %s AND date < %s "
            "AND source_url LIKE 'https://en.wikipedia.org/wiki/%%' ORDER BY date, id",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        ).fetchall()

        # (year, article) -> the earliest event that year citing it.
        owner: dict[tuple[int, str], tuple[str, str, str]] = {}
        for eid, d, url, licence in events:
            owner.setdefault((d.year, url), (eid, url, licence))

        texts: dict[str, str] = {}
        for url in sorted({url for _, url in owner}):
            title = unquote(url.rsplit("/", 1)[1]).replace("_", " ")
            data = http.get_json(API, {
                "action": "query", "format": "json", "redirects": "1", "titles": title,
                "prop": "extracts", "explaintext": "1",
            })
            page = next(iter(data["query"]["pages"].values()))
            texts[url] = page.get("extract", "")

        rows = []
        per_year = defaultdict(int)
        for (year, url), (eid, _, licence) in sorted(owner.items()):
            for text in select(paragraphs(texts.get(url, "")), year):
                rows.append((eid, text, url, licence))
                per_year[year] += 1

        vectors = embed(http, ollama, [r[1] for r in rows])
        with conn.cursor() as cur:
            cur.execute("DELETE FROM passage WHERE event_id = ANY(%s)", ([e[0] for e in events],))
            for (eid, text, url, licence), vector in zip(rows, vectors):
                cur.execute(
                    "INSERT INTO passage (event_id, text, source_url, licence, embedding) VALUES (%s, %s, %s, %s, %s)",
                    (eid, text, url, licence, "[" + ",".join(f"{x:.6f}" for x in vector) + "]"),
                )
        conn.commit()

    print(f"passages {args.start}–{args.end}: {len(rows)} from {len(texts)} articles; "
          + ", ".join(f"{y}: {n}" for y, n in sorted(per_year.items())))


if __name__ == "__main__":
    main()
