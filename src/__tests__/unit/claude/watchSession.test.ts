import { describe, expect, it } from "vitest";

import { claudeErrorLines } from "../../../claude/claudeErrors.js";
import {
  type ClaudeWatchLiveSet,
  type ClaudeWatchSession,
  isWatchLive,
  parseWatchSession,
  WATCH_TICK_GRACE_FLOOR_MS,
  WATCH_TICK_GRACE_INTERVALS,
  watchLivenessLine,
  watchSessionLiveness,
  watchTickDeadlineMs,
} from "../../../claude/watchSession.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { ProcessSnapshot } from "../../../live/standing/inspect.js";
import type { ClaudeWatchProcess, ProcessRow } from "../../../live/standing/processes.js";

const NOW_ISO = "2026-09-10T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const CWD = "/wt/keep-alive";

/** Ten minutes, the deadline the default five-minute interval produces. */
const TEN_MINUTES_MS = 10 * 60 * 1000;

/** A verdict's live set when nothing is running, for the renderer cases. */
const EMPTY_SET: ClaudeWatchLiveSet = { candidates: [], duplicates: [], queued: [] };

function session(over: Partial<ClaudeWatchSession> = {}): ClaudeWatchSession {
  return {
    cwd: CWD,
    intervalMs: 5 * 60 * 1000,
    lastTickStartedAtIso: NOW_ISO,
    pid: 4242,
    startedAtIso: "2026-09-10T09:00:00.000Z",
    watchId: "w1a2b3c4",
    ...over,
  };
}

/** One `claude watch` row, shaped like the tsx child `bin/slopweaver` really leaves in the table. */
function watchRow({ pid, cwd = CWD, flags = "" }: { pid: number; cwd?: string; flags?: string }): ProcessRow {
  return {
    argv: `node --require ${cwd}/node_modules/tsx/dist/preflight.cjs ${cwd}/bin/../src/cli/index.ts claude watch${flags}`,
    pid,
    ppid: 1,
  };
}

/** The decoded shape of {@link watchRow}. */
function watcher({ pid, cwd = CWD, waiting = false }: { pid: number; cwd?: string; waiting?: boolean }) {
  return { cwd, pid, ppid: 1, waiting } satisfies ClaudeWatchProcess;
}

function table(...rows: readonly ProcessRow[]): ProcessSnapshot {
  return { kind: "rows", rows };
}

/** A verdict over a record whose process is the real watcher, unless a test says otherwise. */
function verdict(
  over: {
    nowMs?: number;
    problems?: readonly string[];
    sameCheckout?: (sides: { left: string; right: string }) => boolean;
    session?: ClaudeWatchSession | undefined;
    snapshot?: ProcessSnapshot;
  } = {},
) {
  return watchSessionLiveness({ nowMs: NOW_MS, session: session(), snapshot: table(watchRow({ pid: 4242 })), ...over });
}

