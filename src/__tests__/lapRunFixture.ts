/**
 * The plain fakes a single-pull-request `slopweaver github lap` test drives `runGithubLap` over: a GitHub whose
 * status read-back echoes what was posted, and every other edge as a fake one option bends. Shared by the
 * `lapRun` test files, split by scenario so each stays one a reader can hold.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { errAsync, ResultAsync } from "neverthrow";

import { lapPlan } from "../cli/commands/github/lapCore.js";
import type { GithubLapDeps, LapLockHandle, LapRefs } from "../cli/commands/github/lapDeps.js";
import { LapErrors } from "../cli/commands/github/lapErrors.js";
import {
  type LapReceipt,
  type LapReceiptEvidence,
  lapStepKey,
  type StandingHold,
} from "../cli/commands/github/lapVerdict.js";
import type { CommitStatus, RequiredCheckSources } from "../corpus/github/writeStatus.js";
import type { IngestError } from "../lib/ingestError.js";
import { err, ok } from "../lib/result.js";
import type { GithubLapApi } from "../outbound/github/lapApi.js";
import { memoryDoorLedger } from "./doorLedgerFixture.js";

export const BASE = "4cf8df588ae4aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const HEAD = "777de6d8be0fbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const ARGS = ["--repo", "o/r", "--number", "7"];

/** A held lap lock whose advance to `running` always succeeds: the fake every lap test holds. */
export const ADVANCING_LOCK: LapLockHandle = { advance: () => ok(undefined) };

/** A base requiring both lap contexts, each pinned to the hosted-Actions app, as this repository's `main` was. */
export const ACTIONS_PINNED_SOURCES: RequiredCheckSources = {
  kind: "required",
  sources: [
    { appId: 15368, context: "build" },
    { appId: 15368, context: "integration" },
  ],
};

/** What one fake lap observed, for the assertions. */
export interface Observed {
  readonly out: string[];
  readonly diagnostic: string[];
  readonly ran: string[];
  readonly envs: Readonly<Record<string, string>>[];
  readonly posted: { context: string; state: string; sha: string }[];
  readonly disposed: string[];
  readonly landing: string[];
  readonly receipts: LapReceipt[];
  /** Every pause the lap took between two status read-backs, in ms. */
  readonly waits: number[];
}

/**
 * One scripted status read-back: `lag` answers what GitHub held BEFORE this lap posted anything, as its list does
 * while it trails the POST; an error answers that failure.
 */
export type ScriptedRead = "lag" | IngestError;

/** A plain fake GitHub whose status read-back echoes what was posted, after any scripted reads are spent. */
function lapApi({
  observed,
  admin,
  preposted = [],
  reads = [],
}: {
  observed: Observed;
  admin: boolean;
  preposted?: readonly CommitStatus[];
  reads?: readonly ScriptedRead[];
}): GithubLapApi {
  const stored: CommitStatus[] = [...preposted];
  const script = [...reads];
  return {
    isAdmin: () => ResultAsync.fromSafePromise(Promise.resolve(admin)),
    mergeRecord: () => ResultAsync.fromSafePromise(Promise.resolve({ mergedAtIso: undefined, state: "open" })),
    postStatus: ({ context, state, description, sha }) => {
      observed.posted.push({ context, sha, state });
      const status = { context, description, state };
      stored.unshift(status);
      return ResultAsync.fromSafePromise(Promise.resolve(status));
    },
    protection: () =>
      ResultAsync.fromSafePromise(Promise.resolve({ enforceAdmins: false, kind: "protected" as const })),
    read: () =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          baseRef: "main",
          baseSha: BASE,
          body: "",
          draft: false,
          headRef: "a-branch",
          headSha: HEAD,
          number: 7,
          stack: undefined,
          stackQueue: undefined,
          state: "open",
          title: "t",
          url: "https://github.com/o/r/pull/7",
        }),
      ),
    requiredSources: () => ResultAsync.fromSafePromise(Promise.resolve(ACTIONS_PINNED_SOURCES)),
    statuses: () => {
      const next = script.shift();
      if (next === undefined) {
        return ResultAsync.fromSafePromise(Promise.resolve([...stored]));
      }
      if (next === "lag") {
        return ResultAsync.fromSafePromise(Promise.resolve([...preposted]));
      }
      return errAsync(next);
    },
  };
}

