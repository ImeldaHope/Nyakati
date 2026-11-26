-- Approvals AI made at the owner's request are recorded as such, not as a person's.

ALTER TABLE event DROP CONSTRAINT event_reviewed_by_check;
ALTER TABLE event
  ADD CONSTRAINT event_reviewed_by_check CHECK (reviewed_by IN ('person', 'presort', 'wikidata-trust', 'claude'));
