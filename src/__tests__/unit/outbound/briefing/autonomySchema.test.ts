/** The autonomy ledger section's form: what one act may carry, the section's bounds, and its above-fold words. */
import { describe, expect, it } from "vitest";

import { autonomyRowAboveFoldWords, autonomySchema } from "../../../../outbound/briefing/autonomySchema.js";
import type { BriefingAutonomyRow } from "../../../../outbound/briefing/types.js";

/** One reported issue, reduced to the two fields a caller reads. */
interface Issue {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

/** A complete, valid act, with `over` laid on top. */
function row({ over = {} }: { over?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    actionId: "enqueue-pr-2185",
    bySession: "every-slopweaver-ratchet-baseline-goes-to-zero-no",
    doneIso: "2026-09-12T02:06:09Z",
    kindLabel: "enqueue pull request",
    run: "untested-modules-slice",
    said: "Queued your pull request because CI was green.",
    sessionLabel: "ratchet baseline",
    steer: "good call",
    subject: "https://github.com/acme/slopweaver/pull/2185",
    subjectLabel: "acme/slopweaver#2185",
    why: "green, gold-anchored and mergeable",
    witness: "slopweaver github enqueue 2185",
    ...over,
  };
}

/** Every issue the section schema raises for `value`; an empty list when it parses. */
function issuesOf({ value }: { value: unknown }): Issue[] {
  const parsed = autonomySchema.safeParse(value);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path }));
}

/** Every issue for a one-row section whose row carries `over`. */
function rowIssues({ over }: { over: Record<string, unknown> }): Issue[] {
  return issuesOf({ value: { notShown: 0, rows: [row({ over })] } });
}

/** Zod's own refusal for a string longer than `max`. */
function tooLong({ max }: { max: number }): string {
  return `Too big: expected string to have <=${String(max)} characters`;
}

const INSTANT_REFUSAL =
  "an act's instant must be an ISO-8601 timestamp a clock can parse, as in `2026-09-12T02:06:09Z`.";

const SUBJECT_REFUSAL =
  "an act's subject must be a checkable id: an absolute http(s) URL, a handover board row slug, or " +
  "`state:<path>` for a file under the state home.";