let homes: string[] = [];

/**
 * Hand over every state home `depsFor` minted since the last call, and forget them; a test file removes each from
 * its own `afterEach`, so the removal stays in a `*.test.ts` the door-coverage scan exempts.
 *
 * @returns the minted home directories, oldest first
 */
export function takeLapHomes(): readonly string[] {
  const taken = homes;
  homes = [];
  return taken;
}

/** A disposer that records `name` as disposed. */
function disposerFor({ observed, name }: { observed: Observed; name: string }): () => Promise<void> {
  return () => Promise.resolve(void observed.disposed.push(name));
}

/** The edges no option bends: a fixed environment and clock, and sinks that record what the lap wrote. */
function fixedDeps({
  observed,
}: {
  observed: Observed;
}): Pick<
  GithubLapDeps,
  | "ambientEnv"
  | "cleanTree"
  | "commitFacts"
  | "doorLedger"
  | "memberMergeFacts"
  | "now"
  | "out"
  | "pid"
  | "release"
  | "simulateSquash"
  | "token"
  | "toolCaches"
  | "wait"
  | "writeDiagnostic"
  | "writeReceipt"
> {
  return {
    ambientEnv: {
      GITHUB_TOKEN: "seat-token",
      HOME: "/Users/seat",
      PATH: "/bin",
      POLLY_MODE: "record",
      SLOPWEAVER_HOME: "/operator",
    },
    cleanTree: () => ok(undefined),
    commitFacts: () => err(LapErrors.refused({ reason: "a single lap never reads a landed commit back" })),
    doorLedger: memoryDoorLedger().port,
    memberMergeFacts: () => err(LapErrors.refused({ reason: "a single lap never measures a batch member" })),
    now: () => new Date("2026-11-10T03:00:00.000Z"),
    out: (line) => observed.out.push(line),
    pid: 4242,
    release: () => Promise.resolve(void observed.landing.push("release")).then(() => 0),
    simulateSquash: () => err(LapErrors.refused({ reason: "a single lap never simulates a squash" })),
    token: () => "token",
    toolCaches: { YARN_GLOBAL_FOLDER: "/Users/seat/.yarn/berry" },
    wait: ({ ms }) => Promise.resolve(void observed.waits.push(ms)),
    writeDiagnostic: (line) => observed.diagnostic.push(line),
    writeReceipt: ({ receipt }) => observed.receipts.push(receipt),
  };
}

/** A ref fetch answering HEAD over BASE, then `refsAfter` (when set) on every fetch after the first. */
function fakeFetchRefs({
  observed,
  refsAfter,
}: {
  observed: Observed;
  refsAfter: LapRefs | undefined;
}): GithubLapDeps["fetchRefs"] {
  let fetches = 0;
  return () => {
    fetches += 1;
    if (fetches > 1) {
      observed.landing.push("fetch");
    }
    if (fetches > 1 && refsAfter !== undefined) {
      return Promise.resolve(ok(refsAfter));
    }
    return Promise.resolve(ok({ baseTip: BASE, headSha: HEAD }));
  };
}

/** A step runner that records each step and exits 1 for an id listed in `red`. */
function fakeRunStep({ observed, red }: { observed: Observed; red: readonly string[] }): GithubLapDeps["runStep"] {
  return ({ step, env }) => {
    observed.ran.push(step.id);
    observed.envs.push(env);
    return Promise.resolve({
      context: step.context,
      exitCode: red.includes(step.id) ? 1 : 0,
      id: step.id,
      wallMs: 1000,
    });
  };
}

