/**
 * What the backfill decides, over hand-built state, and what it does when the world moves under it.
 *
 * The property under test on every case is that it writes ONLY what the audit calls unrepresented and the
 * append seam accepts, and that one row's trouble costs that row's entries and no others.
 */
import { describe, expect, it } from "vitest";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RulingEvent, RunEvent } from "../../../handover/ledger.js";
import type { RowEventWritten } from "../../../handover/rowEvent.js";
import { type RowWriteError, RowWriteErrors } from "../../../handover/rowEventErrors.js";
import type { RulingAuditInput, RulingAuditInputRow } from "../../../handover/rulingAuditTypes.js";
import {
  applyRulingBackfill,
  backfilledRulingEvent,
  planRulingBackfill,
  reportRulingBackfillPlan,
  rulingBackfillExitCode,
} from "../../../handover/rulingBackfill.js";
import type { RulingBackfillDeps } from "../../../handover/rulingBackfillTypes.js";
import type { RulingManifestEntry } from "../../../handover/rulingManifest.js";
import { err, ok, type Result } from "../../../lib/result.js";

const SOURCE = "2026-09-04T12:38:57.414Z";
const OTHER_SOURCE = "2026-09-05T08:10:00.000Z";
const TODAY = "2026-09-13T02:00:00.000Z";
const WORDS = "OWNER RULED: ship it";
const ANCHOR = "https://example.invalid/p9";

/** A plain row document. */
function doc({ slug = "a-row", path = `/board/${slug}.md` }: { slug?: string; path?: string } = {}): HandoverDoc {
  return parseHandoverDoc({
    path: path,
    text: ["---", `slug: ${slug}`, "summary: a row", "---", ""].join("\n"),
  });
}

/** The answer a manifest entry names. */
function answered({ at = SOURCE, answer = WORDS }: { at?: string; answer?: string } = {}): RunEvent {
  return { answer, atIso: at, kind: "answered" };
}

/** One acquired row. */
function row({
  slug = "a-row",
  docs = [doc({ slug })],
  events = [answered()],
  unreadableLines = [],
}: {
  slug?: string;
  docs?: readonly HandoverDoc[];
  events?: readonly RunEvent[];
  unreadableLines?: readonly number[];
} = {}): RulingAuditInputRow {
  return {
    docs: docs.map((each) => ({ doc: each, location: "active", path: each.path })),
    journal: { events, kind: "read", unreadableLines },
    journalPath: `/runs/${slug}.jsonl`,
    slug,
  };
}

const ENTRY: RulingManifestEntry = { anchor: ANCHOR, slug: "a-row", sourceAtIso: SOURCE, words: WORDS };

/** The whole acquired state. */
function input({
  rows = [row()],
  entries = [ENTRY],
  problems = [],
}: {
  rows?: readonly RulingAuditInputRow[];
  entries?: readonly RulingManifestEntry[];
  problems?: RulingAuditInput["problems"];
} = {}): RulingAuditInput {
  return {
    handoverDir: "/board",
    manifest: { entries, schemaVersion: 1 },
    manifestPath: "/m.json",
    problems,
    rows,
    runsDir: "/runs",
  };
}

/** A recording seam that appends into the state it is given, the way the real one does. */
function seam({ states, failures = [] }: { states: RulingAuditInput[]; failures?: readonly RowWriteError[] }): {
  deps: RulingBackfillDeps;
  appended: RulingEvent[];
} {
  const appended: RulingEvent[] = [];
  let instant = 0;
  const deps: RulingBackfillDeps = {
    append: ({ event, slug }): Result<RowEventWritten, RowWriteError> => {
      const failure = failures[appended.length];
      appended.push(event);
      if (failure !== undefined) {
        return err(failure);
      }
      const current = states.at(-1)!;
      const updated = current.rows.map((each) =>
        each.slug === slug && each.journal.kind === "read"
          ? { ...each, journal: { ...each.journal, events: [...each.journal.events, event] } }
          : each,
      );
      states.push({ ...current, rows: updated });
      return ok({
        path: `/runs/${slug}.jsonl`,
        skipped: { unknownKind: [], unreadable: [] },
        state: {
          branch: undefined,
          docHash: undefined,
          entries: 0,
          lastIso: undefined,
          openQuestion: undefined,
          openQuestionPost: undefined,
          phase: "open",
        },
      });
    },
    readCurrentInput: (): RulingAuditInput => states.at(-1)!,
    recordingInstant: (): string => {
      instant += 1;
      return `2026-09-13T03:00:0${String(instant)}.000Z`;
    },
  };
  return { appended, deps };
}

