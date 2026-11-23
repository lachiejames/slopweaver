/**
 * `tick.json`, the chair's one authored file per sweep: every malformed field refused by name, the headline
 * held to at most four clean sentences at parse time, and the template `tick open` writes read back as
 * incomplete rather than silently accepted.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { parseTickInput, tickInputTemplate } from "../../../supervisor/tickInput.js";

const RECORDED = "2026-09-27T01:00:00.000Z";

/**
 * A valid tick file, with any field replaced.
 *
 * @param over the fields to replace
 * @returns the document
 */
function tickFile(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    actions: [],
    foldSummary: "Two merges landed and the queue is clear.",
    folds: ["The queue drained after the rebase landed."],
    headline: { sentences: ["The merge queue is clear.", "Nothing needs the owner this hour."] },
    judgements: [],
    openPagesReviewed: true,
    schemaVersion: 1,
    shift: null,
    sleeping: false,
    ...over,
  };
}

/**
 * The refusal lines one invalid document produced.
 *
 * @param value the document
 * @returns the issues
 */
function issuesOf({ value }: { value: unknown }): readonly string[] {
  const parsed = parseTickInput({ recordedIso: RECORDED, value });
  expect(parsed.isErr()).toBe(true);
  const error = parsed._unsafeUnwrapErr();
  expect(error.code).toBe("TICK_INPUT_INVALID");
  if (error.code !== "TICK_INPUT_INVALID") {
    throw new Error(error.message);
  }
  return error.issues;
}

describe("parseTickInput", () => {
  it("reads a valid file, normalising absent optional lists to empty", () => {
    const input = unwrap(parseTickInput({ recordedIso: RECORDED, value: tickFile() }));

    expect(input.headline).toEqual(["The merge queue is clear.", "Nothing needs the owner this hour."]);
    expect(input.dropCards).toEqual([]);
    expect(input.alignmentDetails).toEqual([]);
    expect(input.lede).toBe(undefined);
    expect(input.shift).toBe(null);
    expect(input.openPagesReviewed).toBe(true);
  });

  it("stamps every authored action and judgement with the close's own instant", () => {
    const value = tickFile({
      actions: [
        {
          actionId: "a1",
          detail: "enqueued the rebase",
          kind: "enqueued",
          outcome: "completed",
          subject: { id: "https://github.com/o/r/pull/1", kind: "pull-request", label: "o/r#1" },
          witness: { kind: "command", ref: "slopweaver github enqueue --pr 1" },
        },
      ],
    });

    const input = unwrap(parseTickInput({ recordedIso: RECORDED, value }));

    expect(input.actions.map((action) => [action.actionId, action.recordedIso])).toEqual([["a1", RECORDED]]);
  });

  it("refuses a fifth headline sentence, naming the count", () => {
    const sentences = ["One is here.", "Two is here.", "Three is here.", "Four is here.", "Five is here."];

    expect(issuesOf({ value: tickFile({ headline: { sentences } }) })).toEqual([
      "headline.sentences: has 5 sentences; at most 4 are allowed — keep the ones the owner has to read to decide, and move the rest into a fold",
    ]);
  });

  it("refuses an empty headline", () => {
    expect(issuesOf({ value: tickFile({ headline: { sentences: [] } }) })).toEqual([
      "headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });

  it("refuses a sentence naming a path, a seat number or the fleet words", () => {
    const sentences = ["The page at ~/.slopweaver/pages/x.html is stale.", "The tick wrote a row."];

    const issues = issuesOf({ value: tickFile({ headline: { sentences } }) });

    expect(issues.some((issue) => issue.includes("sentence 1 names a filesystem path"))).toBe(true);
    expect(issues.filter((issue) => issue.includes("sentence 2 uses the fleet word"))).toHaveLength(2);
  });

  it("refuses the headline as two free strings, the shape that joined to five sentences", () => {
    const value = tickFile({ headline: { rest: "Two. Three. Four. Five.", strong: "One." } });

    expect(issuesOf({ value })).toEqual([
      "headline.sentences: Invalid input: expected array, received undefined",
      'headline: Unrecognized keys: "rest", "strong"',
    ]);
  });

  it("names every malformed field at once, never just the first", () => {
    const issues = issuesOf({ value: tickFile({ folds: [], openPagesReviewed: "yes", surprise: 1 }) });

    expect(issues.map((issue) => issue.split(":")[0])).toEqual(["folds", "openPagesReviewed", "(the file)"]);
  });

  it("judges the headline in the same refusal as a malformed sibling field", () => {
    const sentences = ["One.", "Two.", "Three.", "Four.", "The tick is done."];

    const issues = issuesOf({ value: tickFile({ folds: [], headline: { sentences } }) });

    expect(issues).toEqual([
      "folds: Too small: expected array to have >=1 items",
      "headline.sentences: has 5 sentences; at most 4 are allowed — keep the ones the owner has to read to decide, and move the rest into a fold",
      'headline.sentences: sentence 5 uses the fleet word "tick" — say what happened, in plain words',
    ]);
  });

  it("refuses an over-cap foldSummary at read, naming the field and its length rather than the rendered path", () => {
    const issues = issuesOf({ value: tickFile({ foldSummary: "x".repeat(127) }) });

    expect(issues).toEqual(["foldSummary: 127 chars, cap 120"]);
  });

  it("measures the trimmed foldSummary, the string the page renders", () => {
    const input = unwrap(
      parseTickInput({ recordedIso: RECORDED, value: tickFile({ foldSummary: `  ${"x".repeat(120)}  ` }) }),
    );

    expect(input.foldSummary).toBe("x".repeat(120));
  });

  it("refuses a foldSummary ending in a truncation ellipsis, the render's other refusal", () => {
    const issues = issuesOf({ value: tickFile({ foldSummary: "Two merges landed and the queue..." }) });

    expect(issues).toEqual([
      "foldSummary: ends in an ellipsis with nothing after it. A cut that drops the rest leaves it nowhere on the " +
        "page to read — write the whole thing, and fold it behind a `detail` if it runs long.",
    ]);
  });

  it("reports an over-cap foldSummary in the same refusal as a malformed sibling field", () => {
    const issues = issuesOf({ value: tickFile({ folds: [], foldSummary: "y".repeat(121) }) });

    expect(issues).toEqual(["folds: Too small: expected array to have >=1 items", "foldSummary: 121 chars, cap 120"]);
  });

  it("refuses an authored action carrying its own recordedIso — the close stamps it", () => {
    const value = tickFile({
      actions: [
        {
          actionId: "a1",
          detail: "x",
          kind: "enqueued",
          outcome: "completed",
          recordedIso: RECORDED,
          subject: { id: "s", kind: "session", label: "s" },
          witness: { kind: "command", ref: "c" },
        },
      ],
    });

    expect(issuesOf({ value })).toEqual(['actions.0: Unrecognized key: "recordedIso"']);
  });
});

describe("tickInputTemplate", () => {
  it("carries the derived actions and reads back as incomplete until the chair fills it", () => {
    const template = tickInputTemplate({ derivedActions: [] });

    expect(issuesOf({ value: template })).toEqual([
      "foldSummary: Too small: expected string to have >=1 characters",
      "folds: Too small: expected array to have >=1 items",
      "headline.sentences: has 0 sentences; the headline needs at least 1",
    ]);
  });
});
