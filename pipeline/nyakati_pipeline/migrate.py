"""Apply db/migrations/*.sql in name order, each once, each in its own transaction."""

from pathlib import Path

import psycopg

from .db import connect

MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "migrations"


def apply(conn: psycopg.Connection) -> None:
    """Bring the database behind conn up to date; used for the local and the hosted one."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migration "
        "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    applied = {row[0] for row in conn.execute("SELECT name FROM schema_migration")}
    conn.commit()
    pending = [p for p in sorted(MIGRATIONS.glob("*.sql")) if p.name not in applied]
    for path in pending:
        with conn.transaction():
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migration (name) VALUES (%s)", (path.name,))
        print(f"applied {path.name}")
    if not pending:
        print("schema is up to date")


def main() -> None:
    with connect() as conn:
        apply(conn)


if __name__ == "__main__":
    main()
