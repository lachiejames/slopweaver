/**
 * Evidence whose checkout was DELETED, re-proved from a surviving checkout of the same repository — or left out.
 * Pure: every filesystem and git question arrives as a plain function (`./orphanedEvidenceProbes.ts` is the real one).
 *
 * ## The defect this closes
 *
 * A pass record names the checkout it ran in (`repoRoot`), and a landing read folds a record only under a checkout
 * that QUALIFIES — its `origin` is the pull request's repository and it holds the head commit, both asked of git IN
 * that directory (`./landingGateRun.ts`). A worktree removed after its passes ran fails both by construction, so its
 * READY plan and CLEAN review read NOT RUN while the main checkout beside it holds the very same commit. MEASURED by
 * `src/__tests__/unit/codex/landingGateWiring/deletedWorktree.test.ts`: roots `[main, authoring]` and no failures while
 * the worktree stood, both "no planning pass" and "no general review pass" after `git worktree remove`.
 *
 * ## What re-proves a record, and why every clause is needed
 *
 * A record is ADOPTED into a surviving checkout's fold only when ALL of these hold:
 *
 * - **its recorded path is definitely gone** — `missing`, never `unknown`. A path that still exists keeps today's
 *   qualification exactly, so a reused path now holding another repository stays excluded (the path-reuse hole
 *   `docs/doctrine-rationale/rule-9.md` records);
 * - **its recorded `originRepository` is the pull request's repository** — validated as `owner/name`, a malformed or
 *   absent one never matching. This is the clause commit ancestry cannot supply: a fork's commit object can sit in
 *   this clone, so "the surviving checkout holds it" is lineage, never provenance (`./originBinding.ts`);
 * - **the branch it RECORDED is the pull request's branch** — the one on disk, never one branch continuity relabelled
 *   it to (`./landingBranchEvidence.ts`). Continuity is proved from the recording checkout's reflog, and a deleted
 *   checkout is exactly the one whose git can no longer be trusted to vouch for a rename, so an orphan is held to the
 *   name it wrote;
 * - **the surviving checkout holds its recorded head, and that head IS the pull request's head or an ancestor of it.**
 *   A record for unrelated history is never adopted, and a git error is no proof.
 *
 * Adoption only PLACES a record; it never judges it. The adopted copy goes through the unchanged freshness and
 * diff-carry rules (`./ledger.ts`, `./diffCarry.ts`), so a stale review still reads stale and a dirty witness is
 * still refused (`./baselineBumpWitness.ts`). A plan, which must read STALE, is placed by the same clauses.
 *
 * ## The copy is re-homed, in memory only
 *
 * An adopted record is folded as a copy whose `repoRoot` names the surviving checkout, so every fold that keys on
 * the checkout — `ledgerForBranch`, `reviewBaseRefs`, `fallbackLedgerEntries` — places it without a second code path.
 * The file on disk keeps the historical path. No diagnostic is lost: the only refusals that print a record's checkout
 * name an UNPLACEABLE record or a foreign or unbound receipt, and none of those is ever adopted.
 *
 * ## What it never does
 *
 * It never widens the `codex status` table, `codex supersede` or the other-checkouts line, which stay a report about
 * ONE checkout; only the two landing reads call it. `codex status --check` IS the pairing floor's landing read, so it
 * adopts exactly as `github enqueue` does — the check and the landing verb must never disagree. It never touches the fail-closed counts: an orphan that is not
 * adopted stays outside every fold exactly as before, and an adopted one has a branch and a tree, so it is neither
 * `unattributed` nor `unknowable`.
 *
 * **Records written before `originRepository` existed carry none, so they stay NOT RUN once their path is gone.**
 * There is no retroactive recovery and nothing backfills the field.
 */

import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import { recordedOriginRepository } from "./originBinding.js";
import type { CodexArtifactRecord } from "./types.js";

/** Whether a recorded checkout path is there: `unknown` is any answer other than a definite absence or presence. */
export type RecordedPathState = "missing" | "present" | "unknown";

/** The filesystem and git questions adoption asks, each a plain function a test can hand a literal answer. */
export interface OrphanProbes {
  /** Whether the recorded checkout path still exists. */
  readonly pathState: (args: { path: string }) => RecordedPathState;
  /** Whether a surviving checkout holds a commit object. */
  readonly holdsCommit: (args: { root: string; commit: string }) => boolean;
  /** Whether `ancestor` is an ancestor of `descendant` in a surviving checkout; `error` when git could not say. */
  readonly ancestry: (args: { root: string; ancestor: string; descendant: string }) => "yes" | "no" | "error";
}

/** The pull request a landing read is judging. */
export interface OrphanSubject {
  readonly branch: string;
  readonly headSha: string;
  /** `owner/name`, as the pull request names its repository. */
  readonly repository: string;
}

/** A full commit name, SHA-1 or SHA-256. */
const FULL_COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/**
 * The surviving checkout a piece of evidence is re-proved in, or `undefined` when it is not adopted.
 *
 * Every field arrives through `unknown`, because the pass-record decoder is shallow and a `null` from disk reaches
 * here typed as a string. The cheap clauses run first, so evidence on another branch or from another repository costs
 * no filesystem or git call.
 *
 * @param placement where the evidence says it was taken: its checkout path, origin binding, branch and head commit
 * @param subject the pull request being judged
 * @param targets the qualifying surviving checkouts, in the order the read ranks them
 * @param probes the filesystem and git questions
 * @returns the first target that re-proves it, or `undefined`
 */
