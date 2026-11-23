/**
 * The nudge register: every stuck CodeRabbit review `slopweaver github landing --press` re-requested, one
 * claim file per pull request AND head.
 *
 * ## Why it exists
 *
 * The owner's ruling makes a re-request the fleet's own act once every CodeRabbit thread is resolved and
 * twenty seconds have passed with CHANGES_REQUESTED still standing (`./codeRabbitNudge.ts`). A bot that stays
 * stuck AFTER one re-request is no longer the stuck-flip case, and a press that re-requested it on every tick
 * would be a wake loop posting `@coderabbitai review` every few minutes. So one head is re-requested at most
 * once, and after that the row stays `spawn-coderabbit` for a session to read the review body.
 *
 * The door ledger cannot answer "was this head already re-requested", for the reason `./pressJournal.ts`
 * gives: by design it stores no target id.
 *
 * ## Claimed BEFORE the post, and claimed exclusively
 *
 * `github comment create` reports a failure when the post landed but its read-back did not, so recording
 * only on success would let the next tick post a duplicate. The claim is made before the comment is sent; an
 * attempt that then fails has still spent that head's one automatic re-request, which errs toward silence.
 *
 * A claim is a FILE per head created with `wx`, never a line appended after a read: a read-check-append
 * register lets two concurrent passes both read "absent" and both post. The filesystem's exclusive create is the compare-and-set, so exactly one pass wins a head.
 *
 * **"Once" is per STATE HOME**, like every register under it (`./pressJournal.ts` included): two passes
 * pointed at two different `--home` directories are two installs and coordinate through nothing. The supervisor tick runs against the one resolved home.
 *
 * **Its one known gap is a repository RENAME.** The key is the slug the read reports, not GitHub's immutable
 * repository id, so a repository renamed while a pull request sits stuck at the same head files a second key
 * and gets one more re-request. `./pressJournal.ts` keys by slug the same way. The
 * cost is one extra `@coderabbitai review` comment, and closing it means carrying a repository node id through
 * the fleet read, which nothing else needs yet.
 */

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

/** Owner-only, matching every other register under the state home. */
const FILE_MODE = 0o600;

/** Owner-only for the directory the claims live in. */
const DIR_MODE = 0o700;

/** The suffix every claim file carries, so a stray file in the directory is never read as a claim. */
const CLAIM_SUFFIX = ".json";

