# Nyakati

A timeline of Kenya you can walk into, from 1895 to today. Scroll the river of years, step into a year, and it opens as a room of that year's events, each linked to its source, with credited images and a guide that answers only from cited passages.

## What is in it

- **706 approved events** from 1895 to 2026, from Wikidata, Wikipedia's "<year> in Kenya" categories and the dated entries in its "<year> in Kenya" articles. Those year lists exist for 1975, 1982, 1992 and 2006 onwards, so recent years are denser than early ones.
- **Who approved each event is recorded and published.** None has been checked by a person yet: 502 were approved by AI at the owner's request, and 204 were taken from Wikidata on trust. Every year room and `/sources` say so.
- **132 images** from Wikimedia Commons, each shown with its author and licence. Images without a stated author or a free licence are never stored.
- **People and places** from Wikidata, on the cards of the events tied to a Wikidata item: 28 people and 63 places. Wikidata's "chair" and "head of state" are left out, because they give today's holder, not the one at the time.
- **Four threads:** land, elections, the constitution and Jomo Kenyatta.
- **News** for the current year from the GDELT Project: headlines and links only, labelled as unreviewed and cited, as GDELT's terms ask.

## The site

- **The river** (`components/River.tsx`) is drawn on a canvas over native scrolling, so touch momentum works, and an invisible list of year buttons carries focus, keyboard control and screen-reader names. A band of water runs the length of the timeline, tinted by era, with a current drifting from the past toward the present. Each event is a mark on its bed, shaped and coloured by its lens.
- **Zoom:** year, decade and century. `+` and `-` zoom, arrows move a year, Page Up and Page Down a decade, Home and End jump to either end, and typing four digits jumps to a year. Enter opens a year and Escape leaves it.
- **A year room** opens on all its events at `/1963`. The tabs filter by lens: `/1963/politics`, `/1963/culture`, `/1963/places` and `/1963/news`. Every year and lens is a static page, with the cards in the HTML, so they load without JavaScript.
- **Motion:** entering a year, its numeral grows into the room's header in 700 ms and lands back on the same numeral when you leave. With reduced motion, every move is a 150 ms cross-fade and the river's current stands still.
- **`/list`** is every event on one plain page, oldest first: the screen-reader path and what search engines index.
- **`/sources`** lists the datasets and licences, the approval split, the lens-tagging error rate, the guide's eval score and a credit for every image.
- **`/thread/<slug>`** draws a line through a thread's events on the century view and lists them.
- **"Report an error"** on every card goes to `NEXT_PUBLIC_REPORT_URL` with the event id in the subject. With it unset, the link is hidden.

## The guide

`/api/guide` answers questions about a year from that year's sources:

1. Limit and filter (`lib/guide/guard.ts`, `lib/guide/ratelimit.ts`).
2. Retrieve the eight passages nearest the question, embedded with `bge-m3` in pgvector, widening to the neighbouring years if fewer than three are found.
3. Ask a small model, giving each passage an id like `[p3]`.
4. Check in plain code: a sentence survives only if it cites a passage that was sent (`lib/guide/citations.ts`, tested with `pnpm test`). The evals found four ways to fool the check, and each became a test.
5. Stream the passages first, so a slow model still leaves sources on screen, then the sentences that passed.

When the sources do not cover a question, the guide says so and suggests the nearest year that does.

**Eval.** `make eval` runs 40 questions with known answers and 10 the sources cannot answer, and writes `public/data/eval.json`, which `/sources` shows. With `llama3.2:1b`: 27 of 40 answered correctly, 8 of 10 declined, and 64 of 70 answer sentences backed by their cited passage. Marking is automatic, and every answer is published for checking by hand. On a CPU an uncached answer takes 35–60 seconds; the eval restarts Ollama first, because its prompt cache makes a repeated run look fast.

## Run it

Everything runs in Docker; only `make` and `docker` are needed on the host.

```bash
make up
```

Then open http://localhost:3000. Source is bind-mounted, so edits hot-reload. Postgres with pgvector listens on host port 5433 (`make psql` opens a shell), and Ollama reads the models already in `~/.ollama/models`. `/review`, for approving and rejecting candidates, is on only in development (`REVIEW_ENABLED=1`) and returns 404 in production.

`make eval` needs `GUIDE_EVAL_KEY` in `.env` (any long random string), which lets it past the rate limit.

After changing `package.json`, refresh the lockfile inside a container:

```bash
docker run --rm -u node -v "$PWD":/app -w /app -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 node:22-alpine corepack pnpm install --lockfile-only
```

