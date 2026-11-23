/**
 * `tick fill`'s pure half: each edit the chair used to write as a jq patch, applied to a form, and every bad row
 * or unknown drop refused with nothing kept.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { applyTickFill, type TickFillEdits, tickFormIssues } from "../../../supervisor/tickFill.js";

/** No edits at all; each case sets the ones it exercises. */
const NONE: TickFillEdits = {
  actions: [],
  alignmentDetails: undefined,
  alignmentSummary: undefined,
  carried: undefined,
  dropActions: [],
  dropCards: undefined,
  dropJudgements: [],
  earlierSummary: undefined,
  foldAt: undefined,
  folds: undefined,
  foldSummary: undefined,
  headline: undefined,
  judgements: [],
  lede: undefined,
  openPagesReviewed: undefined,
  shift: undefined,
  sleeping: undefined,
};

const ACTION = {
  actionId: "a1",
  detail: "enqueued the rebase",
  kind: "enqueued",
  outcome: "completed",
  subject: { id: "https://github.com/o/r/pull/1", kind: "pull-request", label: "o/r#1" },
  witness: { kind: "command", ref: "slopweaver github enqueue --pr 1" },
};

const JUDGEMENT = {
  claim: "The rebase is held until the queue drains.",
  judgementId: "j1",
  kind: "hold-rationale",
  subject: { id: "https://github.com/o/r/pull/1", kind: "pull-request", label: "o/r#1" },
  whyNotDerived: "risk-call",
  witness: { kind: "command", ref: "slopweaver github checks --number 1" },
};

/**
 * A filled form, with any field replaced.
 *
 * @param over the fields to replace
 * @returns the form
 */
function form(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    actions: [],
    foldSummary: "Two merges landed and the queue is clear.",
    folds: ["The queue drained after the rebase landed."],
    headline: { sentences: ["The merge queue is clear."] },
    judgements: [],
    openPagesReviewed: true,
    schemaVersion: 1,
    shift: null,
    sleeping: false,
    ...over,
  };
}

/**
 * The issues one refused fill named.
 *
 * @returns the issue lines
 */
function refused({ value, edits }: { value: unknown; edits: TickFillEdits }): readonly string[] {
  const error = unwrapErr(applyTickFill({ edits, form: value }));
  expect(error.code).toBe("TICK_INPUT_INVALID");
  if (error.code !== "TICK_INPUT_INVALID") {
    throw new Error(error.message);
  }
  return error.issues;
}

