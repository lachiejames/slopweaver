/**
 * The completeness ORACLE — an independent second opinion on whether the thread we hold is the whole thread.
 * Pure.
 *
 * ## Why the protocol alone was not enough
 *
 * `pagination.ts` proves the cursor was exhausted and cross-checks Slack's `has_more`. That is a claim about
 * OUR loop: we followed the protocol correctly. It never asks Slack how many replies there are supposed to
 * be, so a page Slack simply declined to mention is indistinguishable from a thread that ended. The thread
 * root carries `reply_count`, which is exactly that independent number, and until now this verb ignored it.
 *
 * ## Report, do not refuse — and why that is not a softening
 *
 * The tempting rule is "fetched count ≠ `reply_count` + 1 ⇒ fail". It is wrong, and it would refuse
 * perfectly good threads: `reply_count` goes stale when a reply is deleted, and it can drift in BOTH
 * directions — advertising more than a token can read (a deleted reply, a message from an app this token
 * cannot see) and advertising fewer (a count not yet caught up). A mismatch is therefore evidence of a
 * discrepancy, never proof of incompleteness, and a verb that turns evidence into a refusal destroys the
 * thread it was asked to read in order to report a number it cannot trust.
 *
 * So the split is deliberate, and the two halves are not the same kind of claim:
 *
 *  - **A protocol fault stays FATAL** (`pagination.ts`): a repeated cursor, `has_more` with no cursor, a
 *    thrown page. Those prove our own read broke, and a broken read has nothing honest to return.
 *  - **A count disagreement is REPORTED** (this module): stated in the output, in both directions, with the
 *    provider's number and ours kept as separate figures rather than collapsed into one "N of M".
 *
 * ## Every number here is separate on purpose
 *
 * Collapsing them is the failure mode. "Showing 300 of 311" reads as a provider shortfall when it might be
 * our own cap, our own shaping loss, or a stale count — three different actions for the reader. So the
 * provider's advertised total, the rows received, the rows that survived de-duplication and the rows the
 * document actually holds are each reported as themselves.
 *
 * Ported from the evidence model in `src/references/completeness.ts`, which does this better than
 * what `read-thread` shipped with. Re-implemented against this verb's own shapes rather than reused: that model
 * models a document of many collections, and a thread is one collection whose total is always `reply_count`
 * plus its root.
 *
 * ## The attachment half: a file that could not be fetched is EVIDENCE, not an error
 *
 * The same argument runs a second time over attachments, and the two are deliberately different claims.
 *
 * A *skip* (`filePlan.ts`) is a decision this program made for a stated reason — a video it cannot read, a
 * file over the size cap, a canvas Slack does not serve as bytes. An **unretrievable** file is one this
 * program intended to fetch and could not: the GET failed, or the token lacks the scope. Collapsing the two
 * would tell a reader that a transient failure and a deliberate policy are the same event, when only one of
 * them is worth retrying.
 *
 * Both are reported. Neither is fatal, and that is a correction rather than a softening: `fileDownloads.ts`
 * used to return `err` on the first failed download, which destroyed the ENTIRE thread — every message, every
 * other attachment — to report one missing PDF. `filePlan.ts` records that happening for real ("a single
 * canvas fail[ed] the ENTIRE thread read … the user got nothing at all for a thread whose other six
 * attachments were fine") and fixed it for canvases alone by pre-skipping them, leaving the general defect in
 * place. `blockFiles.ts` had already made the opposite call for `files.info` and written down why: "making a
 * `files.info` failure sink the whole thread would mean a token missing `files:read` turns a thread that used
 * to read fine into nothing at all."
 *
 * That argument is correct and it applies unchanged to the bytes. The original concern — that a message whose
 * PDF silently failed is a message the model summarises without its content — is answered by the word
 * *silently*: an unretrievable file appears in `unretrievableFiles`, in `limitations`, and in `warnings`, so
 * the model is told outright which file it is reasoning without and why.
 */

