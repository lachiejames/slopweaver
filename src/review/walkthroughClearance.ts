/**
 * Self-review walkthroughs on the OWNER's pull requests: which of them a landing verb resolves first, whether a pull
 * request carries one at all, and the ledger row the resolving leaves behind.
 *
 * The rule: self-review comments on pull requests are wanted, and all of them are self-resolved before a pull
 * request merges. Otherwise the pull request stays stuck open over comments that are not actually callouts.
 *
 * ## Why BEFORE the queue entry, measured
 *
 * A queue entry is not a merge, but `acme/acme-admin`'s `staging` queue refuses the ENTRY over an open
 * conversation. `enqueuePullRequest` with three one-voice notes open answered
 * _"A conversation must be resolved before this pull request can be merged."_; once a session resolved the
 * three by hand, the same press was accepted.
 *
 * ## What is resolved, and what never is
 *
 * A thread the pull request's author opened on which the owner also holds the last word: `../review/prStateDetail.ts`'s
 * `ours-open`, and its `answered-open` where the opener is the author too — a note carrying the owner's own follow-up,
 * or a colleague's question the owner answered without resolving. Left open, that second shape is merged over by
 * `github merge --admin` and refused by the queue exactly as a one-voice note is. The safety argument is the last word, never widened past it: a thread whose last comment is a
 * colleague's is a colleague waiting, and the reply guard holds the landing on it instead. On top of it, the
 * author must be the account the token belongs to: the fleet presses with the OWNER's token, and resolving a
 * teammate's or a bot's own notes on their pull request is not something the owner asked for.
 *
 * Pure. No I/O, no clock.
 */

import { createHash } from "node:crypto";

import type { AutonomyError } from "../autonomy/errors.js";
import { buildAutonomyAction } from "../autonomy/row.js";
import type { AutonomyActionRow } from "../autonomy/types.js";
import type { Result } from "../lib/result.js";
import type { PrReviewThread } from "../live/github/reviewState.js";
import type { LandingRow } from "./landing.js";
import { type ThreadDetail, threadDetails } from "./prStateDetail.js";

/** What a press does about the author's own open walkthrough threads. */
export type WalkthroughClearance =
  /** There is no open one-voice author thread to resolve. */
  | { readonly kind: "none" }
  /** There are, but the pull request is not the authenticated account's, so they are left exactly as they are. */
  | { readonly kind: "not-ours"; readonly authorLogin: string; readonly open: number }
  /**
   * At least one came back with no node id, so `github thread resolve` cannot address it and GitHub would
   * refuse the entry on it anyway: the press is not made.
   */
  | { readonly kind: "unaddressable"; readonly open: number; readonly unaddressable: number }
  /** Resolve these, by node id, before the press. */
  | { readonly kind: "clear"; readonly threadIds: readonly string[] };

/**
 * Which of the author's own open walkthrough threads a press resolves before it enqueues.
 *
 * A bot-typed opener is never "ours", whatever its login spells.
 *
 * @param authorLogin the pull request's author
 * @param viewerLogin the login the pressing token belongs to
 * @param threads every thread the read carried
 * @returns the clearance
 */
export function walkthroughClearance({
  authorLogin,
  viewerLogin,
  threads,
}: {
  authorLogin: string;
  viewerLogin: string;
  threads: readonly PrReviewThread[];
}): WalkthroughClearance {
  const ours = threadDetails({ prAuthorLogin: authorLogin, threads }).filter(
    (detail) =>
      detail.openedByBot !== true &&
      detail.openedByLogin === authorLogin &&
      (detail.disposition === "ours-open" || detail.disposition === "answered-open"),
  );
  if (ours.length === 0) {
    return { kind: "none" };
  }
  if (authorLogin.toLowerCase() !== viewerLogin.toLowerCase()) {
    return { authorLogin, kind: "not-ours", open: ours.length };
  }
  const unaddressable = ours.filter((detail) => detail.id === "").length;
  if (unaddressable > 0) {
    return { kind: "unaddressable", open: ours.length, unaddressable };
  }
  return { kind: "clear", threadIds: ours.map((detail) => detail.id) };
}

/**
 * What a re-read straight after the resolves says about the threads the press selected.
 *
 * GitHub's resolve is addressed by node id and has no precondition, so a colleague's reply landing between the
 * first read and the resolve is resolved with it, and another client can reopen a thread before the press. The
 * re-read cannot prevent either; it makes both visible, and the landing verb reopens a replied thread and
 * refuses. A replied thread must be REOPENED rather than only reported: resolved, it no longer reads as
 * `ours-open`, so a retry would select nothing and land over the collapsed reply.
 *
 * A reply is a comment count GROWN past the read that selected the thread, never a count above one: a note
 * carrying the author's own follow-up is selected with two comments already.
 *
 * @param threadIds the node ids the press resolved
 * @param before every thread the read that selected them carried
 * @param threads every thread the re-read carried
 * @returns which are no longer resolved (or were not in the re-read at all), and which gained a reply
 */
