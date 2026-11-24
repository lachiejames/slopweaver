/**
 * THE HANDS-FREE LIST, effectful half: where a `slopweaver private-terms` edit waits to be read back, and the one
 * write that lands it in `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`. The edit itself is `./privateTermsEdit.ts`.
 *
 * ## Proposed, read back, then confirmed
 *
 * The owner's rule counts only once it is read back to the owner. So an edit is first a PROPOSAL: the whole new file,
 * the digest of the file it was decided over, and the row it changes, kept owner-only under
 * `hygiene/private-term-proposals/`. The verb prints a read-back naming the row by id, class, case and probe results,
 * never its pattern; the supervisor says it back to the owner, and on the owner's yes `confirm <proposal>` writes it.
 * A proposal the owner did not take, or one a later edit left stale, is RETIRED: removed without being applied.
 *
 * ## The write
 *
 * Confirming takes the file's lock, re-reads the proposal and the file under it, and writes only when the file's
 * digest is still the one the proposal was decided over: an edit landing in between makes the proposal stale, refused,
 * and nothing is written. The new text is re-parsed whole before the write, written atomically at exactly `0600`, and
 * the proposal is removed once it has landed so it cannot land twice. Retiring takes the SAME lock and re-reads the
 * proposal under it too, so a confirm and a retire of one proposal cannot both succeed. The lock and how a stale one is
 * cleared without deleting a live one are `./privateTermsLock.ts`.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { createFileExclusive, ensureDirectory, removeEntry, writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import {
  type PrivateTermAnswer,
  privateTermAnswerContents,
  privateTermAnswerPath,
  readPrivateTermAnswer,
} from "./privateTermAnswers.js";
import { parsePrivateTerms } from "./privateTerms.js";
import { type PidAlive, underTermsLock } from "./privateTermsLock.js";
import {
  type PrivateTermsFileState,
  type PrivateTermsProposal,
  type PrivateTermsProposalAction,
  privateTermsProposalIsStale,
} from "./privateTermsProposal.js";
import { type PrivateTermsStoreError, PrivateTermsStoreErrors } from "./privateTermsStoreErrors.js";

/** A proposal's id: `pp-` and twelve lowercase hex digits. */
const PROPOSAL_ID = /^pp-[0-9a-f]{12}$/u;

/** What one confirm landed. */
export interface PrivateTermsLanded {
  readonly path: string;
  readonly termId: string;
  readonly action: PrivateTermsProposalAction;
  readonly rows: number;
}

/** What one retire removed, and whether it was stale against the file read under the lock. */
export interface PrivateTermsRetired {
  readonly action: PrivateTermsProposalAction;
  readonly proposalId: string;
  readonly stale: boolean;
  readonly termId: string;
}

/**
 * sha256 of a file's exact bytes.
 *
 * @internal
 * @param bytes the file's raw contents, as read
 * @returns its hex digest
 */
export function privateTermsBytesSha256({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A fresh random row id for a new or migrated row.
 *
 * @returns `pt-` and twelve hex digits
 */
export function mintPrivateTermId(): string {
  return `pt-${randomBytes(6).toString("hex")}`;
}

/**
 * A fresh random proposal id.
 *
 * @returns `pp-` and twelve hex digits
 */
export function mintPrivateTermsProposalId(): string {
  return `pp-${randomBytes(6).toString("hex")}`;
}

/**
 * Read the private-terms file as an edit starts from it: its text and the digest of its raw bytes, or absent.
 *
 * @param home the state home
 * @returns the file's state, or why it could not be read
 */
export function readCurrentPrivateTerms({
  home,
}: {
  home: string;
}): Result<PrivateTermsFileState, PrivateTermsStoreError> {
  const path = stateHomePaths({ home }).privateTerms;
  try {
    const bytes = readFileSync(path);
    return ok({ bytesSha256: privateTermsBytesSha256({ bytes }), kind: "present", text: bytes.toString("utf8") });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok({ kind: "absent" });
    }
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "reading the private terms file" }));
  }
}

/** Where one proposal is kept. */
function proposalPath({ home, proposalId }: { home: string; proposalId: string }): string {
  return join(stateHomePaths({ home }).privateTermProposals, `${proposalId}.json`);
}

/**
 * Keep one proposal, owner-only, until it is confirmed or retired.
 *
 * @param home the state home
 * @param proposal the edit decided, with the whole new file
 * @returns the path it is kept at, or why it could not be kept
 */