## The pipeline

Python (httpx, pydantic, psycopg) in `pipeline/`, run through `make` in Docker. For any span of years (`FROM=1960 TO=1969`), in order:

| Step | What it does |
| --- | --- |
| `candidates` | Loads candidates from Wikidata, Wikipedia's year categories and its year lists. Every exclusion is written to `data/raw/` with its reason. |
| `autosort` | Drafts a decade's pre-sort from rules, for reading before it is applied. |
| `presort` | Applies `data/presort/<from>-<to>.json`: keep, hold or reject, each with a reason. Decided rows are protected from reruns. |
| `dedupe` | Proposes same-year duplicates by `bge-m3` similarity; pairs judged different go in `data/presort/not-duplicates.json`. |
| `lenstag` | Has the model pick each event's lens, then rules correct its systematic mistakes. `lenscheck` measured it on 100 events: 33 wrong. |
| `threads` | Fills the threads from `data/threads.json`. |
| `entities` | Fills people and places from Wikidata. |
| `images` | Finds a Commons image per event, freely licensed and with a stated author. |
| `passages` | Splits the cited articles into paragraphs and embeds them for the guide. |
| `export` | Writes approved events to `public/data/`, which the site serves. Commit the result. |

Then `news` for the current year, and `checklinks` before a release (all 381 source links answered).

## Deploy

Pushing a version tag builds the production image: `.github/workflows/image.yml` publishes it to `ghcr.io/imeldahope/nyakati`, tagged with the version and `latest`. The host only pulls it: `compose.prod.yaml` stands alone and runs just the site. Never deploy `compose.yaml`, the development setup, which turns on `/review`.

Build settings are repository variables (Settings > Secrets and variables > Actions > Variables), because they are read at build time:

```
SITE_URL=<public address, for social cards>
NEXT_PUBLIC_REPORT_URL=<optional: mailto: or form URL for "Report an error">
```

The host's environment:

```
DATABASE_URL=<Postgres with pgvector; a pooled URL is fine>
OLLAMA_URL=<Ollama, reachable on PROXY_NETWORK>
OLLAMA_MODEL=<chat model>
PROXY_NETWORK=<Docker network shared with the proxy and Ollama>
IMAGE_TAG=<optional: a version such as 0.1.0, to pin or roll back; default latest>
OLLAMA_API_KEY=<optional: bearer key for the model host>
OLLAMA_TIMEOUT_MS=<optional: default 90000>
OLLAMA_EMBED_TIMEOUT_MS=<optional: default 60000>
```

The proxy sends the domain to service `nyakati-web`, port `3000`. Ollama needs `bge-m3` and the chat model. To release, bump `version` in `package.json`, commit, tag and push the tag:

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

When the image workflow has finished, redeploy so the host pulls the new image.

Fill the database from this machine with a direct (not pooled) URL, again whenever events or passages change. Use a database for Nyakati alone: its `event` and `passage` tables are emptied and replaced.

```bash
GUIDE_DATABASE_URL='<direct URL>' make guide-db
```

A slow CPU can pass the guide's time limits. If answers come back unavailable before any passages show, Ollama is reloading `bge-m3`: raise `OLLAMA_EMBED_TIMEOUT_MS`, or let Ollama keep both models loaded (`OLLAMA_MAX_LOADED_MODELS=2` on the Ollama container, about 3.5 GB of memory with a 3B chat model). If they come back unavailable after the passages, raise `OLLAMA_TIMEOUT_MS`.

## Palette contrast

Measured against `--ground` (#14110F), using the WCAG 2.x contrast ratio:

| Token | Value | Ratio | Text (4.5) | Large text and marks (3.0) |
| --- | --- | --- | --- | --- |
| `--paper` | #EFE8DA | 15.4 | pass | pass |
| `--paper-dim` | #A39A88 | 6.8 | pass | pass |
| `--brass` | #B8893B | 6.0 | pass | pass |
| `--slate` | #6F8296 | 4.8 | pass | pass |
| `--acacia` | #5E7A57 | 3.9 | **fail** | pass |
| `--murram` | #A8452F | 3.2 | **fail** | pass |

These values are kept for marks, lens swatches and the large current-year numeral. Small text in those hues uses lighter variants: `--murram-ink` #CB5C44 (4.6) and `--acacia-ink` #67865F (4.6).

`docs/launch-checklist.md` tracks the launch checklist, and `docs/design-pass/` has before-and-after screenshots of the river.
