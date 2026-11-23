/**
 * The seam contract of `slopweaver github lap`: every process, file and network edge the orchestration in
 * `./lapRun.ts` and `./lapPhases.ts` reaches, as one interface a unit test fills with plain fakes and
 * `./lapShell.ts` fills for production. Types only.
 */

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { Result } from "../../../lib/result.js";
import type { GithubLapApi } from "../../../outbound/github/lapApi.js";
import type { LandedCommit, MemberMergeFacts } from "./lapBatchCore.js";
import type { GithubLapArgs, LapStep } from "./lapCore.js";
import type { LapError } from "./lapErrors.js";
import type { LapLock } from "./lapLockShape.js";
import type { LapSeatFacts } from "./lapSeat.js";
import type { LapSeatError } from "./lapSeatStore.js";
import type { LapStepOutcome } from "./lapStatuses.js";
import type { LapReceipt, LapReceiptEvidence, StandingHold } from "./lapVerdict.js";

/** One simulated squash: the tree and one-parent commit it made, or the paths that would conflict. */
export type SquashOutcome =
  | { readonly kind: "clean"; readonly tree: string; readonly commit: string }
  | { readonly kind: "conflict"; readonly paths: readonly string[] };

/** The refs one lap fetched: the base tip and the pull request's head, both as commit shas. */
export interface LapRefs {
  readonly baseTip: string;
  readonly headSha: string;
}

/** A throwaway resource the lap must tear down whatever happens. */
export interface LapResource<T> {
  readonly value: T;
  readonly dispose: () => Promise<void>;
}

/**
 * The machine's lap lock as its holder sees it: taken in its `preflight` phase, and advanced once to `running`
 * under the full subject when the lap has a head and starts its lanes or its landing.
 */
export interface LapLockHandle {
  /** Rewrite the held lock in place as `running` under `subject`, refusing when the lock is no longer this one. */
  readonly advance: (args: { subject: string; startedIso: string }) => Result<void, LapError>;
}

/** Whether an invocation holds the machine: a dry run takes nothing, every other mode holds the lock. */
export type LapExecution = { readonly kind: "dry-run" } | { readonly kind: "held"; readonly lock: LapLockHandle };

