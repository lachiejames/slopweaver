/**
 * The dispatch register's round trip, over a real throwaway home — the one filesystem case `testing.md`
 * allows, because the property under test IS the file: a settlement is an APPEND of the same id, and the
 * reader folds by id with the last write winning, so a reader can never catch the register mid-rewrite.
 *
 * The fold into the capacity document's dispatch block is here too, because it reads the same file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { dispatchBlockFor } from "../../../../live/machine/dispatchBlock.js";
import type { DispatchRow } from "../../../../live/machine/dispatchRow.js";
import {
  appendDispatchRow,
  coveringDispatches,
  dispatchRegisterPath,
  liveDispatchSignatures,
  openDispatches,
  REGISTERED_LIVE_SECONDS,
  readDispatchRows,
  rowsForSignature,
} from "../../../../live/machine/dispatchStore.js";

const SIGNATURE = "hold+single-process|bfs|foreign";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dispatch-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One row, with only what a case varies overridden. */
function row(over: Partial<DispatchRow> = {}): DispatchRow {
  return {
    id: "d1",
    load1: 45.9,
    observedIso: "2026-09-19T09:00:00.000Z",
    seated: { kind: "seated", slug: "investigate-bfs", workspace: "workspace:9" },
    settled: undefined,
    signature: SIGNATURE,
    subject: { kill: "kill 4242", label: "bfs", sessionId: undefined, tree: [], why: "bfs at 301.2% cpu" },
    triggers: ["hold", "single-process"],
    ...over,
  };
}

describe("readDispatchRows", () => {
  it("reports an empty register for a fresh install, rather than a failure", () => {
    expect(unwrap(readDispatchRows({ home }))).toStrictEqual([]);
  });

  it("never lets a stale registered line replace the seat the spawn already reported", () => {
    const registered = row({
      seated: { kind: "registered", sinceIso: "2026-09-19T09:00:05.000Z", slug: "investigate-bfs" },
    });
    const settlement = {
      atIso: "2026-09-19T09:02:00.000Z",
      witness: "settled off a read taken before the spawn reported",
    };
    appendDispatchRow({ home, row: registered });
    appendDispatchRow({ home, row: row() });
    appendDispatchRow({ home, row: { ...registered, settled: settlement } });

    expect(unwrap(readDispatchRows({ home }))).toStrictEqual([{ ...row(), settled: settlement }]);
  });

  it("never lets a later unsettled line re-open a settled row — the watch's final append lands after a settle", () => {
    const registered = row({
      seated: { kind: "registered", sinceIso: "2026-09-19T09:00:05.000Z", slug: "investigate-bfs" },
    });
    const settlement = { atIso: "2026-09-19T09:02:00.000Z", witness: "the machine, not one session" };
    appendDispatchRow({ home, row: registered });
    appendDispatchRow({ home, row: { ...registered, settled: settlement } });
    appendDispatchRow({ home, row: row() });

    expect(unwrap(readDispatchRows({ home }))).toStrictEqual([{ ...row(), settled: settlement }]);
  });

  it("round-trips an appended row", () => {
    expect(unwrap(appendDispatchRow({ home, row: row() }))).toBe(undefined);

    const rows = unwrap(readDispatchRows({ home }));

    expect(rows.length).toBe(1);
    expect(rows[0]!).toStrictEqual(row());
  });

  it("orders rows newest observation first", () => {
    appendDispatchRow({ home, row: row({ id: "d1", observedIso: "2026-09-19T09:00:00.000Z" }) });
    appendDispatchRow({ home, row: row({ id: "d3", observedIso: "2026-09-19T11:00:00.000Z" }) });
    appendDispatchRow({ home, row: row({ id: "d2", observedIso: "2026-09-19T10:00:00.000Z" }) });

    expect(unwrap(readDispatchRows({ home })).map((entry) => entry.id)).toStrictEqual(["d3", "d2", "d1"]);
  });

  it("folds a settlement written as a second append of the same id", () => {
    const settled = { atIso: "2026-09-19T09:40:00.000Z", witness: "killed the bfs; load back to 3.1" };
    appendDispatchRow({ home, row: row() });
    appendDispatchRow({ home, row: row({ settled }) });
    const rows = unwrap(readDispatchRows({ home }));

    expect(rows.length).toBe(1);
    expect(rows[0]!.settled).toStrictEqual(settled);
    expect(readFileSync(dispatchRegisterPath({ home }), "utf8").trimEnd().split("\n").length).toBe(2);
  });

  it("skips one unparseable line rather than blinding the gate to every good one", () => {
    appendDispatchRow({ home, row: row() });
    writeFileSync(dispatchRegisterPath({ home }), "{ not json\n", { flag: "a" });
    appendDispatchRow({ home, row: row({ id: "d2" }) });

    expect(unwrap(readDispatchRows({ home })).map((entry) => entry.id)).toStrictEqual(["d1", "d2"]);
  });

  it("skips a well-formed JSON line that is not a complete row", () => {
    appendDispatchRow({ home, row: row() });
    writeFileSync(dispatchRegisterPath({ home }), '{"id":"d9"}\n', { flag: "a" });

    expect(unwrap(readDispatchRows({ home })).map((entry) => entry.id)).toStrictEqual(["d1"]);
  });
});

