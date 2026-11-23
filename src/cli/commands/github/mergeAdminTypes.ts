/**
 * The contract of `github merge --admin` (`./mergeAdminRun.ts`): the edges it is handed and the request it
 * carries. Kept apart from the run so the run file holds behaviour, and so a test or a sibling verb can name
 * the contract without loading what performs it.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { BaselineBumpWitnessReader } from "../../../codex/baselineBumpWitnessRun.js";
import type { LocalCodexLoopReader } from "../../../codex/landingGateRun.js";
import type { SupervisorEvent } from "../../../events/event.js";
import type { GithubAdminMergeApi } from "../../../outbound/github/adminMerge.js";
import type { MergeDocsBudgetSweep } from "../../../outbound/github/docsBudgetSweep.js";
import type { BaseFreshness, BaseFreshnessAcknowledgement } from "./baseFreshnessCore.js";
import type { GithubVerbResult } from "./errors.js";
import type { WalkthroughStepDeps } from "./walkthroughStep.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface GithubAdminMergeDeps {
  /** The door ledger the merge's decision is recorded through before GitHub is asked to merge. */
  readonly doorLedger: DoorLedgerPort;
  readonly token: (args: { home: string }) => string | undefined;
  readonly makeApi: (args: { home: string; token: string }) => GithubAdminMergeApi;
  /** The commit a local ref resolves to, or why it does not resolve. */
  readonly localSha: (args: { cwd: string; ref: string }) => GithubVerbResult<string>;
  /** A freshly fetched remote tip, compared against the local head — `github push`'s own measurement. */
  readonly measureBaseFreshness: (args: {
    cwd: string;
    remote: string;
    baseBranch: string;
    headSha: string;
  }) => GithubVerbResult<BaseFreshness>;
  /** The base branch's own docs budget, measured against a fresh fetch — run only AFTER a merge lands. */
  readonly probePostMergeDocsBudget: (args: {
    cwd: string;
    remote: string;
    baseBranch: string;
  }) => MergeDocsBudgetSweep;
  /** Read this PULL REQUEST's pairing-floor evidence. A seam so the wiring is testable with a plain function. */
  readonly readCodexLoop: LocalCodexLoopReader;
  /** Read whether every ratchet bump the pull request adds has its Codex witness (`./baselineBumpGate.ts`). */
  readonly readBumpWitness: BaselineBumpWitnessReader;
  readonly nowIso: () => string;
  /** Publishes to the supervisor stream, warning rather than throwing on a write failure. */
  readonly publishAlert: (args: { event: SupervisorEvent; home: string }) => void;
  /**
   * Clears this repository's merge hold, but only when the pull request just merged is the one holding it.
   * A no-op when no hold stands, or when the hold is somebody else's.
   */
  readonly releaseOwnHold: (args: { home: string; pr: number; repo: string; sha: string }) => void;
  /** The author's own open walkthrough threads, resolved immediately before the merge (`./walkthroughStep.ts`). */
  readonly walkthrough: WalkthroughStepDeps;
  readonly out: (args: { line: string }) => void;
}

/**
 * Whether an admin run MERGES, or runs every check the merge would and stops before the first write. A `dry-run` is
 * what `github lap --land` runs before its first lane, so a landing the merge would refuse costs no lap.
 */
export type AdminMergeExecution = "merge" | "dry-run";

/** What one admin merge needs to know, beyond the guard's own arguments. */
export interface AdminMergeRequest {
  readonly execution: AdminMergeExecution;
  readonly repo: string;
  readonly number: number;
  readonly base: string;
  readonly head: string;
  readonly remote: string;
  readonly repoRoot: string;
  readonly home: string;
  readonly acknowledgement: BaseFreshnessAcknowledgement;
}