describe("autonomySchema", () => {
  it("parses a complete section unchanged", () => {
    const section = {
      notShown: 3,
      rows: [row(), row({ over: { actionId: "rebase-pr-2180", doneIso: "2026-09-11T23:00:00Z" } })],
    };
    expect(autonomySchema.parse(section)).toEqual(section);
  });

  // The defaulted count's two cases (a form written before it existed, a count that is not a whole number) went
  // with the field and the read that filled it.
  // deleted-with-code: FoldedAutonomyRead
  it("refuses an unreadable-line count, which a store-backed ledger never has", () => {
    expect(issuesOf({ value: { notShown: 0, rows: [], unreadable: 0 } }).map((issue) => issue.path)).toEqual([[]]);
  });

  it("accepts 10 rows and refuses 11", () => {
    const rowsOf = ({ count }: { count: number }): Record<string, unknown>[] =>
      Array.from({ length: count }, (_unused, n) => row({ over: { actionId: `act-${String(n)}` } }));
    expect(issuesOf({ value: { notShown: 0, rows: rowsOf({ count: 10 }) } })).toEqual([]);
    expect(issuesOf({ value: { notShown: 0, rows: rowsOf({ count: 11 }) } })).toEqual([
      {
        message:
          "the autonomy ledger shows at most 10 acts. The register keeps all of them — project the newest, and " +
          "let `notShown` state how many are not on this page.",
        path: ["rows"],
      },
    ]);
  });

  it("accepts a notShown of 0 and refuses -1", () => {
    expect(issuesOf({ value: { notShown: 0, rows: [] } })).toEqual([]);
    expect(issuesOf({ value: { notShown: -1, rows: [] } })).toEqual([
      { message: "Too small: expected number to be >=0", path: ["notShown"] },
    ]);
  });

  it("accepts acts newest first, ties included, and refuses them oldest first", () => {
    const newer = row({ over: { actionId: "a", doneIso: "2026-09-12T02:06:09Z" } });
    const tied = row({ over: { actionId: "b", doneIso: "2026-09-12T02:06:09Z" } });
    const older = row({ over: { actionId: "c", doneIso: "2026-09-11T02:06:09Z" } });
    expect(issuesOf({ value: { notShown: 0, rows: [newer, tied, older] } })).toEqual([]);
    expect(issuesOf({ value: { notShown: 0, rows: [older, newer] } })).toEqual([
      {
        message:
          "the autonomy ledger's acts are not newest first. The register folds them in that order already, so a " +
          "section in any other order was re-sorted on the way here.",
        path: ["rows"],
      },
    ]);
  });

  it("accepts distinct act ids and refuses a repeated one", () => {
    const first = row({ over: { actionId: "same" } });
    const second = row({ over: { actionId: "other" } });
    expect(issuesOf({ value: { notShown: 0, rows: [first, second] } })).toEqual([]);
    expect(issuesOf({ value: { notShown: 0, rows: [first, row({ over: { actionId: "same" } })] } })).toEqual([
      {
        message:
          "two rows of the autonomy ledger carry the same act id, so a steer naming it could not say which row it " +
          "judges. Fold the register before projecting it.",
        path: ["rows"],
      },
    ]);
  });

  it("accepts an http(s) URL, a board row slug and a state: reference as the subject, and refuses prose", () => {
    expect(rowIssues({ over: { subject: "http://example.com/a" } })).toEqual([]);
    expect(rowIssues({ over: { subject: "acquireoperationlock-s-stale-lock-takeover" } })).toEqual([]);
    expect(rowIssues({ over: { subject: "state:ledgers/autonomy.jsonl" } })).toEqual([]);
    expect(rowIssues({ over: { subject: "the open pull request" } })).toEqual([
      { message: SUBJECT_REFUSAL, path: ["rows", 0, "subject"] },
    ]);
  });

  it("refuses an instant no clock can parse", () => {
    expect(rowIssues({ over: { doneIso: "yesterday" } })).toEqual([
      { message: INSTANT_REFUSAL, path: ["rows", 0, "doneIso"] },
    ]);
  });

  it("accepts a 40-character instant and refuses a 41-character one", () => {
    const forty = `2026-09-12T02:06:09.${"0".repeat(19)}Z`;
    const fortyOne = `2026-09-12T02:06:09.${"0".repeat(20)}Z`;
    expect(rowIssues({ over: { doneIso: forty } })).toEqual([]);
    expect(rowIssues({ over: { doneIso: fortyOne } })).toEqual([
      { message: tooLong({ max: 40 }), path: ["rows", 0, "doneIso"] },
    ]);
  });

  it("caps kindLabel at 60, actionId at 80, and both derived labels at 120", () => {
    expect(rowIssues({ over: { kindLabel: "k".repeat(60) } })).toEqual([]);
    expect(rowIssues({ over: { kindLabel: "k".repeat(61) } })).toEqual([
      { message: tooLong({ max: 60 }), path: ["rows", 0, "kindLabel"] },
    ]);
    expect(rowIssues({ over: { actionId: "a".repeat(80) } })).toEqual([]);
    expect(rowIssues({ over: { actionId: "a".repeat(81) } })).toEqual([
      { message: tooLong({ max: 80 }), path: ["rows", 0, "actionId"] },
    ]);
    expect(rowIssues({ over: { sessionLabel: "s".repeat(120), subjectLabel: "l".repeat(120) } })).toEqual([]);
    expect(rowIssues({ over: { sessionLabel: "s".repeat(121), subjectLabel: "l".repeat(121) } })).toEqual([
      { message: tooLong({ max: 120 }), path: ["rows", 0, "sessionLabel"] },
      { message: tooLong({ max: 120 }), path: ["rows", 0, "subjectLabel"] },
    ]);
  });

  it("caps run at 200, bySession at 300 and said at 400", () => {
    expect(rowIssues({ over: { bySession: "b".repeat(300), run: "r".repeat(200), said: "s".repeat(400) } })).toEqual(
      [],
    );
    expect(rowIssues({ over: { bySession: "b".repeat(301), run: "r".repeat(201), said: "s".repeat(401) } })).toEqual([
      { message: tooLong({ max: 300 }), path: ["rows", 0, "bySession"] },
      { message: tooLong({ max: 200 }), path: ["rows", 0, "run"] },
      { message: tooLong({ max: 400 }), path: ["rows", 0, "said"] },
    ]);
  });

  it("caps the subject at 500 characters", () => {
    const prefix = "https://example.com/";
    const atCap = `${prefix}${"p".repeat(500 - prefix.length)}`;
    const pastCap = `${prefix}${"p".repeat(501 - prefix.length)}`;
    expect(rowIssues({ over: { subject: atCap } })).toEqual([]);
    expect(rowIssues({ over: { subject: pastCap } })).toEqual([
      { message: tooLong({ max: 500 }), path: ["rows", 0, "subject"] },
      { message: SUBJECT_REFUSAL, path: ["rows", 0, "subject"] },
    ]);
  });

  it("leaves why, witness and steer uncapped", () => {
    const long = "w".repeat(5000);
    expect(rowIssues({ over: { steer: long, why: long, witness: long } })).toEqual([]);
  });

  it("refuses a key the form does not declare, naming the nearest field", () => {
    expect(rowIssues({ over: { witnes: "x" } })).toEqual([
      {
        message:
          'unknown field "witnes" — REFUSED, not ignored. Did you mean "witness"?\n' +
          "this form's fields are: actionId, bySession, doneIso, kindLabel, run, said, sessionLabel, steer, " +
          "subject, subjectLabel, why, witness",
        path: ["rows", 0],
      },
    ]);
  });
});

describe("autonomyRowAboveFoldWords", () => {
  it("counts only the kind, subject and session labels, never the folded or raw fields", () => {
    const projected: BriefingAutonomyRow = {
      actionId: "enqueue-pr-2185",
      bySession: "a long full session name with many words",
      doneIso: "2026-09-12T02:06:09Z",
      kindLabel: "enqueue pull request",
      said: "eight words of plain prose in the fold",
      sessionLabel: "ratchet",
      steer: "three more words",
      subject: "https://github.com/acme/slopweaver/pull/2185",
      subjectLabel: "acme/slopweaver#2185",
      why: "four words of why",
      witness: "two words",
    };
    expect(autonomyRowAboveFoldWords({ row: projected })).toBe(5);
  });
});
