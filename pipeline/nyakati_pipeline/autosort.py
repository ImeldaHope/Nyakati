"""Draft a pre-sort file for a span of years from rules, for AI to read through before applying.

The 1960s were pre-sorted one item at a time (data/presort/1960-1969.json). For the other
decades the same judgements are written down as rules:

  reject  church offices and units, embassies and posts, companies, schools, places with
          no event, holidays, sport, lists, countries, items too thin to write a card from,
          dates before 1895, and founding years contradicted by the item's own source
  keep    elections, wars, attacks, disasters, treaties, laws, protests and other events;
          the founding of parties, national institutions, universities and parks; publications
  hold    anything the rules cannot place, for a person

Kept organisations are retitled as events ("X is founded"). Kept items are written as
"keep" when they come from Wikidata (approved under the trust rule) and "approve" otherwise
(approved by AI), so `reviewed_by` stays honest. The draft is written to
data/presort/<from>-<to>.json, and only if that file does not exist: a hand-made file wins.
"""

import argparse
import json
import re
from datetime import date

from .db import connect
from .presort import PRESORT

# Order matters: the first rule that matches decides.
REJECT = [
    (r"diocese|archdiocese|parish|bishop|archbishop|vicariate|prefecture apostolic|episcopal|church office", "A church office or unit."),
    (r"embass|ambassador|high commission|consulate|diplomatic mission|list of", "A diplomatic post or a list."),
    (r"\b(position|office|title|post)\b|^(president|vice-president|deputy president|prime minister|minister|governor|mayor|speaker|chief justice|attorney general|commander|chief of|first lady|queen|king) of", "An office, not an event."),
    (r"\b(company|business|enterprise|bank|airline|limited|ltd|plc|holding|brand|manufacturer|hotel|restaurant|supermarket|retail)\b", "A company."),
    (r"\b(school|academy|polytechnic|college|institute of technology|training institute|seminary)\b", "A minor school or college."),
    (r"\b(sport|football|rugby|cricket|basketball|athletics|marathon|rally|tournament|championship|league|club|team|olympic|games|cup|boxing|golf|beauty pageant|miss )\b", "Sport or a pageant."),
    (r"\b(county|constituency|ward|district|location|sub-county|village|town|city|human settlement|lake|river|mountain|hill|island|forest|valley|road|highway|bridge|railway station|airport|stadium|building|tower|dam|hospital|museum|library|market)\b", "A place, with no event in the source."),
    (r"\b(country|sovereign state|colony|protectorate|state|republic)\b$", "A state, not an event."),
]
KEEP_EVENT = re.compile(
    r"election|by-election|referendum|war\b|conflict|battle|massacre|attack|bombing|shooting|siege|hostage|riot|protest|"
    r"strike|uprising|rebellion|insurgency|mutiny|coup|assassination|murder|disaster|flood|drought|famine|earthquake|"
    r"landslide|fire|crash|accident|shipwreck|epidemic|outbreak|pandemic|treaty|agreement|accord|convention|act\b|law\b|"
    r"constitution|amendment|independence|summit|conference|declaration|commission|inquiry|trial|expedition|event|"
    r"festival|scandal|crisis|operation\b|campaign|movement|state of emergency|curfew",
    re.I,
)
KEEP_FOUNDING = [
    (re.compile(r"political party|party\b", re.I), "{} is founded"),
    (re.compile(r"trade union|labor union|labour union|union\b", re.I), "{} is founded"),
    (re.compile(r"central bank|armed forces|army|navy|air force|police|ministry|government agency|commission|authority|"
                r"parliament|court|national assembly|senate|state corporation|public body", re.I), "{} is established"),
    (re.compile(r"national park|national reserve|marine park|game reserve|protected area|wildlife", re.I), "{} is established"),
    (re.compile(r"\buniversity\b", re.I), "{} is founded"),
    (re.compile(r"newspaper|magazine|periodical|radio station|television station|broadcaster", re.I), "{} is founded"),
]
PUBLICATION = re.compile(r"\b(novel|book|film|feature film|documentary|album|song|single|play|poem|literary work)\b", re.I)
FOUNDED_IN = re.compile(
    r"\b(?:founded|established|formed|created|chartered|opened|launched|registered|inaugurated)\b[^.]{0,40}?\b(1[89]\d\d|20\d\d)\b",
    re.I,
)


