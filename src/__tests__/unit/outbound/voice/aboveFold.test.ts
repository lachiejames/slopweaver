/**
 * The above-the-fold packing rules, measured against the eight cells of the voice exercise.
 *
 * Both damaged cells and both of their rewrites are here, re-told over invented packages and advisories with each
 * cell's sentence, colon, dash and semicolon shape kept, plus the exercise's own control — the cell that was
 * already fine. A rule that fired on the control would be a rule that punishes good prose.
 */
import { describe, expect, it } from "vitest";

import {
  ABOVE_FOLD_MAX_PARENTHETICALS,
  ABOVE_FOLD_SENTENCE_MAX_WORDS,
  aboveFoldFindings,
} from "../../../../outbound/voice/aboveFold.js";

const EM_DASH = [{ kind: "literal", value: "—" }] as const;

/** Every rule code one cell breaks, in report order. */
function codesOf({ text }: { text: string }): readonly string[] {
  return aboveFoldFindings({ cells: [{ path: "cell", text }], rules: EM_DASH }).map((finding) => finding.code);
}

const CELLS = {
  problemPinCurrent:
    "Root package.json `resolutions` forces left-pad-lite to 2.4.0. Four open high-severity Dependabot alerts " +
    "affect that version (CVSS up to 7.9): header injection via CRLF, incomplete CRLF escaping, and " +
    "two unbounded-memory DoS issues in pad() and stream handling.",
  problemPinRewritten:
    "we pinned left-pad-lite to 2.4.0 ourselves, in root package.json resolutions. that pin is the only reason " +
    "we are on a vulnerable version. four high dependabot alerts are open against it, worst CVSS 7.9.",
  problemQueryCurrent:
    "tiny-query is on 1.12.3 with 3 open high-severity Dependabot alerts (top CVSS 8.1): a filter-key SQL " +
    "injection, a Postgres identifier-quoting injection, and an order-by clause injection, all in the query " +
    "layer used by the api and the worker.",
  problemQueryRewritten:
    "tiny-query 1.12.3 has three open high dependabot alerts, all sql injection, worst CVSS 8.1. it is a direct " +
    "dependency in the query layer behind the api and the worker. none of the vulnerable call sites exist in " +
    "our code today.",
  solutionPinCurrent:
    "Removed the redundant left-pad-lite resolutions entry. Its only consumer, fmt-utils, already declares " +
    "^2.3.1 — removing the override lets yarn resolve the latest matching release, 2.6.2, patching all " +
    "four advisories. Lockfile diff touches only left-pad-lite; no parent bump needed.",
  solutionPinRewritten:
    "deleted the resolutions entry. fmt-utils is the only consumer and it already allows ^2.3.1, so yarn " +
    "picks up 2.6.2 on its own. that patches all four alerts. the lockfile diff touches one package, and " +
    "nothing needed a parent bump.",
  solutionQueryCurrent:
    "Bump the tiny-query Yarn catalog entry from ^1.12.0 to ^1.14.2, the latest stable release rather than the " +
    "1.12.9 minimum. tiny-query is catalogued, so only .yarnrc.yml changes.",
  solutionQueryRewritten:
    "bumped the tiny-query catalog entry from ^1.12.0 to ^1.14.2. that is the latest stable, not the 1.12.9 " +
    "minimum. tiny-query is catalogued, so only .yarnrc.yml changes.",
} as const;

describe("the measured cells", () => {
  it("refuses the packed Problem cell on its colon-introduced list", () => {
    expect(codesOf({ text: CELLS.problemPinCurrent })).toStrictEqual(["colon-list"]);
  });

  it("refuses the one-sentence Problem cell on both the colon list and the length", () => {
    expect(codesOf({ text: CELLS.problemQueryCurrent })).toStrictEqual(["colon-list", "long-sentence"]);
  });

  it("refuses the Solution cell on the em dash and the semicolon-joined clauses", () => {
    expect(codesOf({ text: CELLS.solutionPinCurrent })).toStrictEqual(["voice-rule", "semicolon-clauses"]);
  });

  it("accepts the control cell the exercise found already fine", () => {
    expect(codesOf({ text: CELLS.solutionQueryCurrent })).toStrictEqual([]);
  });

  it("accepts every rewritten cell", () => {
    const rewritten = [
      CELLS.problemPinRewritten,
      CELLS.problemQueryRewritten,
      CELLS.solutionPinRewritten,
      CELLS.solutionQueryRewritten,
    ];
    expect(rewritten.flatMap((text) => codesOf({ text }))).toStrictEqual([]);
  });
});

describe("each rule on its own", () => {
  it("does not call a labelling colon a list", () => {
    expect(codesOf({ text: "one thing broke: the pool." })).toStrictEqual([]);
  });

  it("calls a colon followed by a comma-separated run a list", () => {
    expect(codesOf({ text: "three broke: the pool, the queue, and the cache." })).toStrictEqual(["colon-list"]);
  });

  it("calls a colon followed by a joining word a list", () => {
    expect(codesOf({ text: "two broke: the pool and the queue." })).toStrictEqual(["colon-list"]);
  });

  it("does not see a colon inside a timestamp", () => {
    expect(codesOf({ text: "we read the rollup at 18:15Z, then again later." })).toStrictEqual([]);
  });

  it("refuses one semicolon joining two clauses", () => {
    expect(codesOf({ text: "the diff touches one package; nothing needed a bump." })).toStrictEqual([
      "semicolon-clauses",
    ]);
  });

  it("refuses a sentence one word over the cap and accepts one exactly at it", () => {
    const atCap = `we ${"word ".repeat(ABOVE_FOLD_SENTENCE_MAX_WORDS - 2)}end.`;
    const overCap = `we ${"word ".repeat(ABOVE_FOLD_SENTENCE_MAX_WORDS - 1)}end.`;
    expect(codesOf({ text: atCap })).toStrictEqual([]);
    expect(codesOf({ text: overCap })).toStrictEqual(["long-sentence"]);
  });

  it("allows one parenthetical aside and refuses a second", () => {
    expect(codesOf({ text: "the pool (the staging one) exhausted overnight." })).toStrictEqual([]);
    expect(codesOf({ text: "the pool (staging) exhausted (overnight) again." })).toStrictEqual(["parentheticals"]);
  });

  it("does not count a function call as a parenthetical aside", () => {
    expect(ABOVE_FOLD_MAX_PARENTHETICALS).toBe(1);
    expect(codesOf({ text: "the leak is in list() and in read() alike." })).toStrictEqual([]);
  });

  it("reports every cell's findings, naming the cell that broke each rule", () => {
    const findings = aboveFoldFindings({
      cells: [
        { path: "problem", text: "three broke: the pool, the queue, and the cache." },
        { path: "solution", text: "we fixed it — twice." },
      ],
      rules: EM_DASH,
    });
    expect(findings.map((finding) => `${finding.path}/${finding.code}`)).toStrictEqual([
      "problem/colon-list",
      "solution/voice-rule",
    ]);
  });

  it("finds nothing in an empty cell list", () => {
    expect(aboveFoldFindings({ cells: [], rules: EM_DASH })).toStrictEqual([]);
  });

  it("reads no rule at all when the operator has configured none", () => {
    expect(aboveFoldFindings({ cells: [{ path: "problem", text: "we fixed it — twice." }], rules: [] })).toStrictEqual(
      [],
    );
  });
});
