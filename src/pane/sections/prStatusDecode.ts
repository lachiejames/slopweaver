/**
 * PULL REQUESTS — decoding `gh`'s JSON and the `--pr-repo`/`--pr-repos` flag spelling.
 *
 * Split out of {@link ../prStatus.js} (the file-size ratchet, step 2): everything here turns untyped input —
 * a `gh pr list --json` payload, a raw flag value — into the typed shapes {@link ../prStatus.js} defines
 * ({@link PrRecord}, {@link RequestedReviewer}). Pure, no `gh` invocation lives in this file.
 */

import { isRecord } from "../../lib/parsers.js";
import type { PrRecord, RequestedReviewer } from "./prStatus.js";

/** One string field of a `gh` record, or the empty string when it is absent or the wrong shape. */
function stringField({ record, name }: { record: Record<string, unknown>; name: string }): string {
  const value = record[name];
  return typeof value === "string" ? value : "";
}

/**
 * Decode one `gh pr list --json` entry, or say why it could not be decoded.
 *
 * A pull request whose NUMBER cannot be read is refused rather than defaulted, because every downstream
 * identity — the row key, the sort tie-break, the link — is built from it, and a row keyed `#0` is a row that
 * silently merges with the next undecodable one.
 *
 * @param value one element of the `gh` array
 * @param repo the repository the element came from, as `owner/name`
 * @returns the decoded pull request, or the reason it was refused
 */
export function decodePr({ value, repo }: { value: unknown; repo: string }): PrRecord | string {
  if (!isRecord(value)) {
    return "`gh pr list --json` returned an element that is not an object";
  }
  const record = value;
  const number = record["number"];
  if (typeof number !== "number") {
    return `\`gh pr list --json\` returned a pull request with no number (in ${repo})`;
  }
  return {
    author: nestedLogin({ value: record["author"] }),
    body: stringField({ name: "body", record }),
    headRefName: stringField({ name: "headRefName", record }),
    isDraft: record["isDraft"] === true,
    mergeable: stringField({ name: "mergeable", record }),
    number,
    repo,
    reviewDecision: stringField({ name: "reviewDecision", record }),
    reviewRequests: requestedReviewers({ value: record["reviewRequests"] }),
    statusCheckRollup: record["statusCheckRollup"],
    title: stringField({ name: "title", record }),
    updatedAt: stringField({ name: "updatedAt", record }),
    url: stringField({ name: "url", record }),
  };
}

/**
 * The `login` of a nested `gh` actor object, or the empty string when there is none to read.
 *
 * Exported: the collect edge's cheap open-pull-request scan ({@link ../prStatusCollect.js}) decodes the same
 * nested actor shape and must not duplicate this logic.
 *
 * @param value the raw actor field, as `gh` returned it
 * @returns the login, or the empty string when it is absent or the wrong shape
 */
export function nestedLogin({ value }: { value: unknown }): string {
  if (!isRecord(value)) {
    return "";
  }
  return stringField({ name: "login", record: value });
}

/**
 * Who review has been requested from, with users and teams kept apart.
 *
 * `__typename` is preferred where `gh` supplies it, but it is NOT required: the shape is inferred from the
 * fields when it is absent, because entries without it are supported input here and always have been. Only an
 * entry that carries neither a usable `login`/`slug` nor a `name` falls through to `unknown`, and even then it
 * is kept rather than dropped — see {@link RequestedReviewer}.
 *
 * Measured on live data: a user arrives as `{__typename: "User", login}` and a team as
 * `{__typename: "Team", name, slug}`.
 */
function requestedReviewers({ value }: { value: unknown }): readonly RequestedReviewer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: unknown): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry): RequestedReviewer => {
      const typename = stringField({ name: "__typename", record: entry });
      const login = stringField({ name: "login", record: entry });
      const slug = stringField({ name: "slug", record: entry });
      const name = stringField({ name: "name", record: entry });
      if (typename === "User" || (typename === "" && login !== "")) {
        return { handle: login, kind: login === "" ? "unknown" : "user" };
      }
      if (typename === "Team" || (typename === "" && (slug !== "" || name !== ""))) {
        const handle = slug === "" ? name : slug;
        return { handle, kind: handle === "" ? "unknown" : "team" };
      }
      return { handle: login === "" ? name : login, kind: "unknown" };
    })
    .filter((reviewer) => reviewer.handle !== "" || reviewer.kind === "unknown");
}

/**
 * Parse the whole `gh pr list --json` payload.
 *
 * Refusals are COUNTED and returned, never dropped. A pull request that failed to decode is a pull request
 * missing from the board, and a board that silently shortens is the failure this console exists to prevent.
 *
 * @param stdout what `gh` printed
 * @param repo the repository the payload came from, as `owner/name`
 * @returns the decoded pull requests plus one sentence per refusal, or the reason none could be read
 */