describe("openDispatches, coveringDispatches and rowsForSignature", () => {
  it("selects only the rows nobody has settled", () => {
    const rows = [row(), row({ id: "d2", settled: { atIso: "2026-09-19T09:40:00.000Z", witness: "reaped" } })];

    expect(openDispatches({ rows }).map((entry) => entry.id)).toStrictEqual(["d1"]);
  });

  it("counts only a SEATED open row as covering — a failed spawn or a backed-off seat is not", () => {
    const rows = [
      row(),
      row({ id: "d2", seated: { kind: "none", why: "board row registered, but cmux spawn failed: not running" } }),
      row({ id: "d3", seated: { kind: "none", why: "seat backed off until 2026-09-19T09:05:00.000Z" } }),
    ];

    expect(openDispatches({ rows }).map((entry) => entry.id)).toStrictEqual(["d1", "d2", "d3"]);
    expect(coveringDispatches({ rows }).map((entry) => entry.id)).toStrictEqual(["d1"]);
  });

  it("counts a settled row as neither open nor covering, even though it seated a session", () => {
    const rows = [row({ settled: { atIso: "2026-09-19T09:40:00.000Z", witness: "killed it" } })];

    expect(coveringDispatches({ rows })).toStrictEqual([]);
  });

  it("selects only the rows carrying one signature", () => {
    const rows = [row(), row({ id: "d2", signature: "process-count|session abc|abc" })];

    expect(rowsForSignature({ rows, signature: SIGNATURE }).map((entry) => entry.id)).toStrictEqual(["d1"]);
  });
});