describe("parseWatchSession — absence and corruption are DIFFERENT facts", () => {
  it("reads a complete record back", () => {
    const parsed = unwrap(parseWatchSession({ value: { ...session() } }))!;
    expect(parsed.watchId).toBe("w1a2b3c4");
    expect(parsed.pid).toBe(4242);
    expect(parsed.cwd).toBe(CWD);
    expect(parsed.lastTickStartedAtIso).toBe(NOW_ISO);
    expect(parsed.intervalMs).toBe(300000);
  });

  it("reports a missing file as genuinely absent, not as a failure", () => {
    const parsed = parseWatchSession({ value: undefined });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toBe(undefined);
  });

  // A record that cannot be read is a defect to look at; an absent one is a loop to start. Collapsing the
  // first into the second would send an operator to start a loop that may already be running, and would
  // hide the real fault behind a routine caption.
  it("REFUSES a record with no pid rather than reporting it as absent", () => {
    const { pid: _dropped, ...rest } = session();
    const parsed = parseWatchSession({ value: rest });
    expect(parsed.isErr()).toBe(true);
    expect(claudeErrorLines({ error: unwrapErr(parsed) })).toStrictEqual([
      "`pid` is not a positive integer, so no process can be looked up",
    ]);
  });

  it("refuses a pid that is not a positive integer", () => {
    expect(claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: { ...session(), pid: 0 } })) })).toEqual([
      "`pid` is not a positive integer, so no process can be looked up",
    ]);
    expect(claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: { ...session(), pid: -1 } })) })).toEqual([
      "`pid` is not a positive integer, so no process can be looked up",
    ]);
    expect(claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: { ...session(), pid: 1.5 } })) })).toEqual([
      "`pid` is not a positive integer, so no process can be looked up",
    ]);
  });

  it("refuses a tick instant that is not a date, and says why it matters", () => {
    const parsed = parseWatchSession({ value: { ...session(), lastTickStartedAtIso: "whenever" } });
    expect(claudeErrorLines({ error: unwrapErr(parsed) })).toStrictEqual([
      "`lastTickStartedAtIso` is not a date, so tick freshness cannot be judged",
    ]);
  });

  it("refuses an interval of zero, which would make every deadline vacuous", () => {
    expect(
      claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: { ...session(), intervalMs: 0 } })) }),
    ).toEqual(["`intervalMs` is not a positive number, so the staleness deadline would be vacuous"]);
  });

  it("refuses a value that is not an object at all", () => {
    expect(claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: "watching" })) })).toEqual([
      "the keep-alive record is not an object, so nothing about the loop can be read from it",
    ]);
    expect(claudeErrorLines({ error: unwrapErr(parseWatchSession({ value: [session()] })) })).toEqual([
      "the keep-alive record is not an object, so nothing about the loop can be read from it",
    ]);
  });
});

describe("watchTickDeadlineMs", () => {
  it("allows two whole intervals for a loop ticking slower than the floor", () => {
    expect(watchTickDeadlineMs({ intervalMs: 5 * 60 * 1000 })).toBe(TEN_MINUTES_MS);
    expect(WATCH_TICK_GRACE_INTERVALS).toBe(2);
  });

  // A tick refreshes one store per plan through a 60-second bounded command, so two one-minute intervals
  // is shorter than one honest tick and would report a working loop as stopped.
  it("never falls below the floor, however short the configured interval", () => {
    expect(watchTickDeadlineMs({ intervalMs: 60 * 1000 })).toBe(WATCH_TICK_GRACE_FLOOR_MS);
  });
});

describe("watchSessionLiveness — step 1 and 2: what cannot be read establishes nothing", () => {
  it("grades an unreadable record invalid, carrying the problems, never as absence", () => {
    const liveness = verdict({
      problems: ["`pid` is not a positive integer, so no process can be looked up"],
      session: undefined,
    });
    expect(liveness.state).toBe("invalid");
    expect(isWatchLive({ liveness })).toBe(false);
  });

  it("puts an unreadable RECORD ahead of an unreadable table, since nothing else can be trusted", () => {
    const liveness = verdict({
      problems: ["`cwd` is missing or empty"],
      session: undefined,
      snapshot: { kind: "unreadable", problem: "ps timed out" },
    });
    expect(liveness).toStrictEqual({ ...EMPTY_SET, problems: ["`cwd` is missing or empty"], state: "invalid" });
  });

  // A state never suppresses the evidence of a second writer: an invalid record over a table holding two
  // watches still says two watches are running.
  it("still reports every running watch beside an invalid record", () => {
    const liveness = verdict({
      problems: ["`pid` is not a positive integer"],
      session: undefined,
      snapshot: table(watchRow({ pid: 5151 }), watchRow({ pid: 6161 })),
    });
    expect(liveness.candidates.map((candidate) => candidate.pid)).toStrictEqual([5151, 6161]);
    expect(liveness.duplicates.map((duplicate) => duplicate.pid)).toStrictEqual([6161]);
  });

  // The whole reason the snapshot is fallible: a failed `ps` collapsed to `[]` reads as "no watch is
  // running", which is a verdict, while a failed read establishes nothing at all.
  it("grades an unreadable process table UNMEASURED, never as an empty one", () => {
    const liveness = verdict({ snapshot: { kind: "unreadable", problem: "ps timed out" } });
    expect(liveness).toStrictEqual({ ...EMPTY_SET, problem: "ps timed out", state: "unmeasured" });
    expect(isWatchLive({ liveness })).toBe(false);
  });
});

