import type { DecadeData } from "./timeline";

// Decade files are fetched once and shared by the river (for its marks) and the year rooms.
const pending = new Map<number, Promise<DecadeData>>();
const loaded = new Map<number, DecadeData>();
const EMPTY: DecadeData = { events: [], images: [] };

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;

export function loadDecade(decade: number): Promise<DecadeData> {
  let request = pending.get(decade);
  if (!request) {
    request = fetch(`/data/decades/${decade}.json`)
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((data: DecadeData) => {
        const value = { events: data.events ?? [], images: data.images ?? [] };
        loaded.set(decade, value);
        return value;
      })
      .catch(() => {
        pending.delete(decade);
        return EMPTY;
      });
    pending.set(decade, request);
  }
  return request;
}

/** Fill the cache from data the page already carries (a year's static page). */
export function seedDecade(decade: number, data: DecadeData) {
  if (loaded.has(decade)) return;
  loaded.set(decade, data);
  pending.set(decade, Promise.resolve(data));
}

/** The decade's data if it has already arrived, without waiting. */
export function peekDecade(decade: number): DecadeData | undefined {
  return loaded.get(decade);
}
