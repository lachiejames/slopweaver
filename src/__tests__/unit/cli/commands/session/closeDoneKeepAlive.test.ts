/**
 * `session close-done`'s keep-alive arm over the whole sweep: a real temp ledger, journal and board, a fake cmux
 * that refuses an unforced close as cmux 0.65.2 does, and a retired chair as measured
 * (`../../../sessions/keepAliveChairFixture.ts`) — two retired chairs held every tick because
 * each footer counted the one shell its keep-alive runs in.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { CmuxWorkspaceSummary } from "../../../../../cmux/client.js";
import { err, ok } from "../../../../../lib/result.js";
import { ProcessTableErrors } from "../../../../../live/standing/processTableErrors.js";
import { renderCloseDoneOutcome } from "../../../../../sessions/closeDoneOutcome.js";
import {
  CHAIR_TREE,
  CHAIR_WATCH,
  COVERED,
  claudeRow,
  NO_SHELL,
  ONE_SHELL,
  SOLE,
  SUCCESSOR_QUEUED,
  shellRow,
  watchRows,
} from "../../../sessions/keepAliveChairFixture.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import {
  deps,
  home,
  openKeys,
  outcomesOf,
  registry,
  removeFixtureDirs,
  run,
  sessionRecord,
  spawnedRow,
  workspace,
} from "./closeDoneHarness.js";
import { AT_REST, PARKED_DIR, parkedFixture, SEAT_TREE } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

const TITLE = "/slopweaver:supervisor";

/** Chair 9367's own queued watch, pid 20566, and the tree that holds it. */
const OTHER_WATCH = [
  claudeRow({ pid: 30000 }),
  shellRow({ pid: 30001 }),
  ...watchRows({ child: 20566, launcher: 20565, wait: true }),
];
const OTHER_TREE = [
  {
    children: [
      {
        children: [{ children: [{ children: [], name: "node", pid: 20566 }], name: "node", pid: 20565 }],
        name: "zsh",
        pid: 30001,
      },
    ],
    name: "2.1.318",
    pid: 30000,
  },
];

/** Each chair's watch, and nothing else: they cover only each other. */
const MUTUAL = ok([...CHAIR_WATCH, ...OTHER_WATCH]);

/** One finished chair, its ledger row and its live workspace. */
function chair({
  fixture,
  n,
  title = TITLE,
}: {
  fixture: { readonly home: string };
  n: number;
  title?: string;
}): CmuxWorkspaceSummary {
  const slug = `fresh-supervisor-handoff-${String(n)}`;
  spawnedRow({ home: fixture.home, slug, workspaceRef: `workspace:${String(n)}` });
  run({ finished: true, home: fixture.home, slug });
  return workspace({
    currentDirectory: `/w/.claude/worktrees/${slug}`,
    title,
    workspaceId: `id-${String(n)}`,
    workspaceRef: `workspace:${String(n)}`,
  });
}