describe("watchSessionLiveness — step 3: no record", () => {
  // The state the outage was actually in: nothing had run the loop for days.
  it("grades no record and no running watch as never-started", () => {
    const liveness = verdict({ session: undefined, snapshot: table() });
    expect(liveness).toStrictEqual({ ...EMPTY_SET, state: "never-started" });
    expect(isWatchLive({ liveness })).toBe(false);
  });

  it("grades a running watch with no record as UNRECORDED and live — a run that has not stamped yet", () => {
    const liveness = verdict({ session: undefined });
    expect(liveness).toStrictEqual({
      candidates: [watcher({ pid: 4242 })],
      duplicates: [],
      queued: [],
      state: "unrecorded",
    });
    expect(isWatchLive({ liveness })).toBe(true);
  });

  it("does not count a queued --wait watch as running, so no record and only a waiter is never-started", () => {
    const liveness = verdict({ session: undefined, snapshot: table(watchRow({ flags: " --wait", pid: 7070 })) });
    expect(liveness).toStrictEqual({
      candidates: [],
      duplicates: [],
      queued: [watcher({ pid: 7070, waiting: true })],
      state: "never-started",
    });
  });
});

describe("watchSessionLiveness — steps 4 and 5: the recorded owner", () => {
  it("grades a fresh tick under the recorded process as watching", () => {
    const liveness = verdict({ nowMs: NOW_MS + 30_000 });
    expect(liveness).toStrictEqual({
      candidates: [watcher({ pid: 4242 })],
      cwd: CWD,
      duplicates: [],
      pid: 4242,
      queued: [],
      sinceTickMs: 30_000,
      state: "watching",
      watchId: "w1a2b3c4",
    });
    expect(isWatchLive({ liveness })).toBe(true);
  });

  // A released `--wait` successor carries the flag in its argv for life. Partitioning the waiters out
  // BEFORE looking for the owner would read the one watch that is actually ticking as dead.
  it("promotes the recorded process to owner even though it was launched with --wait", () => {
    const liveness = verdict({ snapshot: table(watchRow({ flags: " --wait", pid: 4242 })) });
    expect(liveness.state).toBe("watching");
    expect(liveness.candidates).toStrictEqual([watcher({ pid: 4242, waiting: true })]);
    expect(liveness.queued).toStrictEqual([]);
  });

  it("puts the owner FIRST, reports every other running watch as a duplicate, and waiters as queued", () => {
    const liveness = verdict({
      snapshot: table(
        watchRow({ pid: 5151 }),
        watchRow({ flags: " --wait", pid: 7070 }),
        watchRow({ pid: 4242 }),
        watchRow({ cwd: "/wt/other", pid: 6161 }),
      ),
    });
    expect(liveness.state).toBe("watching");
    expect(liveness.candidates.map((candidate) => candidate.pid)).toStrictEqual([4242, 5151, 6161]);
    expect(liveness.duplicates.map((duplicate) => duplicate.pid)).toStrictEqual([5151, 6161]);
    expect(liveness.queued.map((queued) => queued.pid)).toStrictEqual([7070]);
  });

  it("still counts a tick exactly ON the deadline as watching, so the boundary is not a flap", () => {
    expect(verdict({ nowMs: NOW_MS + TEN_MINUTES_MS }).state).toBe("watching");
  });

  it("grades a running owner that has begun no tick past its deadline as ticks-stopped — not live, not absent", () => {
    const liveness = verdict({ nowMs: NOW_MS + TEN_MINUTES_MS + 1 });
    expect(liveness.state).toBe("ticks-stopped");
    expect(isWatchLive({ liveness })).toBe(false);
    expect(liveness.candidates).toStrictEqual([watcher({ pid: 4242 })]);
  });

  // One watch is TWO rows — the tsx launcher and the node child that stamps its own pid. Counting both
  // would make every healthy watch its own duplicate.
  it("reads a watch and its tsx launcher as ONE watch, owned by the child the record names", () => {
    const launcher: ProcessRow = {
      argv: `node ${CWD}/node_modules/.bin/tsx ${CWD}/bin/../src/cli/index.ts claude watch`,
      pid: 4200,
      ppid: 1,
    };
    const child: ProcessRow = { ...watchRow({ pid: 4242 }), ppid: 4200 };
    const liveness = verdict({ snapshot: table(launcher, child) });
    expect(liveness.state).toBe("watching");
    expect(liveness.candidates).toStrictEqual([{ cwd: CWD, pid: 4242, ppid: 4200, waiting: false }]);
    expect(liveness.duplicates).toStrictEqual([]);
  });
});

