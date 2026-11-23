/**
 * Start-up admission for `claude watch` — pure, over process tables written the way `ps` prints them.
 *
 * The shape under test is the one the duplicate incident needed: a second watch must not start beside a
 * running one, a queued `--wait` successor is not an incumbent unless the record shows it took over, and an
 * unreadable table refuses rather than reading as empty.
 */
import { describe, expect, it } from "vitest";

import { claudeWatchStartDecision, claudeWatchStartDetail } from "../../../claude/watchStart.js";
import type { ProcessSnapshot } from "../../../live/standing/inspect.js";
import type { ProcessRow } from "../../../live/standing/processes.js";

const CWD = "/wt/keep-alive";
const SELF = 700;

/** One `claude watch` node child, as `bin/slopweaver` leaves it in the table. */
function watchRow({ pid, ppid = 1, flags = "" }: { pid: number; ppid?: number; flags?: string }): ProcessRow {
  return { argv: `node --require x/preflight.cjs ${CWD}/bin/../src/cli/index.ts claude watch${flags}`, pid, ppid };
}

/** This process and the tsx launcher that started it — both carry the entrypoint and the verb. */
const SELF_ROWS: readonly ProcessRow[] = [
  { argv: `node ${CWD}/node_modules/.bin/tsx ${CWD}/bin/../src/cli/index.ts claude watch`, pid: 699, ppid: 1 },
  watchRow({ pid: SELF, ppid: 699 }),
];

function table(...rows: readonly ProcessRow[]): ProcessSnapshot {
  return { kind: "rows", rows: [...SELF_ROWS, ...rows] };
}

describe("claudeWatchStartDecision", () => {
  it("admits a start when the only watch in the table is this process and its own launcher", () => {
    expect(claudeWatchStartDecision({ processId: SELF, recorded: undefined, snapshot: table() })).toStrictEqual({
      kind: "ready",
    });
  });

  it("refuses a start beside another running watch, naming it", () => {
    expect(
      claudeWatchStartDecision({ processId: SELF, recorded: undefined, snapshot: table(watchRow({ pid: 5151 })) }),
    ).toStrictEqual({ kind: "occupied", watchers: [{ cwd: CWD, pid: 5151, ppid: 1, waiting: false }] });
  });

  it("names EVERY incumbent, not only the first", () => {
    const decision = claudeWatchStartDecision({
      processId: SELF,
      recorded: undefined,
      snapshot: table(watchRow({ pid: 5151 }), watchRow({ pid: 6161 })),
    });
    expect(decision).toMatchObject({ kind: "occupied", watchers: [{ pid: 5151 }, { pid: 6161 }] });
  });

  it("does not count another queued --wait watch as an incumbent", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: undefined,
        snapshot: table(watchRow({ flags: " --wait", pid: 7070 })),
      }),
    ).toStrictEqual({ kind: "ready" });
  });

  // A released `--wait` successor keeps the flag in its argv for life, and the canonical boot line IS
  // `claude watch --wait` — so without the record's word the typical live watch would be invisible here,
  // and every second start beside it would pass.
  it("DOES count a --wait watch the record names, because the record says it took over", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: { cwd: CWD, pid: 7070 },
        snapshot: table(watchRow({ flags: " --wait", pid: 7070 })),
      }),
    ).toStrictEqual({ kind: "occupied", watchers: [{ cwd: CWD, pid: 7070, ppid: 1, waiting: true }] });
  });

  it("does not promote a --wait watch from ANOTHER checkout at the recorded pid", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: { cwd: "/wt/other", pid: 7070 },
        snapshot: table(watchRow({ flags: " --wait", pid: 7070 })),
      }),
    ).toStrictEqual({ kind: "ready" });
  });

  it("promotes it through an alias the injected comparator resolves", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: { cwd: `/private${CWD}`, pid: 7070 },
        sameCheckout: ({ left, right }) => left.replace(/^\/private/u, "") === right.replace(/^\/private/u, ""),
        snapshot: table(watchRow({ flags: " --wait", pid: 7070 })),
      }),
    ).toMatchObject({ kind: "occupied", watchers: [{ pid: 7070, waiting: true }] });
  });

  it("fails CLOSED when the process table could not be read", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: undefined,
        snapshot: { kind: "unreadable", problem: "the process table could not be read (ps timed out)" },
      }),
    ).toStrictEqual({ kind: "unreadable", problem: "the process table could not be read (ps timed out)" });
  });
});

describe("claudeWatchStartDetail", () => {
  it("names each running watch by pid and checkout", () => {
    expect(
      claudeWatchStartDetail({
        decision: {
          kind: "occupied",
          watchers: [
            { cwd: CWD, pid: 5151, ppid: 1, waiting: false },
            { cwd: "/wt/other", pid: 6161, ppid: 1, waiting: false },
          ],
        },
      }),
    ).toBe("already running: pid 5151 from /wt/keep-alive, pid 6161 from /wt/other");
  });

  it("says an unreadable table rules nothing out", () => {
    expect(claudeWatchStartDetail({ decision: { kind: "unreadable", problem: "ps failed" } })).toBe(
      "ps failed, so no running watch can be ruled out",
    );
  });
});

