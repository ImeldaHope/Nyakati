import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_COVERED, REFUSES_IN_WORDS, checkSentence, isRefusal, splitReply } from "./citations.ts";

const checkAll = (reply: string, sent = 8) => splitReply(reply).map((s) => checkSentence(s, sent));

test("keeps a sentence that cites a passage it was given, without its id", () => {
  assert.deepEqual(checkSentence("Kenya became independent on 12 December 1963 [p3].", 8), {
    text: "Kenya became independent on 12 December 1963.",
    cites: [3],
  });
});

test("drops a sentence with no id, or an id that was not sent", () => {
  assert.equal(checkSentence("Kenya became independent in 1963.", 8), null);
  assert.equal(checkSentence("Kenya became independent in 1963 [p9].", 8), null);
  assert.equal(checkSentence("Kenya became independent in 1963 [p2] [p12].", 8), null);
});

test("accepts [3] as well as [p3], and a bare figure as an answer", () => {
  assert.deepEqual(checkSentence("83 [1]", 8), { text: "83", cites: [1] });
});

test("drops a claim that is only ids", () => {
  assert.equal(checkSentence("[p1] [p2]", 8), null);
});

test("splits trailing-id sentences", () => {
  const out = checkAll("KANU won 83 seats [p1]. KADU lost. Kenyatta became prime minister [p2].");
  assert.deepEqual(out, [{ text: "KANU won 83 seats.", cites: [1] }, null, { text: "Kenyatta became prime minister.", cites: [2] }]);
});

test("splits leading-id claims, keeping each claim's first sentence", () => {
  const out = checkAll("[1] Jaramogi Oginga Odinga [2] A series of by-elections were held. They followed a split [3] In March 1966 a faction");
  assert.deepEqual(out, [
    { text: "Jaramogi Oginga Odinga", cites: [1] },
    { text: "A series of by-elections were held.", cites: [2] },
    { text: "In March 1966 a faction", cites: [3] },
  ]);
});

test("recognises the refusal", () => {
  assert.ok(NOT_COVERED.test("NOT COVERED"));
  assert.ok(!NOT_COVERED.test("It is not covered by the treaty [p1]."));
});

// Cases from the first eval run (public/data/eval.json, 2026-11-21).
test("drops stray ids and list numbering passed off as an answer", () => {
  assert.deepEqual(checkAll("[p1] p2"), [null]);
  assert.deepEqual(checkAll("[p1] p3 [p4] p5"), [null, null]);
  assert.deepEqual(checkAll("[p1] 1. [p2] 2."), [null, null]);
});

test("drops a claim that says the passages are silent", () => {
  assert.equal(checkSentence("The weather on New Year's Day 1966 was not specified in the passage [p1].", 8), null);
  assert.ok(REFUSES_IN_WORDS.test("There is no information about that."));
  assert.deepEqual(checkSentence("Permission for the rally was not given [p2].", 8), {
    text: "Permission for the rally was not given.",
    cites: [2],
  });
});

test("does not cut a claim at an initial", () => {
  assert.deepEqual(checkAll("[p2] Senator John F. Kennedy arranged a donation. It paid for airfare."), [
    { text: "Senator John F. Kennedy arranged a donation.", cites: [2] },
  ]);
});

// Case from the eval run of 2026-11-22: r08 answered "Not covered" and cited a passage for it.
test("recognises the refusal written in ordinary case, alone", () => {
  assert.ok(isRefusal("Not covered [p3]."));
  assert.ok(isRefusal("[p2] not covered"));
  assert.ok(isRefusal("NOT COVERED"));
  assert.ok(!isRefusal("The ballot was not covered by the 1963 law [p1]."));
});