export function writePrivateTermsProposal({
  home,
  proposal,
}: {
  home: string;
  proposal: PrivateTermsProposal;
}): Result<string, PrivateTermsStoreError> {
  const path = proposalPath({ home, proposalId: proposal.proposalId });
  try {
    ensureDirectory({ directory: stateHomePaths({ home }).privateTermProposals, mode: 0o700 });
    createFileExclusive({
      contents: `${safeJsonStringify({ label: "private terms proposal", space: 2, value: proposal })}\n`,
      mode: 0o600,
      path,
    });
    return ok(path);
  } catch (error: unknown) {
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "keeping the proposal at" }));
  }
}

/** Whether a parsed value is a proposal this module wrote. */
function isProposal(value: unknown): value is PrivateTermsProposal {
  return (
    isRecord(value) &&
    value["schemaVersion"] === 1 &&
    typeof value["proposalId"] === "string" &&
    typeof value["createdAtIso"] === "string" &&
    (value["action"] === "add" || value["action"] === "narrow" || value["action"] === "remove") &&
    typeof value["termId"] === "string" &&
    (value["baseSha256"] === null || typeof value["baseSha256"] === "string") &&
    typeof value["text"] === "string"
  );
}

/**
 * Read one proposal back.
 *
 * @internal
 * @param home the state home
 * @param proposalId the id the read-back printed
 * @returns the proposal, or why none is waiting under that id
 */
export function readPrivateTermsProposal({
  home,
  proposalId,
}: {
  home: string;
  proposalId: string;
}): Result<PrivateTermsProposal, PrivateTermsStoreError> {
  if (!PROPOSAL_ID.test(proposalId)) {
    return err(
      PrivateTermsStoreErrors.proposalUnusable({
        why: "a proposal id is pp- and twelve lowercase hex digits, as the read-back printed it",
      }),
    );
  }
  const path = proposalPath({ home, proposalId });
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "private terms proposal", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      const why = `${proposalId} is not waiting: it was confirmed or retired already, or never made under this home`;
      return err(PrivateTermsStoreErrors.proposalUnusable({ why }));
    }
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "reading the proposal at" }));
  }
  if (!isProposal(parsed) || parsed.proposalId !== proposalId) {
    return err(PrivateTermsStoreErrors.proposalUnusable({ why: `${path} is not a proposal this verb writes` }));
  }
  return ok(parsed);
}

/**
 * Every proposal waiting, for `private-terms list`. Advisory: a file that does not read is skipped.
 *
 * @param home the state home
 * @returns the readable proposals, oldest first
 */
export function waitingPrivateTermsProposals({ home }: { home: string }): readonly PrivateTermsProposal[] {
  let names: readonly string[];
  try {
    names = readdirSync(stateHomePaths({ home }).privateTermProposals);
  } catch {
    // No directory is no proposal yet.
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const read = readPrivateTermsProposal({ home, proposalId: name.slice(0, -".json".length) });
      return read.isOk() ? [read.value] : [];
    })
    .toSorted((left, right) => left.createdAtIso.localeCompare(right.createdAtIso));
}

/**
 * Land one proposal: under the lock, only over the file it was decided against, re-parsed, atomically at `0600`.
 *
 * @param home the state home
 * @param proposalId the id the read-back printed
 * @param pidAlive whether a lock holder still runs
 * @returns what landed, or why nothing was written
 */
export function confirmPrivateTermsProposal({
  home,
  proposalId,
  pidAlive,
}: {
  home: string;
  proposalId: string;
  pidAlive: PidAlive;
}): Result<PrivateTermsLanded, PrivateTermsStoreError> {
  // The proposal and its answer are read only once the lock is held, so an answer recorded while a confirm
  // waits cannot be missed by it, and a confirm and a retire cannot both succeed on one proposal.
  return underTermsLock({
    home,
    pidAlive,
    run: ({ path }) => landProposal({ home, path, proposalId }),
  });
}

/**
 * Record the owner's answer to one proposal, under the same lock a confirm takes, and only while the proposal is
 * still waiting: a confirm that lands it first leaves nothing to answer, and this refuses rather than writing an
 * answer beside nothing.
 *
 * @param home the state home
 * @param answer what was answered, for which proposal
 * @param pidAlive whether a lock holder still runs
 * @returns the path the answer is kept at, or why nothing was written
 */
