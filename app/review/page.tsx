import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pool, reviewEnabled } from "@/lib/db";
import { LENSES, type DatePrecision, type Lens } from "@/lib/timeline";
import { decide } from "./actions";
import "./review.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review · Nyakati", robots: { index: false } };

// Phase 1 is finished at 60 reviewed events for the seed decade.
const TARGET = 60;
const TABS = ["unreviewed", "approved", "rejected"] as const;
type Tab = (typeof TABS)[number];

interface Row {
  id: string;
  date: string;
  date_precision: DatePrecision;
  title: string;
  summary: string;
  lens: Lens;
  source_url: string;
  source_name: string;
  licence: string;
  wikidata_id: string | null;
  wikidata_types: string[];
  origin: "hand" | "wikidata" | "wikipedia";
  reviewed_by: "person" | "presort" | "wikidata-trust" | "claude" | null;
  review_note: string | null;
}

const DECIDED_BY = {
  person: "Decided by you",
  presort: "Rejected in pre-sort",
  "wikidata-trust": "Approved by the trust-Wikidata rule",
  claude: "Approved by AI at your request",
} as const;

function dateInput(row: Row): string {
  return row.date_precision === "year" ? row.date.slice(0, 4) : row.date_precision === "month" ? row.date.slice(0, 7) : row.date;
}

