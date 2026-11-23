import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseSyncRunEvent, type SyncRunEvent, syncRunEventLine } from "../../../syncRun/event.js";
import { foldSyncRun } from "../../../syncRun/fold.js";
import { appendSyncRunEvent, readRecentSyncRuns, syncRunDir, syncRunFileName } from "../../../syncRun/store.js";
import { tallyCommit } from "../../../syncRun/tally.js";

const started: SyncRunEvent = {
  atIso: "2026-10-03T00:00:00.000Z",
  pid: 77,
  runId: "r1",
  since: "2026-10-01",
  source: "slack",
  type: "started",
  until: "2026-10-04",
  v: 1,
};

const committed = ({
  container,
  label,
  written,
  offered,
  atIso,
}: {
  container: string;
  label: string;
  written: number;
  offered: number;
  atIso: string;
}): SyncRunEvent => ({
  atIso,
  container,
  kinds: { message: { offered, written } },
  label,
  runId: "r1",
  type: "committed",
  v: 1,
});

const progress = ({ atIso, done }: { atIso: string; done: number }): SyncRunEvent => ({
  atIso,
  done,
  item: "#general",
  metrics: {},
  phase: "channel",
  runId: "r1",
  total: 40,
  type: "progress",
  v: 1,
});

const finished = ({ ok, errors }: { ok: boolean; errors: string[] }): SyncRunEvent => ({
  atIso: "2026-10-03T00:10:00.000Z",
  deduped: 5,
  errors,
  excluded: 0,
  gaps: 0,
  ledgerFailures: 0,
  ok,
  runId: "r1",
  type: "finished",
  v: 1,
  warnings: 0,
  written: 120,
});

const fold = ({
  events,
  holds,
  nowIso = "2026-10-03T00:05:00.000Z",
}: {
  events: SyncRunEvent[];
  holds: boolean;
  nowIso?: string;
}) => foldSyncRun({ events, holdsSlot: () => holds, malformedLines: 0, nowIso, runId: "r1", source: "slack" });

describe("parseSyncRunEvent", () => {
  it("round-trips every row shape through its own line", () => {
    const rows = [
      started,
      progress({ atIso: "2026-10-03T00:01:00.000Z", done: 3 }),
      committed({ atIso: "2026-10-03T00:01:00.000Z", container: "slack/C1", label: "#a", offered: 4, written: 2 }),
      finished({ errors: ["x"], ok: false }),
    ];

    expect(rows.map((event) => parseSyncRunEvent({ line: syncRunEventLine({ event }) }))).toEqual(rows);
  });

  it("drops a line of another version, a negative count, or a half-written tail", () => {
    const negative = syncRunEventLine({
      event: committed({ atIso: "t", container: "c", label: "l", offered: 1, written: 1 }),
    }).replace('"written":1', '"written":-1');

    expect(parseSyncRunEvent({ line: '{"v":2,"type":"started"}' })).toBe(undefined);
    expect(parseSyncRunEvent({ line: negative })).toBe(undefined);
    expect(parseSyncRunEvent({ line: '{"v":1,"type":"fin' })).toBe(undefined);
  });
});

describe("tallyCommit", () => {
  it("counts offered and written per container and kind, labelled by the channel a record carries", () => {
    const base = { kind: "message" as const, refs: [], source: "slack" as const, text: "", tsIso: "t", url: "u" };
    const a1 = { ...base, attrs: { channel: "#a" }, container: "slack/A", sourceId: "1" };
    const a2 = { ...base, attrs: { channel: "#a" }, container: "slack/A", kind: "comment" as const, sourceId: "2" };
    const b1 = { ...base, container: "slack/B", sourceId: "3" };

    expect(tallyCommit({ offered: [a1, a2, b1], written: [a2] })).toEqual([
      {
        container: "slack/A",
        kinds: { comment: { offered: 1, written: 1 }, message: { offered: 1, written: 0 } },
        label: "#a",
        source: "slack",
      },
      { container: "slack/B", kinds: { message: { offered: 1, written: 0 } }, label: "slack/B", source: "slack" },
    ]);
  });
});