describe("watchSessionLiveness — step 6: the record names a run that is not the one running", () => {
  // MEASURED: a second watch took the record over and was killed, and the gauge said
  // "keep-alive: NOT running" while the first watch still ticked. This is that shape, and it now reads live.
  it("grades a dead recorded run beside a running watch as UNRECORDED and live, nesting process-dead", () => {
    const liveness = verdict({ snapshot: table(watchRow({ pid: 5151 })) });
    expect(liveness).toStrictEqual({
      candidates: [watcher({ pid: 5151 })],
      duplicates: [],
      queued: [],
      recorded: { cwd: CWD, pid: 4242, state: "process-dead", watchId: "w1a2b3c4" },
      state: "unrecorded",
    });
    expect(isWatchLive({ liveness })).toBe(true);
  });

  it("nests process-foreign when the recorded pid now runs something else", () => {
    const liveness = verdict({
      snapshot: table({ argv: "/bin/sleep 600", pid: 4242, ppid: 1 }, watchRow({ pid: 5151 })),
    });
    expect(liveness.state).toBe("unrecorded");
    expect(liveness).toMatchObject({ recorded: { pid: 4242, state: "process-foreign" } });
  });

  // Comparing checkout spellings let a macOS alias (`/var` is `/private/var`) hide a running owner.
  // The owner is the decoded watch at the recorded pid; a reused pid running a watch is live either way.
  // Both directions. A pid alone credited a reused pid running a queued watch from ANOTHER tree
  // (a false live); a spelling comparison let an alias hide the real owner (a false NOT-running).
  it("does not credit a queued watch from ANOTHER checkout at the recorded pid", () => {
    const liveness = verdict({ snapshot: table(watchRow({ cwd: "/wt/other", flags: " --wait", pid: 4242 })) });
    expect(liveness.state).toBe("process-foreign");
    expect(liveness.candidates).toStrictEqual([]);
    expect(liveness.queued).toStrictEqual([watcher({ cwd: "/wt/other", pid: 4242, waiting: true })]);
  });

  it("credits the owner through an alias the injected comparator resolves", () => {
    const aliases = ({ left, right }: { left: string; right: string }): boolean =>
      left.replace(/^\/private/u, "") === right.replace(/^\/private/u, "");
    const liveness = verdict({
      sameCheckout: aliases,
      snapshot: table(watchRow({ cwd: `/private${CWD}`, pid: 4242 })),
    });
    expect(liveness.state).toBe("watching");
  });
});

describe("watchSessionLiveness — step 7: nothing running", () => {
  it("grades a record whose process is gone as process-dead, even with a tick stamped this second", () => {
    const liveness = verdict({ snapshot: table() });
    expect(liveness.state).toBe("process-dead");
    expect(isWatchLive({ liveness })).toBe(false);
  });

  // MEASURED as a class rather than an incident: pids are reused. A watcher killed one second after
  // stamping still has a fresh record, so without this the reused number reads as a healthy keep-alive.
  it("grades a REUSED pid as process-foreign, not as watching, however fresh the record is", () => {
    const liveness = verdict({ nowMs: NOW_MS + 1000, snapshot: table({ argv: "/bin/sleep 600", pid: 4242, ppid: 1 }) });
    expect(liveness.state).toBe("process-foreign");
    expect(isWatchLive({ liveness })).toBe(false);
  });

  // Ordering is the contract: a record's timestamp can outlive its writer by up to a whole deadline.
  it("puts process death ahead of tick staleness", () => {
    expect(verdict({ nowMs: NOW_MS + TEN_MINUTES_MS + 1, snapshot: table() }).state).toBe("process-dead");
  });

  it("keeps a queued successor on a terminal verdict, so the waiter is not lost from the report", () => {
    const liveness = verdict({ snapshot: table(watchRow({ flags: " --wait", pid: 7070 })) });
    expect(liveness).toStrictEqual({
      candidates: [],
      cwd: CWD,
      duplicates: [],
      pid: 4242,
      queued: [watcher({ pid: 7070, waiting: true })],
      state: "process-dead",
      watchId: "w1a2b3c4",
    });
  });
});