/** The register exists but could not be read — never read as empty, which would re-request every spent head. */
export interface NudgeRegisterUnreadableError {
  readonly code: "NUDGE_REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The claim could not be created, so the head is not claimed and nothing may be posted. */
export interface NudgeRegisterUnwritableError {
  readonly code: "NUDGE_REGISTER_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Why the nudge register could not answer. */
export type CodeRabbitNudgeJournalError = NudgeRegisterUnreadableError | NudgeRegisterUnwritableError;

/** Factories for {@link CodeRabbitNudgeJournalError}. */
export const CodeRabbitNudgeJournalErrors = {
  unreadable: ({ path, cause }: { path: string; cause: unknown }): NudgeRegisterUnreadableError => ({
    cause,
    code: "NUDGE_REGISTER_UNREADABLE",
    message: `the CodeRabbit nudge register ${path} could not be read: ${String(cause)}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): NudgeRegisterUnwritableError => ({
    cause,
    code: "NUDGE_REGISTER_UNWRITABLE",
    message: `the CodeRabbit nudge register ${path} could not be written: ${String(cause)}`,
    path,
  }),
} as const;

/** One re-request this machine attempted, as the contents of its claim file. */
export interface CodeRabbitNudgeRecord {
  /** When the attempt was claimed — immediately before the comment was posted. */
  readonly attemptedAtIso: string;
  readonly repoSlug: string;
  readonly number: number;
  /** The head the stuck verdict was read on; another head of the same pull request is a new case. */
  readonly headOid: string;
}

/**
 * The register's directory.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `landing-coderabbit-nudges/`
 */
export function codeRabbitNudgeJournalPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).landingCodeRabbitNudgesDir;
}

/**
 * The key one head of one pull request is filed under.
 *
 * @param repoSlug `owner/name`
 * @param number the pull request number
 * @param headOid the full head commit
 * @returns `owner/name#number@head`
 */
export function codeRabbitNudgeKey({
  repoSlug,
  number,
  headOid,
}: {
  repoSlug: string;
  number: number;
  headOid: string;
}): string {
  return `${repoSlug}#${String(number)}@${headOid}`;
}

/**
 * The claim file name one key is filed under — the key percent-encoded, so its `/` never names a directory.
 *
 * @param key a key as {@link codeRabbitNudgeKey} spells it
 * @returns the file name, suffix included
 */
export function codeRabbitNudgeClaimName({ key }: { key: string }): string {
  return `${encodeURIComponent(key)}${CLAIM_SUFFIX}`;
}

/**
 * The key a directory entry files, or undefined when the entry is not a claim this register wrote.
 *
 * @param name one entry of the register's directory
 * @returns the key, as {@link codeRabbitNudgeKey} spells it
 */
export function codeRabbitNudgeKeyOfClaim({ name }: { name: string }): string | undefined {
  if (!name.endsWith(CLAIM_SUFFIX)) {
    return undefined;
  }
  try {
    return decodeURIComponent(name.slice(0, -CLAIM_SUFFIX.length));
  } catch {
    return undefined;
  }
}

/** Whether a thrown filesystem error carries the given `code`. */
function hasCode({ error, code }: { error: unknown; code: string }): boolean {
  return isRecord(error) && error["code"] === code;
}

/**
 * Every head the register says was already re-requested, answering "nothing recorded" when the directory
 * does not exist yet.
 *
 * Any OTHER read failure is an error rather than an empty set: an unreadable register read as empty would
 * re-request every head it had already spent, which is the loop this register exists to stop.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the keys already re-requested, or why the register could not be read
 */
export function readCodeRabbitNudgedHeads({ home }: { home?: string } = {}): Result<
  ReadonlySet<string>,
  CodeRabbitNudgeJournalError
> {
  const path = codeRabbitNudgeJournalPath(home === undefined ? {} : { home });
  let names: readonly string[];
  try {
    names = readdirSync(path);
  } catch (error) {
    if (hasCode({ code: "ENOENT", error })) {
      return ok(new Set());
    }
    return err(CodeRabbitNudgeJournalErrors.unreadable({ cause: error, path }));
  }
  const heads = new Set<string>();
  for (const name of names) {
    const key = codeRabbitNudgeKeyOfClaim({ name });
    if (key !== undefined) {
      heads.add(key);
    }
  }
  return ok(heads);
}

/**
 * Claim one head's re-request, immediately before the comment is posted.
 *
 * The claim file is created exclusively, so of two passes claiming the same head — a second one that started
 * during this one's twenty-second wait, say — exactly one answers `reserved` and the other `already-recorded`.
 *
 * @param record the attempt about to be made
 * @param home the state home (defaults to the resolved home)
 * @returns `reserved`, `already-recorded`, or why the claim could not be made
 */
export function reserveCodeRabbitNudge({
  record,
  home,
}: {
  record: CodeRabbitNudgeRecord;
  home?: string;
}): Result<"reserved" | "already-recorded", CodeRabbitNudgeJournalError> {
  const dir = codeRabbitNudgeJournalPath(home === undefined ? {} : { home });
  const path = join(dir, codeRabbitNudgeClaimName({ key: codeRabbitNudgeKey(record) }));
  // Two tries, not one: `mkdirSync` over a FILE at `dir` also throws EEXIST, which must read as unwritable
  // rather than as a head somebody already claimed.
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  } catch (error) {
    return err(CodeRabbitNudgeJournalErrors.unwritable({ cause: error, path: dir }));
  }
  try {
    writeFileSync(path, `${JSON.stringify(record)}\n`, { flag: "wx", mode: FILE_MODE });
  } catch (error) {
    if (hasCode({ code: "EEXIST", error })) {
      return ok("already-recorded");
    }
    return err(CodeRabbitNudgeJournalErrors.unwritable({ cause: error, path }));
  }
  return ok("reserved");
}
