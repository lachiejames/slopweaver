/**
 * `fresh-cut verify`'s work: re-derive a recorded cut from its source SHA, refuse on any tree-hash difference, then
 * scan every file of the cut with the scans that exist today — the hygiene gate's leak classes and denylist, and
 * every private term of the installation, owner-address rows included — and hand back the findings for the state
 * home, with a count of each private-term match the sanctioned exemptions set aside (`./core.ts`'s
 * `CUT_EXEMPTION_REASONS`) and of each finding the reviewed-residue list accepts (`./reviewedResidue.ts`).
 *
 * Every file is read from the cut's root commit through the object store, never from its checkout, so what is
 * scanned is exactly what a push of that commit would publish.
 */

import { loadPrivateTerms, privateTermsRefusal } from "../hygiene/privateTerms.js";
import { loadDenylistResult, unreadableDenylistMessage } from "../hygiene/scan.js";
import { err, ok, type Result } from "../lib/result.js";
import { findOwnerTurn } from "../supervisor/chairTranscript.js";
import { parseTurnPointer } from "../transcripts/pointer.js";
import { parseCatFileBatch } from "../worktree/salvageScan.js";
import {
  type CutExemptionCounts,
  type CutFile,
  type FreshCutFinding,
  type FreshCutRecord,
  type FreshCutVerification,
  firstGitlinkPath,
  scanCutFiles,
} from "./core.js";
import { type FreshCutError, FreshCutErrors } from "./errors.js";
import { freshCutGitText, runFreshCutGit } from "./git.js";
import { checkCut, readTreeEntries } from "./produce.js";
import { type ReviewedResidueEntry, subtractReviewedResidue } from "./reviewedResidue.js";
import { readReviewedResidue, reviewedResiduePath } from "./reviewedResidueStore.js";

/** How many blobs one `cat-file --batch` run reads, so no single answer holds the whole repository at once. */
const BLOB_BATCH = 500;

/**
 * Read every blob of a tree from the cut's own object store.
 *
 * @param destination the cut repository
 * @param treeSha the tree whose files to read
 * @returns each file's path and bytes, or why the cut could not be read whole
 */
function readCutFiles({
  destination,
  treeSha,
}: {
  destination: string;
  treeSha: string;
}): Result<readonly CutFile[], FreshCutError> {
  const entries = readTreeEntries({ cwd: destination, treeSha });
  if (entries.isErr()) {
    return err(FreshCutErrors.cutMismatch({ why: `its tree could not be listed: ${entries.error}` }));
  }
  const gitlink = firstGitlinkPath({ entries: entries.value });
  if (gitlink !== undefined) {
    return err(FreshCutErrors.gitlinkInTree({ path: gitlink }));
  }
  const files: CutFile[] = [];
  for (let start = 0; start < entries.value.length; start += BLOB_BATCH) {
    const batch = entries.value.slice(start, start + BLOB_BATCH);
    const answer = runFreshCutGit({
      args: ["cat-file", "--batch"],
      cwd: destination,
      input: batch.map((entry) => `${entry.sha}\n`).join(""),
    });
    if (answer.isErr()) {
      return err(FreshCutErrors.cutMismatch({ why: `git cat-file failed: ${answer.error.cause}` }));
    }
    const contents = parseCatFileBatch({ output: answer.value });
    if (contents === null) {
      return err(FreshCutErrors.cutMismatch({ why: "a blob is missing or git's answer did not parse" }));
    }
    for (const entry of batch) {
      const bytes = contents.get(entry.sha);
      if (bytes === undefined) {
        return err(FreshCutErrors.cutMismatch({ why: `blob ${entry.sha} for ${entry.path} was not returned` }));
      }
      files.push({ bytes, path: entry.path });
    }
  }
  return ok(files);
}

/** What one scan of a recorded cut found, before the reviewed-residue list is applied. */
export interface FreshCutScan {
  readonly sourceTreeSha: string;
  readonly files: readonly CutFile[];
  readonly findings: readonly FreshCutFinding[];
  readonly exemptions: CutExemptionCounts;
}