export function adoptionTarget({
  placement,
  subject,
  targets,
  probes,
}: {
  placement: {
    readonly recordedRoot: unknown;
    readonly originRepository: unknown;
    readonly branch: unknown;
    readonly headSha: unknown;
  };
  subject: OrphanSubject;
  targets: readonly string[];
  probes: OrphanProbes;
}): string | undefined {
  const { branch, headSha, recordedRoot } = placement;
  if (branch !== subject.branch || typeof headSha !== "string" || !FULL_COMMIT.test(headSha)) {
    return undefined;
  }
  if (recordedOriginRepository({ value: placement.originRepository }) !== subject.repository) {
    return undefined;
  }
  if (typeof recordedRoot !== "string" || recordedRoot.length === 0 || targets.includes(recordedRoot)) {
    return undefined;
  }
  if (probes.pathState({ path: recordedRoot }) !== "missing") {
    return undefined;
  }
  return targets.find(
    (root) =>
      probes.holdsCommit({ commit: headSha, root }) &&
      (headSha === subject.headSha ||
        probes.ancestry({ ancestor: headSha, descendant: subject.headSha, root }) === "yes"),
  );
}

/** The branch each piece of evidence wrote to disk, keyed by {@link recordKey} or {@link receiptKey}. */
export type RecordedBranches = ReadonlyMap<string, unknown>;

/** The key a pass record's recorded branch is held under. */
const recordKey = ({ artifactId }: { artifactId: unknown }): string => `record:${String(artifactId)}`;

/** The key a fallback receipt's recorded branch is held under. */
const receiptKey = ({ receiptId }: { receiptId: string }): string => `receipt:${receiptId}`;

/**
 * The branch every record and receipt wrote, read from the scan BEFORE branch continuity relabels anything, so
 * adoption can hold an orphan to the name it recorded.
 *
 * @param records the pass records as scanned off disk
 * @param receipts the fallback receipts as scanned off disk, or `undefined` for a read that folds none
 * @returns each one's recorded branch
 */
export function recordedBranchesOf({
  records,
  receipts,
}: {
  records: readonly CodexArtifactRecord[];
  receipts: FallbackReceiptScan | undefined;
}): RecordedBranches {
  const branches = new Map<string, unknown>();
  for (const record of records) {
    branches.set(recordKey({ artifactId: record.artifactId }), record.tree?.branch);
  }
  if (receipts === undefined) {
    return branches;
  }
  for (const receipt of [...receipts.planReceipts, ...receipts.receipts]) {
    branches.set(receiptKey({ receiptId: receipt.receiptId }), receipt.request.tree.branch);
  }
  return branches;
}

/**
 * Every pass record, with each re-proved orphan re-homed to the checkout that re-proved it. Records that are not
 * adopted are returned unchanged, so a checkout-keyed fold reads them exactly as before.
 *
 * @param records every pass record the scan read, after branch continuity
 * @param recordedBranches what each record wrote as its branch, before continuity
 * @param subject the pull request being judged
 * @param targets the qualifying surviving checkouts
 * @param probes the filesystem and git questions
 * @returns the records, in the same order
 */
export function rehomeOrphanedRecords({
  records,
  recordedBranches,
  subject,
  targets,
  probes,
}: {
  records: readonly CodexArtifactRecord[];
  recordedBranches: RecordedBranches;
  subject: OrphanSubject;
  targets: readonly string[];
  probes: OrphanProbes;
}): readonly CodexArtifactRecord[] {
  return records.map((record) => {
    const target = adoptionTarget({
      placement: {
        branch: recordedBranches.get(recordKey({ artifactId: record.artifactId })),
        headSha: record.tree?.headSha,
        originRepository: record.originRepository,
        recordedRoot: record.repoRoot,
      },
      probes,
      subject,
      targets,
    });
    return target === undefined ? record : { ...record, repoRoot: target };
  });
}

/**
 * The receipt scan, with each re-proved bound plan or review receipt re-homed the same way. Foreign and unbound
 * receipts are never adopted — nothing trustworthy binds them — so their branch-local refusals are unchanged.
 *
 * @param receipts the Claude fallback receipts, after branch continuity
 * @param recordedBranches what each receipt's request wrote as its branch, before continuity
 * @param subject the pull request being judged
 * @param targets the qualifying surviving checkouts
 * @param probes the filesystem and git questions
 * @returns the scan with only its bound receipts possibly re-homed
 */
export function rehomeOrphanedReceipts({
  receipts,
  recordedBranches,
  subject,
  targets,
  probes,
}: {
  receipts: FallbackReceiptScan;
  recordedBranches: RecordedBranches;
  subject: OrphanSubject;
  targets: readonly string[];
  probes: OrphanProbes;
}): FallbackReceiptScan {
  const targetOf = ({
    receiptId,
    request,
  }: {
    receiptId: string;
    request: {
      readonly repoRoot: string;
      readonly originRepository?: string;
      readonly tree: { readonly headSha: string };
    };
  }): string | undefined =>
    adoptionTarget({
      placement: {
        branch: recordedBranches.get(receiptKey({ receiptId })),
        headSha: request.tree.headSha,
        originRepository: request.originRepository,
        recordedRoot: request.repoRoot,
      },
      probes,
      subject,
      targets,
    });
  return {
    ...receipts,
    planReceipts: receipts.planReceipts.map((receipt) => {
      const target = targetOf(receipt);
      return target === undefined ? receipt : { ...receipt, request: { ...receipt.request, repoRoot: target } };
    }),
    receipts: receipts.receipts.map((receipt) => {
      const target = targetOf(receipt);
      return target === undefined ? receipt : { ...receipt, request: { ...receipt.request, repoRoot: target } };
    }),
  };
}
