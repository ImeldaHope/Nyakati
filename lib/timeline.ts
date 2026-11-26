export const FIRST_YEAR = 1895;

export type Lens = "politics" | "news" | "culture" | "places";
export type DatePrecision = "day" | "month" | "year";

// An approved event as exported to public/data/decades/<decade>.json.
export interface TimelineEvent {
  id: string;
  date: string;
  date_precision: DatePrecision;
  date_label?: string;
  title: string;
  summary: string;
  lens: Lens;
  era: string;
  source_url: string;
  source_name: string;
  licence: string;
  // Who approved it. Only approved events are exported to the site.
  reviewed_by: "person" | "claude" | "wikidata-trust";
  // From Wikidata, where the event's item names them (see pipeline/entities.py).
  place?: { name: string; county?: string; wikidata_id: string };
  people?: { name: string; wikidata_id: string; role: string }[];
}

// A Commons image for an event. No image is exported without its author and licence.
export interface TimelineImage {
  event_id: string;
  lens: Lens;
  year: string;
  commons_title: string;
  thumb_url: string;
  page_url: string;
  width: number;
  height: number;
  author: string;
  licence: string;
  licence_url: string;
  caption: string;
  taken?: string; // the year a photograph was taken, when Commons records it
}

// public/data/decades/<decade>.json
export interface DecadeData {
  events: TimelineEvent[];
  images: TimelineImage[];
}

// public/data/threads.json: each thread's events in order.
export interface Thread {
  slug: string;
  title: string;
  description: string;
  events: { id: string; date: string; title: string; lens: Lens }[];
}

// public/data/news-<year>.json: headlines from the GDELT Project, not reviewed events.
export interface NewsFeed {
  year: number;
  source: string;
  source_url: string;
  fetched: string;
  items: { title: string; url: string; outlet: string; date: string }[];
}

// public/data/index.json, written by `make export`.
export interface TimelineIndex {
  decades: number[];
  years: Record<string, number>;
  approved: { total: number; by: Partial<Record<TimelineEvent["reviewed_by"], number>> };
  images: number;
}

// Lens is never shown by colour alone: each has a label and a mark shape.
export const LENSES: Record<Lens, { label: string; shape: "square" | "circle" | "triangle" | "diamond" }> = {
  politics: { label: "Politics", shape: "square" },
  news: { label: "News", shape: "diamond" },
  culture: { label: "Culture", shape: "circle" },
  places: { label: "Places", shape: "triangle" },
};

export const LENS_ORDER: Lens[] = ["politics", "news", "culture", "places"];

// A room shows all its year's events, at /1963; each lens is a filter with its own route,
// /1963/culture.
export type View = Lens | "all";

export function roomPath(year: number, view: View): string {
  return view === "all" ? `/${year}` : `/${year}/${view}`;
}

export function parseRoomPath(path: string | null): { year: number; view: View } | null {
  const m = path?.match(/^\/(\d{4})(?:\/(politics|news|culture|places))?\/?$/);
  return m ? { year: Number(m[1]), view: (m[2] as Lens | undefined) ?? "all" } : null;
}

export interface Era {
  id: string;
  name: string;
  short: string; // for the zoomed-out river, where the full name may not fit
  start: number;
  end: number | null; // null runs to today
}

export const ERAS: Era[] = [
  { id: "protectorate", name: "East Africa Protectorate", short: "Protectorate", start: 1895, end: 1919 },
  { id: "colony", name: "Colony and Protectorate", short: "Colony", start: 1920, end: 1962 },
  { id: "independence", name: "Independence", short: "Independence", start: 1963, end: 1990 },
  { id: "multiparty", name: "Multiparty", short: "Multiparty", start: 1991, end: 2009 },
  { id: "constitution", name: "2010 Constitution", short: "2010 Constitution", start: 2010, end: null },
];

// Era for an exact date. Independence is 12 December 1963, so 1963 itself straddles two eras.
// Kept in step with era_for in pipeline/nyakati_pipeline/common.py.
export function eraForDate(iso: string): string {
  if (iso >= "2010-01-01") return "constitution";
  if (iso >= "1991-01-01") return "multiparty";
  if (iso >= "1963-12-12") return "independence";
  if (iso >= "1920-01-01") return "colony";
  return "protectorate";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function yearsBetween(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function eventYear(e: TimelineEvent): number {
  return Number(e.date.slice(0, 4));
}

// 1–12, or null when the event is only known to the year.
export function eventMonth(e: TimelineEvent): number | null {
  return e.date_precision === "year" ? null : Number(e.date.slice(5, 7));
}

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function formatDate(e: TimelineEvent): string {
  const year = eventYear(e);
  const month = eventMonth(e);
  if (month === null) return `${year}`;
  const name = monthName(month);
  if (e.date_precision === "month") return `${name} ${year}`;
  return `${e.date_label ?? `${Number(e.date.slice(8, 10))} ${name}`} ${year}`;
}

export interface MonthGroup {
  key: string;
  label: string;
  events: TimelineEvent[];
}

// Events by month in date order; year-only events last, under "During <year>".
export function groupByMonth(events: TimelineEvent[], year: number): MonthGroup[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<number, TimelineEvent[]>();
  for (const e of sorted) {
    const m = eventMonth(e) ?? 13;
    groups.set(m, [...(groups.get(m) ?? []), e]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([m, list]) => ({
      key: String(m),
      label: m === 13 ? `During ${year}` : monthName(m),
      events: list,
    }));
}
