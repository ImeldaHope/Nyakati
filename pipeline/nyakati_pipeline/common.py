"""Shared pieces: the event candidate model, the upsert, and a polite HTTP client."""

import re
import time
from datetime import date
from typing import Literal

import httpx
import psycopg
from pydantic import BaseModel, field_validator

USER_AGENT = "NyakatiPipeline/0.1 (https://github.com/ImeldaHope/Nyakati)"

Lens = Literal["politics", "news", "culture", "places"]
Precision = Literal["day", "month", "year"]
Origin = Literal["hand", "wikidata", "wikipedia"]

# Kept in step with ERAS in lib/timeline.ts. Independence is 12 December 1963.
_ERAS = [
    (date(1895, 1, 1), "protectorate"),
    (date(1920, 1, 1), "colony"),
    (date(1963, 12, 12), "independence"),
    (date(1991, 1, 1), "multiparty"),
    (date(2010, 1, 1), "constitution"),
]

CULTURE = re.compile(
    r"\b(?:school|university|college|newspaper|magazine|museum|library|film|album|song|novel|book|"
    r"festival|church|cathedral|mosque|temple|band|radio|television|theatre|art|literary|music)s?\b",
    re.I,
)


# Noise the plan expects: sports fixtures, minor administrative and institutional items.
# Matched against Wikidata type labels and Wikipedia article titles.
EXCLUDE = re.compile(
    r"sport|season|match|tournament|championship|competition|olympic|games|delegation|"
    r"football|\bF\.?C\b|club|team|league|\bcup\b|\brace\b|marathon|athlet|golf|\bopen\b|"
    r"constituency|electoral (?:district|ward)|\bward\b|human settlement|village|"
    r"airport|railway station|dam\b|hospital|hotel|\bbusiness\b|company|enterprise|limited|"
    r"school|academy|stadium|building|road|bridge",
    re.I,
)


def era_for(d: date) -> str:
    # Items dated before 1895 fall in the first era; the pre-sort rejects them anyway.
    return ([name for start, name in _ERAS if d >= start] or [_ERAS[0][1]])[-1]


def guess_lens(*texts: str) -> Lens:
    """A first guess for the reviewer to correct. Model-assisted tagging comes in Phase 6."""
    return "culture" if any(CULTURE.search(t or "") for t in texts) else "politics"


def first_sentences(text: str, n: int = 2) -> str:
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])", " ".join(text.split()))
    return " ".join(sentences[:n]).strip()


class Candidate(BaseModel):
    id: str
    date: date
    date_precision: Precision
    date_label: str | None = None
    title: str
    summary: str = ""
    lens: Lens = "politics"
    source_url: str
    source_name: str
    licence: str
    wikidata_id: str | None = None
    wikidata_types: list[str] = []
    origin: Origin

    @field_validator("title", "source_url", "source_name", "licence")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be blank")
        return v.strip()


UPSERT = """
INSERT INTO event (id, date, date_precision, date_label, title, summary, lens, era,
                   source_url, source_name, licence, wikidata_id, wikidata_types, origin)
VALUES (%(id)s, %(date)s, %(date_precision)s, %(date_label)s, %(title)s, %(summary)s, %(lens)s, %(era)s,
        %(source_url)s, %(source_name)s, %(licence)s, %(wikidata_id)s, %(wikidata_types)s, %(origin)s)
ON CONFLICT (id) DO UPDATE SET
  date = EXCLUDED.date, date_precision = EXCLUDED.date_precision, date_label = EXCLUDED.date_label,
  title = EXCLUDED.title, summary = EXCLUDED.summary, lens = EXCLUDED.lens, era = EXCLUDED.era,
  source_url = EXCLUDED.source_url, source_name = EXCLUDED.source_name, licence = EXCLUDED.licence,
  wikidata_id = EXCLUDED.wikidata_id, wikidata_types = EXCLUDED.wikidata_types, updated_at = now()
-- A rerun refreshes candidates but never touches a row that has been decided or pre-sorted.
WHERE event.status = 'unreviewed' AND NOT event.curated
"""


def upsert(conn: psycopg.Connection, candidates: list[Candidate]) -> int:
    """Insert or refresh candidates. Returns how many rows were written."""
    written = 0
    with conn.cursor() as cur:
        for c in candidates:
            cur.execute(UPSERT, {**c.model_dump(), "era": era_for(c.date)})
            written += cur.rowcount
    conn.commit()
    return written


def prune(conn: psycopg.Connection, origin: str, start: int, end: int, keep: set[str]) -> int:
    """Drop unreviewed candidates from an earlier run that this run no longer produces."""
    deleted = conn.execute(
        "DELETE FROM event WHERE origin = %s AND status = 'unreviewed' AND NOT curated "
        "AND date >= %s AND date < %s "
        "AND NOT (id = ANY(%s))",
        (origin, date(start, 1, 1), date(end + 1, 1, 1), list(keep)),
    ).rowcount
    conn.commit()
    return deleted


class Http:
    """One client for Wikidata and Wikipedia: identifies itself, waits between calls, backs off on 429/5xx."""

    def __init__(self, pause: float = 1.0):
        self.client = httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=90, follow_redirects=True)
        self.pause = pause
        self._last = 0.0

    def get_json(self, url: str, params: dict | None = None, headers: dict | None = None) -> dict:
        for attempt in range(5):
            wait = self._last + self.pause - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            r = self.client.get(url, params=params, headers=headers)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(float(r.headers.get("Retry-After", 5 * (attempt + 1))))
                continue
            r.raise_for_status()
            return r.json()
        r.raise_for_status()
        raise RuntimeError(f"gave up on {url}")
