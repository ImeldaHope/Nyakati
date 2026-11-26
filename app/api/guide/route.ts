import { inspect, refusalFor, MAX_INPUT } from "@/lib/guide/guard";
import { allow, underDailyCeiling } from "@/lib/guide/ratelimit";
import { embedQuestion, nearestOtherYear, ollamaHeaders, ollamaUrl, retrieve } from "@/lib/guide/retrieve";
import { buildPrompt } from "@/lib/guide/prompt";
import { NOT_COVERED, checkSentence, isRefusal, splitReply } from "@/lib/guide/citations";
import { FIRST_YEAR } from "@/lib/timeline";

export const dynamic = "force-dynamic";

const MODEL = () => process.env.OLLAMA_MODEL ?? "llama3.2:1b";
// On a CPU a cold prompt (a year's passages the model has not seen) takes 30–60 s to read.
const TIMEOUT_MS = () => Number(process.env.OLLAMA_TIMEOUT_MS) || 90_000;
const MAX_SENTENCES = 4;

/**
 * The guide. Answers stream as newline-delimited JSON:
 *   {type: "passages", passages}        the sources retrieved for the year, sent first
 *   {type: "sentence", text, cites}     each sentence that passed the citation check, in order
 *   {type: "end", status, suggestion?}  answered | not-covered | unavailable
 *   {type: "blocked", message}          the input filter refused the question
 * If the model is slow or down, the passages already sent are the answer.
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL || !ollamaUrl()) {
    return Response.json({ error: "The guide is not available here." }, { status: 503 });
  }
  let body: { year?: unknown; question?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: {year, question}." }, { status: 400 });
  }
  const year = Number(body.year);
  const question = String(body.question ?? "").trim();
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > new Date().getFullYear() || !question) {
    return Response.json({ error: "A year and a question are needed." }, { status: 400 });
  }

  // Step 1: limit and filter, as on ihope.dev. The eval runner carries a key past the limit.
  const evalKey = process.env.GUIDE_EVAL_KEY;
  const isEval = Boolean(evalKey) && req.headers.get("x-guide-eval-key") === evalKey;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  if (!isEval && (!allow(ip) || !underDailyCeiling())) {
    return Response.json({ error: "Too many questions. Try again in a minute." }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const verdict = inspect(question.slice(0, MAX_INPUT + 1));
        if (verdict.verdict === "block") {
          send({ type: "blocked", message: refusalFor(verdict.rule) });
          return;
        }

        // Step 2: retrieve.
        let vector: number[];
        try {
          vector = await embedQuestion(question, AbortSignal.timeout(20_000));
        } catch {
          send({ type: "end", status: "unavailable" });
          return;
        }
        const passages = await retrieve(vector, year);
        if (passages.length === 0) {
          send({ type: "end", status: "not-covered", suggestion: await nearestOtherYear(vector, year) });
          return;
        }
        send({ type: "passages", passages });

        // Step 3: ask.
        const { system, user } = buildPrompt(year, passages, question);
        let response: Response;
        try {
          response = await fetch(`${ollamaUrl()}/api/chat`, {
            method: "POST",
            headers: ollamaHeaders(),
            body: JSON.stringify({
              model: MODEL(),
              stream: true,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              options: { temperature: 0.1, num_predict: 220 },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS()),
          });
          if (!response.ok || !response.body) throw new Error(`chat failed: ${response.status}`);
        } catch {
          send({ type: "end", status: "unavailable" });
          return;
        }

        // The reply is read to the end (on a CPU, reading the prompt is the slow part; writing
        // takes a second or two), then steps 4 and 5: check each claim, send only the survivors.
        let emitted = 0;
        let dropped = 0;
        let declined = false;
        const handle = (raw: string) => {
          if (isRefusal(raw)) {
            declined = true;
            return;
          }
          const checked = checkSentence(raw, passages.length);
          if (checked && emitted < MAX_SENTENCES && !declined) {
            send({ type: "sentence", ...checked });
            emitted++;
          } else {
            dropped++;
          }
        };

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lines = "";
        let reply = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            lines += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = lines.indexOf("\n")) >= 0) {
              const line = lines.slice(0, nl).trim();
              lines = lines.slice(nl + 1);
              if (!line) continue;
              reply += JSON.parse(line).message?.content ?? "";
            }
          }
          if (NOT_COVERED.test(reply) && !/\[p?\d+\]/i.test(reply)) declined = true;
          else splitReply(reply).forEach(handle);
        } catch {
          // Timed out mid-answer: keep what passed, and say the model gave up.
          send({ type: "end", status: emitted ? "answered" : "unavailable", dropped, partial: true });
          return;
        }

        if (emitted === 0) {
          send({ type: "end", status: "not-covered", suggestion: await nearestOtherYear(vector, year), dropped });
        } else {
          send({ type: "end", status: "answered", dropped });
        }
      } catch {
        send({ type: "end", status: "unavailable" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