/**
 * Re-derive a recorded cut, check its shape and scan every file — the half `fresh-cut verify` and `fresh-cut accept`
 * share, so an acceptance is judged against exactly the findings a verify would report.
 *
 * @param record the cut's record
 * @param source the source checkout to re-derive the tree in
 * @param home the state home whose denylist and private terms the scan applies
 * @returns the scan, or the first failure
 */
export function prepareFreshCutScan({
  record,
  source,
  home,
}: {
  record: FreshCutRecord;
  source: string;
  home: string;
}): Result<FreshCutScan, FreshCutError> {
  const sourceTree = freshCutGitText({ args: ["rev-parse", "--verify", `${record.sourceSha}^{tree}`], cwd: source });
  if (sourceTree.isErr()) {
    return err(FreshCutErrors.sourceUnreadable({ cause: sourceTree.error.cause, step: "rev-parse" }));
  }
  if (sourceTree.value !== record.treeSha) {
    return err(
      FreshCutErrors.cutMismatch({
        why: `the source's tree for ${record.sourceSha} is ${sourceTree.value}, but the record says ${record.treeSha}`,
      }),
    );
  }
  const shape = checkCut({ destination: record.destination, rootSha: record.rootSha, treeSha: record.treeSha });
  if (shape.isErr()) {
    return err(shape.error);
  }
  const denylist = loadDenylistResult({ home });
  if (denylist.kind === "unreadable") {
    return err(FreshCutErrors.scanInputUnavailable({ why: unreadableDenylistMessage({ load: denylist }) }));
  }
  const privateTerms = loadPrivateTerms({ home });
  if (privateTerms.kind !== "loaded") {
    return err(FreshCutErrors.scanInputUnavailable({ why: privateTermsRefusal({ load: privateTerms }) }));
  }
  const files = readCutFiles({ destination: record.destination, treeSha: record.treeSha });
  if (files.isErr()) {
    return err(files.error);
  }
  const { exemptions, findings } = scanCutFiles({
    denylist: denylist.kind === "absent" ? [] : denylist.lines,
    files: files.value,
    privateTerms: privateTerms.terms,
  });
  return ok({ exemptions, files: files.value, findings, sourceTreeSha: sourceTree.value });
}

/** Why an owner anchor cannot be relied on: it names no owner turn, or its transcript could not be read. */
type OwnerAnchorProblem = { readonly kind: "no-owner-turn" } | { readonly kind: "unreadable"; readonly why: string };

/**
 * Resolve an owner anchor to the owner's own turn in its transcript — the one check `fresh-cut accept` runs before it
 * records an anchored entry and `fresh-cut verify` runs again before it subtracts one, so a hand-written entry with an
 * invented pair of ids is never trusted. The turn found is dropped here: neither its text nor anything else of it
 * goes further.
 *
 * @param ownerAnchor the `transcript:<session>#<turn>` pointer the entry carries
 * @param projectsDir the transcripts' root, `~/.claude/projects` in a real run
 * @returns nothing, or why the anchor cannot be relied on
 */
export function resolveOwnerAnchor({
  ownerAnchor,
  projectsDir,
}: {
  ownerAnchor: string;
  projectsDir: string;
}): Result<void, OwnerAnchorProblem> {
  const pointer = parseTurnPointer({ text: ownerAnchor });
  if (pointer === undefined) {
    return err({ kind: "no-owner-turn" });
  }
  const turn = findOwnerTurn({ pointer, projectsDir });
  if (turn.isOk()) {
    return ok(undefined);
  }
  if (turn.error.code === "TURN_NOT_FOUND") {
    return err({ kind: "no-owner-turn" });
  }
  return err({ kind: "unreadable", why: turn.error.message });
}

/**
 * Re-resolve every anchored entry that can subtract a finding of this record and tree. One that does not resolve
 * refuses the whole list, exactly as a malformed line does, rather than being skipped: skipping it would leave a
 * forged entry's finding refused today and say nothing about the list that carried it.
 *
 * @param entries the list's entries
 * @param recordId the cut's record id
 * @param treeSha the cut's tree
 * @param listPath the list's path, for the refusal
 * @returns nothing, or the refusal naming the entry by id
 */
