/**
 * The fake worlds of `cmux reseat`'s pass: a live one (each workspace runs a `claude`) and a cold one (a reopened bare
 * tab), each handing back a client and the deps to run a pass over it.
 */
import type { SeatBootPlan } from "../../../../../../claude/seatBoot.js";
import type { ReseatDeps } from "../../../../../../cli/commands/cmux/reseatPass.js";
import type { CmuxClient, CmuxProcess } from "../../../../../../cmux/client.js";
import { ok } from "../../../../../../lib/result.js";
import { CHAIR_ID, record, SEAT_ID, SHELL } from "./fixtures.js";
import { worldClient } from "./harnessClient.js";
import { worldDeps } from "./harnessDeps.js";
import type { WorldHarness, WorldState } from "./harnessTypes.js";

/**
 * A fake world: each workspace runs one `claude` (pid by workspace), its screen is `screens`, a stopped seat leaves
 * `afterStop` in its tab, and the registry shows each session back under pid + 1000 once a line has been typed into
 * its workspace.
 *
 * @returns the client and the deps but the client
 */
export function world({
  screens,
  stops = true,
  afterStop = SHELL,
  boots = new Map(),
  journal,
  lockedBy = new Set(),
  lockJournal = [],
}: {
  screens: ReadonlyMap<string, string>;
  stops?: boolean;
  /** What a tab runs once its `claude` was stopped; a bare shell by default. */
  afterStop?: readonly CmuxProcess[];
  /** What each session booted on, by session id; a session absent here is on plan-one's store. */
  boots?: ReadonlyMap<string, SeatBootPlan>;
  journal: string[];
  /** Workspaces another live reseat already holds. */
  lockedBy?: ReadonlySet<string>;
  /** Where the reseat lock's takes and releases go, apart from the effects' own journal. */
  lockJournal?: string[];
}): WorldHarness {
  const state: WorldState = {
    afterStop,
    boots,
    journal,
    lockedBy,
    lockJournal,
    pids: new Map([
      ["ws-seat", 393],
      ["ws-chair", 75277],
    ]),
    relaunched: new Set<string>(),
    screens,
    sessions: new Map([
      ["ws-seat", SEAT_ID],
      ["ws-chair", CHAIR_ID],
    ]),
    stops,
  };
  return { client: worldClient({ state }), deps: worldDeps({ state }) };
}

/**
 * The world with ws-chair's tab reopened COLD: a bare shell, cmux's binding naming the chair's session, and the
 * registry showing it back only once a line has been typed — while `trees` scripts what each tree read answers.
 *
 * @returns the client and the deps but the client
 */
export function coldWorld({ journal, trees }: { journal: string[]; trees: (readonly CmuxProcess[])[] }): WorldHarness {
  const base = world({ journal, screens: new Map() });
  let typed = false;
  const client: CmuxClient = {
    ...base.client,
    // Once the line is typed the chair's session (pid 80000) runs under the tab's shell.
    workspaceTop: () =>
      Promise.resolve(
        ok({
          surfaces: 1,
          trees: typed
            ? [{ children: [{ children: [], name: "2.1.287", pid: 80000 }], name: "zsh", pid: 1 }]
            : trees.shift()!,
          ttys: [],
          unattributedTtyPids: [],
        }),
      ),
    readResumeBinding: () =>
      Promise.resolve(
        ok({
          argv: `--settings {} --resume ${CHAIR_ID}`,
          checkpointId: CHAIR_ID,
          cwd: "/wt/ws-chair",
          source: "resume_binding",
        }),
      ),
    sendLine: (options) => {
      typed = true;
      return base.client.sendLine(options);
    },
  };
  const deps: Omit<ReseatDeps, "client"> = {
    ...base.deps,
    readLiveRecords: () => ok(typed ? [record({ cwd: "/wt/ws-chair", pid: 80000, sessionId: CHAIR_ID })] : []),
    readRegistry: () => ok(typed ? [record({ cwd: "/wt/ws-chair", pid: 80000, sessionId: CHAIR_ID })] : []),
  };
  return { client, deps };
}
