/**
 * `store assessment-due` and `store assessment-record` over plain seams: the flags, the check's exit, what each mode
 * prints, and each verdict re-checked against the row as stored before it is written. Synthetic rows and words only.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import {
  parseStoreAssessmentDueArgs,
  parseStoreAssessmentRecordArgs,
} from "../../../../../cli/commands/store/assessmentArgs.js";
import {
  checkExit,
  dueRowLines,
  runStoreAssessmentDue,
  type StoreAssessmentDueDeps,
} from "../../../../../cli/commands/store/assessmentDueRun.js";
import {
  recordedLine,
  runStoreAssessmentRecord,
  type StoreAssessmentRecordDeps,
} from "../../../../../cli/commands/store/assessmentRecordRun.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { contentDataClassFactsFromFields } from "../../../../../store/dataClassIntake.js";
import { composeDataClassRules } from "../../../../../store/dataClassRules.js";
import {
  RecordedAssessmentErrors,
  type RecordedStoredRowAssessment,
} from "../../../../../store/recordedDataClassAssessment.js";
import type { StoredRowAssessmentSlice } from "../../../../../store/storedRowAssessment.js";

const ROW_A = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";
const ROW_B = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
const DIGEST = "a".repeat(64);
const RULE = "default:private-lane";
const NOW_MS = Date.parse("2026-11-20T21:30:00.000Z");
const DEFAULTS = composeDataClassRules({ installation: [] });
const PRIVATE = contentDataClassFactsFromFields({
  author: "U0FIXTURE",
  container: "slack/D0FIXTURE",
  kind: "message",
  source: "slack",
  visibility: "private",
});

/** One due content row from the private lane. */
const dueRow = ({ rowId = ROW_A }: { rowId?: string } = {}) => ({
  facts: PRIVATE,
  orderAtIso: "2026-11-20T10:00:00.000Z",
  requestSha256: DIGEST,
  rowId,
  ruleId: RULE,
  table: "content" as const,
});

/** A slice holding these due rows. */
const slice = ({
  due = [],
  moreDue = false,
}: {
  due?: readonly ReturnType<typeof dueRow>[];
  moreDue?: boolean;
} = {}): StoredRowAssessmentSlice => ({ assessedToday: 2, due, moreDue, remaining: 23 });

describe("parseStoreAssessmentDueArgs", () => {
  it("defaults to the read mode and the day's limit", () => {
    expect(unwrap(parseStoreAssessmentDueArgs({ rest: [] }))).toEqual({
      check: false,
      home: undefined,
      json: false,
      limit: 25,
      nowMs: undefined,
      withCalls: false,
    });
  });

  it("reads every flag", () => {
    const parsed = unwrap(
      parseStoreAssessmentDueArgs({
        rest: ["--check", "--with-calls", "--limit", "5", "--now", "2026-11-20T21:30:00Z", "--home", "/h", "--json"],
      }),
    );
    expect(parsed).toEqual({ check: true, home: "/h", json: true, limit: 5, nowMs: NOW_MS, withCalls: true });
  });

  it("refuses a limit outside 1 to the daily limit, so no argv widens the day, and a --now that is not an instant", () => {
    expect(unwrapErr(parseStoreAssessmentDueArgs({ rest: ["--limit", "0"] })).message).toContain(
      "--limit is a whole number from 1 to 25, not 0",
    );
    expect(unwrapErr(parseStoreAssessmentDueArgs({ rest: ["--limit", "26"] })).message).toContain(
      "--limit is a whole number from 1 to 25, not 26",
    );
    expect(unwrap(parseStoreAssessmentDueArgs({ rest: ["--limit", "25"] })).limit).toBe(25);
    expect(unwrapErr(parseStoreAssessmentDueArgs({ rest: ["--limit", "101"] })).code).toBe(
      "STORE_ASSESSMENT_ARGS_INVALID",
    );
    expect(unwrapErr(parseStoreAssessmentDueArgs({ rest: ["--now", "tonight"] })).message).toContain(
      "--now tonight is not an ISO instant",
    );
  });
});

describe("parseStoreAssessmentRecordArgs", () => {
  it("requires --verdicts-file", () => {
    expect(unwrapErr(parseStoreAssessmentRecordArgs({ rest: [] })).message).toBe(
      "--verdicts-file is required: a JSON file of one verdict per row",
    );
    expect(unwrap(parseStoreAssessmentRecordArgs({ rest: ["--verdicts-file", "v.json"] })).verdictsFile).toBe("v.json");
  });
});

describe("checkExit", () => {
  it("defers while the slice holds a due row, or a call is due, and is done otherwise", () => {
    expect(checkExit({ callsDue: null, slice: slice({ due: [dueRow()] }) })).toBe(EXIT_DEFERRED);
    expect(checkExit({ callsDue: 1, slice: slice() })).toBe(EXIT_DEFERRED);
    expect(checkExit({ callsDue: 0, slice: slice({ moreDue: true }) })).toBe(EXIT_OK);
    expect(checkExit({ callsDue: null, slice: slice() })).toBe(EXIT_OK);
  });
});

