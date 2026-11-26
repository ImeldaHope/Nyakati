"""Copy what the guide reads to the hosted database: approved events and their passages.

The site itself is static; only the guide queries a database, and only the event and
passage tables (with bge-m3 embeddings, so the host needs pgvector but no model). The
target is migrated, then its events and passages are replaced in one transaction, so the
guide never sees half a copy. Nothing else is copied: no candidates, rejected rows, review
notes or curation state leave this machine.

    make guide-db GUIDE_DATABASE_URL='postgresql://…'

It runs on the host's network, so the target can be a hosted URL or an SSH tunnel on a
local port (see README, Deploy).
"""

import os

import psycopg

from .db import connect
from .migrate import apply

EVENTS = """
SELECT id, date, date_precision, date_label, title, summary, lens, era, source_url,
       source_name, licence, wikidata_id, origin, status, reviewed_by
  FROM event WHERE status = 'approved'
"""
EVENT_COLUMNS = "id, date, date_precision, date_label, title, summary, lens, era, source_url, " \
                "source_name, licence, wikidata_id, origin, status, reviewed_by"  # reviewed is generated
PASSAGES = """
SELECT p.event_id, p.text, p.source_url, p.licence, p.embedding
  FROM passage p JOIN event e ON e.id = p.event_id WHERE e.status = 'approved'
"""


def identity(conn: psycopg.Connection) -> tuple:
    """Which Postgres cluster this is: its unique system identifier, where the role may read
    it, else its address (hosted roles are often not allowed pg_control_system)."""
    try:
        with conn.transaction():
            return ("system", conn.execute("SELECT system_identifier FROM pg_control_system()").fetchone()[0])
    except psycopg.Error:
        return ("address", *conn.execute(
            "SELECT current_database(), inet_server_addr()::text, inet_server_port()").fetchone())


def copy(src: psycopg.Connection, dst: psycopg.Connection, query: str, table: str, columns: str) -> int:
    rows = 0
    with src.cursor().copy(f"COPY ({query}) TO STDOUT") as out, \
         dst.cursor().copy(f"COPY {table} ({columns}) FROM STDIN") as into:
        for chunk in out:
            into.write(chunk)
            rows += bytes(chunk).count(b"\n")
    return rows


def main() -> None:
    target = os.environ.get("GUIDE_DATABASE_URL", "").strip()
    if not target:
        raise SystemExit("Set GUIDE_DATABASE_URL to the hosted database (a direct, not pooled, connection).")
    with connect() as src, psycopg.connect(target) as dst:
        if identity(src) == identity(dst):
            raise SystemExit("GUIDE_DATABASE_URL points at the local database; refusing to replace it.")
        apply(dst)
        with dst.transaction():
            # The hosted copy holds only what the guide reads, so clearing it loses nothing.
            dst.execute("TRUNCATE passage, event CASCADE")
            events = copy(src, dst, EVENTS, "event", EVENT_COLUMNS)
            passages = copy(src, dst, PASSAGES, "passage", "event_id, text, source_url, licence, embedding")
        dst.execute("ANALYZE event; ANALYZE passage")
        dst.commit()
    print(f"guide-db: {events} approved events and {passages} passages copied")


if __name__ == "__main__":
    main()
