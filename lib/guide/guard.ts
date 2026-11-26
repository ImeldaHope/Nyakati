/**
 * Copied from ihope.dev (lib/agent/guard.ts), as the Nyakati plan asks; only the
 * refusal wording is changed. Keep the two in step when either learns a new attack.
 *
 * Input filter — the cheap layer before the model. Normalises the text (so
 * fullwidth, zero-width, homoglyph, leetspeak and spaced-out spellings read as
 * what they say), then rejects instruction overrides, prompt-extraction, secret
 * probes, role hijacks, chat-markup injection and encoded payloads with a
 * canned refusal. In ihope.dev it is scored on every change by evals/ (pnpm evals).
 *
 * Keep it honest: the scope rules and the internal-only, tool-less architecture
 * are the real protection, not these patterns. A filter only makes the common
 * attacks cheap to refuse.
 */
export const MAX_INPUT = 500;

export type GuardRule = "length" | "override" | "extraction" | "secrets" | "role" | "markup" | "encoded";

export type Inspection = { verdict: "pass" } | { verdict: "block"; rule: GuardRule };

/** What each rule catches, in plain words — shown by the Injection Range lab. */
export const RULE_LABEL: Record<GuardRule, string> = {
  length: "Over the 500-character limit",
  override: "Tries to override the instructions",
  extraction: "Asks for the system prompt or context",
  secrets: "Probes for keys, credentials or config",
  role: "Tries to reassign the assistant's role",
  markup: "Injects chat or delimiter markup",
  encoded: "Carries an encoded payload",
};

// Cyrillic and Greek letters that render like Latin ones.
const HOMOGLYPHS: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ѕ: "s", ј: "j", һ: "h", ԁ: "d", ո: "n",
  α: "a", ε: "e", ο: "o", ι: "i", ρ: "p", υ: "u", ν: "v", κ: "k", τ: "t",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Canonical form: compatibility-folded, invisible characters and accents removed, lowercased. */
export function normalize(q: string): string {
  return q
    .normalize("NFKC")
    .replace(/[­​-‏‪-‮⁠-⁤﻿]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[Ͱ-ϿЀ-ԯ]/g, (ch) => HOMOGLYPHS[ch] ?? ch)
    .replace(/\s+/g, " ")
    .trim();
}

const SPACED_RUN = /\b(?:[a-z0-9@$][ ._\-*]){3,}[a-z0-9@$]\b/g;
const unleet = (text: string) =>
  // Digits and symbols standing in for letters, only inside a word.
  text.replace(/[a-z0-9@$]*[a-z][a-z0-9@$]*/g, (word) => word.replace(/[013457@$]/g, (c) => LEET[c]));

/** A second view for matching only: leetspeak undone, l-e-t-t-e-r spacing closed up. */
function deobfuscate(norm: string): string {
  // "s-y-s-t-e-m" / "i g n o r e": single characters joined by one separator.
  return unleet(norm.replace(SPACED_RUN, (run) => run.replace(/[ ._\-*]/g, "")));
}

/** Spelled-out runs lose their word breaks when closed up; these read them anyway. */
const COMPACT: [GuardRule, RegExp][] = [
  ["override", /(?:ignore|disregard|forget)(?:all|the|your|any)?(?:previous|prior|above|earlier)?(?:instructions|rules|prompts)/],
  ["extraction", /(?:system|initial|hidden)prompt|yourinstructions/],
  ["secrets", /apikey|accesstoken|password|envvar/],
];

const SECRET_NOUN =
  "(?:api[ _-]?keys?|secret keys?|access keys?|private keys?|secrets|passwords?|passwd|credentials?|(?:access|auth|bearer|api|session) tokens?|tokens|env(?:ironment)? ?(?:variables?|vars?)|\\.env|config(?:uration)?(?: file)?)";