describe("dueRowLines", () => {
  it("prints the key, rule and digest, then the title and each body line verbatim", () => {
    expect(dueRowLines({ row: { ...dueRow(), body: "line one\nline two", title: "Subject" } })).toEqual([
      `row content/${ROW_A}  rule ${RULE}  request ${DIGEST}`,
      "  title: Subject",
      "  | line one",
      "  | line two",
    ]);
  });

  it("omits the title line for a row with none", () => {
    expect(dueRowLines({ row: { ...dueRow(), body: "x", title: null } }).length).toBe(2);
  });
});

/** The due verb's seams over one slice, recording what it printed and whether the reader closed. */
function dueSeams({ current, calls = 0 }: { current: StoredRowAssessmentSlice; calls?: number }) {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const events: string[] = [];
  const deps: StoreAssessmentDueDeps = {
    callsDue: () => ok(calls),
    loadRules: () => ok(DEFAULTS),
    nowMs: () => NOW_MS,
    openReader: async () =>
      ok({
        close: async () => {
          events.push("closed");
        },
        slice: async () => ok(current),
        texts: async ({ due }) => {
          events.push("texts");
          return ok(due.map((row) => ({ ...row, body: "the body", title: null })));
        },
      }),
    readRegister: () => ok([]),
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, events, out };
}

