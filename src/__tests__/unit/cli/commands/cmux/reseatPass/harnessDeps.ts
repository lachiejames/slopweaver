/** The injected deps of a `reseatPass` world: the process reads, the journalled effects, and the fixed configuration. */
import type { ReseatDeps } from "../../../../../../cli/commands/cmux/reseatPass.js";
import { ok } from "../../../../../../lib/result.js";
import {
  honestExecutables,
  honestProcessGroups,
  honestTtyHolders,
  honestTtyModes,
  memoryReseatLock,
} from "../../fleet/fleetKit.js";
import { record, TABLE } from "./fixtures.js";
import type { WorldState } from "./harnessTypes.js";

/**
 * The deps that read the machine: the process table and what hangs off it, and the registry showing each session back
 * under pid + 1000 once a line has been typed into its workspace.
 *
 * @returns the seven read deps over `state`
 */
function processReadSeams({
  state,
}: {
  state: WorldState;
}): Pick<
  ReseatDeps,
  | "readExecutables"
  | "readLiveRecords"
  | "readProcessGroups"
  | "readProcessRows"
  | "readTtyHolders"
  | "readTtyModes"
  | "readRegistry"
> {
  const { pids, relaunched, sessions } = state;
  return {
    readExecutables: ({ pids: asked }) => ok(honestExecutables({ pids: asked, rows: TABLE })),
    readLiveRecords: () =>
      ok(
        [...relaunched].map((id) =>
          record({ cwd: `/wt/${id}`, pid: pids.get(id)! + 1000, sessionId: sessions.get(id)! }),
        ),
      ),
    readProcessGroups: ({ pids: asked }) => ok(honestProcessGroups({ pids: asked })),
    readProcessRows: () => ok(TABLE),
    readTtyHolders: ({ tty }) => ok(honestTtyHolders({ rows: TABLE, tty })),
    readTtyModes: () => ok(honestTtyModes()),
    readRegistry: () =>
      ok(
        [...pids.entries()].map(([id, pid]) =>
          record({ cwd: `/wt/${id}`, pid: relaunched.has(id) ? pid + 1000 : pid, sessionId: sessions.get(id)! }),
        ),
      ),
  };
}

/**
 * The deps with an effect: each journals what it did, in the order it happened.
 *
 * @returns the five effect deps over `state`
 */
function reseatEffectSeams({
  state,
}: {
  state: WorldState;
}): Pick<ReseatDeps, "acquireReseatLock" | "awaitBootSlot" | "readBoot" | "routeCredential" | "stop"> {
  const { boots, journal, lockJournal, lockedBy, stops } = state;
  return {
    acquireReseatLock: memoryReseatLock({ heldBy: lockedBy, journal: lockJournal }),
    awaitBootSlot: () => {
      journal.push("boot-slot");
      return Promise.resolve();
    },
    readBoot: async ({ session }) => {
      journal.push(`boot ${session.sessionId}`);
      const plan = boots.get(session.sessionId);
      if (plan === undefined) {
        return { alias: "plan-one", kind: "store" };
      }
      return plan;
    },
    routeCredential: ({ plan }) => {
      journal.push(`route ${plan.workspace.workspaceId}`);
      return Promise.resolve(ok({ storeDir: "/home/unbound/seat", tokenPath: "/home/plan-one/setup-token" }));
    },
    stop: ({ pid }) => {
      journal.push(`stop ${String(pid)}`);
      return Promise.resolve(stops);
    },
  };
}

/**
 * Every dep but the client: the read and effect halves, and the fixed configuration of one pass.
 *
 * @returns the deps over `state`
 */
export function worldDeps({ state }: { state: WorldState }): Omit<ReseatDeps, "client"> {
  return {
    ...reseatEffectSeams({ state }),
    callerAncestry: () => ok(new Set([9001, 9000, 1])),
    chairSessionId: undefined,
    chairWorkspaceId: "ws-chair",
    coldShellPolls: 1,
    confirmPolls: 2,
    dryRun: false,
    env: {},
    flagModel: undefined,
    force: false,
    ledgerModels: new Map([["ws-seat", "opus"]]),
    ownWorkspaceId: "ws-own",
    pause: () => Promise.resolve(),
    readArgv: () => "claude --settings {} --resume x",
    ...processReadSeams({ state }),
    seatLine: async ({ sessionId }) => `claude seat: ON plan-one (${sessionId})`,
    spawnDefaults: ({ cwd }) => ({ envPrefix: "", pluginDir: cwd }),
    transcriptExists: () => true,
  };
}
