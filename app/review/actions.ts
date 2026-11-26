"use server";

import { revalidatePath } from "next/cache";
import { pool, reviewEnabled } from "@/lib/db";
import { LENSES, eraForDate, type DatePrecision, type Lens } from "@/lib/timeline";

const STATUSES = ["approved", "rejected", "unreviewed"] as const;

// "1963", "1963-05" or "1963-05-26": the form of the date sets its precision.
function parseDate(input: string): { date: string; precision: DatePrecision } {
  const m = input.trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) throw new Error(`Not a date: "${input}". Use YYYY, YYYY-MM or YYYY-MM-DD.`);
  const [, y, mo, d] = m;
  const date = `${y}-${mo ?? "01"}-${d ?? "01"}`;
  const check = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) {
    throw new Error(`Not a real date: "${input}".`);
  }
  return { date, precision: d ? "day" : mo ? "month" : "year" };
}

export async function decide(formData: FormData) {
  if (!reviewEnabled()) throw new Error("Review is not enabled here.");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("decision") ?? "") as (typeof STATUSES)[number];
  const title = String(formData.get("title") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const lens = String(formData.get("lens") ?? "") as Lens;
  const { date, precision } = parseDate(String(formData.get("date") ?? ""));

  if (!id || !STATUSES.includes(status)) throw new Error("Unknown event or decision.");
  if (!(lens in LENSES)) throw new Error(`Unknown lens: ${lens}`);
  if (!title) throw new Error("An event needs a title.");
  if (status === "approved" && !summary) throw new Error("Write a summary before approving.");

  await pool.query(
    `UPDATE event
        SET status = $2, title = $3, summary = $4, lens = $5, date = $6, date_precision = $7, era = $8,
            reviewed_by = CASE WHEN $2 = 'unreviewed' THEN NULL ELSE 'person' END,
            reviewed_at = CASE WHEN $2 = 'unreviewed' THEN NULL ELSE now() END,
            curated = true, lens_source = 'person', updated_at = now()
      WHERE id = $1`,
    [id, status, title, summary, lens, date, precision, eraForDate(date)],
  );
  revalidatePath("/review");
}
