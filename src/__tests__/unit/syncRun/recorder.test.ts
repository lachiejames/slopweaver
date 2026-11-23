import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeCorpusRecords } from "../../../corpus/corpusWriter.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import type { SyncRunEvent } from "../../../syncRun/event.js";
import { withSyncRunObserver } from "../../../syncRun/observerScope.js";
import { createSyncRunRecorder, type SyncRunAppend } from "../../../syncRun/recorder.js";

const window = { since: "2026-10-01", until: "2026-10-04" };

const rec = (over: Partial<CorpusRecord> = {}): CorpusRecord => ({
  attrs: { channel: "#incidents" },
  container: "slack/C1",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "C1:1",
  text: "hi",
  tsIso: "2026-10-02T00:00:00Z",
  url: "u",
  ...over,
});

/** A recorder over an in-memory appender, with a clock the test advances. */
function harness({ failAppends = false }: { failAppends?: boolean } = {}): {
  rows: { source: string; event: SyncRunEvent }[];
  warnings: string[];
  clock: { ms: number };
  recorder: ReturnType<typeof createSyncRunRecorder>;
} {
  const rows: { source: string; event: SyncRunEvent }[] = [];
  const warnings: string[] = [];
  const clock = { ms: Date.parse("2026-10-03T00:00:00.000Z") };
  const append: SyncRunAppend = ({ source, event }) => {
    if (failAppends && event.type !== "started") {
      return err(["disk full"]);
    }
    rows.push({ event, source });
    return ok(undefined);
  };
  const recorder = createSyncRunRecorder({
    append,
    jobs: [
      { source: "slack", window },
      { source: "slack", window: { since: "1999-01-01", until: "1999-01-02" } },
      { source: "linear", window },
    ],
    nowIso: () => new Date(clock.ms).toISOString(),
    pid: 4242,
    runId: "abcd1234",
    warn: ({ msg }) => warnings.push(msg),
  });
  return { clock, recorder, rows, warnings };
}

describe("createSyncRunRecorder", () => {
  it("writes one started row per planned source, keeping the first window of a source planned twice", () => {
    const { rows } = harness();

    expect(rows.map((row) => [row.source, row.event.type])).toEqual([
      ["slack", "started"],
      ["linear", "started"],
    ]);
    expect(rows[0]!.event).toEqual({
      atIso: "2026-10-03T00:00:00.000Z",
      pid: 4242,
      runId: "abcd1234",
      since: "2026-10-01",
      source: "slack",
      type: "started",
      until: "2026-10-04",
      v: 1,
    });
  });

  it("counts a record re-offered to a later commit once, so a closing write cannot double what a container held", () => {
    const { recorder, rows } = harness();
    const first = rec({ sourceId: "C1:1" });
    const second = rec({ sourceId: "C1:2" });

    recorder.observer.commit({ offered: [first, second], written: [first, second] });
    recorder.observer.commit({ offered: [first, second], written: [] });

    const committed = rows.filter((row) => row.event.type === "committed").map((row) => row.event);
    expect(committed).toEqual([
      {
        atIso: "2026-10-03T00:00:00.000Z",
        container: "slack/C1",
        kinds: { message: { offered: 2, written: 2 } },
        label: "#incidents",
        runId: "abcd1234",
        type: "committed",
        v: 1,
      },
    ]);
  });

  it("writes a heartbeat on a phase change or after five seconds, and drops one in between", () => {
    const { recorder, rows, clock } = harness();
    const beat = ({ phase, done }: { phase: string; done: number }): void => {
      recorder.observer.progress({ event: { done, lane: "heartbeat", phase, source: "slack", total: 9 } });
    };

    beat({ done: 1, phase: "channel" });
    clock.ms += 1000;
    beat({ done: 2, phase: "channel" });
    clock.ms += 1000;
    beat({ done: 1, phase: "thread" });
    clock.ms += 5000;
    beat({ done: 4, phase: "thread" });

    const progress = rows.filter((row) => row.event.type === "progress").map((row) => row.event);
    expect(progress.map((event) => (event.type === "progress" ? `${event.phase}:${String(event.done)}` : ""))).toEqual([
      "channel:1",
      "thread:1",
      "thread:4",
    ]);
  });

  it("ignores a content preview, which carries message text the ledger has no reason to hold", () => {
    const { recorder, rows } = harness();

    recorder.observer.progress({ event: { lane: "content_preview", phase: "channel", source: "slack" } });

    expect(rows.filter((row) => row.event.type === "progress")).toEqual([]);
  });

  it("closes a source the run reported nothing for as a failure that says so", () => {
    const { recorder, rows } = harness();

    recorder.finish({
      outcomes: [{ deduped: 1, errors: [], excluded: 0, gaps: 0, ok: true, source: "slack", warnings: 0, written: 3 }],
    });

    const finished = rows.filter((row) => row.event.type === "finished");
    expect(finished.map((row) => [row.source, row.event.type === "finished" ? row.event.ok : null])).toEqual([
      ["slack", true],
      ["linear", false],
    ]);
    expect(finished[1]!.event).toMatchObject({ errors: ["the refresh ended without a result for this source"] });
  });

  it("counts a failed ledger write and narrates it, never throwing into the sync", () => {
    const { recorder, warnings } = harness({ failAppends: true });

    recorder.observer.commit({ offered: [rec()], written: [rec()] });

    expect(warnings).toEqual(["sync-run ledger: disk full"]);
  });
});

describe("the observer scope reaches the bronze committer", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-syncrun-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reports each commit's offered and appended records to the run's observer", () => {
    const seen: { offered: number; written: number }[] = [];
    const observer = {
      commit: ({ offered, written }: { offered: readonly CorpusRecord[]; written: readonly CorpusRecord[] }) => {
        seen.push({ offered: offered.length, written: written.length });
      },
      progress: () => {},
    };

    withSyncRunObserver({
      body: () => {
        unwrap(writeCorpusRecords({ home, records: [rec(), rec({ sourceId: "C1:2" })], window }));
        unwrap(writeCorpusRecords({ home, records: [rec()], window }));
      },
      observer,
    });
    unwrap(writeCorpusRecords({ home, records: [rec({ sourceId: "C1:3" })], window }));

    expect(seen).toEqual([
      { offered: 2, written: 2 },
      { offered: 1, written: 0 },
    ]);
  });
});
