"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import Link from "next/link";
import gsap from "gsap";
import Guide from "./Guide";
import {
  LENSES,
  LENS_ORDER,
  formatDate,
  groupByMonth,
  roomPath,
  type Lens,
  type NewsFeed,
  type TimelineEvent,
  type TimelineImage,
  type View,
} from "@/lib/timeline";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";

interface Props {
  ref: Ref<HTMLElement>;
  year: number;
  events: TimelineEvent[];
  images: TimelineImage[];
  /** The current year's GDELT headlines, shown with all events and under the News lens. */
  news: NewsFeed | null;
  lens: View;
  loading: boolean;
  decades: number[];
  onLeave(): void;
}

// Where "Report an error" goes (a mailto: or form URL), from the environment at build time.
// No link is shown until it is set.
const REPORT_URL = process.env.NEXT_PUBLIC_REPORT_URL || null;

// Says plainly which events no person has checked yet.
function approvalNote(events: TimelineEvent[]): string | null {
  const byAI = events.filter((e) => e.reviewed_by === "claude").length;
  const trusted = events.filter((e) => e.reviewed_by === "wikidata-trust").length;
  if (!byAI && !trusted) return null;
  const parts = [
    byAI && `${byAI} approved by AI`,
    trusted && `${trusted} taken from Wikidata on trust`,
  ].filter(Boolean);
  return `Not yet checked by a person: ${parts.join(", ")}. Each card links to its source.`;
}

function LensTag({ lens }: { lens: Lens }) {
  return (
    <span className="lens-tag" data-lens={lens} data-shape={LENSES[lens].shape}>
      {LENSES[lens].label}
    </span>
  );
}