describe("closeDoneWithClient — a retired chair holding a keep-alive", () => {
  it("closes it forced when another watch covers its keep-alive, and says so instead of 'screen idle'", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL },
      trees: { "id-9366": [CHAIR_TREE] },
      workspaces: [chair({ fixture, n: 9366 })],
    });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: COVERED }) });

    const outcomes = outcomesOf(swept);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["closed"]);
    expect(fake.closed).toEqual(["id-9366"]);
    expect(openKeys({ home: fixture.home })).toEqual([]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomes[0]! })).toBe(
      "closed workspace:9366 fresh-supervisor-handoff-9366 — run finished, its keep-alive (pid 85912) retires with it; pid 67939 keeps the stores alive",
    );
  });

  it("holds the chair running the only keep-alive, naming why", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL },
      trees: { "id-9366": [CHAIR_TREE] },
      workspaces: [chair({ fixture, n: 9366 })],
    });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: SOLE }) });

    const outcomes = outcomesOf(swept);
    expect(fake.closed).toEqual([]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomes[0]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (it holds the only keep-alive (pid 85912); start one elsewhere with `claude watch --wait` first)",
    );
  });

  it("leaves a busy seat that is not a retired chair to the ordinary hold, never reading its tree", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL },
      workspaces: [chair({ fixture, n: 9366, title: "Some handover" })],
    });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: COVERED }) });

    expect(outcomesOf(swept)).toMatchObject([{ kind: "held", verdict: "busy" }]);
    expect("keepAlive" in outcomesOf(swept)[0]!).toBe(false);
    expect(fake.closed).toEqual([]);
  });

  // The sweep meets the newer ledger row (9367) first; which chair goes first does not matter, only that one stays.
  it("never closes two chairs whose watches cover only each other", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": ONE_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [OTHER_TREE] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: MUTUAL }) });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed", "held"]);
    expect(fake.closed).toEqual(["id-9367"]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (its only cover (pid 20566) sits in a seat this pass closed; the next pass re-reads)",
    );
  });

  it("closes both chairs in one sweep when a third watch outside both covers them", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": ONE_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [OTHER_TREE] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });
    const three = ok([...CHAIR_WATCH, ...OTHER_WATCH, ...SUCCESSOR_QUEUED]);

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: three }) });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed", "closed"]);
    expect(fake.closed).toEqual(["id-9367", "id-9366"]);
  });

  // An idle-path close spent nothing, so its still-listed watch covered the next chair.
  it("never takes a watch in a chair the idle path closed this sweep as cover, dry run included", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": NO_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [OTHER_TREE] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });

    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, processes: MUTUAL }),
    });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed", "held"]);
    expect(renderCloseDoneOutcome({ dryRun: true, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (its only cover (pid 20566) sits in a seat this pass closed; the next pass re-reads)",
    );
  });

  it("holds every later keep-alive close once a chair the idle path closed showed no processes", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": NO_SHELL },
      trees: { "id-9366": [CHAIR_TREE] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });

    const swept = await closeDoneWithClient({ deps: deps({ client: fake.client, fixture, processes: COVERED }) });

    expect(fake.closed).toEqual(["id-9367"]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (a retired chair this sweep closed did not show its processes, so its keep-alive is unknown; the next tick closes this one)",
    );
  });

  // An EMPTY tree read back ok once recorded nothing and blinded nothing.
  it("treats an idle-path chair whose tree reads back empty as unread, dry run included", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": NO_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [[]] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });

    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, processes: MUTUAL }),
    });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed", "held"]);
    expect(renderCloseDoneOutcome({ dryRun: true, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (a retired chair this sweep closed did not show its processes, so its keep-alive is unknown; the next tick closes this one)",
    );
  });

  // The closed chair's tree listed the launcher and not its loop, and the loop was
  // reparented to pid 1 before the next chair's read, so no ancestor walk reached a pid the sweep had kept.
  it("never takes a loop a closed chair's tree omitted as cover, once it is reparented", async () => {
    const fixture = home();
    const launcherOnly = [
      {
        ...OTHER_TREE[0]!,
        children: [{ ...OTHER_TREE[0]!.children[0]!, children: [{ children: [], name: "node", pid: 20565 }] }],
      },
    ];
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": NO_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [launcherOnly] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });
    const orphaned = watchRows({ child: 20566, launcher: 20565, wait: true })
      .filter((row) => row.pid === 20566)
      .map((row) => ({ ...row, ppid: 1 }));

    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        laterProcesses: ok([...CHAIR_WATCH, ...orphaned]),
        processes: MUTUAL,
      }),
    });

    expect(fake.closed).toEqual(["id-9367"]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (its only cover (pid 20566) sits in a seat this pass closed; the next pass re-reads)",
    );
  });

  it("holds every later keep-alive close once a chair the idle path closed met an unreadable process table", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL, "id-9367": NO_SHELL },
      trees: { "id-9366": [CHAIR_TREE], "id-9367": [OTHER_TREE] },
      workspaces: [chair({ fixture, n: 9366 }), chair({ fixture, n: 9367 })],
    });

    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        laterProcesses: ok([...CHAIR_WATCH, ...SUCCESSOR_QUEUED]),
        processes: err(ProcessTableErrors.unreadable({ cause: new Error("ps exited 1") })),
      }),
    });

    expect(fake.closed).toEqual(["id-9367"]);
    expect(renderCloseDoneOutcome({ dryRun: false, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (a retired chair this sweep closed did not show its processes, so its keep-alive is unknown; the next tick closes this one)",
    );
  });

  // A chair the idle PARK closed recorded nothing, so its watch covered the next chair; its
  // second pass: the park reads the tree again, and a watch only a LATER read showed was never kept.
  it.each([
    { reads: "on the first tree read", seen: "first" as const },
    { reads: "only on a later tree read", seen: "later" as const },
  ])("never takes a watch in a chair the park closed this sweep as cover, seen $reads", async ({ seen }) => {
    // The busy chair's row first, so the sweep meets the newer parking chair before it.
    const within = home();
    const busy = chair({ fixture: within, n: 9366 });
    const { fixture } = parkedFixture({ within });
    const parkedChair = workspace({ currentDirectory: PARKED_DIR, title: TITLE });
    const parkedTree = [
      { ...SEAT_TREE[0]!, children: [{ ...SEAT_TREE[0]!.children[0]!, children: OTHER_TREE[0]!.children }] },
    ];
    const reads = { first: [parkedTree], later: [SEAT_TREE, parkedTree] }[seen];
    const fake = fakeClient({
      screens: { "id-1": AT_REST, "id-9366": ONE_SHELL },
      trees: { "id-1": reads, "id-9366": [CHAIR_TREE] },
      workspaces: [parkedChair, busy],
    });

    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        dryRun: true,
        fixture,
        parkSeat: registry({ records: [sessionRecord()] }),
        processes: MUTUAL,
      }),
    });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["parked", "held"]);
    expect(renderCloseDoneOutcome({ dryRun: true, outcome: outcomesOf(swept)[1]! })).toBe(
      "held workspace:9366 fresh-supervisor-handoff-9366 — run finished, but screen busy (its only cover (pid 20566) sits in a seat this pass closed; the next pass re-reads)",
    );
  });

  it("closes nothing on a dry run, and still reports the one it would close", async () => {
    const fixture = home();
    const fake = fakeClient({
      screens: { "id-9366": ONE_SHELL },
      trees: { "id-9366": [CHAIR_TREE] },
      workspaces: [chair({ fixture, n: 9366 })],
    });

    const swept = await closeDoneWithClient({
      deps: deps({ client: fake.client, dryRun: true, fixture, processes: COVERED }),
    });

    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["closed"]);
    expect(fake.closed).toEqual([]);
    expect(openKeys({ home: fixture.home })).toEqual(["fresh-supervisor-handoff-9366"]);
  });
});
