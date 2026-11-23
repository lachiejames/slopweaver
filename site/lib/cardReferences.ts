/**
 * What a queue card's row knows beyond the addresses it carries — the repository its numbers belong to, how large
 * that repository's numbers run, and the install's Linear workspace — so `Decide 16406` and `QQQQ-134` link on a
 * card that carries no address for either.
 *
 * PR numbers and Linear ticket IDs link in all cases, never plain text. An ask can name its pull requests by number
 * alone; its `repoSlug` is the one fact saying whose they are.
 *
 * A module rather than logic inside `../components/console/QueuePanels.tsx` for the reason `./askLinks.ts` gives:
 * the unit lane does not transform `.tsx`. Pure: rows in, references out.
 */

import type { BoardRow } from "../components/live/read";
import type { LinearReferences } from "../components/live/readBoardDocument";
import type { RecordReferences } from "../components/live/readRecords";
import { cardAddresses } from "./cardAddresses";
import type { CardReferences } from "./inlineCitations";
import type { CardPeople } from "./personMentions";
import type { QueueRow } from "./queueRows";

/** A pull request's address: its owner, repository and number. */
const PULL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/u;

/** A pull request's or issue's address: either names the repository it lives in.*/
const GITHUB_ITEM = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/\d+/u;

/**
 * The repository a row names as its own: an ask's `repoSlug`, a decision step's linked ask's, the ONE repository
 * every pull request or issue it carries belongs to, and last, for a row the console PLACES in the `self`
 * workspace (`row.placement`, what its context filter reads — `./workspacePlacement.ts`), the one attested
 * repository named `slopweaver`. A row no field places, or one placed in both, gets no guessed repository. That context is "this instance's own template
 * repository" (`./workContext.ts`); the work context covers acme-admin "and the rest", so it names no single one. Two
 * repositories, or none, is no home — a bare number would be a guess between them.
 *
 * @param row the queue row
 * @param attested {@link attestedNumbers}, whose keys are the repositories the queue knows by address
 * @returns `owner/repo`, or `undefined`
 */
function homeOf({ row, attested }: { row: QueueRow; attested: ReadonlyMap<string, number> }): string | undefined {
  const { record } = row;
  if (record.kind === "ask" && record.row.repoSlug !== undefined) {
    return record.row.repoSlug;
  }
  if (record.kind === "hand" && record.decision?.ask.repoSlug !== undefined) {
    return record.decision.ask.repoSlug;
  }
  const repos = new Map<string, string>();
  for (const url of cardAddresses({ row })) {
    const item = GITHUB_ITEM.exec(url);
    if (item !== null) {
      const slug = `${item[1]}/${item[2]}`;
      repos.set(slug.toLowerCase(), slug);
    }
  }
  if (repos.size === 1) {
    return [...repos.values()][0];
  }
  if (repos.size > 1 || row.placement.kind !== "placed" || row.placement.workspace !== "self") {
    return undefined;
  }
  const named = [...attested.keys()].filter((repo) => repo.endsWith("/slopweaver"));
  if (named.length !== 1) {
    return undefined;
  }
  return named[0];
}

/**
 * The largest pull-request number any address names, per repository — how many digits each repository's numbers
 * run to. Read across EVERY queue row and every board row, parked or not, so a landing row's acme-admin 17648 says
 * how an acme-admin ask's bare `16406` should read, and a queue holding no slopweaver address still knows that
 * repository's numbers run to four digits — MEASURED: the queue alone attested acme-admin only, the
 * board's `prUrls` 484 slopweaver addresses (`slopweaver handover list --json | jq '[.rows[].prUrls[]?] | length'`).
 *
 * @param rows every row the queue holds
 * @param board every row the board holds, for their `prUrls`
 * @returns lowercased `owner/repo` to its largest number
 */
export function attestedNumbers({
  rows,
  board,
}: {
  rows: readonly QueueRow[];
  board: readonly BoardRow[];
}): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const urls = [...rows.flatMap((row) => cardAddresses({ row })), ...board.flatMap((row) => row.prUrls)];
  for (const url of urls) {
    const pull = PULL.exec(url);
    if (pull === null) {
      continue;
    }
    const repo = `${pull[1]}/${pull[2]}`.toLowerCase();
    const number = Number(pull[3]);
    const seen = out.get(repo);
    if (seen === undefined || number > seen) {
      out.set(repo, number);
    }
  }
  return out;
}

/**
 * Every repository a board row or a queue ask checks out — its `repoSlug`, the git origin of a real checkout —
 * lowercased. Never read off prose: `attestedNumbers` counts an address quoted as an example (`acme/widgets/pull/<number>`
 * in a finding about address parsing), and a card that names no repository must never fall back to that one.
 *
 * @param rows every row the queue holds, for an ask's or a decision step's `repoSlug`
 * @param board every row the board holds
 * @returns lowercased `owner/repo`s
 */
