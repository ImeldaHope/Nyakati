-- What the image strip needs: natural size (never cropped), the Commons page the credit
-- links to, when the photo was taken if known, and which file it is (one row per event and file).

ALTER TABLE image
  ADD COLUMN commons_title text NOT NULL DEFAULT '',
  ADD COLUMN page_url text NOT NULL DEFAULT '',
  ADD COLUMN width integer,
  ADD COLUMN height integer,
  ADD COLUMN taken text;

ALTER TABLE image ADD CONSTRAINT image_event_file_key UNIQUE (event_id, commons_title);
