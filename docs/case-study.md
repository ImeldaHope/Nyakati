# Nyakati: a timeline of Kenya you can walk into

*Draft case study for ihope.dev. Numbers are from the runs of 2026-11-22.*

Nyakati is a timeline of Kenya from 1895 to today. You scroll a river of years, step into one, and it opens as a room of all that year's sourced events, with lens tabs to filter them, credited archive images and a guide that answers only with citations.

## The idea

History as a place you move through, with every claim one click from its source. Curious Kenyans, students and journalists checking a date get the story at a glance: on the first scroll, marks thicken around 1952, 1963, 1982, 1992, 2007 and 2022 before a word is read.

## The pipeline

Everything is gathered, cleaned and checked on a laptop, loaded into Postgres with pgvector, and served as static files. The guide is the only live part.

- **Candidates** come from Wikidata (items tied to Kenya by country, jurisdiction or location, dated by point in time, start, publication or inception), Wikipedia's "<year> in Kenya" categories, and the dated entries in its "<year> in Kenya" articles.
- **Review** is the bottleneck, and the honest part. The 1960s were pre-sorted one item at a time. The other decades are drafted by rules distilled from those decisions (reject dioceses, embassies, companies, holidays, sport and contradicted dates; keep elections, wars, attacks, treaties and laws), then read through, with one-off decisions in a reviewed overrides file. Every event records who approved it: a person, AI, or the Wikidata trust rule. `/sources` publishes the split.
- **Model-assisted steps**: the shared model tags each event's lens, with its error rate measured on a 100-event sample: 33 of 100 were wrong, and rules now correct the systematic mistakes. `bge-m3` embeddings find near-duplicate events, which are merged only after review: three of six proposed pairs were real duplicates.
- **People and places** come from Wikidata, for the 369 events tied to one Wikidata item: founders, participants, authors, and where it happened with its county. Wikidata's "chair" and "head of state" are left out, because it gives today's holder, not the one at the time.
- **Images** come from Wikimedia Commons, only under free licences and only with a stated author. No image shows without its author and licence on screen.

706 approved events from 1895 to 2026, 132 credited images, and four threads (land, elections, the constitution and Jomo Kenyatta).

## The guide, and why it can be trusted with a small model

1. Limit and filter, reusing ihope.dev's input guard and rate limiter.
2. Retrieve the eight passages nearest the question from that year's sources (`bge-m3`, pgvector), widening to neighbouring years if fewer than three.
3. Ask a 1B-parameter model to answer in short sentences, each ending with the id of its passage.
4. **Check in plain code**: a sentence survives only if it cites a passage that was actually sent. This is the step that makes a small model usable. The evals found four ways the check could be fooled (bare ids, refusals written as answers, sentences cut at initials, and "Not covered" written in ordinary case with a citation), and each became a test.
5. Show the sources first, then the sentences that passed. On a CPU, reading the prompt takes most of the time, so the passages are the fallback while the model works.

**Eval** (`make eval`, 40 answerable questions and 10 the sources cannot answer): 27 of 40 answered correctly, 8 of 10 declined, and 64 of 70 answer sentences backed by their cited passage (an automatic stand-in: most of the sentence's words appear in it). Times from these runs are not quoted, because repeated prompts were answered from Ollama's cache. On a laptop CPU an uncached answer took 35–60 s in earlier runs, and on a busy machine one passed the guide's time limit. Every question, answer and mark is published for checking by hand.

## The design

An archive at night: warm paper, ink and one earth red, called murram after the laterite road soil. The river is a band of water across the page, tinted by era, with a current drifting from the past toward the present. Year numerals in Fraunces float in it, and each event rests on its bed as a small mark shaped by its lens. Entering a year, the numeral grows into the room's header in 700 ms; leaving, it lands back on the same numeral. With reduced motion, every move is a 150 ms cross-fade.

The palette was chosen by eye and then checked: murram and acacia failed as text on the dark ground (3.2 and 3.9 to 1), so small text uses lighter variants of the same hues.

## What I would do next

- A person reviews the events AI approved, starting with the year-list entries.
- Archive photographs instead of modern ones, from Commons categories and Kenyan archives.
- A dedicated model host, so the guide stays within the plan's 20 seconds when the machine is busy.
- People and places for the year-list events, which cite a year's article rather than one item.
