-- Nyakati schema, from the plan's data model. Applied by `make migrate`.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE place (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  lat         double precision,
  lon         double precision,
  county      text,
  wikidata_id text UNIQUE
);

CREATE TABLE event (
  -- Stable text ids: the slug for hand-written events, wd-Q… for Wikidata items,
  -- enwiki-… for Wikipedia articles with no Wikidata item.
  id              text PRIMARY KEY,
  -- Month- and year-precision dates are stored as the first day of that span.
  date            date NOT NULL,
  date_precision  text NOT NULL CHECK (date_precision IN ('day', 'month', 'year')),
  date_label      text,
  title           text NOT NULL CHECK (title <> ''),
  summary         text NOT NULL DEFAULT '',
  lens            text NOT NULL DEFAULT 'politics' CHECK (lens IN ('politics', 'news', 'culture', 'places')),
  era             text NOT NULL,
  place_id        bigint REFERENCES place (id) ON DELETE SET NULL,
  -- Never cut: every event carries its source.
  source_url      text NOT NULL CHECK (source_url <> ''),
  source_name     text NOT NULL CHECK (source_name <> ''),
  licence         text NOT NULL CHECK (licence <> ''),
  wikidata_id     text UNIQUE,
  wikidata_types  text[] NOT NULL DEFAULT '{}',
  origin          text NOT NULL CHECK (origin IN ('hand', 'wikidata', 'wikipedia')),
  -- Only reviewed events show. A person approves or rejects each one.
  status          text NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed', 'approved', 'rejected')),
  reviewed        boolean GENERATED ALWAYS AS (status = 'approved') STORED,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX event_date_idx ON event (date);
CREATE INDEX event_status_date_idx ON event (status, date);

CREATE TABLE person (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  -- One row per person; never merge on name alone.
  wikidata_id text UNIQUE,
  born        date,
  died        date
);

CREATE TABLE event_person (
  event_id  text NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, person_id, role)
);

-- One paragraph of source text: what the guide retrieves and cites (Phase 5).
CREATE TABLE passage (
  id         bigserial PRIMARY KEY,
  event_id   text NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  text       text NOT NULL,
  source_url text NOT NULL,
  licence    text NOT NULL,
  embedding  vector(1024) -- bge-m3
);

CREATE INDEX passage_event_idx ON passage (event_id);

-- Never cut: no image row without author and licence.
CREATE TABLE image (
  id          bigserial PRIMARY KEY,
  event_id    text NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  file_url    text NOT NULL,
  thumb_url   text,
  author      text NOT NULL CHECK (author <> ''),
  licence     text NOT NULL CHECK (licence <> ''),
  licence_url text NOT NULL CHECK (licence_url <> ''),
  caption     text
);

CREATE TABLE thread (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE thread_event (
  thread_id bigint NOT NULL REFERENCES thread (id) ON DELETE CASCADE,
  event_id  text NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  position  integer NOT NULL,
  PRIMARY KEY (thread_id, event_id)
);
