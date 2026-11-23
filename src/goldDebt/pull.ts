/**
 * What a debt's PULL REQUEST field may be, and the key derived from it. Pure: a string in, a parsed
 * reference or nothing out, no filesystem and no network.
 *
 * ## Why the identity is a URL and the key is derived
 *
 * A debt is one-to-one with a merged pull request, so the pull request IS the identity and there is no
 * session-chosen id to coordinate (`./types.ts` § A debt is IDENTIFIED by the pull request). The key
 * `<owner>/<repo>#<number>` is what a human refers to a debt by and what `slopweaver gold settle` takes, so
 * it is derived here rather than stored — a stored key is a second thing to get wrong and a place for a row
 * to name a pull request it does not point at.
 *
 * ## Two traps copied from `../autonomy/subject.ts`, both measured there
 *
 * Whitespace is refused BEFORE the parse, because `new URL` percent-encodes a space rather than rejecting
 * it — so two URLs separated by a space parse as one URL and render as a link to `…/872%20https:…`, which
 * opens nothing. And the literal `//` is required in the RAW string, because `https:/host/x` parses,
 * reports `https:` as its protocol, and leaves the stored value with a single slash that a browser resolves
 * against the reading page's own host.
 *
 * Nothing here asks GitHub whether the pull request exists, or whether it merged. What the syntax buys is
 * that a writer named something resolvable; what it does not buy is that the thing is there.
 */
import { GOLD_DEBT_URL_MAX } from "./types.js";

/** The host a debt's pull request must live on. This install lands everything on github.com. */
const GITHUB_HOST = "github.com";

/** An owner or repository name as GitHub itself allows one: letters, digits, dot, hyphen, underscore. */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A pull-request number: digits with no leading zero, so one number has exactly one spelling. */
const NUMBER_PATTERN = /^[1-9][0-9]*$/;

/** One merged pull request, as the URL in a row resolves to. */
export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  /**
   * The `<owner>/<repo>#<number>` key a human refers to the debt by, with owner and repo LOWERCASED.
   *
   * GitHub resolves an owner and a repository case-insensitively, so `.../AcmeOrg/widgets/pull/<number>`
   * and `.../acmeorg/widgets/pull/<number>` are one pull request. Keyed on the spelling a caller typed,
   * the register would carry two accounts of one merge and a settlement could not say which it paid — the
   * one thing the conflict check exists to make impossible. The `url` below keeps the original spelling.
   */
  readonly debtId: string;
  /** The URL exactly as it was written. */
  readonly url: string;
}

/**
 * Parse a pull-request URL into the reference a row is keyed by.
 *
 * @param url the pull request's absolute URL, exactly as the row carries it
 * @returns the parsed reference, or undefined when it is not a github.com pull-request URL at all
 */
export function parsePullRequestUrl({ url }: { url: string }): PullRequestRef | undefined {
  if (url.length === 0 || url.length > GOLD_DEBT_URL_MAX || /\s/u.test(url)) {
    return undefined;
  }
  if (!url.startsWith("https://")) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" || parsed.host !== GITHUB_HOST) {
    return undefined;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const [owner, repo, kind, number] = segments;
  if (segments.length !== 4 || owner === undefined || repo === undefined || number === undefined) {
    return undefined;
  }
  if (kind !== "pull" || !NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo) || !NUMBER_PATTERN.test(number)) {
    return undefined;
  }
  return {
    debtId: `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`,
    number: Number(number),
    owner,
    repo,
    url,
  };
}

/**
 * The `<owner>/<repo>#<number>` key of a row's pull request.
 *
 * @param pullRequest the row's pull-request URL, already known to parse
 * @returns the derived key, or the URL itself when it does not parse — a display path only, never a lookup
 */
export function goldDebtId({ pullRequest }: { pullRequest: string }): string {
  const parsed = parsePullRequestUrl({ url: pullRequest });
  if (parsed === undefined) {
    return pullRequest;
  }
  return parsed.debtId;
}

/**
 * Whether a debt key names the same pull request as a row's URL.
 *
 * Accepts either spelling, so `slopweaver gold settle` takes the key a reader sees on the list or the full
 * URL a landing session already has in hand, and neither is the wrong answer.
 *
 * @param pullRequest the row's pull-request URL
 * @param reference the key or URL a caller named it by
 * @returns whether the two name one pull request
 */
export function matchesPullRequest({ pullRequest, reference }: { pullRequest: string; reference: string }): boolean {
  if (pullRequest === reference) {
    return true;
  }
  // The reference goes through the same derivation and is then lowercased, so a caller who typed the owner
  // in its display case finds the row whether they wrote a URL or a key. The stored side needs no lowercasing:
  // a row whose URL does not parse cannot exist, because `buildGoldDebt` refuses one.
  return goldDebtId({ pullRequest }) === goldDebtId({ pullRequest: reference }).toLowerCase();
}
