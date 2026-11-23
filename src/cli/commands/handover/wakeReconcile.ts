/**
 * The effectful half of `handover wake`'s reconcile of a park whose pull request ENDED: one head read of that pull
 * request and one branch read of the parked seat's worktree, handed to `../../../handover/parkedLanding.ts`'s pure
 * classifier — and, for a row it classes `landed` whose finish then closed the run, the `handover close` that lets
 * the row derive `done` rather than stand as AWAITING SHIP. `./wakeRows.ts`'s finish pass runs both, so the pass
 * that reads the landing is the pass that settles it.
 */
import { existsSync } from "node:fs";

import { err, type Result } from "#lib/result.js";

import { githubToken } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { classifyParkedLanding, landedCloseSummary, type ParkedLanding } from "../../../handover/parkedLanding.js";
import type { WakeCandidate } from "../../../handover/wakeCandidates.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import { makeFetchPrHead, type PrHead } from "../../../live/github/prHead.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { stateHomePaths } from "../../../stateHome.js";
import { closeUnderClosingLock } from "./closeUnderLock.js";
import { type DueJudgement, WAKE_CHECKS_READ_TIMEOUT_MS } from "./wakeJudge.js";
import type { HandoverWakeDeps, WakeRowReport } from "./wakeRows.js";

/** How many reconciled parks came to each outcome. */
export interface ReconciliationCounts {
  /** Landed rows closed — or that would be, on a dry run. */
  readonly settled: number;
  /** Landed rows something else settled or held this run: the park moved, a guard held it, or the close failed. */
  readonly landedUnsettled: number;
  readonly hidingStep: number;
  readonly closedUnmerged: number;
  readonly unknown: number;
}

/**
 * Count the reconciled rows by outcome.
 *
 * @param rows every row the run reported
 * @returns the counts
 */
export function reconciliationCounts({ rows }: { rows: readonly WakeRowReport[] }): ReconciliationCounts {
  const kinds = rows.map((row) => row.reconciliation?.kind);
  const settled = rows.filter((row) => row.closeOutcome === "closed" || row.closeOutcome === "would-close").length;
  return {
    closedUnmerged: kinds.filter((kind) => kind === "closed-unmerged").length,
    hidingStep: kinds.filter((kind) => kind === "hiding-step").length,
    landedUnsettled: kinds.filter((kind) => kind === "landed").length - settled,
    settled,
    unknown: kinds.filter((kind) => kind === "unknown").length,
  };
}

/**
 * The text report's closing reconcile line, printed only when some row was reconciled.
 *
 * @param counts the run's counts
 * @param mode the dry-run marker the run's own summary carries, or empty
 * @param rows every row the run reported
 * @returns the line, or `undefined` when no row's pull request had ended
 */
export function reconciliationSummary({
  counts,
  mode,
  rows,
}: {
  counts: ReconciliationCounts;
  mode: string;
  rows: readonly WakeRowReport[];
}): string | undefined {
  if (!rows.some((row) => row.reconciliation !== undefined)) {
    return undefined;
  }
  return (
    `reconcile${mode}: ${String(counts.settled)} landed and settled, ${String(counts.landedUnsettled)} landed but not settled, ` +
    `${String(counts.hidingStep)} hiding a step, ${String(counts.closedUnmerged)} closed unmerged, ` +
    `${String(counts.unknown)} unknown`
  );
}

/**
 * One reconciled row's class, for the text report.
 *
 * @param landing the class
 * @returns the phrase
 */
export function reconciliationPhrase({ landing }: { landing: ParkedLanding }): string {
  switch (landing.kind) {
    case "landed": {
      return `landed (${landing.headRefName})`;
    }
    case "hiding-step": {
      return `HIDING A STEP — ${landing.cause}: ${landing.detail}`;
    }
    case "closed-unmerged": {
      return `CLOSED UNMERGED (${landing.headRefName}) — the work is still owed; its reseat decides it`;
    }
    case "unknown": {
      return `unknown — ${landing.reason}`;
    }
    default: {
      const unreachable: never = landing;
      return unreachable;
    }
  }
}

/**
 * The production head read the reconcile makes: one small GraphQL query per ended pull request, cut at
 * {@link WAKE_CHECKS_READ_TIMEOUT_MS} by an unreferenced timer, so it stays inside the tick's wake reading budget.
 *
 * @param home the state home whose GitHub token the read uses
 * @param repo the `owner/repo` the park waited on
 * @param number the pull request's number
 * @returns the head, or a named read failure
 */
export async function productionReadPrHead({
  home,
  number,
  repo,
}: {
  home: string;
  repo: string;
  number: number;
}): Promise<Result<PrHead, GithubLiveError>> {
  const fetchHead = makeFetchPrHead({ graphql: githubReadGraphql({ token: githubToken({ home }) }) });
  const slash = repo.indexOf("/");
  const cut = new Promise<Result<PrHead, GithubLiveError>>((resolve) => {
    setTimeout(() => {
      resolve(
        err(GithubLiveErrors.readFailed({ message: `the head read passed ${String(WAKE_CHECKS_READ_TIMEOUT_MS)}ms` })),
      );
    }, WAKE_CHECKS_READ_TIMEOUT_MS).unref();
  });
  return Promise.race([fetchHead({ number, owner: repo.slice(0, slash), repo: repo.slice(slash + 1) }), cut]);
}

/**
 * The production close: `handover close`'s own write, under the row's closing lock and past its uncarded-page gate,
 * run in-process — the wake already holds the doc, so a second board scan per row buys nothing.
 *
 * @param doc the row's doc
 * @param home the state home holding its journal and lock
 * @param summary what shipped
 * @returns the journal path written, or `undefined` when the close refused, its reason already on stderr
 */
