/**
 * The effectful half of the landing floor: read what THIS MACHINE records about ONE PULL REQUEST's loop.
 *
 * Every failure here — no checkout holding the pull request's head commit, an unreadable orchestration
 * directory, a scan that skipped a record — becomes `unreadable` with a reason, never an empty failure list.
 * That is the single rule this file exists to hold: uncertainty must not be able to look like a clean loop,
 * because the landing guard treats a clean loop as permission to merge.
 *
 * ## Why it asks several checkouts, and not the one it is running in
 *
 * Pass records live under `$SLOPWEAVER_HOME/orchestration`, which every worktree on the machine shares, and
 * each record names the `repoRoot` it was taken in. The authoring session's evidence has therefore always
 * been on disk and readable — the old reader simply refused to look at it, because it only ever asked the
 * checkout the verb happened to be running in. A session dispatched to press someone else's pull request
 * failed that check by construction. See `./landingGate.ts`'s header for the finding and the argument that
 * this is not a loosening.
 *
 * A checkout QUALIFIES to speak for a pull request when two things hold: its `origin` is the pull request's
 * repository, and it HOLDS the pull request's head commit. The second does the real work and is answered by
 * git rather than guessed — `commitTreeFingerprint` refuses an object the checkout does not have.
 *
 * Only the checkouts that could change the verdict are asked first: the presser's own and every one some
 * evidence names on the pull request's branch (`./branchEvidenceRoots.ts` carries the argument and the
 * measurement — 965 candidates took 176s to qualify). Every candidate is asked only when none of those
 * qualifies, so the "no checkout holds that commit" refusal is unchanged.
 *
 * Kept apart from `./landingGate.ts` so the policy stays testable with plain values, per the pure-core /
 * effectful-shell split in `.claude/rules/testing.md`.
 *
 * The cap read (`./fleetCap.ts`) is the same one `codex status --check` makes, so the two never disagree
 * about whether Codex is available. It cannot change WHETHER this gate refuses — a cap is neither a plan nor
 * a review — only whether the refusal `github enqueue` prints can name rule 9's cap path. It asks the whole
 * REGISTERED FLEET rather than the ambient account, so a landing is never refused over one exhausted plan
 * while a second registered one sits open.
 */

import { originRepositoryOf } from "../config.js";
import { planRegisterPort } from "../plans/port.js";
import { stateHomePaths } from "../stateHome.js";
import { readCodexAccountsLive } from "./accountLive.js";
import { partitionCandidateRoots } from "./branchEvidenceRoots.js";
import { candidateRepoRoots } from "./candidateRepoRoots.js";
import { pullRequestCarryEvidence } from "./diffsNow.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import { fallbackLedgerEntries } from "./fallbackPlan.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "./fallbackPort.js";
import type { TreeFingerprint } from "./fingerprint.js";
import { currentCodexFleetCap } from "./fleetCap.js";
import { codexFleetCapPort } from "./fleetCapPort.js";
import { commitTreeFingerprint, resolveRepoRoot } from "./gitDiff.js";
import type { PullRequestHead } from "./landingGate.js";
import type { LocalCodexLoopRead } from "./landingGateTypes.js";
import { assessCodexLoop, ledgerForBranch } from "./ledger.js";
import { type LedgerScan, scanPassRecords } from "./ledgerStore.js";
import { unionLedger } from "./ledgerUnion.js";
import type { CodexQuotaEvidence } from "./quotaTypes.js";
import { incompleteScanReason } from "./scanReasons.js";
import { type CodexSignInPort, codexSignInPort } from "./signInPort.js";
import type { Supersession } from "./supersession.js";
import type { SupersessionPort } from "./supersessionPort.js";
import { supersessionPort } from "./supersessionStore.js";
import type { CodexArtifactRecord } from "./types.js";

/**
 * A landing verb's seam onto {@link readLocalCodexLoop}: a test hands it a plain value, and the verb's own
 * production deps — the composition root — close the real read over the store-backed sign-in port.
 */
export type LocalCodexLoopReader = (args: {
  cwd: string;
  home: string;
  head: PullRequestHead;
}) => LocalCodexLoopRead | Promise<LocalCodexLoopRead>;

/**
 * The real read as a landing verb's seam, closed over the store's fallback, sign-in and supersession ports — the
 * same production wiring this module already gives the plan register and the fleet cap. Composition roots only,
 * for the reason `./supersessionStore.ts` gives.
 *
 * @returns the reader a landing verb's production deps carry
 */
