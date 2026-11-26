"""Launch check: every shown event's source link opens, and opens the right page.

Fetches each distinct source URL of the approved events. A link fails if it does not answer
200, or if Wikipedia redirects it to a different article than the one named on the card
(a redirect within the same title, such as a normalised spelling, is fine). Writes
data/raw/linkcheck.json and prints the failures.
"""

import json
import time
from pathlib import Path
from urllib.parse import unquote

import httpx

from .common import USER_AGENT
from .db import connect

OUT = Path(__file__).resolve().parents[2] / "data" / "raw" / "linkcheck.json"


def title_of(url: str) -> str:
    return unquote(url.split("/wiki/", 1)[-1].split("#")[0]).replace("_", " ").lower()


def main() -> None:
    with connect() as conn:
        rows = conn.execute(
            "SELECT source_url, min(source_name), count(*) FROM event WHERE status = 'approved' GROUP BY source_url"
        ).fetchall()
    failures, results = [], []
    with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=30) as client:
        for url, name, n in rows:
            try:
                r = client.get(url)
                status, final = r.status_code, str(r.url)
            except httpx.HTTPError as e:
                status, final = 0, str(e)
            ok = status == 200
            if ok and "/wiki/" in url and "/wiki/" in final:
                # Wikipedia answers redirects itself; the canonical link names the article actually shown.
                canonical = r.text.split('<link rel="canonical" href="', 1)[-1].split('"', 1)[0] if 'rel="canonical"' in r.text else final
                ok = title_of(canonical) == title_of(url) or "wikidata.org" in url
                final = canonical
            results.append({"url": url, "events": n, "status": status, "final": final, "ok": ok})
            if not ok:
                failures.append(results[-1])
            time.sleep(0.2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"checked": len(results), "failures": failures}, indent=1, ensure_ascii=False))
    for f in failures:
        print(f"  {f['status']} {f['url']} -> {f['final']} ({f['events']} events)")
    print(f"checklinks: {len(results)} distinct source links, {len(failures)} failing")


if __name__ == "__main__":
    main()
