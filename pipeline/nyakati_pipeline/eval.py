"""Run the guide's eval (data/eval/questions.json) against the running site and publish the score.

Measures, as the plan lists them:
  correct         answerable questions whose answer contains every expected phrase
  refusals        unanswerable questions the guide declined
  citation proxy  answered sentences whose content words mostly appear in the passages they cite
                  (an automatic stand-in for "does the cited passage say it?", to be checked by hand)

Writes public/data/eval.json, which /sources shows. Needs the dev server (make up) and the
ollama service; GUIDE_EVAL_KEY lets the runner past the guide's rate limit.
"""

import json
import os
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "data" / "eval" / "questions.json"
OUT = ROOT / "public" / "data" / "eval.json"

STOP = set(
    "the and that this with from were was which their there have has had for are not but into over under about "
    "after before when where while been being they them then than also its it's his her him she who whom what "
    "will would could should said says each other such only more most some many very year years".split()
)


def ask(client: httpx.Client, url: str, key: str, year: int, question: str) -> dict:
    out = {"passages": [], "sentences": [], "status": None}
    with client.stream("POST", url, json={"year": year, "question": question},
                       headers={"x-guide-eval-key": key}, timeout=300) as r:
        if r.status_code != 200:
            return {**out, "status": f"http {r.status_code}"}
        for line in r.iter_lines():
            if not line.strip():
                continue
            event = json.loads(line)
            if event["type"] == "passages":
                out["passages"] = event["passages"]
            elif event["type"] == "sentence":
                out["sentences"].append(event)
            elif event["type"] in ("end", "blocked"):
                out["status"] = event.get("status", event["type"])
                out["dropped"] = event.get("dropped", 0)
    return out


def contains(answer: str, phrase: str) -> bool:
    return any(alt.lower() in answer.lower() for alt in phrase.split("|"))


def supported(sentence: dict, passages: list[dict]) -> bool:
    cited = " ".join(p["text"] for p in passages if p["n"] in sentence["cites"]).lower()
    words = [w for w in re.findall(r"[a-z0-9']+", sentence["text"].lower()) if len(w) >= 4 and w not in STOP]
    return not words or sum(w in cited for w in words) / len(words) >= 0.6


def main() -> None:
    url = os.environ.get("GUIDE_URL", "http://web:3000/api/guide")
    key = os.environ.get("GUIDE_EVAL_KEY", "")
    questions = json.loads(QUESTIONS.read_text())["questions"]
    results, seconds = [], []
    with httpx.Client() as client:
        for q in questions:
            t0 = time.monotonic()
            r = ask(client, url, key, q["year"], q["question"])
            seconds.append(round(time.monotonic() - t0, 1))
            answer = " ".join(s["text"] for s in r["sentences"])
            if q.get("refuse"):
                ok = r["status"] == "not-covered"
            else:
                ok = r["status"] == "answered" and all(contains(answer, p) for p in q["expect"])
            backed = [supported(s, r["passages"]) for s in r["sentences"]]
            results.append({
                "id": q["id"], "year": q["year"], "question": q["question"], "status": r["status"],
                "answer": answer, "correct": ok, "sentences": len(backed), "supported": sum(backed),
                "dropped": r.get("dropped", 0), "seconds": seconds[-1],
            })
            print(f"{q['id']} {'ok ' if ok else 'NO '} {seconds[-1]:>5}s {r['status']}: {answer[:90]}", flush=True)

    # A run where the site itself failed measures nothing; never let it replace a real score.
    failed = [r["id"] for r in results if not r["status"] or str(r["status"]).startswith("http")]
    if failed:
        raise SystemExit(f"eval: {len(failed)} requests failed ({', '.join(failed[:5])}…); eval.json not written")

    answerable = [r for r in results if not r["id"].startswith("r")]
    refusals = [r for r in results if r["id"].startswith("r")]
    sentences = sum(r["sentences"] for r in results)
    summary = {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "model": os.environ.get("OLLAMA_MODEL", "llama3.2:1b"),
        "embedding_model": "bge-m3",
        "answerable": {"total": len(answerable), "correct": sum(r["correct"] for r in answerable)},
        "refusals": {"total": len(refusals), "declined": sum(r["correct"] for r in refusals)},
        "citation_proxy": {"sentences": sentences, "supported": sum(r["supported"] for r in results)},
        "sentences_dropped_by_check": sum(r["dropped"] for r in results),
        "median_seconds": round(statistics.median(seconds), 1) if seconds else None,
        "marking": "automatic: expected phrases for answers, word overlap for citations; check by hand",
        "results": results,
    }
    OUT.write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print(f"eval: {summary['answerable']['correct']}/{summary['answerable']['total']} correct, "
          f"{summary['refusals']['declined']}/{summary['refusals']['total']} declined, "
          f"{summary['citation_proxy']['supported']}/{sentences} sentences supported (proxy), "
          f"median {summary['median_seconds']}s -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