describe("watchLivenessLine", () => {
  it("says what a never-started loop costs, not just that it is absent", () => {
    expect(watchLivenessLine({ liveness: { ...EMPTY_SET, state: "never-started" } })).toBe(
      "keep-alive: NOT running — no `claude watch` has recorded a tick here, so every store no session is " +
        "pinned to expires on its own eight-hour clock",
    );
  });

  it("sends a reader to the file for an unreadable record, rather than claiming anything about the loop", () => {
    const line = watchLivenessLine({
      liveness: { ...EMPTY_SET, problems: ["`pid` is not a positive integer"], state: "invalid" },
    });
    expect(line).toBe(
      "keep-alive: UNKNOWN — a record exists and could not be read, so whether the loop is running is not " +
        "established. Read the file: `pid` is not a positive integer",
    );
  });

  it("says an unreadable process table establishes nothing", () => {
    const line = watchLivenessLine({ liveness: { ...EMPTY_SET, problem: "ps timed out", state: "unmeasured" } });
    expect(line).toBe(
      "keep-alive: UNKNOWN — the process table could not be read, so whether a loop is running is not " +
        "established (ps timed out)",
    );
  });

  it("names the run, the pid and the checkout of a dead loop", () => {
    const line = watchLivenessLine({
      liveness: { ...EMPTY_SET, cwd: CWD, pid: 4242, state: "process-dead", watchId: "w1a2b3c4" },
    });
    expect(line).toBe(
      "keep-alive: NOT running — its last run (w1a2b3c4, pid 4242, from /wt/keep-alive) is gone from the " +
        "process table, so idle stores are on their own clock",
    );
  });

  it("says a reused pid is a reused pid, so an alive process never reads as an all-clear", () => {
    const line = watchLivenessLine({
      liveness: { ...EMPTY_SET, cwd: CWD, pid: 4242, state: "process-foreign", watchId: "w1a2b3c4" },
    });
    expect(line).toBe(
      "keep-alive: NOT running — pid 4242 from run w1a2b3c4 is in the process table but is not this loop, " +
        "so the pid was reused and nothing is refreshing an idle store",
    );
  });

  it("reports a running watch the record does not name as live, and says what became of the recorded run", () => {
    const line = watchLivenessLine({
      liveness: {
        candidates: [watcher({ pid: 5151 })],
        duplicates: [],
        queued: [],
        recorded: { cwd: CWD, pid: 4242, state: "process-dead", watchId: "w1a2b3c4" },
        state: "unrecorded",
      },
    });
    expect(line).toBe(
      "keep-alive: live — `claude watch` pid 5151 from /wt/keep-alive is running, but the record names run " +
        "w1a2b3c4 (pid 4242), which is gone, so its tick freshness is not established",
    );
  });

  it("reports a live loop with how long ago its last tick began", () => {
    const line = watchLivenessLine({
      liveness: {
        ...EMPTY_SET,
        candidates: [watcher({ pid: 4242 })],
        cwd: CWD,
        pid: 4242,
        sinceTickMs: 12_000,
        state: "watching",
        watchId: "w1a2b3c4",
      },
    });
    expect(line).toBe("keep-alive: live (w1a2b3c4, pid 4242), last tick 12s ago");
  });

  it("names every duplicate writer and every queued successor beside a live loop", () => {
    const line = watchLivenessLine({
      liveness: {
        candidates: [watcher({ pid: 4242 }), watcher({ pid: 5151 })],
        cwd: CWD,
        duplicates: [watcher({ pid: 5151 })],
        pid: 4242,
        queued: [watcher({ pid: 7070, waiting: true })],
        sinceTickMs: 12_000,
        state: "watching",
        watchId: "w1a2b3c4",
      },
    });
    expect(line).toBe(
      "keep-alive: live (w1a2b3c4, pid 4242), last tick 12s ago — DUPLICATE: 1 more running beside it " +
        "(pid 5151), each a second credential writer; interrupt all but one; 1 queued with --wait (pid 7070)",
    );
  });

  it("reports a stalled loop as NOT running, so an alive pid never reads as an all-clear", () => {
    const line = watchLivenessLine({
      liveness: { ...EMPTY_SET, cwd: CWD, pid: 4242, sinceTickMs: 900_000, state: "ticks-stopped", watchId: "w1" },
    });
    expect(line).toBe(
      "keep-alive: NOT running — w1 (pid 4242) is alive but has begun no tick for 900s, past its own " +
        "deadline, so nothing is refreshing an idle store",
    );
  });
});

