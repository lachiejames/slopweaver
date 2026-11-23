/**
 * Which seats the newest recovery attempt refused whose workspace is gone, and how the fold drops one once
 * journalled. Pure.
 */
import { describe, expect, it } from "vitest";

import {
  appStartAcross,
  claudeProcessesOf,
  goneSeatEvents,
  type LiveSessionStart,
  sessionsOutsideCmux,
} from "../../../fleet/goneSeats.js";
import {
  type FleetJournalEvent,
  type FleetJournalRead,
  foldNewestAttempt,
  newestAttemptReadWhole,
} from "../../../fleet/journal.js";

const ATTEMPT = "att";
const STARTED = "2026-10-11T07:15:15.000Z";
const BEFORE = Date.parse("2026-10-11T07:14:33.000Z");
const NOW = "2026-10-11T09:20:00.000Z";
const base = { attemptId: ATTEMPT, schemaVersion: 1 as const };

const started: FleetJournalEvent = { ...base, atIso: STARTED, episodeId: "ep", kind: "attempt-started", pid: 42 };
const finished: FleetJournalEvent = {
  ...base,
  atIso: "2026-10-11T07:27:08.000Z",
  kind: "attempt-finished",
  outcome: "failed",
};

/** One seat line for the attempt. */
function seat({
  workspaceRef,
  phase,
  role = "worker",
}: {
  workspaceRef: string;
  phase: "recovering" | "reseated" | "refused" | "held";
  role?: "supervisor" | "worker";
}): FleetJournalEvent {
  return { ...base, atIso: "2026-10-11T07:27:03.000Z", kind: "seat", phase, role, workspaceRef };
}

/** The `seat-gone` line close-done appends for a ref. */
function gone({ workspaceRef }: { workspaceRef: string }): FleetJournalEvent {
  return { ...base, atIso: NOW, kind: "seat-gone", workspaceRef };
}

/** A read where every line decoded, or where lines failed after the given counts of decoded events. */
function read({
  events,
  unreadableAt = [],
}: {
  events: readonly FleetJournalEvent[];
  unreadableAt?: readonly number[];
}): FleetJournalRead {
  return { events, unreadable: unreadableAt.length, unreadableAt };
}

/** A real attempt's shape: one seat reseated, one refused, the supervisor reseated, finished failed. */
const ATTEMPT_FF96: readonly FleetJournalEvent[] = [
  started,
  seat({ phase: "reseated", role: "supervisor", workspaceRef: "workspace:1" }),
  seat({ phase: "reseated", workspaceRef: "workspace:13" }),
  seat({ phase: "refused", workspaceRef: "workspace:5" }),
  finished,
];

/** The refs judged gone over that attempt with nothing listed, at the given app start. */
function goneRefs({
  appStartedMs,
  journal = read({ events: ATTEMPT_FF96 }),
  outsideCmux = [],
}: {
  appStartedMs: number | undefined;
  journal?: FleetJournalRead;
  outsideCmux?: readonly LiveSessionStart[];
}): readonly string[] {
  return goneSeatEvents({ appStartedMs, journal, liveRefs: new Set(), nowIso: NOW, outsideCmux }).map(
    (line) => line.workspaceRef,
  );
}

