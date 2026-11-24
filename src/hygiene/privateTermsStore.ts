/**
 * THE HANDS-FREE LIST, effectful half: where a `slopweaver private-terms` edit waits to be read back, and the one
 * write that lands it in `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`. The edit itself is `./privateTermsEdit.ts`.
 *
 * ## Proposed, read back, then confirmed
 *
 * The owner's rule counts only once it is read back to the owner. So an edit is first a PROPOSAL: the whole new file,
 * the digest of the file it was decided over, and the row it changes, kept owner-only under
 * `hygiene/private-term-proposals/`. The verb prints a read-back naming the row by id, class, case and probe results,
 * never its pattern; the supervisor says it back to the owner, and on the owner's yes `--confirm <proposal>` writes it.
 *
 * ## The write
 *
 * Confirming takes the file's lock, re-reads the file, and writes only when its digest is still the one the proposal
 * was decided over: an edit landing in between makes the proposal stale, refused, and nothing is written. The new text
 * is re-parsed whole before the write, written atomically at exactly `0600`, and the proposal is removed once it has
 * landed so it cannot land twice. The lock is a file naming its holder's pid; one whose pid is gone is cleared.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
import { type PrivateTermsStoreError, PrivateTermsStoreErrors } from "./privateTermsStoreErrors.js";

/** A proposal's id: `pp-` and twelve lowercase hex digits. */
const PROPOSAL_ID = /^pp-[0-9a-f]{12}$/u;

/** One edit waiting for its read-back to be confirmed. */
export interface PrivateTermsProposal {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly createdAtIso: string;
  readonly action: "add" | "narrow" | "remove";
  /** The row it changes, by the id it carries in the new file. */
  readonly termId: string;
  /** sha256 of the exact bytes of the file the edit was decided over, or null when there was none. */
  readonly baseSha256: string | null;
  /** The whole new file. */
  readonly text: string;
}

/** What one confirm landed. */
export interface PrivateTermsLanded {
  readonly path: string;
  readonly termId: string;
  readonly action: PrivateTermsProposal["action"];
  readonly rows: number;
}

/**
 * The private-terms file as an edit starts from it. `bytesSha256` is over the raw bytes, never the decoded text:
 * two different invalid UTF-8 sequences both decode to U+FFFD, so a hash of the text would call a changed file
 * unchanged and a confirm would overwrite an edit it never saw.
 */
export type PrivateTermsFileState =
  { readonly kind: "absent" } | { readonly kind: "present"; readonly text: string; readonly bytesSha256: string };

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
 * The base hash a proposal records and a confirm compares: the raw bytes' digest, or null for no file.
 *
 * @param state the file as read
 * @returns the digest, or null when the file is absent
 */
export function privateTermsBaseSha256({ state }: { state: PrivateTermsFileState }): string | null {
  if (state.kind === "absent") {
    return null;
  }
  return state.bytesSha256;
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
 * Keep one proposal, owner-only, until it is confirmed.
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
 * @returns the proposal, or why there is none to confirm
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
        why: "--confirm takes a proposal id, pp- and twelve hex digits, as the read-back printed it",
      }),
    );
  }
  const path = proposalPath({ home, proposalId });
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "private terms proposal", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      const why = `${proposalId} is not waiting: it was confirmed already, or never made under this home`;
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

/** Whether a pid names a running process, injected so the stale-lock branch is testable. */
export type PidAlive = (input: { readonly pid: number }) => boolean;

/**
 * The production liveness check: signal 0 asks the kernel without delivering anything.
 *
 * @param pid the lock holder's pid
 * @returns whether it is running, or running under another user
 */
export function processPidAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}

/** Take the file's lock, clearing one whose holder is gone; answer why not when it is held. */
function takeLock({ path, pidAlive }: { path: string; pidAlive: PidAlive }): Result<true, PrivateTermsStoreError> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      createFileExclusive({ contents: `${String(process.pid)}\n`, mode: 0o600, path });
      return ok(true);
    } catch (error: unknown) {
      if (!isRecord(error) || error["code"] !== "EEXIST") {
        return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path, what: "taking the lock" }));
      }
    }
    let holder: number;
    try {
      holder = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    } catch {
      // It was released between the create and the read; the next attempt takes it.
      continue;
    }
    if (Number.isInteger(holder) && holder > 0 && pidAlive({ pid: holder })) {
      return err(PrivateTermsStoreErrors.lockHeld({ path, why: `pid ${String(holder)} holds it and is running` }));
    }
    removeEntry({ path });
  }
  return err(PrivateTermsStoreErrors.lockHeld({ path, why: "another edit took it again as a stale one was cleared" }));
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
  // waits cannot be missed by it, and two confirms cannot both land one proposal.
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

/** Run one store change holding the terms file's lock, releasing it however the change ends. */
function underTermsLock<T>({
  home,
  pidAlive,
  run,
}: {
  home: string;
  pidAlive: PidAlive;
  run: (input: { readonly path: string }) => Result<T, PrivateTermsStoreError>;
}): Result<T, PrivateTermsStoreError> {
  const path = stateHomePaths({ home }).privateTerms;
  const lockPath = `${path}.lock`;
  const directory = dirname(path);
  try {
    ensureDirectory({ directory, mode: 0o700 });
  } catch (error: unknown) {
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path: directory, what: "making the directory" }));
  }
  const locked = takeLock({ path: lockPath, pidAlive });
  if (locked.isErr()) {
    return err(locked.error);
  }
  try {
    return run({ path });
  } finally {
    removeEntry({ path: lockPath });
  }
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
    const sha = privateTermsBaseSha256({ state: current.value });
    if (sha !== proposal.value.baseSha256) {
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
