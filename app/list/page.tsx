import type { Metadata } from "next";
import { allEvents } from "@/lib/data";
import { LENSES, eventYear, formatDate, roomPath, type TimelineEvent } from "@/lib/timeline";
import "./list.css";

export const metadata: Metadata = {
  title: "Every event · Nyakati",
  description: "Every event in Nyakati, oldest first, each with its source. A plain page that works without JavaScript.",
};

// The screen-reader path and what search engines index: every event the year rooms show,
// in order, with the same sources. Plain links and no client code.
export default function ListPage() {
  const events = allEvents();
  const byYear = new Map<number, TimelineEvent[]>();
  for (const e of events) byYear.set(eventYear(e), [...(byYear.get(eventYear(e)) ?? []), e]);
  const byAI = events.filter((e) => e.reviewed_by === "claude").length;
  const trusted = events.filter((e) => e.reviewed_by === "wikidata-trust").length;

  return (
    <main className="doc">
      <p className="doc-kicker">
        <a href="/">Nyakati</a> · Every event · <a href="/sources">Sources</a>
      </p>
      <h1>Every event</h1>
      <p className="doc-intro">
        {events.length} events, oldest first, each with its source. These are the same events the year rooms show.
        {(byAI > 0 || trusted > 0) &&
          ` Not yet checked by a person: ${byAI} approved by AI and ${trusted} taken from Wikidata on trust.`}
      </p>

      {[...byYear.entries()].map(([year, list]) => (
        <section key={year} className="doc-year" aria-labelledby={`y${year}`}>
          <h2 id={`y${year}`}>
            <a href={roomPath(year, "all")}>{year}</a>
          </h2>
          <ol className="doc-events">
            {list.map((e) => (
              <li key={e.id} className="doc-event">
                <p className="doc-date">
                  {formatDate(e)} · {LENSES[e.lens].label}
                </p>
                <h3>{e.title}</h3>
                <p>{e.summary}</p>
                <p className="doc-source">
                  Source: <a href={e.source_url}>{e.source_name}</a> ({e.licence})
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