describe("goneSeatEvents", () => {
  it("names a refused worker whose ref the live inventory no longer carries", () => {
    expect(
      goneSeatEvents({
        appStartedMs: BEFORE,
        journal: read({ events: ATTEMPT_FF96 }),
        liveRefs: new Set(["workspace:1"]),
        nowIso: NOW,
        outsideCmux: [],
      }),
    ).toEqual([gone({ workspaceRef: "workspace:5" })]);
  });

  it("names a held or mid-relaunch worker the same way, and never a reseated one or the supervisor", () => {
    const events = [
      started,
      seat({ phase: "refused", role: "supervisor", workspaceRef: "workspace:1" }),
      seat({ phase: "reseated", workspaceRef: "workspace:2" }),
      seat({ phase: "held", workspaceRef: "workspace:3" }),
      seat({ phase: "recovering", workspaceRef: "workspace:4" }),
      finished,
    ];
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events }) })).toEqual(["workspace:3", "workspace:4"]);
  });

  it("names nothing whose workspace is still listed", () => {
    expect(
      goneSeatEvents({
        appStartedMs: BEFORE,
        journal: read({ events: ATTEMPT_FF96 }),
        liveRefs: new Set(["workspace:5"]),
        nowIso: NOW,
        outsideCmux: [],
      }),
    ).toEqual([]);
  });

  it("names nothing while the attempt has not finished", () => {
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events: ATTEMPT_FF96.slice(0, -1) }) })).toEqual([]);
  });

  it("names nothing when the app started at or after the attempt, or its start is unknown — refs were renumbered", () => {
    expect(goneRefs({ appStartedMs: Date.parse("2026-10-11T08:00:00.000Z") })).toEqual([]);
    expect(goneRefs({ appStartedMs: Date.parse(STARTED) })).toEqual([]);
    expect(goneRefs({ appStartedMs: undefined })).toEqual([]);
  });

  it("needs the app a whole second before the attempt, since `ps` prints its start to the second", () => {
    expect(goneRefs({ appStartedMs: Date.parse(STARTED) - 999 })).toEqual([]);
    expect(goneRefs({ appStartedMs: Date.parse(STARTED) - 1000 })).toEqual(["workspace:5"]);
  });

  it("names nothing when the attempt's own start will not parse", () => {
    const events = [{ ...started, atIso: "not a time" }, ...ATTEMPT_FF96.slice(1)];
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events }) })).toEqual([]);
  });

  it("names nothing when the attempt's start names no real instant, which Date.parse would roll on", () => {
    const events = [{ ...started, atIso: "2026-02-31T09:00:00.000Z" }, ...ATTEMPT_FF96.slice(1)];
    expect(goneRefs({ appStartedMs: Date.parse("2026-03-03T08:30:00.000Z"), journal: read({ events }) })).toEqual([]);
  });

  it("reads an impossible finish or session start as unknown, so a session outside cmux still blocks", () => {
    const rolledFinish = [...ATTEMPT_FF96.slice(0, -1), { ...finished, atIso: "2026-10-11T07:27:61.000Z" }];
    const late = { pid: 9, startedIso: "2026-10-11T09:00:00.000Z" };
    const rolledStart = { pid: 9, startedIso: "2026-10-32T09:00:00.000Z" };
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events: rolledFinish }), outsideCmux: [late] })).toEqual(
      [],
    );
    expect(goneRefs({ appStartedMs: BEFORE, outsideCmux: [rolledStart] })).toEqual([]);
  });

  it("names nothing when a line from the newest start on would not decode, and ignores one before it", () => {
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events: ATTEMPT_FF96, unreadableAt: [3] }) })).toEqual([]);
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events: ATTEMPT_FF96, unreadableAt: [0] }) })).toEqual([
      "workspace:5",
    ]);
  });

  it("names a seat once: the fold has dropped one already journalled", () => {
    const events = [...ATTEMPT_FF96, gone({ workspaceRef: "workspace:5" })];
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events }) })).toEqual([]);
  });

  it("names nothing for an older attempt once a newer one started", () => {
    const newer = { ...started, atIso: "2026-10-11T09:00:00.000Z", attemptId: "newer" };
    expect(goneRefs({ appStartedMs: BEFORE, journal: read({ events: [...ATTEMPT_FF96, newer] }) })).toEqual([]);
  });

  it("names nothing while a session outside cmux started by the finish, or at an unknown time — a possible orphan", () => {
    const atFinish = { pid: 9, startedIso: finished.atIso };
    const unknown = { pid: 9, startedIso: undefined };
    expect(goneRefs({ appStartedMs: BEFORE, outsideCmux: [atFinish] })).toEqual([]);
    expect(goneRefs({ appStartedMs: BEFORE, outsideCmux: [unknown] })).toEqual([]);
  });

  it("names the seat past a session outside cmux whose whole-second start is after the finish", () => {
    const after = { pid: 9, startedIso: new Date(Date.parse(finished.atIso) + 1000).toISOString() };
    expect(goneRefs({ appStartedMs: BEFORE, outsideCmux: [after] })).toEqual(["workspace:5"]);
  });
});

describe("sessionsOutsideCmux", () => {
  it("keeps only the sessions no surface holds", () => {
    const live = [
      { pid: 1, startedIso: STARTED },
      { pid: 2, startedIso: STARTED },
    ];
    expect(sessionsOutsideCmux({ live, surfacePids: [1, 3] })).toEqual([{ pid: 2, startedIso: STARTED }]);
    expect(sessionsOutsideCmux({ live, surfacePids: [] })).toEqual(live);
  });
});