export function walkthroughRecheck({
  threadIds,
  before,
  threads,
}: {
  threadIds: readonly string[];
  before: readonly PrReviewThread[];
  threads: readonly PrReviewThread[];
}): { readonly open: readonly string[]; readonly replied: readonly string[] } {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const selectedById = new Map(before.map((thread) => [thread.id, thread]));
  return {
    open: threadIds.filter((id) => byId.get(id)?.isResolved !== true),
    replied: threadIds.filter((id) => {
      const thread = byId.get(id);
      if (thread === undefined) {
        return false;
      }
      // A thread the selecting read did not carry has no count to grow past, so it reads as replied: reopening
      // one of the author's notes is the safe direction.
      const selected = selectedById.get(id);
      return selected === undefined || thread.commentCount > selected.commentCount;
    }),
  };
}

/** What the walkthrough-thread register remembers about one pull request, as the guards below read it. */
export interface LandingThreadMemory {
  /** Every thread a landing set out to resolve. */
  readonly resolved: readonly string[];
  /** Each thread a landing reopened over a colleague's reply, to the thread as it stood at the latest reopen. */
  readonly surfaced: Readonly<Record<string, { readonly replyAtIso: string; readonly replyCount: number }>>;
}

/**
 * The threads a landing resolved on the owner's pull request where somebody else now holds the last word.
 *
 * @returns those threads, empty unless the pull request is the pressing account's own
 */
function landingResolvedReplies({
  authorLogin,
  viewerLogin,
  threads,
  memory,
}: {
  authorLogin: string;
  viewerLogin: string;
  threads: readonly PrReviewThread[];
  memory: LandingThreadMemory;
}): readonly PrReviewThread[] {
  const viewer = viewerLogin.toLowerCase();
  if (authorLogin.toLowerCase() !== viewer) {
    return [];
  }
  const resolved = new Set(memory.resolved);
  return threads.filter((thread) => resolved.has(thread.id) && thread.lastCommentLogin.toLowerCase() !== viewer);
}

/**
 * A colleague's reply collapsed under a resolve the LANDING made: reopen it before anything lands.
 *
 * A raced reply is resolved with the note it answers, and GitHub records that resolve as the owner's, since the
 * fleet presses with the owner's token. Only the register knows the resolve was the landing's, so a thread the
 * owner resolved by hand after reading a reply is never selected, and one the landing already reopened
 * (`surfaced`) is the owner's to resolve again — until the thread gains a comment or a newer last reply than it
 * held at that reopen, which is a reply the owner has not been shown.
 * Re-derived on every run, so a reopen that failed is retried by the next landing.
 *
 * @param authorLogin the pull request's author
 * @param viewerLogin the login the pressing token belongs to
 * @param threads every thread the read carried
 * @param memory what the register holds for this pull request
 * @returns the node ids to reopen
 */
export function collapsedReplies({
  authorLogin,
  viewerLogin,
  threads,
  memory,
}: {
  authorLogin: string;
  viewerLogin: string;
  threads: readonly PrReviewThread[];
  memory: LandingThreadMemory;
}): readonly string[] {
  const viewer = viewerLogin.toLowerCase();
  const shown = (thread: PrReviewThread): boolean => {
    const seen = memory.surfaced[thread.id];
    if (seen === undefined) {
      return false;
    }
    return thread.commentCount <= seen.replyCount && Date.parse(thread.lastCommentAtIso) <= Date.parse(seen.replyAtIso);
  };
  return landingResolvedReplies({ authorLogin, memory, threads, viewerLogin })
    .filter((thread) => thread.isResolved && thread.resolvedByLogin?.toLowerCase() === viewer)
    .filter((thread) => !shown(thread))
    .map((thread) => thread.id);
}

/**
 * A colleague's reply, open with nobody's answer after it, on one of the author's own walkthrough threads or on a thread
 * the landing resolved.
 *
 * This is what keeps a reply from being merged over. Open, it is no longer `ours-open`, so nothing resolves it,
 * and `github merge --admin` bypasses the conversation rule that would hold the queue door. A thread the author opened
 * holds whether or not the register knows it, because a reply arriving just before the landing's own read is
 * one the landing has never resolved. The landing refuses until the author answers it; a
 * bare resolve of one the landing resolved is reopened by {@link collapsedReplies}.
 *
 * @param authorLogin the pull request's author
 * @param viewerLogin the login the pressing token belongs to
 * @param threads every thread the read carried
 * @param memory what the register holds for this pull request
 * @returns the node ids still waiting on the author
 */
export function unansweredReplies({
  authorLogin,
  viewerLogin,
  threads,
  memory,
}: {
  authorLogin: string;
  viewerLogin: string;
  threads: readonly PrReviewThread[];
  memory: LandingThreadMemory;
}): readonly string[] {
  const viewer = viewerLogin.toLowerCase();
  if (authorLogin.toLowerCase() !== viewer) {
    return [];
  }
  const resolved = new Set(memory.resolved);
  return threads
    .filter((thread) => !thread.isResolved && thread.lastCommentLogin.toLowerCase() !== viewer)
    .filter((thread) => resolved.has(thread.id) || thread.openedByLogin.toLowerCase() === viewer)
    .map((thread) => thread.id);
}