function year(param: string | string[] | undefined, fallback: number): number {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(n) && n >= 1895 && n <= 2100 ? n : fallback;
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!reviewEnabled()) notFound();

  const params = await searchParams;
  const from = year(params.from, 1960);
  const to = Math.max(from, year(params.to, 1969));
  const tab: Tab = TABS.includes(params.status as Tab) ? (params.status as Tab) : "unreviewed";
  const range = [`${from}-01-01`, `${to + 1}-01-01`];

  const [counts, rows] = await Promise.all([
    pool.query<{ status: Tab; trusted: number; claude: number; n: number }>(
      `SELECT status, count(*) FILTER (WHERE reviewed_by = 'wikidata-trust')::int AS trusted,
              count(*) FILTER (WHERE reviewed_by = 'claude')::int AS claude, count(*)::int AS n
         FROM event WHERE date >= $1 AND date < $2 GROUP BY status`,
      range,
    ),
    pool.query<Row>(
      `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, date_precision, title, summary, lens, source_url,
              source_name, licence, wikidata_id, wikidata_types, origin, reviewed_by, review_note
         FROM event WHERE status = $3 AND date >= $1 AND date < $2
        ORDER BY date, title`,
      [...range, tab],
    ),
  ]);
  const count = Object.fromEntries(TABS.map((t) => [t, counts.rows.find((r) => r.status === t)?.n ?? 0])) as Record<Tab, number>;
  const approvedRow = counts.rows.find((r) => r.status === "approved");
  const trusted = approvedRow?.trusted ?? 0;
  const byClaude = approvedRow?.claude ?? 0;
  const byYou = count.approved - trusted - byClaude;
  const query = (status: Tab) => `/review?from=${from}&to=${to}&status=${status}`;

  return (
    <main className="review">
      <header className="review-head">
        <p className="review-kicker">
          <Link href="/">Nyakati</Link> · Review
        </p>
        <h1>
          {from}–{to}
        </h1>
        <p className="review-progress">
          <strong>{count.approved}</strong> of {TARGET} approved
          <span className="review-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (byYou / TARGET) * 100)}%` }} />
            <span className="review-bar-claude" style={{ width: `${Math.min(100, (byClaude / TARGET) * 100)}%` }} />
            <span
              className="review-bar-trusted"
              style={{ width: `${Math.min(100, (trusted / TARGET) * 100)}%` }}
            />
          </span>
        </p>
        {(trusted > 0 || byClaude > 0) && (
          <p className="review-trust">
            {byYou} by you, {byClaude} by AI at your request, {trusted} trusted from Wikidata without anyone checking
            them. A pre-sort rejected the obvious non-events; those rejections can be reversed in the Rejected tab.
          </p>
        )}
        <p className="review-help">
          Only approved events will show on the site. Check each one against its source before approving; fix the
          title, summary, lens or date as you go. A date can be <code>1963</code>, <code>1963-05</code> or{" "}
          <code>1963-05-26</code>, and its form sets the precision.
        </p>
        <nav className="review-tabs" aria-label="Status">
          {TABS.map((t) => (
            <Link key={t} href={query(t)} aria-current={t === tab ? "page" : undefined}>
              {t[0].toUpperCase() + t.slice(1)} <span>{count[t]}</span>
            </Link>
          ))}
        </nav>
      </header>

      {rows.rows.length === 0 && <p className="review-empty">Nothing {tab} in {from}–{to}.</p>}

      <ol className="review-list">
        {rows.rows.map((row) => {
          const categoryDated = row.origin === "wikipedia" && row.date_precision === "year";
          return (
            <li key={row.id} className="review-item">
              <form action={decide}>
                <input type="hidden" name="id" value={row.id} />
                <div className="review-meta">
                  <span className="review-origin" data-origin={row.origin}>
                    {row.origin === "hand" ? "Hand-written" : row.origin === "wikidata" ? "Wikidata" : "Wikipedia category"}
                  </span>
                  {row.wikidata_types.length > 0 && <span>{row.wikidata_types.join(", ")}</span>}
                  {row.wikidata_id && (
                    <a href={`https://www.wikidata.org/wiki/${row.wikidata_id}`} target="_blank" rel="noopener noreferrer">
                      {row.wikidata_id}
                    </a>
                  )}
                </div>

                {row.reviewed_by && tab !== "unreviewed" && (
                  <p className="review-decided" data-by={row.reviewed_by}>
                    {DECIDED_BY[row.reviewed_by]}
                  </p>
                )}

                {row.review_note && <p className="review-note">{row.review_note}</p>}

                {categoryDated && !row.review_note && (
                  <p className="review-warn">
                    Dated only by its Wikipedia year category. That is often a founding year, not an event: check the
                    date, and retitle it as an event if it is one.
                  </p>
                )}

                <div className="review-fields">
                  <label className="field field-date">
                    <span>Date</span>
                    <input name="date" defaultValue={dateInput(row)} pattern="\d{4}(-\d{2}(-\d{2})?)?" required />
                  </label>
                  <label className="field field-lens">
                    <span>Lens</span>
                    <select name="lens" defaultValue={row.lens}>
                      {(Object.keys(LENSES) as Lens[]).map((l) => (
                        <option key={l} value={l}>
                          {LENSES[l].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field field-title">
                    <span>Title</span>
                    <input name="title" defaultValue={row.title} required />
                  </label>
                  <label className="field field-summary">
                    <span>Summary</span>
                    <textarea name="summary" defaultValue={row.summary} rows={3} required />
                  </label>
                </div>

                <div className="review-foot">
                  <a className="review-source" href={row.source_url} target="_blank" rel="noopener noreferrer">
                    {row.source_name} ↗
                  </a>
                  <span className="review-licence">{row.licence}</span>
                  <span className="review-actions">
                    {tab !== "unreviewed" && (
                      <button name="decision" value="unreviewed" className="btn" formNoValidate>
                        Back to unreviewed
                      </button>
                    )}
                    {tab !== "rejected" && (
                      <button name="decision" value="rejected" className="btn btn-reject" formNoValidate>
                        Reject
                      </button>
                    )}
                    {tab !== "approved" ? (
                      <button name="decision" value="approved" className="btn btn-approve">
                        Approve
                      </button>
                    ) : (
                      <button name="decision" value="approved" className="btn">
                        Save changes
                      </button>
                    )}
                  </span>
                </div>
              </form>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
