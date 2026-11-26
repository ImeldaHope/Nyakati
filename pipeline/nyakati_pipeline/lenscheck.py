"""Measure the model's lens tagging on a 100-event sample (the plan's Phase 6 check).

  --sample   draw 100 model-tagged approved events (fixed seed) into data/eval/lens-sample.json,
             each with an empty "check" for the reviewer to fill with the right lens
  (default)  read the checked sample and write public/data/tagging.json, which /sources shows

The file records who checked it, so the published rate says whether a person did.
"""

import argparse
import json
import random
from datetime import date
from pathlib import Path

from .db import connect

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "data" / "eval" / "lens-sample.json"
OUT = ROOT / "public" / "data" / "tagging.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true")
    args = parser.parse_args()

    if args.sample:
        if SAMPLE.exists():
            raise SystemExit(f"{SAMPLE.name} exists; delete it to draw a new sample")
        with connect() as conn:
            rows = conn.execute(
                "SELECT id, title, summary, lens_model FROM event "
                "WHERE status = 'approved' AND lens_source = 'model' ORDER BY id"
            ).fetchall()
        picked = random.Random(1963).sample(rows, min(100, len(rows)))
        SAMPLE.write_text(json.dumps({
            "checked_by": "",
            "model": "",
            "items": [{"id": i, "title": t, "summary": s, "model": m, "check": None} for i, t, s, m in picked],
        }, indent=1, ensure_ascii=False) + "\n")
        print(f"lenscheck: drew {len(picked)} of {len(rows)} model-tagged events -> {SAMPLE.relative_to(ROOT)}")
        return

    doc = json.loads(SAMPLE.read_text())
    items = [i for i in doc["items"] if i["check"]]
    if len(items) < len(doc["items"]):
        raise SystemExit(f"lenscheck: {len(doc['items']) - len(items)} items not checked yet")
    wrong = [i for i in items if i["check"] != i["model"]]
    OUT.write_text(json.dumps({
        "date": date.today().isoformat(),
        "model": doc["model"],
        "sample": len(items),
        "wrong": len(wrong),
        "checked_by": doc["checked_by"],
    }, indent=1) + "\n")
    print(f"lenscheck: {len(wrong)} of {len(items)} wrong ({len(wrong) / len(items):.0%}) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