describe("backfilledRulingEvent", () => {
  it("decides the event at the answer's instant and records it now", () => {
    expect(backfilledRulingEvent({ entry: ENTRY, recordedAtIso: TODAY })).toEqual({
      anchor: ANCHOR,
      atIso: TODAY,
      backfilledFrom: SOURCE,
      decidedIso: SOURCE,
      kind: "ruling",
      ruling: WORDS,
    });
  });
});

describe("planRulingBackfill", () => {
  it("plans an append for a reviewed answer nothing represents", () => {
    const plan = planRulingBackfill({ input: input() });
    expect(plan.entries).toEqual([{ entry: ENTRY, entryIndex: 0, status: "append" }]);
  });

  it("reads an entry already reconstructed as already-recorded, and plans no write", () => {
    const already = backfilledRulingEvent({ entry: ENTRY, recordedAtIso: TODAY });
    const plan = planRulingBackfill({ input: input({ rows: [row({ events: [answered(), already] })] }) });
    expect(plan.entries[0]).toEqual({
      entry: ENTRY,
      entryIndex: 0,
      placement: "effective",
      recordedAtIso: TODAY,
      status: "already-recorded",
    });
  });

  it("refuses an entry whose row the audit could not read, naming the audit's own code", () => {
    const plan = planRulingBackfill({ input: input({ rows: [row({ unreadableLines: [2] })] }) });
    expect(plan.entries[0]).toEqual({
      codes: ["JOURNAL_LINE_UNREADABLE"],
      entry: ENTRY,
      entryIndex: 0,
      failure: null,
      status: "refused",
    });
  });

  it("refuses an entry the append seam would call a duplicate of a live ruling already there", () => {
    const collision: RulingEvent = { anchor: ANCHOR, atIso: SOURCE, decidedIso: SOURCE, kind: "ruling", ruling: WORDS };
    const plan = planRulingBackfill({ input: input({ rows: [row({ events: [answered(), collision] })] }) });
    const entry = plan.entries[0]!;
    expect(entry.status).toBe("refused");
    expect(entry).toMatchObject({
      failure: { cause: { code: "RULING_ALREADY_RECORDED" }, code: "APPEND_INTEGRITY_FAILED" },
    });
  });

  it("keeps one row's trouble off another row's entry", () => {
    const second: RulingManifestEntry = { anchor: "p2", slug: "other-row", sourceAtIso: OTHER_SOURCE, words: "wait" };
    const plan = planRulingBackfill({
      input: input({
        entries: [ENTRY, second],
        rows: [
          row({ unreadableLines: [4] }),
          row({ events: [answered({ answer: "wait", at: OTHER_SOURCE })], slug: "other-row" }),
        ],
      }),
    });
    expect(plan.entries.map((entry) => entry.status)).toEqual(["refused", "append"]);
  });

  it("refuses EVERY entry while a document somewhere could not be read", () => {
    const unreadable = { code: "DOC_UNREADABLE" as const, message: "x", path: "/board/x.md", slug: null };
    const plan = planRulingBackfill({ input: input({ problems: [unreadable] }) });
    expect(plan.entries[0]).toMatchObject({ codes: ["DOC_UNREADABLE"], status: "refused" });
  });
});

