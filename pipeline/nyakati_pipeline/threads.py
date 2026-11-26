"""Fill the thread and thread_event tables from data/threads.json.

Each thread matches approved events by a pattern over their title and summary, within an
optional year limit; its 'exclude' and 'include' lists correct the rule by event id. Events
are ordered by date. Rerunnable: each thread's events are replaced.
"""

import json
import re
from pathlib import Path

from .db import connect

THREADS = Path(__file__).resolve().parents[2] / "data" / "threads.json"


def main() -> None:
    threads = json.loads(THREADS.read_text())["threads"]
    with connect() as conn, conn.cursor() as cur:
        events = cur.execute(
            "SELECT id, title, summary, date FROM event WHERE status = 'approved' ORDER BY date, id"
        ).fetchall()
        for t in threads:
            pattern = re.compile(t["match"], re.I)
            until = t.get("until")
            members = [
                eid for eid, title, summary, d in events
                if (eid in t["include"])
                or (pattern.search(f"{title} {summary}") and eid not in t["exclude"] and (not until or d.year <= until))
            ]
            thread_id = cur.execute(
                "INSERT INTO thread (slug, title, description) VALUES (%s, %s, %s) "
                "ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description RETURNING id",
                (t["slug"], t["title"], t["description"]),
            ).fetchone()[0]
            cur.execute("DELETE FROM thread_event WHERE thread_id = %s", (thread_id,))
            for position, eid in enumerate(members):
                cur.execute(
                    "INSERT INTO thread_event (thread_id, event_id, position) VALUES (%s, %s, %s)",
                    (thread_id, eid, position),
                )
            print(f"thread {t['slug']}: {len(members)} events")
        cur.execute("DELETE FROM thread WHERE slug <> ALL(%s)", ([t["slug"] for t in threads],))
        conn.commit()


if __name__ == "__main__":
    main()