function checkedAnchoredEntries({
  entries,
  recordId,
  treeSha,
  projectsDir,
  listPath,
}: {
  entries: readonly ReviewedResidueEntry[];
  recordId: string;
  treeSha: string;
  projectsDir: string;
  listPath: string;
}): Result<void, FreshCutError> {
  for (const entry of entries) {
    if (entry.schemaVersion !== 2 || entry.reviewedRecordId !== recordId || entry.reviewedTreeSha !== treeSha) {
      continue;
    }
    const resolved = resolveOwnerAnchor({ ownerAnchor: entry.ownerAnchor, projectsDir });
    if (resolved.isErr()) {
      let why = `entry ${entry.entryId} rests on an owner anchor that names no owner turn in its transcript`;
      if (resolved.error.kind === "unreadable") {
        why = `entry ${entry.entryId}'s owner anchor could not be read: ${resolved.error.why}`;
      }
      return err(FreshCutErrors.reviewedResidueUnreadable({ path: listPath, why }));
    }
  }
  return ok(undefined);
}

/**
 * One verification to write, and the count printed beside it that its report does not store.
 *
 * @internal — the declared shape of {@link verifyFreshCut}'s success.
 */
export interface FreshCutVerified {
  readonly verification: FreshCutVerification;
  /** The reviewed-residue entries that applied to this cut and took nothing out. Printed, never written. */
  readonly reviewedUnmatched: number;
}

/**
 * Verify one recorded cut and return the verification to write. A tree-hash difference, a cut that is no longer
 * one parentless commit, scan inputs that cannot be trusted or a reviewed-residue list that cannot be relied on —
 * an anchored entry whose owner turn does not resolve included — are errors; findings left once the list's accepted
 * ones are taken out are a `refused` verification. An entry that took nothing out never changes the status.
 *
 * @param record the cut's record
 * @param source the source checkout to re-derive the tree in
 * @param home the state home whose denylist, private terms and reviewed-residue list the scan applies
 * @param projectsDir the transcripts' root every anchored entry is resolved in again
 * @param now the instant the verification is stamped with
 * @returns the verification and its unmatched-entry count, or the first failure
 */
export function verifyFreshCut({
  record,
  source,
  home,
  projectsDir,
  now,
}: {
  record: FreshCutRecord;
  source: string;
  home: string;
  projectsDir: string;
  now: Date;
}): Result<FreshCutVerified, FreshCutError> {
  const scan = prepareFreshCutScan({ home, record, source });
  if (scan.isErr()) {
    return err(scan.error);
  }
  const list = readReviewedResidue({ home });
  if (list.isErr()) {
    return err(list.error);
  }
  const anchored = checkedAnchoredEntries({
    entries: list.value.entries,
    listPath: reviewedResiduePath({ home }),
    projectsDir,
    recordId: record.recordId,
    treeSha: record.treeSha,
  });
  if (anchored.isErr()) {
    return err(anchored.error);
  }
  const { acceptedOnAnchor, findings, reviewedAccepted, reviewedUnmatched } = subtractReviewedResidue({
    entries: list.value.entries,
    files: scan.value.files,
    findings: scan.value.findings,
    recordId: record.recordId,
    treeSha: record.treeSha,
  });
  return ok({
    reviewedUnmatched,
    verification: {
      acceptedOnAnchor,
      destinationTreeSha: record.treeSha,
      exemptions: scan.value.exemptions,
      filesScanned: scan.value.files.length,
      findings,
      recordId: record.recordId,
      reviewedAccepted,
      reviewedResidueSha256: list.value.sha256,
      schemaVersion: 3,
      sourceTreeSha: scan.value.sourceTreeSha,
      status: findings.length === 0 ? "clear" : "refused",
      verifiedAtIso: now.toISOString(),
    },
  });
}