import { isRecord } from "../../lib/parsers.js";

/**
 * What the evidence supports about the thread we hold. Five arms because they are five different reader
 * actions, and a boolean `complete` would have to pick one of them to be.
 */
type ThreadCompletenessVerdict =
  /** Rows were fetched and are not represented in the output. The only arm that proves real loss. */
  | "shaping-loss"
  /** We hold fewer messages than Slack's own count advertises. */
  | "short-of-advertised"
  /** We hold MORE than Slack's count advertises — the stale-`reply_count` direction. */
  | "over-advertised"
  /** Slack advertised no `reply_count`, so cursor exhaustion is the only evidence there is. */
  | "unverified"
  /** Slack's own count corroborates what we hold, and nothing was lost on the way. */
  | "corroborated";

/** The completeness evidence for one thread. Numbers, not a verdict dressed as one. */
export interface ThreadCompleteness {
  /**
   * `reply_count + 1` off the thread root — the root plus its replies IS the thread. `null` when Slack
   * advertised no count, which is a different claim from a count of zero and is kept as one.
   */
  readonly providerTotalObserved: number | null;
  /** Rows received across every page, before de-duplication. */
  readonly fetchedRaw: number;
  /** Distinct `ts` values among them. */
  readonly fetchedUnique: number;
  /**
   * Rows Slack sent more than once. Expected and benign: `conversations.replies` returns the thread root as
   * `messages[0]` of EVERY page, so a clean two-page read repeats exactly one row. Reported because a
   * larger number than the page count would mean something else entirely.
   */
  readonly repeatedRows: number;
  /** Messages the document actually carries. */
  readonly held: number;
  /**
   * Rows that arrived and are NOT in the output. Structurally zero today — `projection.ts` refuses a row it
   * cannot read rather than dropping it — and computed rather than assumed, so the day that changes this
   * says so instead of continuing to claim completeness.
   */
  readonly droppedInShaping: number;
  /** The FLOOR on what Slack says exists and we do not hold. Zero when we hold at least as much. */
  readonly excludedAtLeast: number;
  /** How many more we hold than Slack advertised. Zero in the other direction. */
  readonly surplusObserved: number;
  readonly verdict: ThreadCompletenessVerdict;
}

/**
 * Slack's advertised reply count off one raw row, or `null` when it carries none.
 *
 * @param raw the row as `conversations.replies` returned it
 * @returns the non-negative integer `reply_count`, or null when absent or not a count
 */