export function parsePrList({
  stdout,
  repo,
}: {
  stdout: string;
  repo: string;
}): { prs: readonly PrRecord[]; refused: readonly string[] } | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "`gh pr list --json` returned output that is not JSON";
  }
  if (!Array.isArray(parsed)) {
    return "`gh pr list --json` did not return an array";
  }
  const decoded = parsed.map((value) => decodePr({ repo, value }));
  return {
    prs: decoded.filter((entry): entry is PrRecord => typeof entry !== "string"),
    refused: decoded.filter((entry): entry is string => typeof entry === "string"),
  };
}

/**
 * The `--json` fields asked for. Verified against `gh`; `reviewThreads` is NOT a valid field.
 *
 * `body` is here because the ≤50-word problem statement is PARSED out of it rather than generated, and
 * `reviewRequests` because a pull request waiting on a named human is a different state from one waiting on
 * "review". Unresolved review threads are deliberately absent: they need paginated GraphQL, which is a second
 * round trip, and one list call per repository is the budget this section is built to.
 */
export const PR_FIELDS =
  "number,title,headRefName,isDraft,mergeable,reviewDecision,updatedAt,url,statusCheckRollup,author,reviewRequests,body";

/** How many pull requests are fetched per repository. A bound, and a breach of it is REPORTED, never silent. */
export const PR_FETCH_LIMIT = 100;

/**
 * The bound on the cheap open-pull-request SCAN.
 *
 * Higher than {@link PR_FETCH_LIMIT} because it asks for `number` alone: measured, 266 open pull
 * requests came back in 2.0s that way, while the same list carrying `statusCheckRollup` returned HTTP 504 on
 * all three attempts at ~11.2s. The count is what lets the page say how many rows it is NOT showing.
 */
export const OPEN_COUNT_LIMIT = 400;

/** One repository to watch, and the GitHub account that can see it. */
export interface PrRepo {
  /** `owner/name`. */
  readonly nameWithOwner: string;
  /**
   * The `gh` account whose token can read it, or `undefined` to use whichever account is currently active.
   *
   * Named per repository because this console watches two that need DIFFERENT accounts, and `gh auth switch`
   * is global state a long-running server must not mutate under other sessions on the machine.
   */
  readonly tokenUser: string | undefined;
}

/**
 * Parse a `--pr-repo` value: `owner/name` or `owner/name@gh-account`.
 *
 * Refused rather than guessed at. An unreadable repository spec that silently fell back to the active account
 * would query the wrong GitHub as the wrong user and render a confident, empty pull-request list.
 *
 * @param value the raw flag value
 * @returns the repository, or the reason it was refused
 */
export function parsePrRepo({ value }: { value: string }): PrRepo | string {
  const [nameWithOwner, ...accountParts] = value.split("@");
  if (nameWithOwner === undefined || !/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner)) {
    return `--pr-repo wants owner/name or owner/name@gh-account, but got "${value}"`;
  }
  if (accountParts.length > 1) {
    return `--pr-repo has more than one "@" in "${value}"`;
  }
  const account = accountParts[0];
  if (account?.length === 0) {
    return `--pr-repo has an empty account after "@" in "${value}"`;
  }
  return { nameWithOwner, tokenUser: account };
}

/**
 * Parse a comma-separated `--pr-repos` value into repositories, keeping every refusal.
 *
 * Refusals are RETURNED rather than dropped: a mistyped entry that silently vanished would leave a whole
 * repository unwatched while the page looked healthy, which is precisely the absent-row-reads-as-fine failure
 * this console exists to prevent.
 *
 * @param value the raw flag value, entries separated by commas
 * @returns the repositories that parsed, plus one sentence per entry that did not
 */
export function parsePrRepos({ value }: { value: string }): {
  repos: readonly PrRepo[];
  refused: readonly string[];
} {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parsePrRepo({ value: entry }));
  return {
    refused: parsed.filter((entry): entry is string => typeof entry === "string"),
    repos: parsed.filter((entry): entry is PrRepo => typeof entry !== "string"),
  };
}

/**
 * The `owner/name` a git remote URL points at, or `undefined` when it is not a GitHub remote.
 *
 * Read from the remote rather than asked of the network: resolving the current repository is a cost on every
 * `pane pr-status` that names no `--pr-repos`, and `git remote get-url` cannot fail because GitHub is
 * unreachable.
 *
 * @param url the remote URL, in either the SSH or HTTPS spelling
 * @returns `owner/name`, or `undefined` when the URL names no GitHub repository
 */
export function repoFromRemote({ url }: { url: string }): string | undefined {
  // The HOST is deliberately not checked. It used to require `github.com`, which broke the default on the
  // author's own machine: an SSH config alias makes the origin `git@github-personal:owner/name.git`, so the
  // console silently watched NOTHING and the pull-request tab read "no repository is being watched" in the
  // repository the owner uses most. Aliases are ordinary for anyone with two GitHub accounts — which is exactly the
  // situation this section was built for.
  //
  // Taking `owner/name` from any host is the honest trade: if the remote turns out not to be GitHub, `gh`
  // answers with a reason and the section prints it. A stated `gh` failure beats a silent empty tab.
  const match = /[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim());
  const owner = match?.[1];
  const name = match?.[2];
  return owner === undefined || name === undefined ? undefined : `${owner}/${name}`;
}
