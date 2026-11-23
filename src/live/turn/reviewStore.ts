/**
 * Where one ask's review lives on disk — the record, the packet, the verdict — keyed exactly like
 * `dispatchStore.ts`, so an ask's worker, its dispatch record and its review all answer to one name.
 *
 * One directory per ask rather than three flat files, because the reviewer is told a verdict PATH and a human
 * looking for "what did the reviewer of that ask actually get" should find everything in one place.
 *
 * ## Why re-opening a review ARCHIVES the verdict it is replacing
 *
 * The verdict path is fixed per ask, so a second round of review writes its record over the first round's and
 * inherits the first round's `verdict.json`. Measured live: on one ask that file outlived its
 * reviewer by an hour — verdict written by workspace:231 for one digest, record rewritten
 * an hour later naming workspace:245 for another — and every `--poll` in between read
 * it, classified the review as finished and CLOSED the reviewer that was mid-verdict. Eight reviewer
 * workspaces died that way on one ask and four more the next hour, each matched to the poll that killed it
 * within a second by cmux's own closed-item history. How long a given reviewer survived is not a property of
 * the fault — it is just how soon its worker happened to poll — so nothing here keys off elapsed time.
 *
 * So a re-open renames the superseded file out of the way BEFORE the new record can be read. Renamed, never
 * deleted: a verdict is the only record of what a reviewer actually found, and the round that produced it is
 * exactly what someone diagnosing a re-review wants to read.
 */
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { readReviewVerdict } from "../../admit/reviewVerdictFile.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AskIdentity } from "../ask/identity.js";
import { type AnswerChange, structuralChanges } from "./answerChange.js";
import { parseReviewRecord, type ReviewRecord } from "./review.js";
import { type VerdictFileRead, verdictSpeaksForReviewer } from "./reviewPoll.js";

/** The three files one review is made of, all under one directory. */
export interface ReviewPaths {
  readonly dir: string;
  readonly record: string;
  readonly packet: string;
  readonly verdict: string;
}

/**
 * The name a superseded verdict is archived under when a new review round opens over it —
 * `verdict-superseded-<reviewer>-<when>.json`, the standing convention.
 *
 * Both halves name the round being DISPLACED, not the one displacing it: a person opening the directory is
 * asking "whose verdict was this and when", and the incoming reviewer already has `record.json` to speak for
 * it. Keyed off recorded values rather than a clock read, so the same re-open always produces the same name.
 *
 * @param reviewer the outgoing reviewer's workspace id, or any short token identifying it
 * @param spawnedAt the ISO instant the outgoing reviewer was spawned
 * @returns the archive file's basename
 */
export function supersededVerdictName({ reviewer, spawnedAt }: { reviewer: string; spawnedAt: string }): string {
  return `verdict-superseded-${fileSafe({ text: reviewer })}-${fileSafe({ text: spawnedAt })}.json`;
}