def decide(row: dict) -> dict:
    eid, title, summary = row["id"], row["title"], row["summary"] or ""
    types = ", ".join(row["wikidata_types"]).lower()
    year = row["date"].year

    def matches(pattern: str | re.Pattern) -> bool:
        p = pattern if isinstance(pattern, re.Pattern) else re.compile(pattern, re.I)
        return bool(p.search(title) or p.search(types))

    if year < 1895:
        return {"id": eid, "action": "reject", "reason": "Before 1895, where the river starts."}
    m = FOUNDED_IN.search(summary)
    if m and abs(int(m.group(1)) - year) > 1:
        return {"id": eid, "action": "reject",
                "reason": f"Contradicted by its source, which gives {m.group(1)} rather than {year}."}
    # A dated entry from a "<year> in Kenya" list is an event by construction, and its date comes
    # from the list itself; it is kept unless it is plainly not about Kenya's history.
    if eid.startswith("yl-"):
        return {"id": eid, "action": "approve"}
    if re.search(r"^\d{4} in kenya|in kenyan (football|sport)", title, re.I) or matches(r"events in a specific year"):
        return {"id": eid, "action": "reject", "reason": "A list of a year's events, not an event."}
    if matches(r"gubernatorial|local elections?|county .*election"):
        return {"id": eid, "action": "reject", "reason": "A county-level election."}
    if re.search(r"presidential election|parliamentary election", title, re.I) and re.match(r"general elections were held", summary, re.I):
        return {"id": eid, "action": "reject", "reason": "Covered by the general election card."}
    if matches(r"conference edition|recurring event edition|planned event|cultural artifact|\bdrum\b|monument|statue|power station"):
        return {"id": eid, "action": "reject", "reason": "A recurring conference, an object or a structure; no event in the source."}
    if re.match(r"this is a list|the following (is a )?list", summary, re.I):
        return {"id": eid, "action": "reject", "reason": "The source text is a list, not this event."}
    if matches(r"political party") and re.fullmatch(r"(the )?.{1,90}? (is|was) a (\w+ )?political party in kenya\.?", summary.strip(), re.I):
        return {"id": eid, "action": "reject", "reason": "Too little in the source to write a card."}
    if matches(r"universit") and year > 1990 and "public" not in summary.lower() and "public" not in types:
        return {"id": eid, "action": "reject", "reason": "A minor private university."}
    if re.search(r"\bday$", title, re.I) or matches(r"public holiday|observance|annual event|national holiday"):
        return {"id": eid, "action": "reject", "reason": "A holiday, not an event."}
    is_event = matches(KEEP_EVENT)
    if not is_event:
        for pattern, reason in REJECT:
            if matches(pattern):
                return {"id": eid, "action": "reject", "reason": reason}
    if len(summary) < 45:
        return {"id": eid, "action": "reject", "reason": "Too little in the source to write a card."}

    # A Wikipedia category date is often a founding year, not an event; only trust it when
    # the article itself names the year.
    if row["origin"] == "wikipedia" and row["date_precision"] == "year" and str(year) not in summary:
        return {"id": eid, "action": "hold",
                "note": "Dated only by its Wikipedia year category, and the article's opening does not name the year."}

    kept = "keep" if row["origin"] == "wikidata" else "approve"
    if is_event:
        return {"id": eid, "action": kept}
    for pattern, form in KEEP_FOUNDING:
        if pattern.search(types or title):
            return {"id": eid, "action": kept, "title": form.format(title)}
    if PUBLICATION.search(types):
        kind = PUBLICATION.search(types).group(1).lower()
        verb = "released" if kind in ("film", "feature film", "documentary", "album", "song", "single") else "published"
        return {"id": eid, "action": kept, "lens": "culture", "title": f"{title} ({kind}) is {verb}"}
    return {"id": eid, "action": "hold", "note": "The rules could not place this one."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    args = parser.parse_args()
    out = PRESORT / f"{args.start}-{args.end}.json"
    if out.exists():
        print(f"autosort: {out.name} exists; leaving it alone")
        return

    with connect() as conn:
        cur = conn.execute(
            "SELECT id, origin, title, summary, date, date_precision, wikidata_types FROM event "
            "WHERE status = 'unreviewed' AND NOT curated AND origin <> 'hand' AND date >= %s AND date < %s ORDER BY date",
            (date(args.start, 1, 1), date(args.end + 1, 1, 1)),
        )
        names = [c.name for c in cur.description]
        rows = [dict(zip(names, r)) for r in cur.fetchall()]

    overrides = {d["id"]: d for d in json.loads((PRESORT / "overrides.json").read_text())["decisions"]} \
        if (PRESORT / "overrides.json").exists() else {}
    decisions = []
    for r in rows:
        d = overrides.get(r["id"]) or decide(r)
        # A Wikidata item kept by the rules is a trust-rule "keep"; anything else kept is AI's
        # "approve", including Wikidata items AI promoted by hand in the overrides file.
        if d["action"] == "keep" or (d["action"] == "approve" and r["id"] not in overrides):
            d = {**d, "action": "keep" if r["origin"] == "wikidata" else "approve"}
        decisions.append(d)
    counts = {a: sum(d["action"] == a for d in decisions) for a in ("keep", "approve", "hold", "reject")}
    doc = {
        "_note": f"Drafted by autosort.py from rules on {date.today()}, then read through by AI before applying. "
                 "keep = a Wikidata event approved under the trust rule; approve = approved by AI; "
                 "hold = left for a person; reject = with a reason.",
        "decisions": decisions,
    }
    PRESORT.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(f"autosort {args.start}–{args.end}: " + ", ".join(f"{v} {k}" for k, v in counts.items()) + f" -> {out.name}")


if __name__ == "__main__":
    main()
