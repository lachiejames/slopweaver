/**
 * The granular state of ONE pull request — what a reader needs to exercise judgement, rather than a verdict
 * that exercises it for them.
 *
 * A schema refusal on a review ask is the wrong tool: a pull request is sometimes a discussion piece whose
 * failed checks are expected, and the point is not asking for a review but asking why something is red. So one
 * command returns the ACTUAL state rather than a bare verdict, because "verdict equals pass" is not enough
 * information. What a human would expect is the contract this module implements, in this order: was it approved
 * by CodeRabbit; are there unresolved comments, from whom, and what are they; have we answered the comments
 * without resolving them, or pushed back instead; is CI failing, is the failing check REQUIRED, and which one.
 *
 * ## Why the disposition is structural and never a sentiment read
 *
 * "Did we push back" and "did we answer and forget to resolve" differ only in what the reply MEANS, and a
 * classifier deciding that is a heuristic that would be wrong quietly, on the cases that matter, and a reader
 * could not tell when. So {@link ThreadDisposition} answers only what is checkable: who spoke last, and whether
 * the thread is resolved. The reply's own words ride beside it in {@link ThreadDetail.lastCommentLine} — the
 * reply's own FIRST LINE, trimmed to {@link EXCERPT_CHARS} characters rather than the whole body — so the
 * reader's judgement decides which of the two it was. Good information plus good judgement is the mechanism.
 *
 * ## Why the author's own threads are their own disposition
 *
 * MEASURED over the owner's 28 open `acme/acme-admin` pull requests: six of them carry open threads whose only
 * author is the owner. Those are the `--self-review` reviewer-wayfinding comments the door writes on the owner's
 * behalf, and they are unresolved by design — nobody resolves their own walkthrough. Folding them in with a
 * reviewer's open thread makes the count wrong on six of twenty-eight, which is the rate at which a reader
 * stops reading the field. Reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --author <login> --include-drafts --json`.
 *
 * ## …and why "the author opened it" was never the right test for that
 *
 * The arm above is about a walkthrough note nobody else has touched, and firing on the OPENER alone would let a
 * colleague replying to one of those notes disappear from every surface at once. {@link dispositionOf} carries
 * the measurement and the command. The disposition is the author's only while the thread has exactly one
 * comment, and {@link owedTo} names whoever spoke last on the rest. {@link oursResolvable} is the other side of the same narrowing: a thread that IS only ours is a
 * condition the fleet clears itself under `AGENTS.md` rule 10, never one it waits on.
 *
 * Pure. No I/O, no clock.
 */

import type { GithubCheck } from "../live/github/checksDedupe.js";
import type { RequiredContextGate } from "../live/github/requiredContexts.js";
import type { PrReviewThread } from "../live/github/reviewState.js";

/**
 * Where one open thread has got to, decided by who spoke last and by nothing else.
 *
 * `answered-open` deliberately covers BOTH of the two shapes — a comment answered without being
 * resolved, and a comment pushed back on — because the difference is in the words, not in the state. Read
 * {@link ThreadDetail.lastCommentLine} to tell them apart. It is the reply's first non-empty line trimmed
 * to {@link EXCERPT_CHARS} characters, not the whole body — a thread longer or wider than that is read on
 * GitHub, and no consumer may claim to have seen the whole exchange.
 */
export type ThreadDisposition =
  | "resolved"
  /** A reviewer opened it and nobody from our side has replied. */
  | "awaiting-us"
  /** We replied after the reviewer's last comment and left it open — answered, or pushed back. */
  | "answered-open"
  /** We replied and the reviewer has since spoken again; the ball is back with us. */
  | "reviewer-replied"
  /** The pull request's own author opened it — a self-review walkthrough, unresolved by design. */
  | "ours-open";