export function productionLocalCodexLoopReader(): LocalCodexLoopReader {
  const fallbackPort = fallbackRegisterPort();
  const signInPort = codexSignInPort();
  const supersessions = supersessionPort();
  return ({ cwd, head, home }) => readLocalCodexLoop({ cwd, fallbackPort, head, home, signInPort, supersessions });
}

/**
 * Read what this machine records about a pull request's Codex loop.
 *
 * @param cwd the checkout the landing verb is running in — considered alongside every checkout named by a
 *   record, and in no way privileged over them
 * @param home the state home whose `orchestration` directory holds the pass records
 * @param head the pull request being landed
 * @param fallbackPort where the Claude fallback receipts are read — the store, whose outage refuses the read
 *   rather than landing on the pass records alone
 * @param signInPort where the fleet read behind the cap files and reads the Codex sign-in observations — required,
 *   so only a composition root ever builds the production one
 * @param supersessions the register of retired passes — REQUIRED, so a test hands a memory port and only a
 *   composition root reaches the store
 * @returns the evidence, or the reason nothing on this machine can answer for this pull request
 */
export async function readLocalCodexLoop({
  cwd,
  fallbackPort,
  home,
  head,
  supersessions,
  signInPort,
}: {
  cwd: string;
  fallbackPort: FallbackRegisterPort;
  home: string;
  head: PullRequestHead;
  supersessions: SupersessionPort;
  signInPort: CodexSignInPort;
}): Promise<LocalCodexLoopRead> {
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (scan.isErr()) {
    return { kind: "unreadable", reason: `could not read the pass records: ${scan.error.message}` };
  }
  const receipts = await fallbackPort.scan({ home });
  if (receipts.isErr()) {
    return {
      kind: "unreadable",
      reason: `could not read the Claude fallback review receipts: ${receipts.error.message}`,
    };
  }
  const { considered, ownRoot, qualified } = qualifyingFromCwd({
    cwd,
    head,
    receipts: receipts.value,
    scan: scan.value,
  });
  const first = qualified[0];
  if (first === undefined) {
    return { kind: "unreadable", reason: noQualifyingCheckoutReason({ considered, head }) };
  }
  // Fail closed: a register that cannot be read leaves which passes are retired UNKNOWN, never "none".
  const retired = await supersessions.read({ home });
  if (retired.isErr()) {
    return { kind: "unreadable", reason: `could not read the supersession register: ${retired.error.message}` };
  }
  return readPullRequestFloor({
    head,
    home,
    // Every qualifying checkout produced a fingerprint of the SAME commit, so they are equal by
    // construction; taking the first is a choice of which identical value to use, not a preference.
    now: first.head,
    // The checkout the OLD reader consulted, and the only one whose fail-closed count must never be dropped.
    // An unresolvable cwd leaves it undefined, which matches no root and so privileges nothing.
    ownRoot,
    receipts: receipts.value,
    retired: retired.value,
    roots: qualified.map((checkout) => checkout.root),
    scan: scan.value,
    signInPort,
  });
}

/** A checkout that may speak for the pull request, and the head fingerprint it resolved. */
export interface QualifyingCheckout {
  readonly root: string;
  readonly head: TreeFingerprint;
}

/**
 * The verb's own checkout, every candidate checkout and the qualifying ones, relevant first.
 *
 * @param cwd the checkout the landing verb is running in; an unresolvable one leaves `ownRoot` undefined
 * @param head the pull request being landed
 * @param receipts every Claude fallback receipt that read and bound
 * @param scan every pass record that could be read
 * @returns the resolved own root, the roots considered and the qualifying checkouts
 */
function qualifyingFromCwd({
  cwd,
  head,
  receipts,
  scan,
}: {
  cwd: string;
  head: PullRequestHead;
  receipts: FallbackReceiptScan;
  scan: LedgerScan;
}): { considered: readonly string[]; ownRoot: string | undefined; qualified: readonly QualifyingCheckout[] } {
  const own = resolveRepoRoot({ cwd });
  const ownRoot = own.isOk() ? own.value : undefined;
  const considered = candidateRepoRoots({ fallbackScan: receipts, ownRoot, records: scan.records });
  const qualified = relevantFirstQualifying({
    considered,
    fallbackScan: receipts,
    head,
    ownRoot,
    records: scan.records,
  });
  return { considered, ownRoot, qualified };
}

