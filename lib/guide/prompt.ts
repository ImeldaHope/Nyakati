import { sanitizeForModel } from "./guard";
import type { Passage } from "./retrieve";

/**
 * Step 3: the passages, each with a short id, and the rules for the answer. Worded for a
 * small model: one worked example, and the question again after the passages.
 */
export function buildPrompt(year: number, passages: Passage[], question: string) {
  const system = [
    `You are a careful guide to Kenya in ${year}. Answer the question using only the numbered passages.`,
    "Write two to four short sentences. End each sentence with the number of the passage it comes from, in square brackets.",
    "Example: Kenya was admitted to the United Nations in December 1963 [p4].",
    "Do not give opinions about events or people. If passages disagree, say so and cite each.",
    "If no passage answers the question, write only: NOT COVERED",
  ].join(" ");
  const q = sanitizeForModel(question);
  const sources = passages.map((p) => `[p${p.n}] ${p.text}`).join("\n\n");
  const user = `Question: ${q}\n\nPassages:\n\n${sources}\n\nQuestion: ${q}\nAnswer:`;
  return { system, user };
}
