"use client";

import { useRef, useState } from "react";
import Link from "next/link";

interface Passage {
  n: number;
  text: string;
  source_url: string;
  source_name: string;
  licence: string;
  event_title: string;
  year: number;
}

interface Sentence {
  text: string;
  cites: number[];
}

type Status = "idle" | "asking" | "answered" | "not-covered" | "unavailable" | "blocked" | "error";

const MAX_INPUT = 500;

/**
 * "Ask about 1963". Sentences appear one at a time once they have passed the citation check
 * on the server; each ends with numbered markers that open the source passage below.
 */
export default function Guide({ year }: { year: number }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [passages, setPassages] = useState<Passage[]>([]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [suggestion, setSuggestion] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || status === "asking") return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAsked(q);
    setStatus("asking");
    setPassages([]);
    setSentences([]);
    setSuggestion(null);
    setMessage("");
    try {
      const r = await fetch("/api/guide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year, question: q }),
        signal: controller.signal,
      });
      if (!r.ok || !r.body) {
        const body = await r.json().catch(() => ({}));
        setMessage(body.error ?? "The guide is not available right now.");
        setStatus("error");
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "passages") setPassages(event.passages);
          else if (event.type === "sentence") setSentences((s) => [...s, { text: event.text, cites: event.cites }]);
          else if (event.type === "blocked") {
            setMessage(event.message);
            setStatus("blocked");
          } else if (event.type === "end") {
            setSuggestion(event.suggestion ?? null);
            setStatus(event.status);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessage("The guide is not available right now.");
        setStatus("error");
      }
    }
  }

  // Passages worth showing: the ones cited, or the top three when there is no written answer.
  const cited = new Set(sentences.flatMap((s) => s.cites));
  const shown =
    sentences.length > 0 ? passages.filter((p) => cited.has(p.n)) : status === "asking" ? [] : passages.slice(0, 3);

  return (
    <div className="guide">
      <form className="guide-form" onSubmit={ask}>
        <label htmlFor="guide-input" className="visually-hidden">
          Ask about {year}
        </label>
        <input
          id="guide-input"
          className="guide-input"
          placeholder={`Ask about ${year}`}
          value={question}
          maxLength={MAX_INPUT}
          autoComplete="off"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="guide-ask" disabled={!question.trim() || status === "asking"}>
          Ask
        </button>
      </form>

      {status === "idle" && (
        <p className="placeholder-text">
          Answers come only from the sources for this year, and every sentence links to the passage it rests on.
        </p>
      )}

      {status !== "idle" && (
        <div className="guide-answer" aria-live="polite">
          <p className="guide-asked">{asked}</p>

          {status === "asking" && sentences.length === 0 && (
            <p className="guide-wait">{passages.length ? "Reading the sources…" : "Finding sources…"}</p>
          )}

          {sentences.length > 0 && (
            <p className="guide-text">
              {sentences.map((s, i) => (
                <span key={i} className="guide-sentence" style={{ "--i": i } as React.CSSProperties}>
                  {s.text}
                  {s.cites.map((n) => (
                    <a key={n} href={`#guide-p${n}`} className="guide-marker" aria-label={`Source ${n}`}>
                      {n}
                    </a>
                  ))}{" "}
                </span>
              ))}
            </p>
          )}

          {status === "not-covered" && (
            <p className="guide-text">
              The sources I have for {year} do not cover that.
              {suggestion && (
                <>
                  {" "}
                  Try <Link href={`/${suggestion}`}>{suggestion}</Link>.
                </>
              )}
            </p>
          )}
          {status === "unavailable" && sentences.length === 0 && (
            <p className="guide-text">The guide&apos;s model is busy, so here are the closest source passages instead.</p>
          )}
          {(status === "blocked" || status === "error") && <p className="guide-text">{message}</p>}

          {shown.length > 0 && (
            <ol className="guide-sources">
              {shown.map((p) => (
                <li key={p.n} id={`guide-p${p.n}`} value={p.n}>
                  <p className="guide-passage">{p.text}</p>
                  <p className="guide-source">
                    <a href={p.source_url} target="_blank" rel="noopener noreferrer">
                      {p.source_name}
                    </a>{" "}
                    · {p.licence}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
