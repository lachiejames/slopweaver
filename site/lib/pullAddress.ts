/**
 * Where a pull request lives in this console, and the two verbs that read it — the address half of the console's
 * pull-request view, which gives pull requests and their diffs and reviews the same citation chips and hover cards.
 *
 * A pull request is named by the same grammar the citation chip's hover card reads (`./citedRecord.ts`
 * `citedRecordOf`), never a second one: the console page's path `/pull-requests/<owner>/<repo>/<number>` is
 * rebuilt into the GitHub address and read back through it, so a path that would not name a pull request on
 * GitHub never reaches an argv. The same door as `./threadVerb.ts`: literal argv, every slot checked first.
 */

import { citedRecordOf } from "./citedRecord";

/** A pull request this console can open. */
export interface PullAddress {
  readonly repoSlug: string;
  readonly number: number;
  /** The canonical `https://github.com/<owner>/<repo>/pull/<n>` address. */
  readonly url: string;
}

/** The tabs the view draws, GitHub's own two that carry the confidence the owner needs. */
export const PULL_TABS = ["conversation", "files"] as const;

/** One tab. */
export type PullTab = (typeof PULL_TABS)[number];

/**
 * A pull request out of any GitHub address naming one — its tab, query or fragment dropped.
 *
 * @param url the address as a card wrote it
 * @returns the pull request, or `undefined` when the address names none
 */
export function pullAddressOf({ url }: { url: string }): PullAddress | undefined {
  const record = citedRecordOf({ url });
  if (record?.kind !== "pull") {
    return undefined;
  }
  return { number: record.number, repoSlug: record.repoSlug, url: record.url };
}

/**
 * A pull request out of the console page's own path segments.
 *
 * @returns the pull request, or `undefined` when the three segments do not name one
 */
export function pullAddressOfPath({
  owner,
  repo,
  number,
}: {
  owner: string;
  repo: string;
  number: string;
}): PullAddress | undefined {
  if (!/^[1-9][0-9]{0,9}$/u.test(number)) {
    return undefined;
  }
  const address = pullAddressOf({ url: `https://github.com/${owner}/${repo}/pull/${number}` });
  if (address === undefined || address.repoSlug !== `${owner}/${repo}`) {
    return undefined;
  }
  return address;
}

/**
 * The console page for a pull request.
 *
 * @param tab the tab to open on; the conversation is the page's own default and adds no query
 * @returns the console path
 */
export function pullConsoleHref({ address, tab }: { address: PullAddress; tab?: PullTab }): string {
  const path = `/pull-requests/${address.repoSlug}/${String(address.number)}`;
  if (tab === undefined || tab === "conversation") {
    return path;
  }
  return `${path}?tab=${tab}`;
}

/**
 * Where a link to a record goes in the console: a GitHub pull request's own console page, on the tab its address
 * named, and any other address unchanged.
 *
 * @returns the console path, or the address as given
 */
export function consolePullHref({ url }: { url: string }): string {
  const address = pullAddressOf({ url });
  if (address === undefined) {
    return url;
  }
  return pullConsoleHref({ address, tab: pullTabOfAddress({ url }) });
}

/**
 * The tab a GitHub address opens on: its `/files` tab is the diff, anything else the conversation.
 *
 * @returns the tab
 */
export function pullTabOfAddress({ url }: { url: string }): PullTab {
  if (!URL.canParse(url)) {
    return "conversation";
  }
  const path = new URL(url).pathname.split("/").filter((segment) => segment !== "");
  if (path[4] === "files" || path[4] === "changes") {
    return "files";
  }
  return "conversation";
}

/**
 * The tab a page query asks for, reading anything unknown as the conversation.
 *
 * @returns the tab
 */
export function pullTabOf({ query }: { query: string | undefined }): PullTab {
  if (query === "files") {
    return "files";
  }
  return "conversation";
}

/**
 * How many items of each activity connection the read asks for — GitHub's and `github read`'s own maximum, so a
 * long review conversation is read whole or its cut is named in the residue.
 */
export const PULL_READ_LIMIT = 100;

/**
 * Reading a pull request is the GraphQL object plus one call per hundred changed files. MEASURED:
 * `time slopweaver github read https://github.com/<owner>/<repo>/pull/<number> --limit 100 --json` took 3.5s;
 * the bound leaves room for a large diff on a machine busy with the page's own polls.
 */
export const PULL_TIMEOUT_MS = 45_000;

/** One verb the route runs, and the command it names in a refusal. */
export interface PullArgv {
  readonly argv: readonly string[];
  readonly title: string;
}

/**
 * The live read of one pull request: the object, its reviews, threads and checks, and its changed files.
 *
 * @returns the literal argv
 */
export function pullReadArgv({ address }: { address: PullAddress }): PullArgv {
  const argv = ["github", "read", address.url, "--limit", String(PULL_READ_LIMIT), "--files", "--json"];
  return { argv, title: `slopweaver ${argv.join(" ")}` };
}

/** A GitHub login as the API writes one — a bot's GraphQL login carries no `[bot]` suffix. */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;

/**
 * The member roster narrowed to the people on this pull request, or the refusal.
 *
 * @param logins the distinct logins the read names
 * @returns the literal argv, or why a login was refused
 */
export function pullAvatarsArgv({
  logins,
}: {
  logins: readonly string[];
}): { readonly kind: "argv"; readonly argv: PullArgv } | { readonly kind: "refused"; readonly why: string } {
  const bad = logins.find((login) => !GITHUB_LOGIN.test(login));
  if (bad !== undefined) {
    return { kind: "refused", why: `${bad} is not a GitHub login` };
  }
  const argv = ["identity", "avatars", "--source", "github", "--ids", logins.join(","), "--json"];
  return { argv: { argv, title: `slopweaver ${argv.join(" ")}` }, kind: "argv" };
}