/**
 * Whether the author left any inline self-review comment at all, resolved or not.
 *
 * A thread the author OPENED is the only structural trace a walkthrough leaves; resolving one keeps it, so a
 * landed round still counts. This cannot tell a walkthrough from an author-started discussion, which is why
 * its only consumer WARNS and never refuses.
 *
 * @param authorLogin the pull request's author
 * @param threads every thread the read carried
 * @returns whether at least one thread was opened by the author, who is not a bot
 */
export function hasWalkthrough({
  authorLogin,
  threads,
}: {
  authorLogin: string;
  threads: readonly ThreadDetail[];
}): boolean {
  return threads.some((thread) => thread.openedByLogin === authorLogin && thread.openedByBot !== true);
}

/**
 * The warning `github landing --author @me` prints naming the owner's pull requests with no self-review
 * walkthrough.
 *
 * Nearly every pull request benefits from self-review comments that guide the reviewer, because that is where
 * humans actually look. A WARNING and never a landing test: GitHub state cannot prove an author's
 * thread is a walkthrough, and a missing note is no reason to hold a merge. A row whose threads were
 * truncated is left out, because an absence over a partial read is not an absence.
 *
 * @param rows every row the read produced; the caller passes none unless the read was `--author @me`
 * @returns one line, or undefined when every row has a walkthrough
 */
export function walkthroughWarningLine({ rows }: { rows: readonly LandingRow[] }): string | undefined {
  const bare = rows.filter(
    (row) => !row.threadsTruncated && !hasWalkthrough({ authorLogin: row.authorLogin, threads: row.threads }),
  );
  if (bare.length === 0) {
    return undefined;
  }
  const named = bare.map((row) => `${row.repoSlug}#${String(row.number)}`).join(", ");
  return (
    `⚠ no self-review walkthrough on ${String(bare.length)}: ${named}. Every pull request of the owner's carries ` +
    "inline notes guiding the reviewer — post a round with `slopweaver github pr update --self-review -`"
  );
}

/** The first seven characters of a commit, the length every press line in this tree prints. */
const HEAD_CHARS = 7;

/** Enough of the resolved-thread digest to tell two rounds on one head apart. */
const DIGEST_CHARS = 6;

/**
 * The autonomy-ledger row one pre-press resolve leaves behind, through the ledger's own validating builder.
 *
 * The id carries the repository, the head and a digest of the threads resolved. The ledger is ONE file across
 * both repositories and refuses a second row under an id with different fields, so `17519` alone would collide
 * the day a slopweaver pull request reaches that number. The digest keeps a retry after a PARTIAL resolve —
 * the same head, the remaining threads — a distinct act rather than a conflict with the first row.
 *
 * Residue, stated: slugging `owner/name` to one hyphenated run is not injective (`a-b/c` and `a/b-c` meet),
 * and a long enough name pushes the id past the ledger's length limit, where the builder refuses and the verb
 * reports the row unwritten. Neither repository this runs on today is either case.
 *
 * @param repoSlug the repository, `owner/name`
 * @param url the pull request's own URL — the row's checkable subject
 * @param headOid the head the press was about to enqueue
 * @param threadIds the node ids actually resolved
 * @param selected how many the press set out to resolve
 * @param bySession what identifies the acting session
 * @param doneIso when the resolving finished
 * @param verb the landing verb that resolved them, as the witness names it
 * @returns the row, or the ledger rule that refused it
 */
export function walkthroughAutonomyRow({
  repoSlug,
  number,
  url,
  headOid,
  threadIds,
  selected,
  bySession,
  doneIso,
  verb,
}: {
  repoSlug: string;
  number: number;
  url: string;
  headOid: string;
  threadIds: readonly string[];
  selected: number;
  bySession: string;
  doneIso: string;
  verb: string;
}): Result<AutonomyActionRow, AutonomyError> {
  const head = headOid.slice(0, HEAD_CHARS);
  const resolved = threadIds.length;
  const repoPart = repoSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const digest = createHash("sha256").update(threadIds.toSorted().join("\n")).digest("hex").slice(0, DIGEST_CHARS);
  return buildAutonomyAction({
    actionId: `${repoPart}-${String(number)}-resolve-own-threads-${head.toLowerCase()}-${digest}`,
    bySession,
    doneIso,
    kind: "resolve-own-threads",
    run: undefined,
    said:
      `I resolved ${String(resolved)} of your own self-review notes on a pull request before landing it. ` +
      `GitHub will not land ${repoSlug}#${String(number)} with a conversation open.`,
    steer: undefined,
    subject: url,
    why:
      "every other landing check had passed, and these were the owner's own one-voice walkthrough notes; the " +
      "owner's ruling is that every self-review comment is resolved before the merge",
    witness:
      `slopweaver ${verb} -> resolved ${String(resolved)} of ${String(selected)} own open walkthrough ` +
      `thread(s) on ${repoSlug}#${String(number)} at head ${head}`,
  });
}