/** Injectable edges; a unit test passes plain fakes. */
export interface GithubLapDeps {
  readonly doorLedger: DoorLedgerPort;
  readonly home: () => string;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubLapApi;
  /** Fetch the base branch and the pull request's head from `origin` into private refs, and resolve both. */
  readonly fetchRefs: (args: { baseRef: string; number: number }) => Promise<Result<LapRefs, LapError>>;
  readonly isAncestor: (args: { ancestor: string; descendant: string }) => Result<boolean, LapError>;
  /**
   * A batch's simulated squash of `head` onto `onto`: `git merge-tree --write-tree` of the two, recorded as a
   * ONE-parent commit on `onto` the way GitHub's squash records it, or the paths that conflict.
   */
  readonly simulateSquash: (args: { onto: string; head: string; message: string }) => Result<SquashOutcome, LapError>;
  /**
   * What `github merge`'s guard will measure for `head` over `base` — its `base-moved` paths, the paths the head's
   * own diff changes, and whether it contains `base` — by the guard's own `measureMergeFacts`, so the
   * acknowledgement a batch member's merge is handed is exactly what it will raise.
   */
  readonly memberMergeFacts: (args: { base: string; head: string }) => Result<MemberMergeFacts, LapError>;
  /** A commit's parents and tree, read back after a batch member lands. */
  readonly commitFacts: (args: { sha: string }) => Result<LandedCommit, LapError>;
  /**
   * Which plan-source files read differently in the RUNNING CLI's own tree (working tree included) than at
   * `headSha`: the plan is compiled into the code that runs, so the invoking directory is never the side compared.
   */
  readonly planSourcesDiffering: (args: { headSha: string }) => Result<readonly string[], LapError>;
  /** Take the machine's one lap lock, or report the live lap that holds it. */
  readonly acquireLock: (args: {
    home: string;
    lock: Omit<LapLock, "nonce">;
  }) => Result<LapResource<LapLockHandle>, LapError>;
  /** Check `sha` out detached in a fresh directory; disposing removes the tree. */
  readonly checkout: (args: { sha: string }) => Promise<Result<LapResource<string>, LapError>>;
  /** Mint the throwaway `SLOPWEAVER_HOME` every lane runs against. */
  readonly laneHome: () => LapResource<string>;
  /** Start a throwaway Postgres 17 and answer the environment the store-backed lanes read. */
  readonly startStore: () => Promise<Result<LapResource<Readonly<Record<string, string>>>, LapError>>;
  /** The seat's own environment; only `LAP_ENV_ALLOWLIST` of it reaches a lane. */
  readonly ambientEnv: Readonly<Record<string, string | undefined>>;
  /** Each download cache under the seat's real home a lane may reuse, keyed by the variable its tool reads. */
  readonly toolCaches: Readonly<Record<string, string>>;
  readonly runStep: (args: {
    step: LapStep;
    tree: string;
    env: Readonly<Record<string, string>>;
    logDir: string;
  }) => Promise<LapStepOutcome>;
  /** Remove every untracked, unignored file from the tree bar `keep`, as a fresh CI checkout would lack them. */
  readonly cleanTree: (args: { tree: string; keep: readonly string[] }) => Result<void, LapError>;
  /** Where this lap's logs and its receipt go. */
  readonly logDir: (args: { home: string; args: GithubLapArgs; startedIso: string }) => string;
  readonly writeReceipt: (args: { logDir: string; receipt: LapReceipt }) => void;
  /** Every receipt this home keeps for the pull request that parses as one; an unreadable file is no evidence. */
  readonly readReceipts: (args: { home: string; args: GithubLapArgs }) => readonly LapReceiptEvidence[];
  /**
   * Whether this pull request's repository is already held, read before `hold` and FAIL-CLOSED: a hold document
   * that cannot be read or decoded is `unreadable`, never `clear`. `github hold` answers success for a hold on
   * the SAME pull request it did not place, so this is how the lap tells its own hold from somebody else's.
   */
  readonly standingHold: (args: { args: GithubLapArgs; home: string }) => StandingHold;
  /**
   * The lap seat's designation, whether its run has closed, and the run this session holds (`./lapSeatStore.ts`),
   * read FAIL-CLOSED before anything else so an off-seat lap never reaches the network.
   */
  readonly lapSeatFacts: (args: { home: string }) => Result<LapSeatFacts, LapSeatError>;
  /** `github hold` on the pull request, answering its exit code. */
  readonly hold: (args: { args: GithubLapArgs; home: string }) => Promise<number>;
  /**
   * `github merge --admin` pinned to the lapped head with the pull request's own body, measured in `tree` (its
   * `--cwd`), answering its exit code.
   */
  readonly merge: (args: { args: GithubLapArgs; home: string; baseRef: string; tree: string }) => Promise<number>;
  /**
   * The same landing as {@link merge}, run as `github merge --admin --dry-run`: every precondition the merge
   * checks, before the lap's first step, writing nothing. Answers its exit code.
   */
  readonly landingPreconditions: (args: {
    args: GithubLapArgs;
    home: string;
    baseRef: string;
    tree: string;
  }) => Promise<number>;
  /** `github release` on the pull request. */
  readonly release: (args: { args: GithubLapArgs; home: string }) => Promise<number>;
  readonly pid: number;
  readonly now: () => Date;
  /** Pause between two status read-backs; a test passes one that records the pause and returns at once. */
  readonly wait: (args: { ms: number }) => Promise<void>;
  readonly out: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** What one invocation carries through every phase once the preflight passed. */
export interface LapSession {
  readonly args: GithubLapArgs;
  readonly deps: GithubLapDeps;
  readonly api: GithubLapApi;
  readonly home: string;
  readonly refs: LapRefs;
  readonly baseRef: string;
}
