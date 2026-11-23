/**
 * The claim reading's pure half (`src/talk/claimFidelity.ts`, `src/talk/claimDetails.ts`): each kind fires on the
 * change it names and stays quiet on the reword that a call's grading found it must allow.
 */
import { describe, expect, it } from "vitest";

import { claimSentence } from "../../../talk/claimDetails.js";
import { answerToVoiceFindings, sourceToAnswerFindings } from "../../../talk/claimFidelity.js";
import { claimSourcesOf, textsOf } from "../../../talk/claimMatch.js";

/** A finding cut to what a reader checks: its kind and its detail. */
function kindsOf({ findings }: { findings: readonly { kind: string; detail: string }[] }): readonly string[][] {
  return findings.map((finding) => [finding.kind, finding.detail]);
}

describe("claimSentence", () => {
  it("reads spoken numbers as values, and a compound's words for its number", () => {
    expect([...claimSentence({ text: "Ten files crossed the three-hundred-line cap." }).numbers]).toEqual([
      "10",
      "300",
    ]);
  });

  it("never reads 'one' as a count, nor a number inside an identifier", () => {
    expect([...claimSentence({ text: "The one that #2864 fixed." }).numbers]).toEqual([]);
    expect([...claimSentence({ text: "The one that #2864 fixed." }).identifiers]).toEqual(["#2864"]);
  });

  it("reads polarity per clause, so a joined sentence keeps each clause's own", () => {
    const joined = claimSentence({
      text: "The ledger writes a local file, but I haven't checked which records exist.",
    });
    expect(joined.clauses.map((clause) => clause.negated)).toEqual([false, true]);
  });
});

describe("answerToVoiceFindings", () => {
  it("names a claim the voice dropped, a question it added and a number it swapped", () => {
    const findings = answerToVoiceFindings({
      handed: "The pool holds 14 connections. The replica backup was not checked.",
      spoken: "The pool holds 13 connections. Should we schedule a migration tomorrow?",
    });
    expect(kindsOf({ findings })).toEqual([
      ["swapped-detail", "14 → 13"],
      ["added-question", "nothing handed says it"],
      ["dropped-claim", "a negated claim, unsaid"],
    ]);
  });

  it("stays quiet on a reword that keeps the claims, word endings included", () => {
    const findings = answerToVoiceFindings({
      handed: "Whether typed and spoken answers behave alike is something to measure, not assume.",
      spoken: "Typed and spoken answers get measured for behaving alike, not assumed.",
    });
    expect(findings).toEqual([]);
  });

  it("names quotation marks around words the handed answer does not hold", () => {
    const findings = answerToVoiceFindings({
      handed: "The fix tells the model to reread when challenged.",
      spoken: 'The fix says "keep the source words" and to reread when challenged.',
    });
    expect(kindsOf({ findings })).toEqual([["misquote", '"keep the source words"']]);
  });

  it("finds nothing in an empty answer said as nothing", () => {
    expect(answerToVoiceFindings({ handed: "", spoken: "" })).toEqual([]);
  });
});

describe("textsOf", () => {
  it("reads every string a tool answer's JSON holds, in order, and a non-JSON answer whole", () => {
    expect(textsOf({ text: '{"title":"ABC-1","rows":[{"note":"one"},{"note":"two"}],"n":3}' })).toEqual([
      "ABC-1",
      "one",
      "two",
    ]);
    expect(textsOf({ text: "plain words" })).toEqual(["plain words"]);
  });
});

describe("sourceToAnswerFindings", () => {
  const turn = claimSourcesOf({ texts: ['{"text":"Deploy ABC-1 shipped 3 fixes."}', "Deploy ABC-1 shipped 3 fixes."] });

  it("names a number the answer swapped from the source its sentence restates", () => {
    const findings = sourceToAnswerFindings({ answer: "Deploy ABC-1 shipped 4 fixes.", record: turn, turn });
    expect(kindsOf({ findings })).toEqual([["swapped-detail", "3 → 4"]]);
  });

  it("names a number and an identifier on no record as unsourced, never as invented", () => {
    const findings = sourceToAnswerFindings({ answer: "It merged as #2911 after 7 retries.", record: turn, turn });
    expect(kindsOf({ findings })).toEqual([
      ["unsourced-detail", "7, on no record"],
      ["unsourced-detail", "#2911, on no record"],
    ]);
  });

  it("finds nothing when the answer quotes its source exactly", () => {
    const findings = sourceToAnswerFindings({
      answer: 'The card says "Deploy ABC-1 shipped 3 fixes."',
      record: turn,
      turn,
    });
    expect(findings).toEqual([]);
  });
});