export function answerPrivateTermsProposal({
  home,
  answer,
  pidAlive,
}: {
  home: string;
  answer: PrivateTermAnswer;
  pidAlive: PidAlive;
}): Result<string, PrivateTermsStoreError> {
  return underTermsLock({
    home,
    pidAlive,
    run: () => {
      const waiting = readPrivateTermsProposal({ home, proposalId: answer.proposalId });
      if (waiting.isErr()) {
        return err(waiting.error);
      }
      const path = privateTermAnswerPath({ home, proposalId: answer.proposalId });
      try {
        writeFileAtomic({
          contents: privateTermAnswerContents({ answer }),
          dirMode: 0o700,
          exactMode: true,
          fileMode: 0o600,
          path,
        });
      } catch (error: unknown) {
        return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "keeping the answer at" }));
      }
      return ok(path);
    },
  });
}

/**
 * Retire one waiting proposal: remove it and any answer recorded for it, under the same lock a confirm takes, WITHOUT
 * applying it. The private terms file is read only to say whether the proposal was stale against it, and is never
 * written.
 *
 * @param home the state home
 * @param proposalId the id the read-back or `list` printed
 * @param pidAlive whether a lock holder still runs
 * @returns what was retired and whether it was stale, or why nothing was removed
 */
export function retirePrivateTermsProposal({
  home,
  proposalId,
  pidAlive,
}: {
  home: string;
  proposalId: string;
  pidAlive: PidAlive;
}): Result<PrivateTermsRetired, PrivateTermsStoreError> {
  return underTermsLock({
    home,
    pidAlive,
    run: ({ path }) => {
      const proposal = readPrivateTermsProposal({ home, proposalId });
      if (proposal.isErr()) {
        return err(proposal.error);
      }
      const current = readCurrentPrivateTerms({ home });
      if (current.isErr()) {
        return err(current.error);
      }
      const stale = privateTermsProposalIsStale({ proposal: proposal.value, state: current.value });
      try {
        removeEntry({ path: proposalPath({ home, proposalId }) });
        removeEntry({ path: privateTermAnswerPath({ home, proposalId }) });
      } catch (error: unknown) {
        return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "retiring the proposal beside" }));
      }
      return ok({ action: proposal.value.action, proposalId, stale, termId: proposal.value.termId });
    },
  });
}

/** Land one proposal; the caller holds the lock. */
function landProposal({
  home,
  path,
  proposalId,
}: {
  home: string;
  path: string;
  proposalId: string;
}): Result<PrivateTermsLanded, PrivateTermsStoreError> {
  const proposal = readPrivateTermsProposal({ home, proposalId });
  if (proposal.isErr()) {
    return err(proposal.error);
  }
  const answered = readPrivateTermAnswer({ home, proposalId });
  if (answered.kind === "answered" && answered.answer.answer === "no") {
    const why = `the owner answered no to ${proposalId} on ${answered.answer.via} at ${answered.answer.answeredAtIso}`;
    return err(PrivateTermsStoreErrors.proposalUnusable({ why }));
  }
  // An answer file that does not read may have held a no, so it never lets a confirm through.
  if (answered.kind === "unreadable") {
    const why = `the owner's answer to ${proposalId} at ${answered.path} does not read; record it again with private-terms answer`;
    return err(PrivateTermsStoreErrors.proposalUnusable({ why }));
  }
  try {
    const current = readCurrentPrivateTerms({ home });
    if (current.isErr()) {
      return err(current.error);
    }
    if (privateTermsProposalIsStale({ proposal: proposal.value, state: current.value })) {
      const why = "the private terms file changed after it was proposed";
      return err(PrivateTermsStoreErrors.proposalStale({ proposalId, why }));
    }
    const parsed = parsePrivateTerms({ text: proposal.value.text });
    if (parsed.isErr()) {
      const why = `its text no longer parses (${parsed.error.message})`;
      return err(PrivateTermsStoreErrors.proposalStale({ proposalId, why }));
    }
    writeFileAtomic({ contents: proposal.value.text, dirMode: 0o700, exactMode: true, fileMode: 0o600, path });
    removeEntry({ path: proposalPath({ home, proposalId }) });
    removeEntry({ path: privateTermAnswerPath({ home, proposalId }) });
    return ok({ action: proposal.value.action, path, rows: parsed.value.length, termId: proposal.value.termId });
  } catch (error: unknown) {
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "writing the private terms file" }));
  }
}
