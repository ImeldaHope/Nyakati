-- Who decided each event, and a note for the reviewer. Curated rows (decided, or
-- pre-sorted with suggested edits) are never overwritten or pruned by pipeline reruns.

ALTER TABLE event
  ADD COLUMN reviewed_by text CHECK (reviewed_by IN ('person', 'presort', 'wikidata-trust')),
  ADD COLUMN review_note text,
  ADD COLUMN curated boolean NOT NULL DEFAULT false;