describe("watchSessionLiveness — the first counterexample, replayed", () => {
  // A released `--wait` owner started from /tmp. Its record names the checkout its argv runs, as the writer
  // now stamps it, and the gauge must read it live rather than NOT running.
  it("grades a released --wait owner started from another directory as watching", () => {
    const launcher: ProcessRow = {
      argv: `node /repo/slopweaver/node_modules/.bin/tsx /repo/slopweaver/bin/../src/cli/index.ts claude watch --wait`,
      pid: 4200,
      ppid: 1,
    };
    const owner: ProcessRow = { ...watchRow({ cwd: "/repo/slopweaver", flags: " --wait", pid: 4242 }), ppid: 4200 };
    const liveness = verdict({ session: session({ cwd: "/repo/slopweaver" }), snapshot: table(launcher, owner) });
    expect(liveness.state).toBe("watching");
    expect(liveness.candidates.map((candidate) => candidate.pid)).toStrictEqual([4242]);
    expect(liveness.queued).toStrictEqual([]);
  });

  it("matches a record whose checkout is spelled differently but names the same tree", () => {
    expect(verdict({ session: session({ cwd: `${CWD}/bin/..` }) }).state).toBe("watching");
  });
});

describe("watchSessionLiveness — the second counterexample, under the released-child shape", () => {
  // A released --wait start runs its loop as a child without the flag. The record names a duplicate that
  // stamped and died (5151); the gauge must still read the running loop as live, not as a queued waiter.
  it("reads the released loop as a running candidate, and its waiter and launcher as nothing", () => {
    const entry = `${CWD}/bin/../src/cli/index.ts`;
    const launcher: ProcessRow = {
      argv: `node ${CWD}/node_modules/.bin/tsx ${entry} claude watch --wait`,
      pid: 4200,
      ppid: 1,
    };
    const waiter: ProcessRow = {
      argv: `node --require x/preflight.cjs ${entry} claude watch --wait`,
      pid: 4201,
      ppid: 4200,
    };
    const loop: ProcessRow = { argv: `node --require x/preflight.cjs ${entry} claude watch`, pid: 4242, ppid: 4201 };
    const liveness = verdict({ session: session({ pid: 5151 }), snapshot: table(launcher, waiter, loop) });
    expect(liveness.state).toBe("unrecorded");
    expect(isWatchLive({ liveness })).toBe(true);
    expect(liveness.candidates).toStrictEqual([{ cwd: CWD, pid: 4242, ppid: 4201, waiting: false }]);
    expect(liveness.queued).toStrictEqual([]);
  });
});

describe("watchSessionLiveness — a counterexample: two --wait successors released together", () => {
  // Each released successor runs its loop as a child without --wait, so a second writer is a DUPLICATE —
  // never a queued waiter the record happens not to name — and the all-clear fails on it.
  it("reports the second released loop as a duplicate, not as queued", () => {
    const entry = `${CWD}/bin/../src/cli/index.ts`;
    const chain = ({ base }: { base: number }): readonly ProcessRow[] => [
      { argv: `node ${CWD}/node_modules/.bin/tsx ${entry} claude watch --wait`, pid: base, ppid: 1 },
      { argv: `node --require x/preflight.cjs ${entry} claude watch --wait`, pid: base + 1, ppid: base },
      { argv: `node --require x/preflight.cjs ${entry} claude watch`, pid: base + 42, ppid: base + 1 },
    ];
    const liveness = verdict({
      session: session({ pid: 4242 }),
      snapshot: table(...chain({ base: 4200 }), ...chain({ base: 5100 })),
    });
    expect(liveness.state).toBe("watching");
    expect(liveness.candidates.map((candidate) => candidate.pid)).toStrictEqual([4242, 5142]);
    expect(liveness.duplicates.map((duplicate) => duplicate.pid)).toStrictEqual([5142]);
    expect(liveness.queued).toStrictEqual([]);
  });
});
