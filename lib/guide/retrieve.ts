import { pool } from "@/lib/db";

export const EMBED_MODEL = "bge-m3";

export interface Passage {
  n: number; // 1-based, as cited: [p1]
  text: string;
  source_url: string;
  source_name: string;
  licence: string;
  event_title: string;
  year: number;
}

export function ollamaUrl(): string | undefined {
  return process.env.OLLAMA_URL;
}

/** Headers for the model host; a host behind a proxy may want a bearer key. */
export function ollamaHeaders(): Record<string, string> {
  const key = process.env.OLLAMA_API_KEY;
  return { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

export async function embedQuestion(question: string, signal?: AbortSignal): Promise<number[]> {
  const r = await fetch(`${ollamaUrl()}/api/embed`, {
    method: "POST",
    headers: ollamaHeaders(),
    // Ask Ollama to keep bge-m3 loaded: by default it unloads a model after five idle minutes,
    // and loading it again on a busy CPU can outlast the guide's wait.
    body: JSON.stringify({ model: EMBED_MODEL, input: question, keep_alive: process.env.OLLAMA_EMBED_KEEP_ALIVE || "24h" }),
    signal,
  });
  if (!r.ok) throw new Error(`embed failed: ${r.status}`);
  return (await r.json()).embeddings[0];
}

const NEAREST = `
SELECT p.text, p.source_url, e.source_name, p.licence, e.title AS event_title,
       extract(year FROM e.date)::int AS year
  FROM passage p JOIN event e ON e.id = p.event_id
 WHERE e.status = 'approved' AND e.date >= make_date($2, 1, 1) AND e.date < make_date($3 + 1, 1, 1)
 ORDER BY p.embedding <=> $1::vector
 LIMIT $4`;

/**
 * Step 2: the eight nearest passages whose event falls in the year, widening to the two
 * neighbouring years if fewer than three are found.
 */
export async function retrieve(vector: number[], year: number): Promise<Passage[]> {
  const v = `[${vector.join(",")}]`;
  let rows = (await pool.query(NEAREST, [v, year, year, 8])).rows;
  if (rows.length < 3) rows = (await pool.query(NEAREST, [v, year - 1, year + 1, 8])).rows;
  return rows.map((r, i) => ({ n: i + 1, ...r }));
}

/** For a question the year cannot answer: the nearest other year whose sources come closest. */
export async function nearestOtherYear(vector: number[], year: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT extract(year FROM e.date)::int AS year, 1 - (p.embedding <=> $1::vector) AS score
       FROM passage p JOIN event e ON e.id = p.event_id
      WHERE e.status = 'approved' AND extract(year FROM e.date)::int <> $2
      ORDER BY p.embedding <=> $1::vector LIMIT 1`,
    [`[${vector.join(",")}]`, year],
  );
  // Only suggest a year whose best passage is a reasonable match.
  return rows[0] && rows[0].score > 0.55 ? rows[0].year : null;
}