const RULES: [GuardRule, RegExp][] = [
  // --- chat / delimiter markup (checked on the canonical text) --------------
  ["markup", /<\s*\/?\s*(?:visitor_question|system|assistant|user|instructions?|inst|s)\s*>/],
  ["markup", /\[\s*\/?\s*(?:inst|system|sys)\s*\]/],
  ["markup", /<\|[^|>]{0,40}\|>/],
  ["markup", /(?:^|\n|#{2,} ?|[.!?] )(?:system|assistant|developer)\s*:/],
  ["markup", /#{2,} ?(?:system|instructions?|new polic)/],

  // --- instruction override -------------------------------------------------
  [
    "override",
    /\b(?:ignore|disregard|forget|override|bypass|skip|drop|do not follow|don't follow|stop following)\b.{0,40}\b(?:instructions?|prompts?|rules?|directions?|guidelines?|restrictions?|polic(?:y|ies)|told|scope|guardrails?)/,
  ],
  ["override", /\b(?:ignore|disregard|forget)\b.{0,20}\b(?:everything|all|anything)\b.{0,20}\b(?:above|before|previous|prior|earlier)/],
  ["override", /\bnew (?:instructions?|rules?|polic(?:y|ies)|directives?)\s*:/],
  ["override", /\bfrom now on,? you\b/],
  ["override", /\b(?:developer|debug|admin|god|sudo|unrestricted|dan) mode\b/],
  ["override", /\b(?:no longer apply|have no (?:rules|restrictions)|without (?:your |any )?(?:safety )?(?:rules|restrictions|guardrails|filters))\b/],

  // --- prompt / context extraction -----------------------------------------
  ["extraction", /\b(?:system|initial|original|hidden|secret|developer|first|base|pre-?)\s?(?:prompt|message|instructions?)\b/],
  ["extraction", /\byour (?:\w+ ){0,2}(?:instructions?|prompt|directives?|guidelines)\b/],
  ["extraction", /\b(?:rules|instructions?|prompt|guidelines) you (?:have been|were|are|got) (?:given|told|provided|sent)\b/],
  ["extraction", /\bwhat (?:were|are) you (?:told|instructed|given)\b/],
  ["extraction", /\b(?:conversation|chat|session|thread)\b.{0,30}\b(?:open(?:ed|s)?|start(?:ed|s)?|beg[ai]n|begins)\b.{0,12}\bwith\b/],
  ["extraction", /\b(?:first|opening|initial) (?:sentence|message|line|words?|thing)\b.{0,40}\b(?:conversation|chat|session|you (?:saw|read|received|were))\b/],
  [
    "extraction",
    /\b(?:repeat|print|output|recite|echo|quote|write out|copy|dump|show|display)\b.{0,40}\b(?:everything above|text above|above this|the above|verbatim|word for word|first line|first sentence|context window|your context)\b/,
  ],
  ["extraction", /\b(?:context window|your context)\b.{0,40}\b(?:dump|print|show|output|repeat)\b/],

  // --- secrets and config ---------------------------------------------------
  [
    "secrets",
    new RegExp(
      `\\b(?:print|dump|leak|reveal|expose|give me|show me|send me|list|output|tell me|share|what(?: is|'s| are)|exfiltrate)\\s+(?:me\\s+)?(?:all\\s+|any\\s+)?(?:of\\s+)?(?:the\\s+)?(?:your|the|any|all|every|its|those|these|my)?\\s*(?:contents of\\s+)?(?:the\\s+)?(?:server'?s?\\s+|site'?s?\\s+|admin\\s+|value of\\s+)*${SECRET_NOUN}`,
    ),
  ],
  ["secrets", new RegExp(`\\byour\\s+(?:\\w+\\s+){0,2}${SECRET_NOUN}`)],
  ["secrets", new RegExp(`\\b${SECRET_NOUN}\\s+(?:of|for|on)\\s+(?:the|this|your)\\s+(?:server|site|system|backend|model|host)`)],
  ["secrets", /\bprocess\.env\b|\bprintenv\b|\bollama_(?:url|model)\b|\/etc\/passwd/],
  ["secrets", /\b(?:leak|exfiltrate|steal)\b.{0,30}\b(?:credentials?|secrets?|keys?|tokens?|data)\b/],

  // --- role hijack ----------------------------------------------------------
  ["role", /\byou are now\b|\byou're now\b/],
  ["role", /(?:^|[.!?:;,] ?)(?:please )?(?:now )?(?:act|behave|respond|speak|talk) (?:as|like) (?:a|an|my|the|if)\b/],
  ["role", /\bpretend (?:to be|you are|you're|that you)\b/],
  ["role", /\b(?:role-?play|stay in character|in character as)\b/],
  ["role", /\b(?:this is a jailbreak|jailbreak (?:mode|test|prompt)|do anything now)\b/],

  // --- encoded payload instructions ------------------------------------------
  ["encoded", /\b(?:base64|rot-?13|hex|morse)\b.{0,60}\b(?:follow|obey|execute|do what|comply|run)\b/],
  ["encoded", /\b(?:decode|decrypt|decipher)\b.{0,60}\b(?:follow|obey|execute|do what|comply|then (?:do|run))\b/],
];

/** A run long enough to hide a sentence; real questions don't carry one. */
const BASE64_RUN = /[A-Za-z0-9+/]{32,}={0,2}/g;

function matchRules(text: string): GuardRule | null {
  for (const [rule, re] of RULES) if (re.test(text)) return rule;
  return null;
}

function decodeBase64(run: string): string | null {
  try {
    const out = atob(run);
    // Keep only decodes that are overwhelmingly printable text.
    const printable = out.replace(/[^\x20-\x7e]/g, "").length;
    return out.length >= 12 && printable / out.length > 0.9 ? out : null;
  } catch {
    return null;
  }
}

/** Runs every rule and says which one fired — the filter's full verdict. */
export function inspect(q: string): Inspection {
  if (q.length > MAX_INPUT) return { verdict: "block", rule: "length" };

  // Markup is matched with line breaks intact; everything else on one line.
  const lined = q.normalize("NFKC").toLowerCase();
  const norm = normalize(q);
  const plain = deobfuscate(norm);
  for (const view of [lined, norm, plain]) {
    const rule = matchRules(view);
    if (rule) return { verdict: "block", rule };
  }
  for (const run of norm.match(SPACED_RUN) ?? []) {
    const joined = unleet(run.replace(/[ ._\-*]/g, ""));
    for (const [rule, re] of COMPACT) if (re.test(joined)) return { verdict: "block", rule };
  }

  // Encoded payloads: decode and re-inspect; an opaque blob is refused outright.
  for (const run of q.match(BASE64_RUN) ?? []) {
    const decoded = decodeBase64(run);
    if (decoded && matchRules(deobfuscate(normalize(decoded)))) return { verdict: "block", rule: "encoded" };
    if (decoded && run.length >= 48) return { verdict: "block", rule: "encoded" };
  }
  return { verdict: "pass" };
}

const REFUSAL = "I can only answer questions about Kenya's history from the sources on this site.";
const TOO_LONG = "Please keep it to a short question about this year.";

/** The canned refusal for a blocked inspection. */
export const refusalFor = (rule: GuardRule) => (rule === "length" ? TOO_LONG : REFUSAL);

/** Returns a canned refusal string to short-circuit with, or null if OK. */
export function preFilter(q: string): string | null {
  const result = inspect(q);
  return result.verdict === "block" ? refusalFor(result.rule) : null;
}

/**
 * Visitor text as it's handed to the model: angle brackets swapped for
 * look-alikes so nothing inside can close the <visitor_question> delimiter.
 */
export function sanitizeForModel(q: string): string {
  return q.slice(0, MAX_INPUT).replace(/</g, "‹").replace(/>/g, "›");
}
