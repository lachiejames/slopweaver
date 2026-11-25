/**
 * `session watch --json-report --record-reading`: the document prints first, the same text is appended second at the
 * document's own instant, and a refused append exits non-zero without hiding the printed report; a drain that lost
 * the fold's compare-and-set prints and records nothing. Driven over plain array seams and the in-memory store port.
 */
import { describe, expect, it } from "vitest";

import { foldAndCommit } from "../../../../../cli/commands/session/watch.js";
import {
  commitThenReport,
  emitWatchReportDocument,
  recordReadingRefusal,
  type WatchReportSinks,
} from "../../../../../cli/commands/session/watchReadingRecord.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { SessionWatchState } from "../../../../../cmux/eventState/port.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { type ReadingsError, ReadingsErrors } from "../../../../../readings/errors.js";
import type { PrintedReadingAppend } from "../../../../../readings/printedReading.js";
import type { ReadingReceipt } from "../../../../../readings/types.js";
import { memoryCmuxEventStatePort, memoryCmuxEventStateStore } from "../../../../cmuxEventStateFixture.js";

/** A report document as `sessionWatchReportDocument` shapes one, judged five seconds before the append. */
const DOCUMENT = {
  diagnostics: [],
  observedAtIso: "2026-11-20T08:00:00.000Z",
  rows: [],
  suppressed: 0,
  suppressedOldestQuietMinutes: null,
};

/** The document's text, as stdout and the ledger both carry it. */
const TEXT =
  '{"diagnostics":[],"observedAtIso":"2026-11-20T08:00:00.000Z","rows":[],"suppressed":0,"suppressedOldestQuietMinutes":null}';

/** Sinks that record every line and append; `refuse` makes the ledger refuse. */
function sinksOf({ refuse }: { refuse?: ReadingsError } = {}): {
  sinks: WatchReportSinks;
  out: string[];
  diagnostics: string[];
  appends: PrintedReadingAppend[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const appends: PrintedReadingAppend[] = [];
  const sinks: WatchReportSinks = {
    recordReading: (append): Result<ReadingReceipt, ReadingsError> => {
      appends.push(append);
      if (refuse !== undefined) {
        return err(refuse);
      }
      return ok({
        documentPath: "/h/readings/session-watch/doc.json",
        indexPath: "/h/readings/index.jsonl",
        record: {
          by: append.by,
          bytes: append.document.length,
          file: "session-watch/doc.json",
          observedAtIso: append.observedAtIso,
          producer: append.producer,
          readingId: `${append.nowIso}-session-watch`,
          recordedAtIso: append.nowIso,
        },
      });
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { appends, diagnostics, out, sinks };
}

describe("emitWatchReportDocument", () => {
  it("prints the document and appends nothing when no --record-reading was given", () => {
    const fake = sinksOf();
    expect(
      emitWatchReportDocument({
        by: undefined,
        document: DOCUMENT,
        home: "/h",
        recordedAtIso: "2026-11-20T08:00:05.000Z",
        sinks: fake.sinks,
      }),
    ).toBe(EXIT_OK);
    expect([fake.out, fake.appends, fake.diagnostics]).toEqual([[TEXT], [], []]);
  });

  it("appends exactly the printed text under `session watch`, observed at the document's own instant", () => {
    const fake = sinksOf();
    expect(
      emitWatchReportDocument({
        by: "sync-now",
        document: DOCUMENT,
        home: "/h",
        recordedAtIso: "2026-11-20T08:00:05.000Z",
        sinks: fake.sinks,
      }),
    ).toBe(EXIT_OK);
    expect([fake.out, fake.appends]).toEqual([
      [TEXT],
      [
        {
          by: "sync-now",
          document: TEXT,
          home: "/h",
          nowIso: "2026-11-20T08:00:05.000Z",
          observedAtIso: "2026-11-20T08:00:00.000Z",
          producer: "session watch",
        },
      ],
    ]);
  });

  it("keeps the printed document and exits non-zero naming the refusal when the ledger will not take it", () => {
    const fake = sinksOf({ refuse: ReadingsErrors.ledgerBusy({ why: "a fixture holds the lock" }) });
    expect(
      emitWatchReportDocument({
        by: "sync-now",
        document: DOCUMENT,
        home: "/h",
        recordedAtIso: "2026-11-20T08:00:05.000Z",
        sinks: fake.sinks,
      }),
    ).toBe(EXIT_ERROR);
    expect([fake.out, fake.diagnostics]).toEqual([
      [TEXT],
      [
        "session watch: the reading was not recorded — another session is writing the readings ledger right now (a fixture holds the lock) — nothing was written; try again",
      ],
    ]);
  });
});

describe("commitThenReport", () => {
  const home = "/nonexistent/home-never-read";
  const batch = { events: [], highestSeq: 120 };

  /** The `--json-report --record-reading sync-now` report over the committed state, through `sinks`. */
  function recordingReport({ sinks }: { sinks: WatchReportSinks }): (committed: SessionWatchState) => Promise<number> {
    return () =>
      Promise.resolve(
        emitWatchReportDocument({
          by: "sync-now",
          document: DOCUMENT,
          home,
          recordedAtIso: "2026-11-20T08:00:05.000Z",
          sinks,
        }),
      );
  }

  it("records nothing and prints nothing when another drain won the compare-and-set first", async () => {
    const store = memoryCmuxEventStateStore();
    // The rival drain's commit, already in: revision 2 at cursor 130.
    store.rows.set("session-watch", { activities: {}, cursorSeq: 130, revision: 2 });
    const fake = sinksOf();

    await expect(
      commitThenReport({
        commit: () =>
          foldAndCommit({
            batch,
            home,
            nowIso: "2026-11-20T08:00:00.000Z",
            port: memoryCmuxEventStatePort({ store }),
            state: { activities: {}, cursorSeq: 100, revision: 1 },
          }),
        report: recordingReport({ sinks: fake.sinks }),
      }),
    ).rejects.toThrow("another session-watch committed its state first (this one expected revision 1)");
    expect([fake.out, fake.appends, store.rows.get("session-watch")]).toEqual([
      [],
      [],
      { activities: {}, cursorSeq: 130, revision: 2 },
    ]);
  });

  it("reports and records once the drain's own commit landed", async () => {
    const store = memoryCmuxEventStateStore();
    const fake = sinksOf();

    const exit = await commitThenReport({
      commit: () =>
        foldAndCommit({
          batch,
          home,
          nowIso: "2026-11-20T08:00:00.000Z",
          port: memoryCmuxEventStatePort({ store }),
          state: { activities: {}, cursorSeq: 100, revision: null },
        }),
      report: recordingReport({ sinks: fake.sinks }),
    });

    expect([exit, fake.out, fake.appends.length, store.rows.get("session-watch")!.cursorSeq]).toEqual([
      EXIT_OK,
      [TEXT],
      1,
      120,
    ]);
  });
});

describe("recordReadingRefusal", () => {
  it("allows a plain --json-report drain, and no flag at all", () => {
    expect([
      recordReadingRefusal({ by: "sync-now", follow: false, jsonReport: true }),
      recordReadingRefusal({ by: undefined, follow: true, jsonReport: false }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses a recording with no --json-report document, and one beside --follow", () => {
    expect([
      recordReadingRefusal({ by: "sync-now", follow: false, jsonReport: false }),
      recordReadingRefusal({ by: "sync-now", follow: true, jsonReport: true }),
    ]).toEqual([
      "--record-reading records the --json-report document, so it needs --json-report",
      "--record-reading records one plain drain's document, so it cannot run with --follow",
    ]);
  });
});