/** One review thread, with who raised it, what it says, and where it has got to. */
export interface ThreadDetail {
  /**
   * The thread's GraphQL node id, or the empty string when the read did not carry one.
   *
   * Here so {@link oursResolvable}'s answer can be ACTED on — `github thread resolve --thread <id>` — rather
   * than only counted. Every other field on this interface is for a reader; this one is for a write.
   */
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly openedByLogin: string;
  /** Present when GitHub typed the opener a `Bot`, whatever its login spells. */
  readonly openedByBot?: true;
  readonly openedAtIso: string;
  /** The opening comment's first non-empty line, trimmed to a readable length. */
  readonly openerLine: string;
  readonly lastCommentLogin: string;
  readonly lastCommentAtIso: string;
  /** The most recent comment's first non-empty line, trimmed the same way. */
  readonly lastCommentLine: string;
  readonly commentCount: number;
  readonly isOutdated: boolean;
  readonly disposition: ThreadDisposition;
}

/** How many characters of a comment's first line a detail row carries. */
const EXCERPT_CHARS = 160;

/** Whether a line is only `_emphasis_` cells joined by pipes — CodeRabbit's severity row, and no finding. */
function isSeverityRow({ line }: { line: string }): boolean {
  return line.split("|").every((cell) => /^_[^_]+_$/.test(cell.trim()));
}

/**
 * A comment body's first non-empty line, collapsed to one line and trimmed.
 *
 * Markdown emphasis is left exactly as written. Arlo's blocking threads open with the literal `**Blocking.**`
 * and CodeRabbit's open with its own severity row, so the marker a reader scans for IS the raw text — a
 * renderer that stripped it would remove the one signal the excerpt exists to carry.
 *
 * That severity row is ALL marker, though, so it is joined to the line after it — the bold finding title.
 * MEASURED on a live `acme/acme-admin` pull request: both CodeRabbit threads excerpted to
 * `_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_` and nothing a reader could judge.
 *
 * @param body the comment body as GitHub stores it, or the empty string when bodies were not read
 * @returns the first non-empty line (with the next one after a marker-only severity row), whitespace-collapsed,
 *   at most {@link EXCERPT_CHARS} characters
 */
export function excerptOf({ body }: { body: string }): string {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = lines[0];
  if (first === undefined) {
    return "";
  }
  const second = lines[1];
  const joined = isSeverityRow({ line: first }) && second !== undefined ? `${first} ${second}` : first;
  const collapsed = joined.replace(/\s+/g, " ");
  return collapsed.length <= EXCERPT_CHARS ? collapsed : `${collapsed.slice(0, EXCERPT_CHARS - 1)}…`;
}

/**
 * Where one thread has got to.
 *
 * `ours-open` is tested before every other open arm: a thread the pull request's own author opened is a
 * walkthrough note, and reading it as `awaiting-us` would put the author's own wayfinding comments on the list of
 * things a reviewer is waiting on.
 *
 * **But the author opening a thread only makes it ours while nobody else has spoken on it**, which is
 * `commentCount === 1` and nothing looser. An arm firing on the opener alone would swallow a colleague
 * replying to one of the author's walkthrough notes: the thread would read `ours-open`, {@link waitingOn}
 * would drop it, `../review/reviewSignals.ts`'s tallies exclude every author-opened thread by construction, and
 * the landing row would print `openThreads: []` over a person waiting for an answer. MEASURED on an
 * `acme/acme-admin` pull request — an author-opened thread of two comments whose last is a colleague's, with
 * `conversations.humans.open` and `codeRabbit.open` both zero. One of 23 `ours-open` threads across the
 * owner's 27 open pull requests carried that shape, and 21 of the other 22 are single-comment. Reproduce:
 * `slopweaver github landing --repo acme/acme-admin --author <login> --json | jq -r '.rows[] | select([.threads[]|select(.disposition=="ours-open")]|length > 0) | "#\(.number) " + ([.threads[]|select(.disposition=="ours-open")|"c\(.commentCount)/last=\(.lastCommentLogin)"]|join(" "))'`
 *
 * A multi-comment author-opened thread therefore falls through to the arms below it and lands where its LAST
 * speaker puts it: the author, and it is `answered-open` with nobody waiting; anybody else, and it is
 * `reviewer-replied` with the ball back on our side.
 *
 * @param thread the thread as the live read returned it
 * @param prAuthorLogin the pull request's author, whose comments are "ours"
 * @returns the disposition
 */