/** Reduce a token to what a filename can carry without quoting, collapsing every run of other characters. */
function fileSafe({ text }: { text: string }): string {
  const safe = text.replace(/[^A-Za-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return safe.length === 0 ? "unknown" : safe;
}

/**
 * The file one round's REVIEWED answer is snapshotted to, named by its own digest.
 *
 * Content-addressed rather than archived by rename, which is what the superseded verdict does. Three reasons,
 * and each is a defect the rename shape has here. The verdict already names the digest it bound itself to, so
 * a later round can look the exact answer up rather than trusting an ordering. A round whose reviewer died
 * leaves no verdict, and a rename chain would then make the baseline the answer of a round that settled
 * nothing. And `archiveSupersededVerdict` is called at both ends of the spawn window, so a late second write
 * lands under a name already used — {@link archiveVerdictFile} numbers its way past that for a verdict, and a
 * numbered sibling is no way to find the bytes a carried claim is judged against.
 *
 * @param digest the `sha256:<hex>` digest of the parsed answer
 * @param dir the ask's review directory
 * @returns the absolute path to that answer's snapshot
 */
function reviewedAnswerPath({ digest, dir }: { digest: string; dir: string }): string {
  return join(dir, reviewedAnswerFileName({ digest }));
}

/**
 * The basename one round's reviewed answer is snapshotted under.
 *
 * Exported so a reader that has only a digest and a directory listing — `turn freeze`, deciding which
 * snapshots fall inside its window — builds the name with the same code that wrote it, rather than with a
 * second copy of the flattening rule.
 *
 * @param digest the `sha256:<hex>` digest of the parsed answer
 * @returns the snapshot's basename
 */
export function reviewedAnswerFileName({ digest }: { digest: string }): string {
  return `answer-reviewed-${fileSafe({ text: digest })}.json`;
}

/**
 * Snapshot the answer a round is about to review, so a later round can compare against it.
 *
 * Idempotent by construction: the same answer writes the same path with the same bytes.
 *
 * @param answer the parsed answer being reviewed
 * @param digest the digest the round's verdict will bind to
 * @param home the resolved state home
 * @param askIdentity the ask being reviewed
 */
export function writeReviewedAnswer({
  answer,
  digest,
  home,
  askIdentity,
}: {
  answer: unknown;
  digest: string;
  home: string;
  askIdentity: AskIdentity;
}): void {
  const paths = reviewPaths({ askIdentity, home });
  mkdirSync(paths.dir, { recursive: true });
  writeAtomically({
    path: reviewedAnswerPath({ digest, dir: paths.dir }),
    text: `${JSON.stringify(answer, null, 2)}\n`,
  });
}

/**
 * Read back the answer a previous round reviewed, by the digest its verdict named.
 *
 * Fails closed to `undefined` on every uncertainty — absent, unreadable, or unparseable — because the caller
 * turns absence into "verify everything yourself" rather than into an empty change list.
 *
 * @param digest the digest the previous verdict bound itself to
 * @param home the resolved state home
 * @param askIdentity the ask being reviewed
 * @returns the parsed answer, or `undefined` when it cannot be read back
 */
function readReviewedAnswer({
  digest,
  home,
  askIdentity,
}: {
  digest: string;
  home: string;
  askIdentity: AskIdentity;
}): unknown {
  const paths = reviewPaths({ askIdentity, home });
  const path = reviewedAnswerPath({ digest, dir: paths.dir });
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The paths one ask's review uses.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns every path, absolute
 */
export function reviewPaths({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): ReviewPaths {
  const dir = join(stateHomePaths({ home }).live.slack.reviews, `${askIdentity.channel}-${askIdentity.messageTs}`);
  return { dir, packet: join(dir, "packet.md"), record: join(dir, "record.json"), verdict: join(dir, "verdict.json") };
}

/** Write a file atomically and durably, creating its directory. */
function writeAtomically({ path, text }: { path: string; text: string }): void {
  writeFileAtomic({ contents: text, path });
}

/**
 * Move a previous round's verdict out of the fixed verdict path, so the incoming reviewer starts against no
 * verdict at all. A no-op when there is nothing there. See this module's header for what reading a stale one
 * cost.
 *
 * Exported because `turn review` calls it BEFORE it spawns, not only through {@link writeReview} afterwards.
 * The two calls are the same guarded step run at both ends of the one window a spawn opens, and the second is
 * a no-op whenever the first did its job — cheaper than reasoning about whether the window can be polled.
 *
 * @param paths the ask's review paths — its still-current `record.json` names the outgoing round
 * @returns the archive path a file was moved to, or `undefined` when there was nothing to move
 */
export function archiveSupersededVerdict({ paths }: { paths: ReviewPaths }): string | undefined {
  if (!existsSync(paths.verdict)) {
    return undefined;
  }
  const outgoing = readRecordFile({ path: paths.record });
  return archiveVerdictFile({
    paths,
    reviewer: outgoing?.reviewer.workspaceId ?? "unknown-reviewer",
    spawnedAt: outgoing?.spawnedAt ?? "unknown-time",
  });
}

/** How many numbered names {@link linkVerdictArchive} tries before it refuses: a bound, never a loop forever. */
const ARCHIVE_NAME_ATTEMPTS = 50;

/**
 * Move whatever sits at the fixed verdict path to `verdict-superseded-<reviewer>-<when>.json`, NEVER over an
 * archive already there.
 *
 * `renameSync` replaces an existing destination, so two displaced verdicts that named the same reviewer and
 * instant used to leave one of them gone. The move is a hard link, which refuses an existing destination
 * with `EEXIST`, then an unlink of the fixed path; a taken name moves the reviewer token to `<reviewer>-2`,
 * `-3`, … so `./checkpoint.ts`'s `parseSupersededVerdictName` still reads the instant off the tail.
 *
 * @param paths the review directory and the fixed verdict path inside it
 * @param reviewer the token naming whoever WROTE the file being moved — never the round displacing it
 * @param spawnedAt the instant the archived round is ordered by in `./checkpoint.ts`
 * @returns the archive path, or `undefined` when there was no verdict to move
 */
export function archiveVerdictFile({
  paths,
  reviewer,
  spawnedAt,
}: {
  paths: Pick<ReviewPaths, "dir" | "verdict">;
  reviewer: string;
  spawnedAt: string;
}): string | undefined {
  const archived = linkVerdictArchive({ paths, reviewer, spawnedAt });
  if (archived !== undefined) {
    unlinkSync(paths.verdict);
  }
  return archived;
}

/**
 * The first half of {@link archiveVerdictFile}: hard-link the file at `paths.verdict` under a free
 * `verdict-superseded-` name, leaving the source in place.
 *
 * Split out so a caller that owes a record for the archive can write it BETWEEN the link and the unlink: an
 * archive name then never stands without its record, whichever later step fails.
 *
 * @param paths the review directory and the path of the file to archive inside it
 * @param reviewer the token naming whoever WROTE the file — never the round displacing it
 * @param spawnedAt the instant the archived round is ordered by in `./checkpoint.ts`
 * @returns the archive path, or `undefined` when there was no file to link
 */
export function linkVerdictArchive({
  paths,
  reviewer,
  spawnedAt,
}: {
  paths: Pick<ReviewPaths, "dir" | "verdict">;
  reviewer: string;
  spawnedAt: string;
}): string | undefined {
  for (let attempt = 1; attempt <= ARCHIVE_NAME_ATTEMPTS; attempt += 1) {
    let token = reviewer;
    if (attempt > 1) {
      token = `${reviewer}-${String(attempt)}`;
    }
    const archived = join(paths.dir, supersededVerdictName({ reviewer: token, spawnedAt }));
    try {
      linkSync(paths.verdict, archived);
    } catch (cause) {
      if (errnoOf({ cause }) === "EEXIST") {
        continue;
      }
      if (errnoOf({ cause }) === "ENOENT" && !existsSync(paths.verdict)) {
        return undefined;
      }
      throw cause;
    }
    return archived;
  }
  throw new Error(
    `could not archive ${paths.verdict}: ${String(ARCHIVE_NAME_ATTEMPTS)} archive names for ${reviewer} at ${spawnedAt} are already taken`,
  );
}

/**
 * Take whatever file sits at the fixed verdict path OFF that path, in one atomic rename, so what is judged
 * next is exactly the file that is moved next.
 *
 * Judging the path and then moving it is a race: a reviewer whose verdict lands between the two has its OWN
 * verdict archived. A rename is the only step that captures a file and frees the
 * path at once, so the judgement reads the claimed copy and nothing written to the path afterwards can be
 * mistaken for it. The claim name is outside `verdict-superseded-`, so `./checkpoint.ts` never reads one.
 *
 * A rename moves a NAME, never an open descriptor: a writer already holding the file open writes into the
 * claimed inode wherever it is moved. The archive keeps that inode rather than copying its
 * bytes on purpose, so such a write is misfiled under `verdict-superseded-` and never unlinked and lost.
 * No test here holds a descriptor across the claim: this is a residue stated, not one exercised.
 *
 * @param paths the review directory and the fixed verdict path inside it
 * @returns the claim path now holding the file, or `undefined` when nothing was at the verdict path
 */
export function claimVerdictFile({ paths }: { paths: Pick<ReviewPaths, "dir" | "verdict"> }): string | undefined {
  const claimed = join(paths.dir, `verdict-claim-${String(process.pid)}-${randomUUID()}.json`);
  try {
    renameSync(paths.verdict, claimed);
  } catch (cause) {
    if (errnoOf({ cause }) === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
  return claimed;
}

/**
 * Put a claimed file back at the fixed verdict path — never over a file that landed there since the claim.
 *
 * A hard link refuses an existing destination, so a verdict that arrived after the claim is never replaced.
 * In that case both files are left where they are and the answer says so: nothing is deleted to resolve it.
 *
 * @param claimed the claim path {@link claimVerdictFile} returned
 * @param paths the review directory and the fixed verdict path inside it
 * @returns `restored` when the file is back at the verdict path, `path-taken` when another file holds it
 */
export function restoreClaimedVerdict({
  claimed,
  paths,
}: {
  claimed: string;
  paths: Pick<ReviewPaths, "verdict">;
}): "restored" | "path-taken" {
  try {
    linkSync(claimed, paths.verdict);
  } catch (cause) {
    if (errnoOf({ cause }) === "EEXIST") {
      return "path-taken";
    }
    throw cause;
  }
  unlinkSync(claimed);
  return "restored";
}

/**
 * Remove a claim once its bytes are archived under another name — reported, never thrown, because by then the
 * archive and its row both stand and a leftover claim name is only clutter `./checkpoint.ts` never reads.
 *
 * @param claimed the claim path {@link claimVerdictFile} returned
 * @returns why the claim could not be removed, or `undefined` when it is gone
 */
export function removeClaimedVerdict({ claimed }: { claimed: string }): string | undefined {
  try {
    unlinkSync(claimed);
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
  return undefined;
}

/** The `code` a Node filesystem error carries, or `undefined` when the throw was not one. */
function errnoOf({ cause }: { cause: unknown }): string | undefined {
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return undefined;
}

/**
 * Persist the packet and the record for one review, archiving any verdict the previous round left behind.
 *
 * The archive FIRST, then the packet, then the record: each step is only safe once the one before it is done.
 * A record naming a packet that does not exist yet is the boot-versus-delivery race `dispatch.ts` closes, one
 * layer over; a record readable while the old verdict is still in place is the poll-kills-its-own-reviewer
 * defect this module's header describes.
 *
 * @param packet the packet text the reviewer reads
 * @param record the review record
 * @param home the resolved state home
 * @returns where a superseded verdict was archived to, or `undefined` when the round left none
 */
export function writeReview({
  packet,
  record,
  home,
}: {
  packet: string;
  record: ReviewRecord;
  home: string;
}): string | undefined {
  const paths = reviewPaths({ askIdentity: record, home });
  mkdirSync(paths.dir, { recursive: true });
  const archived = archiveSupersededVerdict({ paths });
  writeAtomically({ path: paths.packet, text: packet });
  writeAtomically({ path: paths.record, text: `${JSON.stringify(record, null, 2)}\n` });
  return archived;
}

/**
 * Stamp a review record as released, so nothing later tries to close the workspace again.
 *
 * A whole-record rewrite rather than a patch: the record is small, `parseReviewRecord` has already validated
 * what is being written, and a partial write is the one failure that would leave an unreadable address behind.
 * A record that has gone missing is not recreated — there is nothing left to say `releasedAt` about.
 *
 * @param atIso when the release happened
 * @param home the resolved state home
 * @param record the review whose reviewer was just released
 */
export function markReviewerReleased({
  atIso,
  home,
  record,
}: {
  atIso: string;
  home: string;
  record: ReviewRecord;
}): void {
  const paths = reviewPaths({ askIdentity: record, home });
  if (!existsSync(paths.record)) {
    return;
  }
  writeAtomically({ path: paths.record, text: `${JSON.stringify({ ...record, releasedAt: atIso }, null, 2)}\n` });
}

/**
 * Read one ask's review record back, validated. Absent, unreadable or malformed all collapse to `undefined` —
 * no record is the ordinary state for an ask nobody has asked to review.
 *
 * @param askIdentity the exact ask
 * @param home the resolved state home
 * @returns the record, or `undefined`
 */
export function readReviewRecord({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): ReviewRecord | undefined {
  return readRecordFile({ path: reviewPaths({ askIdentity, home }).record });
}

/** Read and validate one record file by path. Absent, unreadable or malformed all collapse to `undefined`. */
function readRecordFile({ path }: { path: string }): ReviewRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  const parsed = parseReviewRecord({ value: raw });
  return parsed.isOk() ? parsed.value : undefined;
}

/**
 * Read the verdict file a review named, classified for `reviewPollTruth`. A file that is not there is
 * `absent`; one that is there but does not parse as a verdict is `invalid` with the parser's own reasons; one
 * that parses but was written by a PREVIOUS round's reviewer is `superseded`, never `present`.
 *
 * That last classification lives here, in the read, rather than at each use — so a caller cannot obtain a
 * foreign verdict by asking for the file and looking at one field. It is the read half of the same idea
 * `writeReview` enforces on the write half.
 *
 * @param record the review whose verdict path to read, and whose `reviewerSession` says whose verdict counts
 * @returns how the file read
 */
export function readVerdictFile({ record }: { record: ReviewRecord }): VerdictFileRead {
  try {
    readFileSync(record.verdictPath, "utf8");
  } catch {
    return { kind: "absent" };
  }
  const verdict = readReviewVerdict({ path: record.verdictPath });
  if (verdict.isErr()) {
    return { kind: "invalid", reason: verdict.error.join("; ") };
  }
  return verdictSpeaksForReviewer({ reviewerSession: record.reviewerSession, verdict: verdict.value })
    ? { kind: "present", verdict: verdict.value }
    : { kind: "superseded", verdict: verdict.value, wroteIt: verdict.value.reviewerSession };
}

/**
 * Which paths of the answer moved since the round whose settlement is being carried.
 *
 * `undefined` — meaning "cannot tell", which the packet renders differently from "nothing moved" — whenever
 * the previous round wrote no verdict to bind a digest, or its answer cannot be read back. It no longer waits
 * for a carried SETTLED claim: measured over one week, 107 of 127 verdicts carried none, and every one of
 * those re-reviews was handed no change list at all (`./reviewThroughput.ts`).
 * Every one of those fails closed to a full re-verification rather than to an empty change list.
 *
 * @param answer the answer this round will review
 * @param askIdentity the ask being reviewed
 * @param home the resolved state home
 * @param inherited what this round inherits, carrying the digest the previous verdict was bound to
 * @returns the change list, or `undefined` when there is nothing sound to compare against
 */
export function previousAnswerChanges({
  answer,
  askIdentity,
  home,
  inherited,
}: {
  answer: unknown;
  askIdentity: AskIdentity;
  home: string;
  inherited: { readonly settledDigest: string | undefined };
}): readonly AnswerChange[] | undefined {
  if (inherited.settledDigest === undefined) {
    return undefined;
  }
  const before = readReviewedAnswer({ askIdentity, digest: inherited.settledDigest, home });
  return before === undefined ? undefined : structuralChanges({ after: answer, before });
}