export function productionClose({
  doc,
  home,
  summary,
}: {
  doc: HandoverDoc;
  home: string;
  summary: string;
}): string | undefined {
  const written = closeUnderClosingLock({
    doc,
    home,
    nowIso: new Date().toISOString(),
    runsDir: stateHomePaths({ home }).runs,
    summary,
  });
  if (typeof written === "number") {
    return undefined;
  }
  return written.path;
}

/**
 * Classify one due park whose pull request merged or closed; a clock park, or a checks park still open, is none of
 * the reconcile's business.
 *
 * @param candidate the park, with its doc's and journal's stated branches
 * @param judgement the park's due judgement
 * @returns the class, or `undefined` when the park's pull request has not ended
 */
export async function reconcileDueRow({
  candidate,
  deps,
  home,
  judgement,
}: {
  candidate: WakeCandidate;
  deps: Pick<HandoverWakeDeps, "readBranch" | "readPrHead">;
  home: string;
  judgement: DueJudgement;
}): Promise<ParkedLanding | undefined> {
  const { observed } = judgement;
  if (observed.kind !== "checks" || observed.prState === "OPEN") {
    return undefined;
  }
  const { parked, statedBranches } = candidate;
  // A synchronous throw from the seam becomes a rejection, so both reach the `.catch` (as `./parkOwnLanding.ts`).
  const head: Result<PrHead, GithubLiveError> = await Promise.resolve()
    .then(() => deps.readPrHead({ home, number: observed.number, repo: observed.repo }))
    .catch((cause: unknown) => err(GithubLiveErrors.readFailed({ cause, message: "the head read threw" })));
  const worktree = worktreeBranch({ deps, worktree: parked.worktree });
  const ownBranches = [...new Set([...statedBranches, ...worktree.branches])];
  return classifyParkedLanding({
    branchUnread: worktree.unread,
    draftCount: parked.drafts === undefined ? 0 : parked.drafts.length,
    head: head.isOk()
      ? { headRefName: head.value.headRefName, kind: "read" }
      : { kind: "unread", reason: head.error.message },
    ownBranches,
    prState: observed.prState,
    question: parked.question,
  });
}

/** The branch the parked seat's worktree has out now, or why it is unknown. */
function worktreeBranch({ deps, worktree }: { deps: Pick<HandoverWakeDeps, "readBranch">; worktree: string }): {
  readonly branches: readonly string[];
  readonly unread: string | undefined;
} {
  if (!existsSync(worktree)) {
    return { branches: [], unread: `its worktree ${worktree} is gone, so the branch it had out is unknown` };
  }
  const read = deps.readBranch({ cwd: worktree });
  if (read.isErr()) {
    return { branches: [], unread: `the branch at ${worktree} did not read: ${read.error.message}` };
  }
  if (read.value === null) {
    return { branches: [], unread: `${worktree} is detached, so its branch is unknown` };
  }
  return { branches: [read.value], unread: undefined };
}

/**
 * What a landed row's finish came to, folded into its class: a finish that did not close the run turns `landed`
 * into a row hiding a step (`finish-refusal`), naming why.
 *
 * @param landing the class read before the finish
 * @param finishWhy why the finish did not close the run, when it did not
 * @returns the class the row reports
 */
export function afterFinish({
  finishWhy,
  landing,
}: {
  finishWhy: string | undefined;
  landing: ParkedLanding;
}): ParkedLanding {
  if (landing.kind !== "landed" || finishWhy === undefined) {
    return landing;
  }
  return { cause: "finish-refusal", detail: finishWhy, kind: "hiding-step" };
}

/**
 * Record `handover close` on a landed row its finish closed — or say it would, on a dry run — so the row derives
 * `done`. A row the finish did not close, or that was not classed `landed`, is returned unchanged.
 *
 * @param candidate the park, whose doc the close is recorded against
 * @param judgement the due judgement, whose merge commit is the close's witness
 * @param landing the row's class
 * @param row what the finish came to
 * @returns the row, with its close outcome when one was attempted
 */
export function closeLanded({
  candidate,
  deps,
  home,
  judgement,
  landing,
  row,
}: {
  candidate: WakeCandidate;
  deps: Pick<HandoverWakeDeps, "close">;
  home: string;
  judgement: DueJudgement;
  landing: ParkedLanding;
  row: WakeRowReport;
}): WakeRowReport {
  if (landing.kind !== "landed" || (row.action !== "finished" && row.action !== "would-finish")) {
    return row;
  }
  const { observed, mergeCommitOid } = judgement;
  if (observed.kind !== "checks" || mergeCommitOid === undefined) {
    return { ...row, closeOutcome: "close-failed", detail: `${row.detail}; no merge commit to record its close by` };
  }
  const summary = landedCloseSummary({
    headRefName: landing.headRefName,
    mergeCommitOid,
    number: observed.number,
    repo: observed.repo,
  });
  if (row.action === "would-finish") {
    return { ...row, closeOutcome: "would-close", detail: `${row.detail}; would record handover close: ${summary}` };
  }
  const closed = deps.close({ doc: candidate.doc, home, summary });
  if (closed === undefined) {
    return {
      ...row,
      closeOutcome: "close-failed",
      detail: `${row.detail}; handover close refused to write, its reason printed above`,
    };
  }
  return { ...row, closeOutcome: "closed", detail: `${row.detail}; handover close recorded it shipped (${summary})` };
}