describe("applyTickFill", () => {
  it("carries the earlier tick's folds, summary, judgements and sleeping, then lands the headline on top", () => {
    const carried = form({
      foldSummary: "carried summary",
      folds: ["carried fold"],
      headline: { sentences: ["The old headline."] },
      judgements: [JUDGEMENT],
      sleeping: true,
    });

    const result = unwrap(
      applyTickFill({ edits: { ...NONE, carried, headline: ["The new headline."] }, form: form({ folds: [] }) }),
    );

    expect(result.form["folds"]).toEqual(["carried fold"]);
    expect(result.form["foldSummary"]).toBe("carried summary");
    expect(result.form["judgements"]).toEqual([JUDGEMENT]);
    expect(result.form["sleeping"]).toBe(true);
    expect(result.form["headline"]).toEqual({ sentences: ["The new headline."] });
    expect(result.changed).toEqual(["folds", "foldSummary", "judgements", "sleeping", "headline"]);
  });

  it("sets the one fold at an index, and the length appends", () => {
    const value = form({ folds: ["zero", "one"] });

    const replaced = unwrap(applyTickFill({ edits: { ...NONE, foldAt: 1, folds: ["ONE"] }, form: value }));
    const appended = unwrap(applyTickFill({ edits: { ...NONE, foldAt: 2, folds: ["two"] }, form: value }));

    expect(replaced.form["folds"]).toEqual(["zero", "ONE"]);
    expect(appended.form["folds"]).toEqual(["zero", "one", "two"]);
  });

  it("refuses a fold index past the end, and two folds for one index", () => {
    const value = form({ folds: ["zero"] });

    expect(refused({ edits: { ...NONE, foldAt: 3, folds: ["x"] }, value })).toEqual([
      "--fold-at 3: the form holds 1 fold(s), so the index is a gap",
    ]);
    expect(refused({ edits: { ...NONE, foldAt: 0, folds: ["x", "y"] }, value })).toEqual([
      "--fold-at 0: sets ONE fold, and 2 were given",
    ]);
  });

  it("replaces an action by its id and appends a new one", () => {
    const value = form({ actions: [ACTION] });
    const replacement = { ...ACTION, detail: "enqueued it again" };
    const added = { ...ACTION, actionId: "a2" };

    const result = unwrap(applyTickFill({ edits: { ...NONE, actions: [replacement, added] }, form: value }));

    expect(result.form["actions"]).toEqual([replacement, added]);
  });

  it("drops a judgement by its id", () => {
    const value = form({ judgements: [JUDGEMENT, { ...JUDGEMENT, judgementId: "j2" }] });

    const result = unwrap(applyTickFill({ edits: { ...NONE, dropJudgements: ["j1"] }, form: value }));

    expect(result.form["judgements"]).toEqual([{ ...JUDGEMENT, judgementId: "j2" }]);
  });

  it("refuses a row the ledger would refuse, naming its position, and keeps nothing", () => {
    const issues = refused({
      edits: { ...NONE, actions: [{ ...ACTION, recordedIso: "2026-10-22T10:00:00.000Z" }], lede: "kept?" },
      value: form(),
    });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("--actions[0]");
  });

  it("refuses a drop naming no row", () => {
    expect(refused({ edits: { ...NONE, dropActions: ["nope"] }, value: form() })).toEqual([
      'actions: no row with actionId "nope" to drop',
    ]);
  });

  it("refuses one id twice in one file rather than letting the last win", () => {
    expect(refused({ edits: { ...NONE, judgements: [JUDGEMENT, JUDGEMENT] }, value: form() })).toEqual([
      '--judgements[1].judgementId: "j1" appears twice in the file',
    ]);
  });

  it("names one id twice at its own position even when the other row fails its schema", () => {
    const bad = { ...ACTION, outcome: "not-an-outcome" };

    const issues = refused({ edits: { ...NONE, actions: [bad, ACTION] }, value: form() });

    expect(issues.length).toBe(2);
    expect(issues[0]).toContain("--actions[0].outcome");
    expect(issues[1]).toBe('--actions[1].actionId: "a1" appears twice in the file');
  });

  it("refuses an id both dropped and put in one call rather than moving it to the end", () => {
    const value = form({ actions: [ACTION, { ...ACTION, actionId: "a2" }] });

    expect(refused({ edits: { ...NONE, actions: [ACTION], dropActions: ["a1"] }, value })).toEqual([
      '--actions[0].actionId: "a1" is also dropped in this call',
    ]);
  });

  it("sets the quiet shift line as null", () => {
    const result = unwrap(applyTickFill({ edits: { ...NONE, shift: null }, form: form({ shift: "the old line" }) }));

    expect(result.form["shift"]).toBe(null);
    expect(result.changed).toEqual(["shift"]);
  });

  it("refuses a file that is not a JSON object", () => {
    expect(refused({ edits: NONE, value: [] })).toEqual(["(the file): is not a JSON object"]);
  });
});

describe("tickFormIssues", () => {
  it("reports nothing for a form close will take", () => {
    expect(tickFormIssues({ form: form() })).toEqual([]);
  });

  it("names what close would still refuse", () => {
    expect(tickFormIssues({ form: form({ headline: { sentences: [] } }) })).toEqual([
      "headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });

  it("names a fold's fleet word before close refuses it, with the rewrite that clears it", () => {
    expect(tickFormIssues({ form: form({ folds: ["The queue drained.", "This tick landed two merges."] }) })).toEqual([
      'folds: "done since you last looked" uses the fleet word "This tick" and never says what it means — "tick" ' +
        "here is one pass of the supervisor's loop. Say what it means in the same breath, above the fold, or write " +
        "the card without the word.",
      "  in plain words: --fold-at 1 --fold 'This pass landed two merges.'",
    ]);
  });

  it("reports only the parser's issues on a malformed form, never the folds' wording", () => {
    expect(tickFormIssues({ form: form({ folds: ["This tick landed."], headline: { sentences: [] } }) })).toEqual([
      "headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });
});