/** A proof store that starts, or refuses to when `storeFails`. */
function fakeStartStore({
  observed,
  storeFails,
}: {
  observed: Observed;
  storeFails: boolean;
}): GithubLapDeps["startStore"] {
  return () =>
    Promise.resolve(
      storeFails
        ? err(LapErrors.storeUnavailable({ why: "would not start" }))
        : ok({
            dispose: disposerFor({ name: "store", observed }),
            value: { STORE_PROOF_ADMIN_URL: "postgresql://x" },
          }),
    );
}

/**
 * Fakes for every edge; each option bends one of them.
 *
 * @param reads the status read-backs GitHub answers before it starts echoing what was posted, in order
 * @param preposted statuses the head already carries before this invocation, newest first
 * @param receipts the receipts the state home keeps for the pull request, as `--land-only` reads them back
 * @param red the step ids that run red; a retry runs as `<id>.retry`, so it is red only when listed too
 * @param holder what the hold store reads before the lap tries to hold, `clear` when unset
 * @returns the deps a `runGithubLap` call runs over
 */
export function depsFor({
  observed,
  red = [],
  contains = true,
  differing = [],
  storeFails = false,
  refsAfter,
  mergeExit = 0,
  landingExit = 0,
  holdExit = 0,
  holder = { kind: "clear" },
  preposted = [],
  receipts = [],
  reads = [],
}: {
  observed: Observed;
  reads?: readonly ScriptedRead[];
  preposted?: readonly CommitStatus[];
  receipts?: readonly LapReceiptEvidence[];
  red?: readonly string[];
  contains?: boolean;
  differing?: readonly string[];
  storeFails?: boolean;
  refsAfter?: LapRefs;
  mergeExit?: number;
  /** What `github merge --admin --dry-run`, run before the lap's first step under `--land`, exits. */
  landingExit?: number;
  holdExit?: number;
  holder?: StandingHold;
}): GithubLapDeps {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-run-"));
  homes.push(home);
  return {
    ...fixedDeps({ observed }),
    acquireLock: () => ok({ dispose: disposerFor({ name: "lock", observed }), value: ADVANCING_LOCK }),
    checkout: () => Promise.resolve(ok({ dispose: disposerFor({ name: "tree", observed }), value: "/tree" })),
    fetchRefs: fakeFetchRefs({ observed, refsAfter }),
    hold: () => Promise.resolve(void observed.landing.push("hold")).then(() => holdExit),
    home: () => home,
    isAncestor: () => ok(contains),
    laneHome: () => ({ dispose: disposerFor({ name: "lane-home", observed }), value: "/lane-home" }),
    lapSeatFacts: () => ok({ callerRun: undefined, seat: undefined, seatRunClosed: false }),
    logDir: () => home,
    makeApi: () => lapApi({ admin: true, observed, preposted, reads }),
    landingPreconditions: ({ tree }) =>
      Promise.resolve(void observed.landing.push(`landing preconditions in ${tree}`)).then(() => landingExit),
    merge: ({ tree }) => Promise.resolve(void observed.landing.push(`merge in ${tree}`)).then(() => mergeExit),
    planSourcesDiffering: () => ok(differing),
    readReceipts: () => receipts,
    runStep: fakeRunStep({ observed, red }),
    standingHold: () => holder,
    startStore: fakeStartStore({ observed, storeFails }),
  };
}

/**
 * A receipt of a finished lap at HEAD over BASE with every planned step green.
 *
 * @returns the receipt `--land-only` accepts as earned
 */
export function earnedReceipt(): LapReceiptEvidence {
  return {
    baseTip: BASE,
    headSha: HEAD,
    outcomes: lapPlan().map((step) => ({ exitCode: 0, id: step.id })),
    phase: "finished",
    plan: lapPlan().map((step) => lapStepKey(step)),
  };
}

/**
 * A fresh observation record.
 *
 * @returns every list empty
 */
export function observe(): Observed {
  return {
    diagnostic: [],
    disposed: [],
    envs: [],
    landing: [],
    out: [],
    posted: [],
    ran: [],
    receipts: [],
    waits: [],
  };
}