describe("claudeWatchStartDecision — the first counterexample, replayed", () => {
  // A `--wait` watch started from /tmp out of /repo/slopweaver, released and ticking as child 4242. Its
  // record now names the checkout as its own argv spells it, so the admission of a second watch sees it.
  const REPO = "/repo/slopweaver";
  const launcher: ProcessRow = {
    argv: `node ${REPO}/node_modules/.bin/tsx ${REPO}/bin/../src/cli/index.ts claude watch --wait`,
    pid: 4200,
    ppid: 1,
  };
  const owner: ProcessRow = {
    argv: `node --require x/preflight.cjs ${REPO}/bin/../src/cli/index.ts claude watch --wait`,
    pid: 4242,
    ppid: 4200,
  };

  it("refuses a second start beside a released --wait owner started from another directory", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: { cwd: REPO, pid: 4242 },
        snapshot: { kind: "rows", rows: [launcher, owner] },
      }),
    ).toMatchObject({ kind: "occupied", watchers: [{ pid: 4242, waiting: true }] });
  });

  it("matches a record spelled with bin/.. to the same process", () => {
    expect(
      claudeWatchStartDecision({
        processId: SELF,
        recorded: { cwd: `${REPO}/bin/..`, pid: 4242 },
        snapshot: { kind: "rows", rows: [launcher, owner] },
      }),
    ).toMatchObject({ kind: "occupied" });
  });
});

describe("claudeWatchStartDecision — a released --wait start runs its loop WITHOUT the flag", () => {
  const REPO = "/repo/slopweaver";
  const entry = `${REPO}/bin/../src/cli/index.ts`;
  // The waiter's tsx launcher, the waiter itself, and the released loop it ran as a foreground child.
  const launcher: ProcessRow = {
    argv: `node ${REPO}/node_modules/.bin/tsx ${entry} claude watch --wait`,
    pid: 4200,
    ppid: 1,
  };
  const waiter: ProcessRow = {
    argv: `node --require x/preflight.cjs ${entry} claude watch --wait`,
    pid: 4201,
    ppid: 4200,
  };
  const loop: ProcessRow = { argv: `node --require x/preflight.cjs ${entry} claude watch`, pid: 4242, ppid: 4201 };

  // The second counterexample: the record names a duplicate that stamped and died, and the running
  // watch must still be an incumbent. It carries no --wait, so it is one without the record's word.
  it("refuses a new start beside a released loop whatever the record names", () => {
    expect(
      claudeWatchStartDecision({
        processId: 700,
        recorded: { cwd: REPO, pid: 5151 },
        snapshot: { kind: "rows", rows: [launcher, waiter, loop] },
      }),
    ).toStrictEqual({ kind: "occupied", watchers: [{ cwd: REPO, pid: 4242, ppid: 4201, waiting: false }] });
  });

  // The released loop re-checks admission like any start. Its own waiter and launcher collapse out of the
  // snapshot, so alone it is admitted.
  it("admits the released loop when nothing else is running", () => {
    expect(
      claudeWatchStartDecision({
        processId: 4242,
        recorded: undefined,
        snapshot: { kind: "rows", rows: [launcher, waiter, loop] },
      }),
    ).toStrictEqual({ kind: "ready" });
  });

  // The third counterexample: an earlier cut trusted the waiter's admission and admitted the released
  // loop beside a visible non-waiting watch. It must refuse like any other start.
  it("refuses the released loop beside another running watch its own snapshot shows", () => {
    const other: ProcessRow = { argv: `node --require x/preflight.cjs ${entry} claude watch`, pid: 6161, ppid: 1 };
    expect(
      claudeWatchStartDecision({
        processId: 4242,
        recorded: undefined,
        snapshot: { kind: "rows", rows: [launcher, waiter, loop, other] },
      }),
    ).toStrictEqual({ kind: "occupied", watchers: [{ cwd: REPO, pid: 6161, ppid: 1, waiting: false }] });
  });

  it("refuses the waiter itself beside an incumbent, so it keeps waiting", () => {
    const incumbent: ProcessRow = { argv: `node --require x/preflight.cjs ${entry} claude watch`, pid: 6161, ppid: 1 };
    expect(
      claudeWatchStartDecision({
        processId: 4201,
        recorded: undefined,
        snapshot: { kind: "rows", rows: [launcher, waiter, incumbent] },
      }),
    ).toMatchObject({ kind: "occupied", watchers: [{ pid: 6161 }] });
  });
});