function replyCountOf({ raw }: { raw: unknown }): number | null {
  if (!isRecord(raw)) {
    return null;
  }
  const count = raw["reply_count"];
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

/** Distinct `ts` values across the raw rows — the de-duplicated row count. */
function uniqueTsCount({ rawMessages }: { rawMessages: readonly unknown[] }): number {
  const seen = new Set<string>();
  for (const raw of rawMessages) {
    if (isRecord(raw)) {
      const ts = raw["ts"];
      if (typeof ts === "string" && ts.length > 0) {
        seen.add(ts);
      }
    }
  }
  return seen.size;
}

/** The verdict, in priority order: real loss first, then each direction of disagreement. */
function verdictFor({
  droppedInShaping,
  excludedAtLeast,
  surplusObserved,
  providerTotalObserved,
}: {
  droppedInShaping: number;
  excludedAtLeast: number;
  surplusObserved: number;
  providerTotalObserved: number | null;
}): ThreadCompletenessVerdict {
  if (droppedInShaping > 0) {
    return "shaping-loss";
  }
  if (excludedAtLeast > 0) {
    return "short-of-advertised";
  }
  if (surplusObserved > 0) {
    return "over-advertised";
  }
  return providerTotalObserved === null ? "unverified" : "corroborated";
}

/**
 * Derive the completeness evidence for a fetched thread.
 *
 * @param rawMessages every row across every page, in Slack's order
 * @param threadTs the thread ROOT timestamp — the row whose `reply_count` is the oracle
 * @param held how many messages the document actually carries after projection
 * @returns the evidence, with the verdict derived from it rather than asserted
 */
export function deriveThreadCompleteness({
  rawMessages,
  threadTs,
  held,
}: {
  rawMessages: readonly unknown[];
  threadTs: string;
  held: number;
}): ThreadCompleteness {
  // The FIRST occurrence of the root: Slack repeats it on every page, and taking the first keeps the reading
  // stable rather than dependent on which page happened to be last.
  const root = rawMessages.find((raw) => isRecord(raw) && raw["ts"] === threadTs);
  const replyCount = replyCountOf({ raw: root });
  const providerTotalObserved = replyCount === null ? null : replyCount + 1;
  const fetchedUnique = uniqueTsCount({ rawMessages });
  const shortfall = providerTotalObserved === null ? 0 : providerTotalObserved - held;
  const droppedInShaping = Math.max(0, fetchedUnique - held);
  const excludedAtLeast = Math.max(0, shortfall);
  const surplusObserved = Math.max(0, -shortfall);
  return {
    droppedInShaping,
    excludedAtLeast,
    fetchedRaw: rawMessages.length,
    fetchedUnique,
    held,
    providerTotalObserved,
    repeatedRows: rawMessages.length - fetchedUnique,
    surplusObserved,
    verdict: verdictFor({ droppedInShaping, excludedAtLeast, providerTotalObserved, surplusObserved }),
  };
}

/**
 * Why an attachment this program INTENDED to fetch has no bytes. Distinct from `FileSkipReason`, which names
 * a decision rather than a failure.
 */
type UnretrievableReason =
  /** The authenticated GET for the bytes failed, was refused, or returned something that was not the file. */
  | "download-failed"
  /** The token does not hold the scope the file lane needs, so the GET was never attempted. */
  | "scope-missing";

/**
 * An attachment that should have been retrieved and was not.
 *
 * `method` and `detail` are both carried because they answer different questions: which call broke, and what
 * it said. A reader deciding whether to retry, grant a scope, or accept the loss needs both.
 */
export interface UnretrievableFile {
  readonly fileId: string;
  readonly messageTs: string;
  readonly reason: UnretrievableReason;
  /** The Slack method or operation that failed, e.g. `slack.files.download`. */
  readonly method: string;
  /** The provider's own words, or this program's reason for not trying. */
  readonly detail: string;
  readonly name?: string;
  readonly mimetype?: string;
  readonly size?: number;
}

/** What the evidence supports about the thread's ATTACHMENTS. */
type FileCompletenessVerdict =
  /** At least one attachment we meant to fetch has no bytes. The only arm that proves attachment loss. */
  | "unretrievable-loss"
  /** Nothing failed, but attachments were deliberately excluded for stated reasons. */
  | "stated-exclusions"
  /** Every attachment the thread carries was either fetched or there were none. */
  | "complete";

/** The attachment evidence for one thread. Four separate counts, for the reason the message lane keeps five. */
export interface FileCompleteness {
  /**
   * Attachments seen on the messages this read RETURNED, in both channels — top-level `files` and Block Kit
   * references.
   *
   * "Returned" rather than "in the thread", and the distinction only bites under `--since`: attachments are
   * planned for the returned messages alone, because downloading a file for a message the caller already has
   * is the same waste as re-sending the message. On a full read the two are the same population. Saying
   * "across the thread" here would be a count this read did not take.
   */
  readonly observed: number;
  /** Attachments whose bytes are on disk. */
  readonly retrieved: number;
  /** Attachments deliberately not fetched, each with a stated reason. */
  readonly skipped: number;
  /** Attachments this program meant to fetch and could not. */
  readonly unretrievable: number;
  readonly verdict: FileCompletenessVerdict;
}

/**
 * Derive the attachment evidence.
 *
 * The verdict is computed from the counts rather than asserted by the caller, for the same reason the message
 * lane does it: a stage that both performs the work and declares it complete has no independent check.
 *
 * @param retrieved how many attachments' bytes reached disk
 * @param skipped how many were deliberately excluded with a stated reason
 * @param unretrievable how many were meant to be fetched and were not
 * @returns the evidence, with `observed` as their sum and the verdict derived from it
 */
export function deriveFileCompleteness({
  retrieved,
  skipped,
  unretrievable,
}: {
  retrieved: number;
  skipped: number;
  unretrievable: number;
}): FileCompleteness {
  return {
    observed: retrieved + skipped + unretrievable,
    retrieved,
    skipped,
    unretrievable,
    verdict: fileVerdictFor({ skipped, unretrievable }),
  };
}

/** The attachment verdict, in priority order: real loss first, then stated policy. */
function fileVerdictFor({
  skipped,
  unretrievable,
}: {
  skipped: number;
  unretrievable: number;
}): FileCompletenessVerdict {
  if (unretrievable > 0) {
    return "unretrievable-loss";
  }
  return skipped > 0 ? "stated-exclusions" : "complete";
}

/**
 * One sentence per unretrievable attachment, naming the file, the failing method and the reason.
 *
 * Per FILE rather than grouped by class, which is the opposite of how `describeSkips` in `filePlan.ts` reports
 * skips — and deliberately so. A skip class is a policy and its members are interchangeable ("3 files over the
 * size cap"); an unretrievable file is a specific thing the reader may want to go and look at, and its
 * `detail` is usually different from its neighbour's even when the class matches.
 *
 * @param files every unretrievable attachment
 * @returns one sentence each, in the order they were encountered
 */
export function describeUnretrievable({ files }: { files: readonly UnretrievableFile[] }): readonly string[] {
  return files.map((file) => {
    const named = file.name === undefined ? file.fileId : `${file.name} (${file.fileId})`;
    const why =
      file.reason === "scope-missing"
        ? "not attempted: this token lacks the scope the file lane needs"
        : "could not be retrieved";
    return `${named} on message ${file.messageTs} ${why} — ${file.method}: ${file.detail}`;
  });
}

/**
 * The caveat sentence for a thread whose evidence does not fully agree — the honest form of "N of M".
 *
 * The numbers are stated separately because they describe different domains: what Slack advertised, and what
 * this read holds. It says outright that a stale count is a live explanation, because a reader who is told
 * only "1 missing" will go looking for a bug that may not exist.
 *
 * @param completeness the derived evidence
 * @returns one sentence, or undefined when every lane of evidence agrees and there is nothing to caveat
 */
export function describeThreadCompleteness({ completeness }: { completeness: ThreadCompleteness }): string | undefined {
  const held = String(completeness.held);
  const advertised = String(completeness.providerTotalObserved);
  switch (completeness.verdict) {
    case "corroborated":
    case "unverified":
      return undefined;
    case "shaping-loss":
      return (
        `${String(completeness.droppedInShaping)} fetched message(s) are not in this output: ` +
        `${String(completeness.fetchedUnique)} distinct rows arrived and ${held} are represented`
      );
    case "short-of-advertised":
      return (
        `Slack's own reply_count advertises ${advertised} messages and this read holds ${held}; ` +
        `at least ${String(completeness.excludedAtLeast)} not represented. Pagination WAS exhausted, so this ` +
        "is a discrepancy between two Slack figures rather than proof the read stopped early — a reply this " +
        "token cannot see, or a count that has not caught up, would both look like this"
      );
    case "over-advertised":
      return (
        `this read holds ${held} messages and Slack's own reply_count advertises only ${advertised}; ` +
        `${String(completeness.surplusObserved)} more than advertised. Slack does not document the rows ` +
        "`conversations.replies` returns and the rows `reply_count` counts as the same population, so the " +
        "count is the likelier of the two to be wrong. Nothing is missing in this direction"
      );
  }
}