export function dispositionOf({
  thread,
  prAuthorLogin,
}: {
  thread: PrReviewThread;
  prAuthorLogin: string;
}): ThreadDisposition {
  if (thread.isResolved) {
    return "resolved";
  }
  if (thread.openedByLogin === prAuthorLogin && thread.commentCount === 1) {
    return "ours-open";
  }
  if (thread.lastCommentLogin === prAuthorLogin) {
    return "answered-open";
  }
  return thread.commentCount > 1 ? "reviewer-replied" : "awaiting-us";
}

/**
 * Every thread on a pull request, shaped for a reader, newest-spoken first.
 *
 * @param threads the threads as the live read returned them
 * @param prAuthorLogin the pull request's author
 * @returns one detail per thread, ordered by when it was last spoken on, most recent first
 */
export function threadDetails({
  threads,
  prAuthorLogin,
}: {
  threads: readonly PrReviewThread[];
  prAuthorLogin: string;
}): readonly ThreadDetail[] {
  return threads
    .map((thread) => ({
      commentCount: thread.commentCount,
      disposition: dispositionOf({ prAuthorLogin, thread }),
      id: thread.id,
      isOutdated: thread.isOutdated,
      lastCommentAtIso: thread.lastCommentAtIso,
      lastCommentLine: excerptOf({ body: thread.lastCommentBody }),
      lastCommentLogin: thread.lastCommentLogin,
      line: thread.line,
      openedAtIso: thread.openedAtIso,
      openedByLogin: thread.openedByLogin,
      ...(thread.openedByBot === true ? { openedByBot: true as const } : {}),
      openerLine: excerptOf({ body: thread.openerBody }),
      path: thread.path,
    }))
    .toSorted((left, right) => right.lastCommentAtIso.localeCompare(left.lastCommentAtIso));
}

/** How many open threads each login is waiting on an answer for, most first. */
export interface ThreadTally {
  readonly login: string;
  readonly open: number;
}

/**
 * Who we owe an answer to on one open thread, or the empty string when nobody is waiting on it.
 *
 * The OPENER is the answer for a reviewer's thread, and it is the wrong answer for one of ours: on a
 * walkthrough note a colleague has replied to, the opener is the author and the person waiting is whoever
 * spoke last. Keyed on that rather than on the opener so a colleague's reply reaches
 * {@link waitingOn} — see {@link dispositionOf} for the measurement.
 *
 * A thread whose last speaker is the author has nobody waiting on it, which is what an author-opened
 * `answered-open` thread is: we said the last word on our own note.
 *
 * @param detail one thread, as {@link threadDetails} shaped it
 * @param prAuthorLogin the pull request's author, who is never owed an answer on their own pull request
 * @returns the login waiting, or the empty string
 */
function owedTo({ detail, prAuthorLogin }: { detail: ThreadDetail; prAuthorLogin: string }): string {
  if (detail.openedByLogin === prAuthorLogin) {
    return detail.lastCommentLogin === prAuthorLogin ? "" : detail.lastCommentLogin;
  }
  return detail.openedByLogin;
}

/**
 * Who is waiting, and on how many threads — the "from who" half of the state.
 *
 * A `ours-open` thread has nobody waiting on it by construction, and the author is never a name here: they
 * would otherwise be the loudest one on their own pull request. Every OTHER open thread is counted against
 * {@link owedTo}, so a colleague who replied to one of the author's walkthrough notes is named rather than swallowed.
 *
 * @param details every thread on the pull request
 * @param prAuthorLogin the pull request's author, excluded from the tally
 * @returns one entry per waiting login, most open threads first, then alphabetically
 */