/**
 * The qualifying checkouts, asking the ones that could change the verdict first and every candidate only when
 * none of those qualifies (`./branchEvidenceRoots.ts`). Exported because the bump witness asks the same question
 * over the same evidence, with no fallback receipts.
 *
 * @param considered every candidate root, in order
 * @param head the pull request being landed
 * @param ownRoot the checkout the verb runs in, always relevant
 * @param records every pass record the scan read
 * @param fallbackScan the Claude fallback receipts, or `undefined` for a read that folds none
 * @returns the qualifying relevant checkouts, or every qualifying candidate when no relevant one qualifies
 */
export function relevantFirstQualifying({
  considered,
  head,
  ownRoot,
  records,
  fallbackScan,
}: {
  considered: readonly string[];
  head: PullRequestHead;
  ownRoot: string | undefined;
  records: readonly CodexArtifactRecord[];
  fallbackScan: FallbackReceiptScan | undefined;
}): readonly QualifyingCheckout[] {
  const { relevant, remaining } = partitionCandidateRoots({
    branch: head.branch,
    candidates: considered,
    fallbackScan,
    ownRoot,
    records,
  });
  const judged = qualifyingCheckouts({ considered: relevant, head });
  if (judged.length > 0) {
    return judged;
  }
  // No relevant checkout qualified, so the full scan's answer is exactly the rest's: every relevant one was asked.
  return qualifyingCheckouts({ considered: remaining, head });
}

/**
 * The checkouts that may speak for this pull request: right repository, and holding its head commit.
 *
 * The commit check is the strong half and it is git's answer rather than a comparison of our own — a
 * checkout that does not hold the object cannot produce its tree. It also closes, rather than inherits, the
 * path-reuse hole `docs/doctrine-rationale/rule-9.md` records against keying on `repoRoot`: a different repository
 * sitting at a reused path holds no such commit.
 *
 * The origin check is kept alongside it because it is one cheap call and it makes a refusal readable — "no
 * checkout of that repository" and "no checkout holds that commit" send a reader to different remedies.
 * `originRepositoryOf` is deliberately the reader here rather than `resolveRepository`: the latter refuses a
 * checkout that is undeclared or sits under the state home, which are ordinary facts about a worktree and
 * must not be mistaken for evidence about a pull request.
 *
 * @param considered every candidate root
 * @param head the pull request being landed
 * @returns the qualifying checkouts, each with the head fingerprint it resolved
 */
function qualifyingCheckouts({
  considered,
  head,
}: {
  considered: readonly string[];
  head: PullRequestHead;
}): readonly QualifyingCheckout[] {
  const qualified: QualifyingCheckout[] = [];
  for (const root of considered) {
    const origin = originRepositoryOf({ cwd: root });
    if (origin.isErr() || `${origin.value.owner}/${origin.value.repo}` !== head.repository) {
      continue;
    }
    const fingerprint = commitTreeFingerprint({ commit: head.headSha, cwd: root });
    if (fingerprint.isOk()) {
      qualified.push({ head: fingerprint.value, root });
    }
  }
  return qualified;
}

/**
 * Why no checkout could answer, in words that name the remedy.
 *
 * The two cases send a reader somewhere different, so they are distinguished rather than collapsed: no
 * checkout of the repository at all is a machine that never held this work, while a checkout that has it but
 * lacks the commit is one `git fetch` away.
 *
 * @param considered every candidate root
 * @param head the pull request being landed
 * @returns the reason, always naming how many checkouts were asked
 */
export function noQualifyingCheckoutReason({
  considered,
  head,
}: {
  considered: readonly string[];
  head: PullRequestHead;
}): string {
  const inRepository = considered.filter((root) => {
    const origin = originRepositoryOf({ cwd: root });
    return origin.isOk() && `${origin.value.owner}/${origin.value.repo}` === head.repository;
  });
  if (inRepository.length === 0) {
    return (
      `none of the ${String(considered.length)} checkout(s) on this machine has ${head.repository} as its ` +
      "`origin`, so nothing here holds evidence about this pull request"
    );
  }
  return (
    `${String(inRepository.length)} checkout(s) of ${head.repository} were asked and none holds the pull ` +
    `request's head commit ${head.headSha}, so nothing here can be judged against the code being landed — ` +
    "`git fetch origin` in the checkout that authored it, then try again"
  );
}

