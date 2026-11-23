/**
 * PULL REQUESTS — what the page is NOT showing, and whose it is.
 *
 * The pure half of {@link ./prStatusCollect.js}: the identity gap (an own-login's pull requests that are
 * open but absent), the `gh auth status` parse that feeds it, and the omission line that states as a number
 * what each watched repository holds back. No `gh` call happens here; the collect edge shells and hands
 * the answers in.
 */

import type { Measured } from "../../measurement/status.js";
import type { PrRepo } from "./prStatusDecode.js";

/** One open pull request as the cheap count call describes it: who opened it, and which number it is. */
export interface OpenPr {
  readonly number: number;
  readonly author: string;
}

/** One of the owner's OWN logins whose pull requests are open here but absent from the page. */
export interface IdentityGap {
  readonly login: string;
  readonly numbers: readonly number[];
}

/**
 * Every pull request that is open here, was opened by an account this machine is logged in as, and is
 * nonetheless NOT on the page.
 *
 * This is the section's most dangerous failure, and the first cut of it was wrong in a way worth recording.
 * The doc described it as an EMPTY list — `--author @me` returning zero rows for `slopweaver/slopweaver` while
 * one is open, because `@me` is the token's login and the ambient account is a collaborator rather than the
 * author. So the first cut only warned when a repository contributed nothing.
 *
 * That guard is obsolete: the owner authors in that repository under BOTH
 * logins. Four open, three by the work account, one by the personal one. `--author @me` therefore returns
 * three rows under either account and is SILENTLY PARTIAL rather than empty — and a partial list with no
 * warning is worse than an empty one, because there is nothing about it to notice.
 *
 * Hence the comparison is against the machine's authenticated logins rather than against zero. It answers
 * exactly the question the count alone cannot: of the pull requests not on this page, which are the owner's?
 *
 * @param open every pull request open in the repository, with its author
 * @param shown the numbers that made it onto the page
 * @param accounts every gh login this machine is authenticated as
 * @returns one entry per own-login whose pull requests are missing, with their numbers
 */
export function identityGap({
  open,
  shown,
  accounts,
}: {
  open: readonly OpenPr[];
  shown: readonly number[];
  accounts: readonly string[];
}): readonly IdentityGap[] {
  const onPage = new Set(shown);
  const mine = new Set(accounts);
  const missing = new Map<string, number[]>();
  for (const pr of open) {
    if (onPage.has(pr.number) || !mine.has(pr.author)) {
      continue;
    }
    const numbers = missing.get(pr.author);
    // The first missing pull request found for a login opens its list.
    if (numbers === undefined) {
      missing.set(pr.author, [pr.number]);
      continue;
    }
    numbers.push(pr.number);
  }
  return [...missing.entries()]
    .map(([login, numbers]) => ({ login, numbers }))
    .toSorted((left, right) => left.login.localeCompare(right.login));
}

/**
 * The sentence a gap prints on the page, naming the login and the exact fix.
 *
 * @param repo the repository the gap is in
 * @param gaps the own-logins whose pull requests are missing
 * @returns one note per gap, or nothing when there is none
 */
export function identityGapNotes({ repo, gaps }: { repo: PrRepo; gaps: readonly IdentityGap[] }): readonly string[] {
  return gaps.map(
    (gap) =>
      `${repo.nameWithOwner}: ${String(gap.numbers.length)} pull request(s) here were opened by @${gap.login} — an account THIS MACHINE IS LOGGED IN AS — and are NOT on this page, because the rows were asked as ${repo.tokenUser === undefined ? "the ambient account" : `@${repo.tokenUser}`}. Missing: ${gap.numbers.map((number) => `#${String(number)}`).join(", ")}. This list is PARTIAL BY IDENTITY, not by fact — add \`--pr-repos ${repo.nameWithOwner}@${gap.login}\``,
  );
}

/**
 * The gh logins this machine is authenticated as.
 *
 * Read from `gh auth status`, which is local and costs no API call. Read at all because it is the only way to
 * tell "this pull request is a colleague's" from "this pull request is yours under your other login" — and
 * those two look identical in a list the page is about to omit.
 *
 * @param stdout what `gh auth status` printed
 * @returns every login it named, in the order it named them
 */
export function parseGhAccounts({ stdout }: { stdout: string }): readonly string[] {
  // `match[1]` is a MANDATORY group, so a match guarantees it — an honest assertion rather than a default
  // that would quietly add an empty login to the set every account is compared against.
  return [...stdout.matchAll(/Logged in to \S+ account (\S+)/g)].map((match) => match[1]!);
}

/** What one watched repository contributed, and what it is holding back. */
export interface WatchedRepo {
  readonly nameWithOwner: string;
  /** The gh account the rows were asked under, or `undefined` when the ambient one was inherited. */
  readonly tokenUser: string | undefined;
  /** How many of its open pull requests are on the page. */
  readonly mine: number;
  /** How many are open there in total, whoever opened them, or why that is unknown. */
  readonly openTotal: Measured<number>;
}

/**
 * What each watched repository contributed, and — stated as a NUMBER — what it is not showing.
 *
 * A page that quietly drops most of a repository is the failure this console exists to remove, so the count
 * of omitted pull requests goes on screen next to the reason they are omitted. "266 open, 7 yours, 259 not
 * here because review reaches you in Slack" is a scope; "7 pull requests" on its own is a claim the reader
 * has no way to check.
 *
 * @param watched every repository, with what it contributed and what it holds
 * @returns the sentence printed under the section blurb
 */
export function omissionLine({ watched }: { watched: readonly WatchedRepo[] }): string {
  const parts = watched.map((repo) => {
    const account = repo.tokenUser === undefined ? "the ambient gh account" : `@${repo.tokenUser}`;
    if (!repo.openTotal.known) {
      return `${repo.nameWithOwner} (as ${account}): ${String(repo.mine)} yours, and how many are open in TOTAL was NOT measured — ${repo.openTotal.why}`;
    }
    const others = repo.openTotal.value - repo.mine;
    return `${repo.nameWithOwner} (as ${account}): ${String(repo.openTotal.value)} open, ${String(repo.mine)} yours, ${String(Math.max(0, others))} not on this page`;
  });
  return `Watching ${String(watched.length)} repo(s) — ${parts.join("; ")}.`;
}