export function checkoutsOf({
  rows,
  board,
}: {
  rows: readonly QueueRow[];
  board: readonly BoardRow[];
}): ReadonlySet<string> {
  const asks = rows.map(({ record }) => {
    if (record.kind === "ask") {
      return record.row;
    }
    if (record.kind === "hand") {
      return record.decision?.ask;
    }
    return undefined;
  });
  const slugs = [...board, ...asks].map((row) => row?.repoSlug?.toLowerCase());
  return new Set(slugs.filter((slug) => slug !== undefined));
}

/**
 * Everything a row's card says in words — its text for the context filter and, for an ask or a decision step, the
 * ask's own summary, problem, lean, options and stakes.
 *
 * @param row the queue row
 * @returns the words, joined
 */
function wordsOf({ row }: { row: QueueRow }): string {
  const { record } = row;
  let ask: BoardRow | undefined;
  if (record.kind === "ask") {
    ask = record.row;
  } else if (record.kind === "hand") {
    ask = record.decision?.ask;
  }
  if (ask === undefined) {
    return row.hint;
  }
  const { blastRadius, lean, options, problem, question, risk, stillReal, summary } = ask;
  return [row.hint, blastRadius, lean, problem, question, risk, stillReal, summary]
    .concat(options.flatMap((one) => [one.option, one.tradeoff]))
    .filter((words) => words !== undefined)
    .join("\n");
}

/**
 * An `owner/repo` standing as a word, and not a segment of a longer path (`/Users/…`, `site/lib/…`): the owner,
 * the repository, and whether a GitHub reference follows it (`#<number>`, `PR <number>`, `pull request`).
 */
const OWNER_REPO =
  /(?<![\w./-]|github\.com\/)([a-z0-9][a-z0-9-]*)\/([a-z0-9._-]*[a-z0-9_-])(?![\w/-])(?<cited>\s*(?:#\d|prs?\b|pull request))?/gu;

/** The `owner/repo` of a GitHub address, however it goes on. */
const GITHUB_REPOSITORY = /github\.com\/([a-z0-9][a-z0-9-]*\/[a-z0-9._-]*[a-z0-9_-])(?![\w.-])/gu;

/**
 * Every repository a row's words name, so a number its home cannot hold has somewhere to go, and a row naming a
 * repository the queue has no address for never falls back to one it does. An attested
 * one is named as `owner/repo` or by its bare name standing as a word: `acme/acme-admin` in the evidence of an
 * ask whose checkout is slopweaver names acme-admin; `acme-admin-work-console` in a slug does not. Any other is named
 * only where it cannot be a path — in a GitHub address, before `#N` or `PR`, or under an owner the queue knows —
 * because a bare `other-org/unattested` reads exactly as `packages/seed-fixtures` does, and the real asks carry
 * paths.
 *
 * @param row the queue row
 * @param attested {@link attestedNumbers}, whose keys are the repositories the queue knows by address
 * @returns lowercased `owner/repo`s
 */
function namedRepositories({ row, attested }: { row: QueueRow; attested: ReadonlyMap<string, number> }): string[] {
  const words = wordsOf({ row }).toLowerCase();
  const known = [...attested.keys()].filter((repo) => {
    const name = repo.split("/").at(-1)!;
    return [repo, name].some((spelled) =>
      new RegExp(`(?<![\\w./-])${escaped({ text: spelled })}(?![\\w/-])`, "u").test(words),
    );
  });
  const owners = new Set([...attested.keys()].map((repo) => repo.split("/")[0]));
  const spelled = [...words.matchAll(OWNER_REPO)]
    .filter(({ 1: owner = "", groups }) => groups?.["cited"] !== undefined || owners.has(owner))
    .map(({ 1: owner, 2: repo }) => `${owner}/${repo}`);
  const addressed = [...words.matchAll(GITHUB_REPOSITORY)].map(({ 1: slug }) => slug);
  return [...new Set([...known, ...spelled, ...addressed])];
}

/**
 * `text` with every regular-expression metacharacter escaped, so a repository name matches as written.
 *
 * @param text what to match literally
 * @returns the escaped pattern
 */
function escaped({ text }: { text: string }): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * What one card resolves a number or key its sentences name without an address against.
 *
 * @param row the card's row
 * @param attested {@link attestedNumbers} over every row, computed once for the whole queue
 * @param linear the install's Linear workspace, off the board
 * @param boardSlugs every slug the board holds a row for, so a sentence naming one keeps it whole as words
 * @param checkouts {@link checkoutsOf} over every row, the only repositories an unnamed number may fall back to
 * @param people every person the queue's rosters name, {@link cardPeople} over the queue once
 * @param records the monitors, controls and risks the board resolved an address for
 * @returns the references
 */
export function cardReferences({
  row,
  attested,
  linear,
  boardSlugs,
  checkouts,
  people,
  records,
}: {
  row: QueueRow;
  attested: ReadonlyMap<string, number>;
  linear: LinearReferences;
  boardSlugs: ReadonlySet<string>;
  checkouts: ReadonlySet<string>;
  people: CardPeople;
  records: RecordReferences;
}): CardReferences {
  return {
    attested,
    boardSlugs,
    checkouts,
    home: homeOf({ attested, row }),
    linearTeamKeys: linear.teamKeys,
    linearWorkspace: linear.workspaceSlug,
    named: namedRepositories({ attested, row }),
    people,
    records,
  };
}
