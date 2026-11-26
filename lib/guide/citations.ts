/**
 * The citation check, step 4 of the guide, in plain code: it is the reason the guide can
 * be trusted with a small model. A sentence survives only if it cites at least one
 * passage, like [p3], and every id it cites was actually sent to the model. Small models
 * also write [3]; both forms count.
 */

const ID = /\[p?(\d+)\]/gi;

export interface CheckedSentence {
  text: string; // without its ids
  cites: number[]; // passage numbers, 1-based, in order of first mention
}

/** Checks one sentence. Returns null if it fails. */
export function checkSentence(raw: string, sent: number): CheckedSentence | null {
  const cites = [...new Set([...raw.matchAll(ID)].map((m) => Number(m[1])))];
  if (cites.length === 0 || cites.some((n) => n < 1 || n > sent)) return null;
  const text = raw
    .replace(ID, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // A claim must say something: words, or a figure like "83". Stray ids ("p2") and list
  // numbering ("1. 2.") are what a small model writes when it has nothing to say.
  const content = text.replace(/\bp\d+\b/gi, "").replace(/(^|\s)\d\.(?=\s|$)/g, " ");
  if (!/[a-z]{2,}/i.test(content) && !/\d{2,}/.test(content)) return null;
  // Saying the passages are silent is a refusal, not an answer.
  if (REFUSES_IN_WORDS.test(text)) return null;
  return { text, cites };
}

/**
 * A model saying, in its own words, that the passages do not answer: a negation about the
 * passages or sources themselves, or "no information". Facts that contain "not" ("permission
 * was not given") are left alone.
 */
export const REFUSES_IN_WORDS =
  /\b(?:not|no|nothing)\b[^.]{0,60}\b(?:passages?|sources?|the text|provided information)\b|\bno (?:information|mention)\b/i;

/**
 * Pulls complete sentences off the front of a streamed reply. A sentence is complete once
 * the text after its end mark (and any ids that follow it) has started, so ids written
 * after the full stop stay with their sentence.
 */
export function takeSentences(buffer: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const complete = /^\s*([\s\S]*?[.!?](?:["')\]]*)(?:\s*\[p?\d+\])*)\s+(?=\S)/i;
  for (let m = rest.match(complete); m; m = rest.match(complete)) {
    sentences.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  if (final && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}

/**
 * Splits a finished reply into claims. Models either end sentences with their ids
 * ("… in 1963. [p2]") or lead with them ("[2] … [3] …"); in the second style each id
 * starts a new claim, the id is moved to its end, and only the claim's first sentence is
 * kept: small models pad a claim by copying the rest of the passage, and the copy may be
 * cut off mid-sentence by the token limit.
 */
export function splitReply(reply: string): string[] {
  const text = reply.trim();
  if (/^\[p?\d+\]/i.test(text)) {
    return text
      .split(/(?=\[p?\d+\])/i)
      .map((part) => {
        const m = part.match(/^(\[p?\d+\])\s*([\s\S]*)$/i);
        if (!m) return part.trim();
        // First sentence; an initial ("John F. Kennedy") is not a sentence end.
        const first = m[2].trim().split(/(?<=[.!?])(?<!\b[A-Z]\.)\s+(?=[A-Z0-9"'(])/)[0];
        return `${first} ${m[1]}`;
      })
      .filter((part) => part.length > 0);
  }
  return takeSentences(text, true).sentences;
}

/** The model's way of saying the passages do not answer the question: in capitals, as asked,
 *  so an answer that merely says "not covered" is not mistaken for a refusal. */
export const NOT_COVERED = /NOT[\s_]+COVERED/;

/** A claim that is nothing but "not covered", in any case and with or without ids: small
 *  models sometimes write the refusal in ordinary case and cite a passage for it. */
const BARE_NOT_COVERED = /^(?:\[p?\d+\]\s*)*not[\s_]+covered[.!]?(?:\s*\[p?\d+\])*[.!]?$/i;

export function isRefusal(claim: string): boolean {
  return NOT_COVERED.test(claim) || BARE_NOT_COVERED.test(claim.trim());
}
