import type { Metadata } from "next";
import { allEvents, allImages, readEval, readIndex, readTagging } from "@/lib/data";
import "../list/list.css";

export const metadata: Metadata = {
  title: "Sources · Nyakati",
  description: "Where every event and image in Nyakati comes from, under what licence, and who checked it.",
};

// The plan's /sources: every dataset, licence and image credit, and the guide's eval score.
export default function SourcesPage() {
  const index = readIndex();
  const evaluation = readEval();
  const tagging = readTagging();
  const events = allEvents();
  const images = allImages();
  const by = index.approved.by;
  const sources = new Map<string, number>();
  for (const e of events) sources.set(e.source_name.split(":")[0], (sources.get(e.source_name.split(":")[0]) ?? 0) + 1);
  // The same Commons file can appear in more than one year; credit it once.
  const credited = [...new Map(images.map((i) => [i.commons_title, i])).values()];

  return (
    <main className="doc">
      <p className="doc-kicker">
        <a href="/">Nyakati</a> · Sources
      </p>
      <h1>Sources</h1>
      <p className="doc-intro">
        Where everything on this site comes from, under what licence, and who checked it. See also{" "}
        <a href="/list">every event</a> as a plain list.
      </p>

      <section className="doc-year" aria-labelledby="datasets">
        <h2 id="datasets">Datasets</h2>
        <ul className="doc-plain">
          <li>
            <strong>Wikidata</strong>: dated items tied to Kenya, the starting point for candidate events. Data is{" "}
            <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>.
          </li>
          <li>
            <strong>English Wikipedia</strong>: the articles each event cites, and its year-in-Kenya categories. Text
            is <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Card summaries are written
            from, or quote, the opening of the cited article, and are shared under the same licence.
          </li>
          <li>
            <strong>Wikimedia Commons</strong>: every image, each under the licence named in its credit below.
          </li>
          <li>
            <strong>
              <a href="https://www.gdeltproject.org/">The GDELT Project</a>
            </strong>
            : the current year&apos;s News lens, headlines linking to the original reports. Free to use with a
            citation and link to the GDELT Project, as its terms ask.
          </li>
        </ul>
        <p>
          Event sources:{" "}
          {[...sources.entries()].map(([name, n], i) => `${i ? ", " : ""}${name} (${n})`).join("")}.
        </p>
      </section>

      <section className="doc-year" aria-labelledby="checks">
        <h2 id="checks">Who checked what</h2>
        <p>
          Only approved events are shown. Of the {index.approved.total} approved so far, {by.person ?? 0} were checked
          by a person, {by.claude ?? 0} were approved by AI at the owner&apos;s request, and{" "}
          {by["wikidata-trust"] ?? 0} were taken from Wikidata on trust, using Wikidata&apos;s dates, after an automatic
          pre-sort removed non-events and dates the cited article contradicts. Every card links to its source.
        </p>
      </section>

      <section className="doc-year" aria-labelledby="tagging">
        <h2 id="tagging">Lens tagging</h2>
        {tagging ? (
          <p>
            Lenses for events nobody tagged by hand are chosen by {tagging.model}. On a sample of {tagging.sample} of
            those events, checked by {tagging.checked_by} on {tagging.date}, the model was wrong {tagging.wrong} times:
            an error rate of {((tagging.wrong / tagging.sample) * 100).toFixed(0)}%.
          </p>
        ) : (
          <p>The lens tagging has not been checked yet.</p>
        )}
      </section>

      <section className="doc-year" aria-labelledby="guide">
        <h2 id="guide">The guide&apos;s score</h2>
        {evaluation ? (
          <>
            <p>
              Run on {evaluation.date} with {evaluation.model} (answers) and {evaluation.embedding_model} (retrieval).
              The guide answers only from passages of each year&apos;s sources; a check in plain code drops any sentence
              that does not cite a passage it was given.
            </p>
            <ul className="doc-plain">
              <li>
                <strong>
                  {evaluation.answerable.correct} of {evaluation.answerable.total}
                </strong>{" "}
                questions with known answers answered correctly.
              </li>
              <li>
                <strong>
                  {evaluation.citation_proxy.supported} of {evaluation.citation_proxy.sentences}
                </strong>{" "}
                answer sentences whose cited passage contains most of their words, an automatic stand-in for whether the
                passage says it. {evaluation.sentences_dropped_by_check} sentences were dropped by the citation check.
              </li>
              <li>
                <strong>
                  {evaluation.refusals.declined} of {evaluation.refusals.total}
                </strong>{" "}
                questions the sources cannot answer were declined.
              </li>
              {evaluation.median_seconds !== null && (
                <li>A median answer took {evaluation.median_seconds} seconds on a CPU.</li>
              )}
            </ul>
            <p>
              Marked automatically; every question, answer and mark is in{" "}
              <a href="/data/eval.json">eval.json</a> for checking by hand.
            </p>
          </>
        ) : (
          <p>The guide has not been evaluated yet. Its score and date will be published here.</p>
        )}
      </section>

      <section className="doc-year" aria-labelledby="images">
        <h2 id="images">Image credits</h2>
        <p>
          {credited.length} images from Wikimedia Commons. No image is shown without its author and licence; to ask
          for one to be removed, contact the site owner.
        </p>
        <ol className="doc-events">
          {credited.map((img) => (
            <li key={img.commons_title} className="doc-event">
              <p>{img.caption}</p>
              <p className="doc-source">
                <a href={img.page_url}>{img.commons_title.replace(/^File:/, "")}</a> · {img.author} ·{" "}
                <a href={img.licence_url} rel="license">
                  {img.licence}
                </a>
                {img.taken && ` · ${img.taken}`}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