describe("foldSyncRun", () => {
  const rows = [
    started,
    progress({ atIso: "2026-10-03T00:01:00.000Z", done: 10 }),
    committed({ atIso: "2026-10-03T00:01:30.000Z", container: "slack/A", label: "#a", offered: 50, written: 20 }),
    committed({ atIso: "2026-10-03T00:02:00.000Z", container: "slack/B", label: "#b", offered: 9, written: 0 }),
    committed({ atIso: "2026-10-03T00:02:30.000Z", container: "slack/C", label: "#c", offered: 90, written: 80 }),
    progress({ atIso: "2026-10-03T00:03:00.000Z", done: 22 }),
  ];

  it("reads a run whose process still holds the slot as running, with its measured rate and per-container yield", () => {
    const view = fold({ events: rows, holds: true });

    expect(view.state).toBe("running");
    expect(view.containers.map((container) => [container.label, container.written])).toEqual([
      ["#c", 80],
      ["#a", 20],
    ]);
    expect(view.quietContainers.map((container) => container.label)).toEqual(["#b"]);
    expect(view.newByKind).toEqual({ message: 100 });
    expect(view.progressRate).toEqual({ amount: 12, overMs: 120_000, unit: "channel" });
    expect(view.quietForMs).toBe(120_000);
    expect(view.stalled).toBe(true);
  });

  it("dates its newest rows by the last commit that wrote any, never a later quiet commit, progress or finish", () => {
    const finishedRun = fold({ events: [...rows, finished({ errors: [], ok: true })], holds: false });
    const nothingWritten = fold({ events: [started, rows[3]!], holds: false });

    expect([finishedRun.lastCommittedIso, finishedRun.lastActivityIso, nothingWritten.lastCommittedIso]).toEqual([
      "2026-10-03T00:02:30.000Z",
      "2026-10-03T00:10:00.000Z",
      null,
    ]);
  });

  it("reads a run with no finish whose slot is gone as ended unfinished, naming its last row", () => {
    const view = fold({ events: rows, holds: false });

    expect(view.state).toBe("ended-unfinished");
    expect(view.why).toContain("after its last row at 2026-10-03T00:03:00.000Z");
    expect(view.quietForMs).toBe(null);
  });

  it("reads a finish row over the slot, and leads a failure with its first error", () => {
    expect(fold({ events: [...rows, finished({ errors: [], ok: true })], holds: true }).state).toBe("finished");
    const failed = fold({ events: [...rows, finished({ errors: ["rate limited"], ok: false })], holds: false });
    expect(failed.state).toBe("failed");
    expect(failed.why).toBe("finished at 2026-10-03T00:10:00.000Z and failed: rate limited");
    expect(failed.elapsedMs).toBe(600_000);
  });

  it("says a failure that carried no error line did, rather than naming no reason", () => {
    const failed = fold({ events: [...rows, finished({ errors: [], ok: false })], holds: false });
    expect(failed.why).toBe(
      "finished at 2026-10-03T00:10:00.000Z and failed: it reported failure without an error line",
    );
  });

  it("reads a file with no start row as unreadable rather than as an empty run", () => {
    expect(fold({ events: rows.slice(1), holds: true }).state).toBe("unreadable");
  });
});

describe("the sync-run store", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-syncstore-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads no runs, not an error, for a source never synced", () => {
    expect(unwrap(readRecentSyncRuns({ home, limit: 3, source: "slack" }))).toEqual([]);
  });

  it("reads the newest runs first and counts a torn last line rather than dropping the run", () => {
    const older = syncRunFileName({ runId: "old", startedAtIso: "2026-10-01T00:00:00.000Z" });
    const newer = syncRunFileName({ runId: "new", startedAtIso: "2026-10-02T00:00:00.000Z" });
    unwrap(appendSyncRunEvent({ event: { ...started, runId: "old" }, fileName: older, home, source: "slack" }));
    unwrap(appendSyncRunEvent({ event: { ...started, runId: "new" }, fileName: newer, home, source: "slack" }));
    writeFileSync(join(syncRunDir({ home, source: "slack" }), newer), '{"v":1,"type":"fin\n', { flag: "a" });

    const runs = unwrap(readRecentSyncRuns({ home, limit: 1, source: "slack" }));

    expect(runs.map((run) => [run.runId, run.events.length, run.malformedLines])).toEqual([["new", 1, 1]]);
  });

  it("counts a row holding a byte that is not UTF-8 as malformed, never as its repaired text", () => {
    const fileName = syncRunFileName({ runId: "new", startedAtIso: "2026-10-02T00:00:00.000Z" });
    unwrap(appendSyncRunEvent({ event: { ...started, runId: "new" }, fileName, home, source: "slack" }));
    const [before, after] = syncRunEventLine({ event: { ...started, runId: "neMARKw" } }).split("MARK");
    writeFileSync(
      join(syncRunDir({ home, source: "slack" }), fileName),
      Buffer.concat([Buffer.from(before!), Buffer.from([0xff]), Buffer.from(`${after!}\n`)]),
      { flag: "a" },
    );

    const runs = unwrap(readRecentSyncRuns({ home, limit: 1, source: "slack" }));

    expect(runs.map((run) => [run.runId, run.events.length, run.malformedLines])).toEqual([["new", 1, 1]]);
  });

  it("reports a ledger directory that is a file as an error, not as no runs", () => {
    mkdirSync(join(home, "live"), { recursive: true });
    writeFileSync(join(home, "live", "sync-runs"), "");

    const error = unwrapErr(readRecentSyncRuns({ home, limit: 1, source: "slack" }));

    expect(error[0]).toContain("could not list the sync-run ledger");
  });
});