describe("runStoreAssessmentDue", () => {
  it("--check prints counts only, never reads a word, and defers on a due row", async () => {
    const seams = dueSeams({ current: slice({ due: [dueRow()], moreDue: true }) });
    expect(await runStoreAssessmentDue({ deps: seams.deps, rest: ["--check"] })).toBe(EXIT_DEFERRED);
    expect(seams.out).toEqual([
      "1 stored row(s) due in today's slice · 2 of 25 assessed today · more rows due beyond today's slice, read on a later day",
    ]);
    expect(seams.events).toEqual(["closed"]);
  });

  it("--check --with-calls counts the calls too and defers on one", async () => {
    const seams = dueSeams({ calls: 3, current: slice() });
    expect(await runStoreAssessmentDue({ deps: seams.deps, rest: ["--check", "--with-calls", "--json"] })).toBe(
      EXIT_DEFERRED,
    );
    expect(JSON.parse(seams.out[0]!)).toEqual({ assessedToday: 2, callsDue: 3, due: 0, limit: 25, moreDue: false });
  });

  it("the read mode prints each row with its words, then the counts, and closes the reader", async () => {
    const seams = dueSeams({ current: slice({ due: [dueRow()] }) });
    expect(await runStoreAssessmentDue({ deps: seams.deps, rest: ["--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(seams.out[0]!)).toEqual({
      counts: { assessedToday: 2, due: 1, limit: 25, moreDue: false },
      due: [{ body: "the body", requestSha256: DIGEST, rowId: ROW_A, ruleId: RULE, table: "content", title: null }],
    });
    expect(seams.events).toEqual(["texts", "closed"]);
  });

  it("refuses a bad flag before touching anything", async () => {
    const seams = dueSeams({ current: slice() });
    expect(await runStoreAssessmentDue({ deps: seams.deps, rest: ["--limit", "x"] })).toBe(EXIT_USAGE);
    expect(seams.events).toEqual([]);
  });

  it("fails on an unreadable register rather than reading every row as due", async () => {
    const seams = dueSeams({ current: slice() });
    const deps: StoreAssessmentDueDeps = {
      ...seams.deps,
      readRegister: () => err(RecordedAssessmentErrors.unreadable({ detail: "line 1 is torn", path: "/r" })),
    };
    expect(await runStoreAssessmentDue({ deps, rest: ["--check"] })).toBe(EXIT_ERROR);
    expect(seams.diagnostics[0]).toContain("store assessment-due: the assessment register at /r could not be read");
    expect(seams.out).toEqual([]);
  });
});

describe("recordedLine", () => {
  it("names the row and its class, never the reason", () => {
    const verdict = {
      requestSha256: DIGEST,
      rowId: ROW_A,
      ruleId: RULE,
      table: "content" as const,
      verdict: { dataClass: "personal" as const, kind: "classified" as const, reason: "a family arrangement" },
    };
    expect(recordedLine({ verdict, written: true })).toBe(`recorded  content/${ROW_A}  personal`);
    expect(recordedLine({ verdict, written: false })).toBe(`already recorded  content/${ROW_A}  personal`);
  });
});

/** A verdicts file naming these rows, each `personal`. */
const verdictsText = ({ rows }: { rows: readonly string[] }): string =>
  JSON.stringify({
    verdicts: rows.map((rowId) => ({
      class: "personal",
      reason: "a family arrangement",
      requestSha256: DIGEST,
      rowId,
      ruleId: RULE,
      table: "content",
    })),
  });

/** The record verb's seams: the store holds these rows' digests, and the register is an array. */
function recordSeams({
  text,
  stored,
  conflictOn,
}: {
  text: string;
  stored: Readonly<Record<string, string>>;
  conflictOn?: string;
}) {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const register: RecordedStoredRowAssessment[] = [];
  let closed = false;
  // Which row the fake's lock holds, and which it held at each append: the append must land inside the lock.
  let lockedRow: string | undefined;
  const lockedAtRecord: (string | undefined)[] = [];
  const deps: StoreAssessmentRecordDeps = {
    loadRules: () => ok(DEFAULTS),
    nowMs: () => NOW_MS,
    openReader: async () =>
      ok({
        close: async () => {
          closed = true;
        },
        withCurrent: async ({ rowId, act }) => {
          const digest = stored[rowId];
          lockedRow = rowId;
          try {
            return act(digest === undefined ? undefined : { facts: PRIVATE, requestSha256: digest });
          } finally {
            lockedRow = undefined;
          }
        },
      }),
    readText: () => text,
    record: ({ assessment }) => {
      lockedAtRecord.push(lockedRow);
      if (assessment.subject.rowId === conflictOn) {
        return err(
          RecordedAssessmentErrors.storedRowConflict({
            requestSha256: assessment.requestSha256,
            rowId: assessment.subject.rowId,
            table: assessment.subject.table,
          }),
        );
      }
      register.push(assessment);
      return ok({ record: assessment, written: true });
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { closed: () => closed, deps, diagnostics, lockedAtRecord, out, register };
}

describe("runStoreAssessmentRecord", () => {
  it("records each verdict whose row still holds the words, stamped with the clock", async () => {
    const seams = recordSeams({ stored: { [ROW_A]: DIGEST }, text: verdictsText({ rows: [ROW_A] }) });
    expect(await runStoreAssessmentRecord({ deps: seams.deps, rest: ["--verdicts-file", "v.json"] })).toBe(EXIT_OK);
    expect(seams.register).toEqual([
      {
        recordedAtIso: "2026-11-20T21:30:00.000Z",
        requestSha256: DIGEST,
        ruleId: RULE,
        subject: { kind: "stored-row", rowId: ROW_A, table: "content" },
        verdict: { dataClass: "personal", kind: "classified", reason: "a family arrangement" },
        version: 2,
      },
    ]);
    expect(seams.out).toEqual([`recorded  content/${ROW_A}  personal`, "1 row verdict(s) recorded · 0 refused"]);
    expect(seams.closed()).toBe(true);
  });

  it("appends each verdict while the lock on that very row still holds", async () => {
    const seams = recordSeams({
      stored: { [ROW_A]: DIGEST, [ROW_B]: DIGEST },
      text: verdictsText({ rows: [ROW_A, ROW_B] }),
    });
    expect(await runStoreAssessmentRecord({ deps: seams.deps, rest: ["--verdicts-file", "v.json"] })).toBe(EXIT_OK);
    expect(seams.lockedAtRecord).toEqual([ROW_A, ROW_B]);
  });

  it("refuses a row whose words moved and one the store no longer holds, still recording the rest", async () => {
    const seams = recordSeams({
      stored: { [ROW_A]: DIGEST, [ROW_B]: "b".repeat(64) },
      text: verdictsText({ rows: [ROW_A, ROW_B, "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f"] }),
    });
    expect(await runStoreAssessmentRecord({ deps: seams.deps, rest: ["--verdicts-file", "v.json"] })).toBe(EXIT_ERROR);
    expect(seams.register.map((record) => record.subject.rowId)).toEqual([ROW_A]);
    expect(seams.out.at(-1)).toBe("1 row verdict(s) recorded · 2 refused");
    expect(seams.out[1]).toContain(`refused  content/${ROW_B}: its words changed since they were read`);
    expect(seams.out[2]).toContain("the store no longer holds this row");
  });

  it("reports a conflicting earlier verdict as refused, never overwriting it", async () => {
    const seams = recordSeams({
      conflictOn: ROW_A,
      stored: { [ROW_A]: DIGEST },
      text: verdictsText({ rows: [ROW_A] }),
    });
    expect(await runStoreAssessmentRecord({ deps: seams.deps, rest: ["--verdicts-file", "v.json"] })).toBe(EXIT_ERROR);
    expect(seams.out[0]).toBe(
      `refused  content/${ROW_A} already has a different verdict recorded for these exact words ` +
        `(${DIGEST.slice(0, 12)}), so nothing was written: one answer per set of words`,
    );
  });

  it("refuses a malformed verdicts file as usage, opening no store", async () => {
    const seams = recordSeams({ stored: {}, text: "{" });
    expect(await runStoreAssessmentRecord({ deps: seams.deps, rest: ["--verdicts-file", "v.json"] })).toBe(EXIT_USAGE);
    expect(seams.diagnostics[0]).toContain("the verdicts file is not JSON");
    expect(seams.closed()).toBe(false);
  });
});
