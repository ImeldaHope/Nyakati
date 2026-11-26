-- Where an event's lens came from, and what the model said, so tagging accuracy can be measured.
ALTER TABLE event
  ADD COLUMN lens_source text CHECK (lens_source IN ('hand', 'rule', 'model', 'person')),
  ADD COLUMN lens_model text;

UPDATE event SET lens_source = 'hand' WHERE origin = 'hand';