describe("reportRulingBackfillPlan", () => {
  it("is complete and exits 0 when every entry is plannable, having written nothing", () => {
    const report = reportRulingBackfillPlan({ input: input() });
    expect(report.mode).toBe("plan");
    expect(report.complete).toBe(true);
    expect(report.counts).toEqual({
      alreadyRecorded: 0,
      append: 1,
      appended: 0,
      failed: 0,
      manifestEntries: 1,
      refused: 0,
    });
    expect(rulingBackfillExitCode({ report })).toBe(0);
  });

  it("is incomplete when the audit found a problem, even one no entry stands on", () => {
    const problem = { code: "UNSAFE_JOURNAL_NAME" as const, message: "x", path: "/runs/-x.jsonl", slug: null };
    const report = reportRulingBackfillPlan({ input: input({ problems: [problem] }) });
    expect(report.complete).toBe(false);
    expect(rulingBackfillExitCode({ report })).toBe(1);
  });
});

describe("applyRulingBackfill", () => {
  it("appends exactly the reviewed reconstruction, once", () => {
    const states = [input()];
    const { appended, deps } = seam({ states });

    const report = applyRulingBackfill({ deps, input: states[0]! });

    expect(appended).toEqual([backfilledRulingEvent({ entry: ENTRY, recordedAtIso: "2026-09-13T03:00:01.000Z" })]);
    expect(report.counts.appended).toBe(1);
    expect(report.entries[0]).toEqual({
      entry: ENTRY,
      entryIndex: 0,
      journalPath: "/runs/a-row.jsonl",
      recordedAtIso: "2026-09-13T03:00:01.000Z",
      status: "appended",
    });
  });

  it("writes nothing on a second run over the same manifest", () => {
    const states = [input()];
    const { appended, deps } = seam({ states });
    applyRulingBackfill({ deps, input: states[0]! });

    const again = applyRulingBackfill({ deps, input: states.at(-1)! });

    expect(appended.length).toBe(1);
    expect(again.counts).toMatchObject({ alreadyRecorded: 1, appended: 0 });
  });

  it("records a failed append as FAILED, says nothing about what landed, and keeps going", () => {
    const second: RulingManifestEntry = { anchor: "p2", slug: "other-row", sourceAtIso: OTHER_SOURCE, words: "wait" };
    const states = [
      input({
        entries: [ENTRY, second],
        rows: [row(), row({ events: [answered({ answer: "wait", at: OTHER_SOURCE })], slug: "other-row" })],
      }),
    ];
    const failure = RowWriteErrors.journalIo({
      cause: { kind: "io", message: "disk said no", operation: "handover.appendRunEvent", path: "/runs/a-row.jsonl" },
    });
    const { deps } = seam({ failures: [failure], states });

    const report = applyRulingBackfill({ deps, input: states[0]! });

    expect(report.entries.map((entry) => entry.status)).toEqual(["failed", "appended"]);
    expect(report.entries[0]).toMatchObject({ failure: { cause: failure, code: "APPEND_FAILED" } });
    expect(rulingBackfillExitCode({ report })).toBe(1);
  });

  /**
   * The re-read before each append is what makes a concurrent writer visible rather than overwritten: the
   * state the seam returns for the second entry already carries a reconstruction nobody planned for.
   */
  it("sees a ruling appended between the plan and the write, and records nothing over it", () => {
    const second: RulingManifestEntry = { anchor: "p2", slug: "other-row", sourceAtIso: OTHER_SOURCE, words: "wait" };
    const otherRow = row({ events: [answered({ answer: "wait", at: OTHER_SOURCE })], slug: "other-row" });
    const first = input({ entries: [ENTRY, second], rows: [row(), otherRow] });
    const states = [first];
    const { appended, deps } = seam({ states });
    // Someone else records the SECOND entry's ruling while the first is being written.
    const interloper = backfilledRulingEvent({ entry: second, recordedAtIso: TODAY });
    const withInterloper: RulingAuditInput = {
      ...first,
      rows: [
        first.rows[0]!,
        {
          ...otherRow,
          journal: {
            events: [...(otherRow.journal.kind === "read" ? otherRow.journal.events : []), interloper],
            kind: "read",
            unreadableLines: [],
          },
        },
      ],
    };
    states.push(withInterloper);

    const report = applyRulingBackfill({ deps, input: first });

    expect(report.entries.map((entry) => entry.status)).toEqual(["appended", "already-recorded"]);
    expect(appended.map((event) => event.backfilledFrom)).toEqual([SOURCE]);
  });
});
