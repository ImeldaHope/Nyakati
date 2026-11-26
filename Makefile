# Data pipeline. Every target runs in Docker; only make and docker are needed on the host.
COMPOSE := docker compose
RUN := $(COMPOSE) --profile pipeline run --rm pipeline python -m nyakati_pipeline
FROM ?= 1960
TO ?= 1969

.PHONY: lenscheck checklinks up db migrate seed wikidata wikipedia yearlists candidates autosort presort lenstag dedupe threads entities news images passages eval export guide-db psql

up:
	$(COMPOSE) up --build --renew-anon-volumes web

db:
	$(COMPOSE) up -d --wait db

migrate: db
	$(RUN).migrate

# The hand-written Phase 0 events, as unreviewed rows.
seed: migrate
	$(RUN).seed_hand

wikidata: migrate
	$(RUN).wikidata --from $(FROM) --to $(TO)

wikipedia: migrate
	$(RUN).wikipedia --from $(FROM) --to $(TO)

# Dated entries from Wikipedia's "<year> in Kenya" articles.
yearlists: migrate
	$(RUN).yearlists --from $(FROM) --to $(TO)

# Everything a reviewer needs for one span of years: make candidates FROM=1960 TO=1969
candidates: seed wikidata wikipedia yearlists

# Draft data/presort/$(FROM)-$(TO).json from rules (never overwrites a hand-made file).
autosort: migrate
	$(RUN).autosort --from $(FROM) --to $(TO)

# Apply data/presort/$(FROM)-$(TO).json. Kept Wikidata items are approved under the trust rule.
presort: migrate
	$(RUN).presort --from $(FROM) --to $(TO) --trust-wikidata

# The model picks a lens for approved events nobody tagged on purpose.
lenstag: migrate
	$(RUN).lenstag --from $(FROM) --to $(TO)

# Near-identical events in the same year; add APPLY=--apply to merge them.
dedupe: migrate
	$(RUN).dedupe --from $(FROM) --to $(TO) $(APPLY)

# The four threads in data/threads.json -> the thread tables.
threads: migrate
	$(RUN).threads

entities: migrate
	$(RUN).entities

# The current year's News lens from GDELT (headlines and links only).
news:
	$(RUN).news

# A Commons image with author and licence for each approved event in FROM–TO.
images: migrate
	$(RUN).images --from $(FROM) --to $(TO)

# Paragraphs of the cited articles, embedded with bge-m3, for the guide. Needs the ollama service.
passages: migrate
	$(COMPOSE) up -d --wait ollama
	$(RUN).passages --from $(FROM) --to $(TO)

# The guide's 50-question eval against the running site (make up); writes public/data/eval.json.
# Ollama is restarted first: its prompt cache would make a repeated run look fast.
eval:
	$(COMPOSE) restart ollama
	$(RUN).eval

# Approved events -> public/data/*.json, which the site serves. Commit the result.
export: migrate
	$(RUN).export

# Tagging accuracy: SAMPLE=--sample draws 100 model-tagged events; then fill "check" and run again.
lenscheck: migrate
	$(RUN).lenscheck $(SAMPLE)

# Launch check: every shown event's source link opens the right page.
checklinks: migrate
	$(RUN).checklinks

# Copy approved events and their passages to the hosted database the guide reads.
# On the host's network, so GUIDE_DATABASE_URL may be an SSH tunnel on a local port.
guide-db: migrate
	$(COMPOSE) --profile pipeline build -q pipeline
	docker run --rm --network host -u 1000:1000 -v "$(CURDIR)":/work -w /work -e PYTHONPATH=/work/pipeline \
	  -e DATABASE_URL="postgresql://nyakati:$${POSTGRES_PASSWORD:-nyakati}@127.0.0.1:5433/nyakati" \
	  -e GUIDE_DATABASE_URL nyakati-pipeline python -m nyakati_pipeline.guide_db

psql:
	$(COMPOSE) exec db psql -U nyakati nyakati