export function waitingOn({
  details,
  prAuthorLogin,
}: {
  details: readonly ThreadDetail[];
  prAuthorLogin: string;
}): readonly ThreadTally[] {
  const counts = new Map<string, number>();
  for (const detail of details) {
    if (detail.disposition === "resolved" || detail.disposition === "ours-open") {
      continue;
    }
    const login = owedTo({ detail, prAuthorLogin });
    if (login === "" || login === prAuthorLogin) {
      continue;
    }
    // A login's tally of threads owed to it opens at its first thread.
    if (!counts.has(login)) {
      counts.set(login, 0);
    }
    counts.set(login, counts.get(login)! + 1);
  }
  return [...counts.entries()]
    .map(([login, open]) => ({ login, open }))
    .toSorted((left, right) => right.open - left.open || left.login.localeCompare(right.login));
}

/**
 * Our own open threads the fleet may resolve ITSELF — a walkthrough note only the author has ever spoken on.
 *
 * A landing always merges the mergeable ones, so a pull request blocked on nothing but unresolved self-review
 * threads is never parked. `AGENTS.md` rule 10 already names clearing comments on the owner's own team-facing
 * pull requests as the fleet's own work, so these are a condition to CLEAR rather than one to wait on or card.
 *
 * **The criterion is `ours-open`, which is exactly "the author opened it and nobody else has spoken".** That
 * narrowness is the whole safety argument, not a detail: a looser reading would silently resolve a colleague's
 * reply — one of the 23 such threads across the owner's 27 open pull requests carried that shape, and
 * {@link dispositionOf} carries the measurement and the command that reproduces it. Nothing here reads a body,
 * an `@mention` or a sentiment; those are the heuristics this module's own header rules out.
 *
 * @param details every thread on the pull request
 * @returns the resolvable threads, in the order {@link threadDetails} produced them
 */
export function oursResolvable({ details }: { details: readonly ThreadDetail[] }): readonly ThreadDetail[] {
  return details.filter((detail) => detail.disposition === "ours-open");
}

/** One check that is not passing, and whether the base branch actually requires it. */
export interface FailingCheckDetail {
  /**
   * A GitHub Check Run, or a legacy commit Status another CI posted — only a Check Run can be an Actions job, so a
   * Status whose URL merely has an Actions job's shape is never read as one.
   */
  readonly kind: GithubCheck["kind"];
  /**
   * The Actions run GitHub itself ties a Check Run to, absent for another app's check. Its details URL is the
   * posting app's own claim, so only a URL naming THIS run is read as that check's job.
   */
  readonly runId?: string | undefined;
  readonly name: string;
  /** The check's own state, as `../live/github/checks.ts` normalises it. */
  readonly state: string;
  readonly url: string | undefined;
  /**
   * Whether the base branch requires this context — `undefined` when the required set could not be read.
   *
   * Three values rather than two on purpose: "the base does not require this" and "we could not find out
   * what the base requires" are different facts, and only the second leaves a reader unable to tell an
   * advisory red from a blocking one. The same distinction `RequiredContextGate.unreadable` exists for.
   */
  readonly required: boolean | undefined;
}

/**
 * Every check that is not passing, each marked with whether the base branch requires it.
 *
 * This is the whole of *"is CI failing, and if so, is it a required check? Which CI is failing?"* — a count
 * cannot answer it, because the difference between one failing advisory E2E run and one failing required
 * build is the difference between sending the pull request and not.
 *
 * @param checks the head's latest-per-name checks
 * @param gate what the required-context read concluded for the base branch
 * @returns one entry per non-passing check, required ones first, then by name
 */
export function failingChecks({
  checks,
  gate,
}: {
  checks: readonly GithubCheck[];
  gate: RequiredContextGate;
}): readonly FailingCheckDetail[] {
  const required = gate.kind === "read" ? new Set(gate.required) : undefined;
  return checks
    .filter((check) => check.state !== "passed")
    .map((check) => ({
      kind: check.kind,
      name: check.name,
      required: required === undefined ? undefined : required.has(check.name),
      ...(check.runId === undefined ? {} : { runId: check.runId }),
      state: check.state,
      url: check.url,
    }))
    .toSorted(
      (left, right) =>
        Number(right.required === true) - Number(left.required === true) || left.name.localeCompare(right.name),
    );
}