describe("claudeProcessesOf", () => {
  /** One `ps` row. */
  const row = ({
    pid,
    command,
    start = "Sun Oct 11 07:15:21 2026",
  }: {
    pid: number;
    command: string;
    start?: string;
  }) => ({
    command,
    pid,
    ppid: 1,
    start,
  });

  it("names every claude process by its own start, whatever its registry holds", () => {
    const rows = [
      row({ command: "/Users/ada/.local/bin/claude", pid: 39948 }),
      row({ command: "/bin/zsh", pid: 39900 }),
      row({ command: "/Applications/Claude.app/Contents/MacOS/Claude", pid: 500 }),
      row({ command: "/opt/bin/claude-code-helper", pid: 501 }),
      row({ command: "claude", pid: 22539, start: "Sun Oct 11 09:46:26 2026" }),
    ];
    expect(claudeProcessesOf({ rows })).toEqual([
      { pid: 39948, startedIso: "2026-10-11T07:15:21.000Z" },
      { pid: 22539, startedIso: "2026-10-11T09:46:26.000Z" },
    ]);
  });

  it("reads an impossible start as unknown, which blocks the judgement", () => {
    const rows = [row({ command: "/usr/local/bin/claude", pid: 7, start: "Sat Feb 31 07:00:00 2026" })];
    expect(claudeProcessesOf({ rows })).toEqual([{ pid: 7, startedIso: undefined }]);
    expect(goneRefs({ appStartedMs: BEFORE, outsideCmux: claudeProcessesOf({ rows }) })).toEqual([]);
  });
});

describe("appStartAcross", () => {
  const app = { pid: 900, startedMs: BEFORE };

  it("answers the start only when the same app ran on both sides of the listing", () => {
    expect(appStartAcross({ after: app, before: app })).toBe(BEFORE);
    expect(appStartAcross({ after: { ...app, pid: 901 }, before: app })).toBeUndefined();
    expect(appStartAcross({ after: { ...app, startedMs: BEFORE + 60_000 }, before: app })).toBeUndefined();
    expect(appStartAcross({ after: undefined, before: app })).toBeUndefined();
    expect(appStartAcross({ after: app, before: undefined })).toBeUndefined();
  });
});

describe("newestAttemptReadWhole", () => {
  it("is whole when every failure falls before the newest start, and not when one falls after it", () => {
    expect(newestAttemptReadWhole({ journal: read({ events: ATTEMPT_FF96, unreadableAt: [0] }) })).toBe(true);
    expect(newestAttemptReadWhole({ journal: read({ events: ATTEMPT_FF96, unreadableAt: [1] }) })).toBe(false);
  });

  it("with no start decoded, is whole only when nothing failed — the failed line may be that start", () => {
    expect(newestAttemptReadWhole({ journal: read({ events: [] }) })).toBe(true);
    expect(newestAttemptReadWhole({ journal: read({ events: [], unreadableAt: [0] }) })).toBe(false);
  });
});

describe("foldNewestAttempt over a seat-gone line", () => {
  it("drops the seat it names from the newest attempt", () => {
    const fold = foldNewestAttempt({ events: [...ATTEMPT_FF96, gone({ workspaceRef: "workspace:5" })] })!;
    expect([...fold.seats.keys()]).toEqual(["workspace:1", "workspace:13"]);
  });

  it("ignores a line naming another attempt", () => {
    const other = { ...gone({ workspaceRef: "workspace:5" }), attemptId: "older" };
    const fold = foldNewestAttempt({ events: [...ATTEMPT_FF96, other] })!;
    expect([...fold.seats.keys()]).toEqual(["workspace:1", "workspace:13", "workspace:5"]);
  });

  it("brings the seat back when a later seat line names its ref again", () => {
    const events = [
      ...ATTEMPT_FF96,
      gone({ workspaceRef: "workspace:5" }),
      seat({ phase: "refused", workspaceRef: "workspace:5" }),
    ];
    expect(foldNewestAttempt({ events })!.seats.get("workspace:5")!.phase).toBe("refused");
  });
});