describe("dispatchBlockFor", () => {
  /** What {@link row}'s default carries into the document as an investigation. */
  const INVESTIGATION = {
    id: "d1",
    observedIso: "2026-09-19T09:00:00.000Z",
    slug: "investigate-bfs",
    subject: { label: "bfs", why: "bfs at 301.2% cpu" },
    triggers: ["hold", "single-process"],
  };

  it("reports nothing open on an empty register", () => {
    expect(dispatchBlockFor({ home, nowIso: "2026-09-19T09:00:00.000Z" })).toStrictEqual({
      backoffSeconds: 0,
      covering: 0,
      investigations: [],
      investigationsOmitted: 0,
      open: 0,
      subject: "",
    });
  });

  it("names the newest open row's subject and the seconds until its signature may be re-seated", () => {
    appendDispatchRow({ home, row: row() });

    expect(dispatchBlockFor({ home, nowIso: "2026-09-19T09:01:00.000Z" })).toStrictEqual({
      backoffSeconds: 240,
      covering: 1,
      investigations: [INVESTIGATION],
      investigationsOmitted: 0,
      open: 1,
      subject: "bfs",
    });
  });

  it("reports no backoff once the window has elapsed, with the row still open", () => {
    appendDispatchRow({ home, row: row() });

    expect(dispatchBlockFor({ home, nowIso: "2026-09-19T09:30:00.000Z" })).toStrictEqual({
      backoffSeconds: 0,
      covering: 1,
      investigations: [INVESTIGATION],
      investigationsOmitted: 0,
      open: 1,
      subject: "bfs",
    });
  });

  it("carries the newest five covering rows and counts the rest, never an uncovering one", () => {
    for (const hour of [1, 2, 3, 4, 5, 6, 7]) {
      appendDispatchRow({
        home,
        row: row({ id: `d${String(hour)}`, observedIso: `2026-09-19T0${String(hour)}:00:00.000Z` }),
      });
    }
    appendDispatchRow({
      home,
      row: row({
        id: "failed",
        observedIso: "2026-09-19T08:00:00.000Z",
        seated: { kind: "none", why: "spawn failed" },
      }),
    });

    const block = dispatchBlockFor({ home, nowIso: "2026-09-19T09:30:00.000Z" });

    expect(block.investigations!.map((entry) => entry.id)).toStrictEqual(["d7", "d6", "d5", "d4", "d3"]);
    expect(block.investigationsOmitted).toBe(2);
    expect(block.covering).toBe(7);
    expect(block.open).toBe(8);
  });

  it("reports an open row whose spawn FAILED as open but covering nothing", () => {
    // The shape the gate refuses on: the fleet tried to investigate, could not, and the alert still stands.
    appendDispatchRow({
      home,
      row: row({ seated: { kind: "none", why: "board row registered, but cmux spawn failed: not running" } }),
    });

    expect(dispatchBlockFor({ home, nowIso: "2026-09-19T09:30:00.000Z" })).toStrictEqual({
      backoffSeconds: 0,
      covering: 0,
      investigations: [],
      investigationsOmitted: 0,
      open: 1,
      subject: "bfs",
    });
  });

  it("stops counting a row once it is settled", () => {
    appendDispatchRow({ home, row: row() });
    appendDispatchRow({ home, row: row({ settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "killed it" } }) });

    expect(dispatchBlockFor({ home, nowIso: "2026-09-19T09:06:00.000Z" })).toStrictEqual({
      backoffSeconds: 0,
      covering: 0,
      investigations: [],
      investigationsOmitted: 0,
      open: 0,
      subject: "",
    });
  });
});

describe("liveDispatchSignatures", () => {
  const nowMs = Date.parse("2026-09-19T09:10:00.000Z");
  const registeredAt = ({ sinceIso }: { sinceIso: string }): DispatchRow =>
    row({ id: sinceIso, seated: { kind: "registered", sinceIso, slug: "investigate-bfs" } });

  it("holds a signature on an open SEATED row", () => {
    expect([...liveDispatchSignatures({ nowMs, rows: [row()] })]).toStrictEqual([SIGNATURE]);
  });

  it("holds it on a REGISTERED row inside the window — its spawn may yet boot, and a second seat duplicates it", () => {
    const sinceIso = new Date(nowMs - (REGISTERED_LIVE_SECONDS - 1) * 1000).toISOString();

    expect([...liveDispatchSignatures({ nowMs, rows: [registeredAt({ sinceIso })] })]).toStrictEqual([SIGNATURE]);
  });

  it("releases it once the window lapses, so a spawn that really died cannot hold its signature forever", () => {
    const sinceIso = new Date(nowMs - REGISTERED_LIVE_SECONDS * 1000).toISOString();

    expect([...liveDispatchSignatures({ nowMs, rows: [registeredAt({ sinceIso })] })]).toStrictEqual([]);
  });

  it("never holds it on a settled row or a row with no seat", () => {
    const rows = [
      row({ settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "gone" } }),
      row({ id: "d2", seated: { kind: "none", why: "backoff" } }),
    ];

    expect([...liveDispatchSignatures({ nowMs, rows })]).toStrictEqual([]);
  });

  it("does not count a registered row as COVERING — a spawn nobody confirmed covers nothing", () => {
    expect(coveringDispatches({ rows: [registeredAt({ sinceIso: "2026-09-19T09:09:00.000Z" })] })).toStrictEqual([]);
  });
});
