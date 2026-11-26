// Build-time reads of the exported data (public/data, written by `make export`). Server only.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DecadeData, NewsFeed, Thread, TimelineEvent, TimelineImage, TimelineIndex } from "./timeline";

const DATA = path.join(process.cwd(), "public", "data");

export function readIndex(): TimelineIndex {
  return JSON.parse(readFileSync(path.join(DATA, "index.json"), "utf8"));
}

export function readDecade(decade: number): DecadeData {
  const file = path.join(DATA, "decades", `${decade}.json`);
  if (!existsSync(file)) return { events: [], images: [] };
  const data = JSON.parse(readFileSync(file, "utf8"));
  return { events: data.events ?? [], images: data.images ?? [] };
}

export function allEvents(): TimelineEvent[] {
  return readIndex().decades.flatMap((d) => readDecade(d).events);
}

export function allImages(): TimelineImage[] {
  return readIndex().decades.flatMap((d) => readDecade(d).images);
}

export interface EvalSummary {
  date: string;
  model: string;
  embedding_model: string;
  answerable: { total: number; correct: number };
  refusals: { total: number; declined: number };
  citation_proxy: { sentences: number; supported: number };
  sentences_dropped_by_check: number;
  median_seconds: number | null;
}

/** public/data/eval.json, written by `make eval`; null until the first run. */
export function readEval(): EvalSummary | null {
  const file = path.join(DATA, "eval.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function readThreads(): Thread[] {
  const file = path.join(DATA, "threads.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).threads : [];
}

/** The current year's GDELT headlines, if `make news` has fetched any. */
export function readNews(year: number): NewsFeed | null {
  const file = path.join(DATA, `news-${year}.json`);
  if (!existsSync(file)) return null;
  const feed: NewsFeed = JSON.parse(readFileSync(file, "utf8"));
  return feed.items.length ? feed : null;
}

export interface TaggingCheck {
  date: string;
  model: string;
  sample: number;
  wrong: number;
  checked_by: string;
}

/** public/data/tagging.json, written by `make lenscheck`: how often the model's lens was wrong. */
export function readTagging(): TaggingCheck | null {
  const file = path.join(DATA, "tagging.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