// Caption and credit sit under every image, always visible: who made it, under what licence.
function Strip({ images, year, lens }: { images: TimelineImage[]; year: number; lens: View }) {
  if (images.length === 0) {
    return (
      <p className="placeholder-text">
        No images {lens === "all" ? "" : `for ${LENSES[lens].label.toLowerCase()} `}in {year} yet.
      </p>
    );
  }
  return (
    <ul className="strip">
      {images.map((img) => (
        <li key={img.commons_title} style={{ "--ratio": img.width / img.height } as React.CSSProperties}>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.thumb_url} width={img.width} height={img.height} alt={img.caption} loading="lazy" decoding="async" />
            <figcaption>
              <span className="strip-caption">{img.caption}</span>
              <span className="strip-credit">
                {img.taken && `${img.taken} · `}
                <a href={img.page_url} target="_blank" rel="noopener noreferrer">
                  {img.author}
                </a>
                {" · "}
                <a href={img.licence_url} target="_blank" rel="noopener noreferrer license">
                  {img.licence}
                </a>
              </span>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

// Headlines, not reviewed events: each links to the original report, and GDELT is cited as its terms ask.
function NewsList({ feed }: { feed: NewsFeed }) {
  return (
    <section className="month news" data-rise aria-labelledby="news-heading">
      <h2 id="news-heading" className="month-label">
        Recent headlines
      </h2>
      <p className="room-note">
        Found by{" "}
        <a href={feed.source_url} target="_blank" rel="noopener noreferrer">
          the GDELT Project
        </a>{" "}
        on {feed.fetched}. These link to the original reports and have not been reviewed like the events.
      </p>
      <ol className="cards">
        {feed.items.map((n) => (
          <li key={n.url} className="card">
            <p className="card-date">{n.date}</p>
            <h3 className="card-title news-title">
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
            </h3>
            <p className="card-foot">
              <span className="lens-tag" data-lens="news" data-shape="diamond">
                News
              </span>
              <span>{n.outlet}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// People to show on a card. The subject of the article a card cites is already named by its
// source link, and may be someone else in the event, so that role stays in the data only.
function shownPeople(e: TimelineEvent) {
  return (e.people ?? []).filter((p) => p.role !== "article subject");
}

export default function YearRoom({ ref, year, events, images, news, lens, loading, decades, onLeave }: Props) {
  const [guideOpen, setGuideOpen] = useState(false);
  const cards = useRef<HTMLDivElement>(null);
  const shownLens = useRef(lens);
  // A room shows all its events; a lens tab filters them to that lens.
  const inLens = lens === "all" ? events : events.filter((e) => e.lens === lens);
  const months = groupByMonth(inLens, year);
  const note = approvalNote(inLens);
  const covered = decades.map((d) => `the ${d}s`).join(", ");
  const count = (l: View) =>
    l === "all" ? events.length : l === "news" && news ? news.items.length : events.filter((e) => e.lens === l).length;
  // Headlines replace the cards under the News lens and follow them under All.
  const showNews = lens === "news" && news !== null;
  const newsAfter = lens === "all" && news !== null;
  // All, then any lens with events this year, plus the current one.
  const tabs: View[] = ["all", ...LENS_ORDER.filter((l) => l === lens || count(l) > 0)];

  // Switching lens cross-fades the cards.
  useEffect(() => {
    if (shownLens.current === lens || !cards.current) return;
    shownLens.current = lens;
    gsap.fromTo(
      cards.current,
      { opacity: 0 },
      { opacity: 1, duration: prefersReducedMotion() ? DURATION.reduced : DURATION.lens, ease: EASE },
    );
  }, [lens]);

  return (
    <section ref={ref} className="room" role="dialog" aria-modal="true" aria-labelledby="room-title">
      <div className="room-bar" data-room-chrome>
        <button type="button" className="room-back" onClick={onLeave}>
          <span aria-hidden="true">←</span> River <kbd>Esc</kbd>
        </button>
        {(events.length > 0 || news) && (
          <nav className="lens-tabs" aria-label="Filter by lens">
            {tabs.map((l) => (
              <Link
                key={l}
                href={roomPath(year, l)}
                replace
                scroll={false}
                className="lens-tab"
                aria-current={l === lens ? "page" : undefined}
              >
                {l === "all" ? <span className="lens-tag lens-all">All</span> : <LensTag lens={l} />}
                <span className="lens-count">{count(l)}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>

      <header className="room-head">
        <h1 id="room-title" className="room-numeral" data-room-numeral tabIndex={-1}>
          {year}
          <span className="baseline-probe" data-baseline aria-hidden="true" />
        </h1>
        <p className="room-count" data-room-chrome>
          {loading
            ? "\u00a0"
            : showNews
              ? `${news!.items.length} headlines · ${events.length} events in all`
              : events.length === 0
                ? "No events"
                : lens === "all"
                  ? `${events.length} event${events.length === 1 ? "" : "s"}${news ? ` · ${news.items.length} headline${news.items.length === 1 ? "" : "s"}` : ""}`
                  : `${inLens.length} ${LENSES[lens].label.toLowerCase()} event${inLens.length === 1 ? "" : "s"} · ${events.length} in all`}
        </p>
      </header>

      <div className="room-grid">
        <div className="room-events">
          {note && (
            <p className="room-note" data-rise>
              {note}
            </p>
          )}
          <div ref={cards}>
          {showNews ? (
            <NewsList feed={news!} />
          ) : loading ? null : events.length === 0 ? (
            <p className="room-empty" data-rise>
              Nothing is written here for {year} yet.{covered && ` So far the timeline covers ${covered}.`}
            </p>
          ) : months.length === 0 ? (
            <p className="room-empty" data-rise>
              No {lens === "all" ? "" : `${LENSES[lens].label.toLowerCase()} `}events in {year}.
            </p>
          ) : (
            months.map((m) => (
              <section key={m.key} className="month" data-rise aria-labelledby={`month-${m.key}`}>
                <h2 id={`month-${m.key}`} className="month-label">
                  {m.label}
                </h2>
                <ol className="cards">
                  {m.events.map((e) => (
                    <li key={e.id} className="card">
                      <p className="card-date">{formatDate(e)}</p>
                      <h3 className="card-title">{e.title}</h3>
                      <p className="card-summary">{e.summary}</p>
                      {(e.place || shownPeople(e).length > 0) && (
                        <p className="card-meta">
                          {e.place && (
                            <a href={`https://www.wikidata.org/wiki/${e.place.wikidata_id}`} target="_blank" rel="noopener noreferrer">
                              {e.place.county && e.place.county !== e.place.name ? `${e.place.name}, ${e.place.county}` : e.place.name}
                            </a>
                          )}
                          {shownPeople(e).map((p) => (
                            <a key={p.wikidata_id + p.role} href={`https://www.wikidata.org/wiki/${p.wikidata_id}`} target="_blank" rel="noopener noreferrer" title={p.role}>
                              {p.name}
                            </a>
                          ))}
                        </p>
                      )}
                      <p className="card-foot">
                        <LensTag lens={e.lens} />
                        <a className="source" href={e.source_url} target="_blank" rel="noopener noreferrer">
                          <span className="source-marker">1</span>
                          {e.source_name}
                        </a>
                        <span className="licence">{e.licence}</span>
                        {REPORT_URL && (
                          <a
                            className="report"
                            href={`${REPORT_URL}${REPORT_URL.includes("?") ? "&" : "?"}subject=${encodeURIComponent(`Nyakati: ${e.id}`)}`}
                          >
                            Report an error
                          </a>
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ))
          )}
          {newsAfter && !loading && <NewsList feed={news!} />}
          </div>
        </div>

        <section className="room-images" data-rise aria-label="Images">
          {!loading && events.length > 0 && (
            <Strip
              images={
                lens === "all"
                  ? // One image may illustrate events under several lenses; show it once.
                    images.filter((img, i) => images.findIndex((o) => o.commons_title === img.commons_title) === i)
                  : images.filter((i) => i.lens === lens)
              }
              year={year}
              lens={lens}
            />
          )}
        </section>

        <aside className="room-guide" data-open={guideOpen ? "" : undefined} data-rise aria-label="Guide">
          <button
            type="button"
            className="guide-toggle"
            aria-expanded={guideOpen}
            aria-controls="guide-body"
            onClick={() => setGuideOpen((o) => !o)}
          >
            Ask about {year}
          </button>
          <div id="guide-body" className="guide-body">
            <p className="placeholder-label">Guide</p>
            <Guide key={year} year={year} />
          </div>
        </aside>
      </div>
    </section>
  );
}