/**
 * The cap standing RIGHT NOW against the whole registered FLEET, never against one account.
 *
 * A live read, not only a capped row: a branch nobody has spent a pass on cannot witness one, and this is
 * the refusal `github enqueue` and `github merge --admin` print (`./ledger.ts` § The cap witness is
 * supplied). It asks the FLEET because a landing refused on "Codex is capped" while a second registered
 * destination sat open would be refusing over an account nobody had to spend (`./fleetCap.ts`).
 *
 * The register is read through the production port here because {@link readLocalCodexLoop} IS the production
 * reader — the value a landing verb hands its deps, beside the real live account read on the next line; a test
 * of a landing verb hands a plain {@link LocalCodexLoopReader} value instead and never reaches this. The sign-in
 * observations arrive from the caller, so a test that does reach this reads a memory port.
 *
 * @param home the state home holding the register and the cached exhaustion records
 * @param signInPort where the fleet read files and reads the Codex sign-in observations
 * @returns the cap evidence, or undefined when anything can still take a pass
 */
async function liveCap({
  home,
  signInPort,
}: {
  home: string;
  signInPort: CodexSignInPort;
}): Promise<CodexQuotaEvidence | undefined> {
  const cap = await currentCodexFleetCap({
    fleetCap: codexFleetCapPort(),
    home,
    nowIso: new Date().toISOString(),
    port: planRegisterPort(),
    readLive: readCodexAccountsLive,
    signInPort,
  });
  return cap.capEvidence;
}

/**
 * The half that reads the RECORDS: every pass, every fallback receipt, and the live cap, folded into the
 * pull request's floor across every checkout that qualified.
 *
 * The union is taken over rows rather than over verdicts, so `loopFailures` judges one list by one set of
 * rules exactly as it does for a single checkout. That is what lets the plan and the review live in
 * different worktrees — the ordinary fleet shape, where one session plans and implements and another lands.
 *
 * @param head the pull request being landed
 * @param home the state home holding the pass records and receipts
 * @param now the pull request head's own fingerprint, which every row's freshness is judged against
 * @param ownRoot the checkout the verb is running in, whose fail-closed count is never dropped
 * @param receipts every Claude fallback receipt that read and bound
 * @param roots the qualifying checkouts
 * @param scan every pass record that could be read
 * @param signInPort where the live cap's fleet read files and reads the Codex sign-in observations
 * @param retired the retirements on the register, already read
 * @returns the evidence, or the reason the records cannot answer for the pull request
 */
async function readPullRequestFloor({
  head,
  home,
  now,
  receipts,
  ownRoot,
  retired,
  roots,
  scan,
  signInPort,
}: {
  head: PullRequestHead;
  home: string;
  now: TreeFingerprint;
  ownRoot: string | undefined;
  receipts: FallbackReceiptScan;
  retired: ReadonlyMap<string, Supersession>;
  roots: readonly string[];
  scan: LedgerScan;
  signInPort: CodexSignInPort;
}): Promise<LocalCodexLoopRead> {
  const ledger = unionLedger({
    ledgers: roots.map((repoRoot) => ({
      alwaysCount: repoRoot === ownRoot,
      ledger: ledgerForBranch({
        branch: head.branch,
        // Only a checkout holding review records on this branch names a base ref, so the many worktrees that
        // qualify merely by holding the commit cost no git call here. The pull request's own base is what
        // carries a review pinned to an older base commit across an unchanged rebase (`./diffCarry.ts`).
        ...pullRequestCarryEvidence({
          baseSha: head.baseSha,
          branch: head.branch,
          commit: head.headSha,
          records: scan.records,
          repoRoot,
        }),
        fallbackEntries: fallbackLedgerEntries({ branch: head.branch, now, repoRoot, scan: receipts }),
        now,
        records: scan.records,
        repoRoot,
        supersessions: retired,
      }),
    })),
  });
  const incomplete = incompleteScanReason({ branch: head.branch, ledger, receipts, repoRoots: new Set(roots), scan });
  if (incomplete !== undefined) {
    return { kind: "unreadable", reason: incomplete };
  }
  return {
    evidence: {
      baseSha: head.baseSha,
      branch: head.branch,
      ...assessCodexLoop({ cap: await liveCap({ home, signInPort }), entries: ledger.entries }),
      headSha: head.headSha,
      repository: head.repository,
      roots,
    },
    kind: "read",
  };
}
