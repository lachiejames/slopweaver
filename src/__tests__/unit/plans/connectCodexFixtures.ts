/**
 * The shared fakes for the Codex Connect tests (`connectCodex.test.ts`, `connectCodexWorker.test.ts`,
 * `connectCodexStore.test.ts`): a fixed register, a fake sign-in, and a journal of every effect, over a temp home the
 * calling test owns. Plain values and functions passed in, never a mock.
 */
import { readdirSync } from "node:fs";

import type { CodexLoginRun } from "../../../codex/loginExchange.js";
import type { SyncOutcome } from "../../../codexPlugin/plan.js";
import { err, ok } from "../../../lib/result.js";
import type { CodexConnectDeps } from "../../../plans/connectCodexRecord.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import type { PlanMutation, PlanRegisterSnapshot } from "../../../plans/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { row, snapshotOf } from "../cli/commands/plans/plansRunFixtures.js";

export const START_MS = Date.parse("2026-11-07T10:00:00.000Z");
export const OTHER_STORE = "/nowhere/.codex-other";
/** The fake processes: this one, alive, and one that has exited. */
export const LIVE_PID = 4242;
export const DEAD_PID = 1;
/** The id every fake start mints. */
export const ATTEMPT_ID = "0123abcd4567ef89";
export const SIGNED_IN: readonly string[] = [
  'start\t{"id":2,"result":{"type":"chatgpt","loginId":"l-1","authUrl":"https://auth.openai.com/oauth/authorize"}}',
  "opened\t",
  'completed\t{"method":"account/login/completed","params":{"loginId":"l-1","success":true}}',
  'account\t{"id":3,"result":{"account":{"type":"chatgpt","email":"b@example.com"}}}',
];

/** What one fake run recorded. */
export interface Journal {
  readonly launched: string[];
  /** Every rename, as `<from> -> <to>`. */
  readonly moved: string[];
  readonly mutations: PlanMutation[];
  readonly removed: string[];
  readonly reserved: string[];
  /** Every Codex home the install ran into, in order. */
  readonly synced: string[];
}

/** What the fake install answers unless a test names another: one home, already current. */
export const SYNC_CURRENT: SyncOutcome = {
  did: "synced",
  homes: [{ codexHome: "/fixture/codex-home", did: "current", trusted: undefined, why: "the install is on HEAD" }],
};

/** The store-directory effects, over an in-memory reservation map, each journalled. */
function fakeStoreDeps({
  journal,
  moves,
  removeFails,
  reservations,
  standing,
}: {
  journal: Journal;
  /** Flipped by the first rename, so a register read after it can answer differently. */
  moves: { once: boolean };
  removeFails: string | undefined;
  reservations: Map<string, string>;
  standing: readonly string[];
}): Pick<CodexConnectDeps, "readStoreReservation" | "removeStoreDir" | "reserveStoreDir" | "retireStoreDir"> {
  return {
    readStoreReservation: ({ storeDir }) => ok(reservations.get(storeDir)),
    removeStoreDir: ({ storeDir }) => {
      journal.removed.push(storeDir);
      if (removeFails !== undefined) {
        return err(removeFails);
      }
      return ok(undefined);
    },
    reserveStoreDir: ({ attemptId, storeDir }) => {
      if (standing.includes(storeDir)) {
        return ok(false);
      }
      journal.reserved.push(storeDir);
      reservations.set(storeDir, attemptId);
      return ok(true);
    },
    retireStoreDir: ({ storeDir }) => {
      // A fixed name the tests can spell; the real one is `mkdtemp`'s.
      const holding = `${storeDir}.retired-${ATTEMPT_ID}`;
      journal.moved.push(`${storeDir} -> ${holding}/store`);
      moves.once = true;
      const held = reservations.get(storeDir);
      reservations.delete(storeDir);
      if (held !== undefined) {
        reservations.set(`${holding}/store`, held);
      }
      return ok(holding);
    },
  };
}

/** The install seam, journalling each home it is handed before answering what the test chose. */
function fakeSyncDeps({
  journal,
  sync,
}: {
  journal: Journal;
  sync: (input: { readonly codexHome: string }) => SyncOutcome;
}): Pick<CodexConnectDeps, "syncCodexPluginHome"> {
  return {
    syncCodexPluginHome: ({ codexHome }) => {
      journal.synced.push(codexHome);
      return sync({ codexHome });
    },
  };
}

/**
 * Deps over a temp home: a fixed register, a fake sign-in, and a journal of every effect.
 *
 * @returns the deps every Connect function takes
 */
export function fakeDeps({
  journal,
  register,
  registerAfterMove = undefined,
  removeFails = undefined,
  reservations = new Map<string, string>(),
  signIn,
  standing = [],
  sync = () => SYNC_CURRENT,
  writeAnswer = undefined,
}: {
  journal: Journal;
  register: PlanRegisterSnapshot;
  /** When set, every register read after the first rename answers this — a `plans add` committed mid-removal. */
  registerAfterMove?: PlanRegisterSnapshot | undefined;
  /** Each store's reservation file, by store directory; a test edits it to stand in for a directory's contents. */
  reservations?: Map<string, string>;
  /** When set, every removal answers this error instead of succeeding. */
  removeFails?: string | undefined;
  signIn: (input: { readonly signInUrlPath: string }) => CodexLoginRun;
  /** Store directories already standing before the start, which a reservation must skip rather than adopt. */
  standing?: readonly string[];
  /** What the install answers, called once per run into the home it is handed; a test may act inside it. */
  sync?: (input: { readonly codexHome: string }) => SyncOutcome;
  /** When set, every register write answers this error instead of the snapshot. */
  writeAnswer?: PlanRegisterError | undefined;
}): CodexConnectDeps {
  let clock = START_MS;
  const moves = { once: false };
  return {
    ...fakeStoreDeps({ journal, moves, removeFails, reservations, standing }),
    launchWorker: ({ id }) => {
      journal.launched.push(id);
      return ok(undefined);
    },
    mintId: () => ATTEMPT_ID,
    nowMs: () => {
      clock += 1000;
      return clock;
    },
    readRegister: async () => {
      if (moves.once && registerAfterMove !== undefined) {
        return ok(registerAfterMove);
      }
      return ok(register);
    },
    runSignIn: (input) => signIn(input),
    processAlive: ({ pid }) => pid === LIVE_PID,
    processId: () => LIVE_PID,
    ...fakeSyncDeps({ journal, sync }),
    wait: async () => undefined,
    writeRegister: async ({ mutation }) => {
      journal.mutations.push(mutation);
      if (writeAnswer !== undefined) {
        return err(writeAnswer);
      }
      return ok(register);
    },
  };
}

/**
 * The lock generation files standing under a home, by name.
 *
 * @returns the sorted lock file names
 */
export function lockFiles({ home }: { home: string }): string[] {
  return readdirSync(stateHomePaths({ home }).live.planConnectionsDir)
    .filter((name) => name.includes(".lock."))
    .toSorted();
}

/**
 * A journal with nothing recorded yet.
 *
 * @returns an empty journal
 */
export function emptyJournal(): Journal {
  return { launched: [], moved: [], mutations: [], removed: [], reserved: [], synced: [] };
}

/** A fresh install: nothing adopted, one Claude plan signed in, no Codex row — a login on the machine is none. */
export const freshInstall = snapshotOf({ plans: [row()], source: "derived" });
export const adopted = snapshotOf({
  plans: [row({ alias: "codex-other", provider: "codex", storeDir: OTHER_STORE })],
});
