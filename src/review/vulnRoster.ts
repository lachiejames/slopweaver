/**
 * The vulnerability-fix ROSTER: which of an author's open pull requests are the dependency-bump set, how much room
 * a row's cap leaves (or that it sets none), and who is holding each one.
 *
 * Pure, and computed from {@link LandingRow}s the fleet read already produces. Nothing here fetches: the
 * six landing tests, the code-owner answer GitHub itself published and the CI verdict are all on the row by
 * the time this sees it, so a roster is a projection of a read rather than a second read with its own idea
 * of the world.
 *
 * ## Why the selector is a TITLE convention and not a label
 *
 * A repository need not define a dependency label at all — Renovate's `config:recommended` sets none — so the
 * selector that always works is the convention the pull requests already carry, and a label is an additional
 * filter a caller may name once a repository defines one. {@link VulnRosterSelector} holds both, and neither is
 * hard-coded: a row names its own `--title-contains`.
 */
import type { LandingRow } from "./landing.js";
import type { CodeRabbitVerdict } from "./reviewState.js";

/** How a caller says which open pull requests are the dependency-bump set. */
export interface VulnRosterSelector {
  /**
   * A case-insensitive substring every title in the set carries — the convention, e.g. `(CVSS `.
   *
   * A substring rather than a pattern because the thing being matched IS a literal convention. A regular
   * expression here would be a small language the definition store could write, and the definition store is
   * outside code review.
   */
  readonly titleContains: string;
  /**
   * A label every row in the set must also carry, when the repository defines one. Absent means the title
   * convention alone selects.
   */
  readonly label?: string | undefined;
}

/** One pull request of the roster, reduced to what a digest line and a top-up decision each need. */
export interface VulnRosterEntry {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  /** What this pull request bumps, taken from its own title. Empty when the title does not say. */
  readonly subject: string;
  /**
   * Who GitHub says is holding it, `@`-prefixed as CODEOWNERS spells one — a login or an `owner/team`.
   *
   * GitHub's OWN answer, carried through from the landing row rather than derived from a CODEOWNERS read.
   * That is the same choice `github landing` documents and for the same measured reason: a derived reading
   * disagrees with GitHub whenever a rule has moved and the request has not.
   */
  readonly blockedOn: readonly string[];
  /** The rules behind {@link blockedOn}, AND across entries and OR within one — who can clear what. */
  readonly owedCodeowners: readonly (readonly string[])[];
  /** Who opened it, so its reviewer is never its own author. */
  readonly authorLogin: string;
  /** Whether every one of the six landing tests passed, so a reader can see which asks are the live ones. */
  readonly ready: boolean;
  /** The head commit the fleet read saw, so an end-to-end run read later is proved to be for the same commit. */
  readonly headOid: string;
  /** The labels standing on it, so a post with E2E evidence configured can mark a line missing its label. */
  readonly labels: readonly string[];
  /**
   * CodeRabbit's verdict on {@link headOid}, carried from the landing row because `github landing` already reads
   * it — evidence only when a post selects `--review-bot coderabbit`, never otherwise.
   */
  readonly codeRabbit: CodeRabbitVerdict;
  /** The detail behind that verdict, so a marked line can say what CodeRabbit is waiting on. */
  readonly codeRabbitDetail: string;
}

/**
 * How many more a top-up may raise: no cap at all — every eligible alert — or a row's `--target`, with the room
 * left under it. A discriminated record rather than a magic number, so "uncapped", zero and a cap never blur.
 */
export type TopupCapacity =
  | { readonly kind: "uncapped" }
  | {
      readonly kind: "capped";
      /** How many the row wants standing at once. */
      readonly target: number;
      /** How many more to raise to reach it. Never negative: a set over target needs no top-up. */
      readonly remaining: number;
    };

/**
 * The roster's capacity as one phrase: how many are open and, under a cap, the room left — never a number the row
 * did not set.
 *
 * @param capacity no cap, or the row's cap and the room left under it
 * @param open how many pull requests the roster holds
 * @returns e.g. `3 open — uncapped`, or `3 of 5 open — 2 to raise`
 */
export function rosterCapacityLine({ capacity, open }: { capacity: TopupCapacity; open: number }): string {
  if (capacity.kind === "uncapped") {
    return `${String(open)} open — uncapped`;
  }
  return `${String(open)} of ${String(capacity.target)} open — ${String(capacity.remaining)} to raise`;
}

/** The roster, and the capacity the top-up acts on. */
export interface VulnRoster {
  readonly entries: readonly VulnRosterEntry[];
  readonly capacity: TopupCapacity;
}

/**
 * The SUBJECT of a vulnerability-fix pull request — what it bumps, as its own title states it.
 *
 * Taken from the title rather than from the diff because the title is what the roster line shows and what a
 * reviewer scans; reading the manifest to name a package the title already names would be a second source
 * that can disagree with the one on screen.
 *
 * The convention the titles carry is `fix(TICKET): <subject> (CVSS 7.5)`, and older titles read
 * `[TICKET] fix(security): <subject>`, so the parse drops a leading bracketed ticket and a leading
 * `type(scope):` prefix and keeps the rest. A title that matches neither yields the whole title, which is honest —
 * there is nothing narrower to say about it.
 *
 * @param title the pull request's own title
 * @returns what it bumps, or the whole title when the convention is absent
 */
export function vulnSubjectOfTitle({ title }: { title: string }): string {
  const withoutTicket = title.replace(/^\s*\[[^\]]+\]\s*/, "");
  const colon = withoutTicket.indexOf(":");
  if (colon < 0) {
    return withoutTicket.trim();
  }
  const prefix = withoutTicket.slice(0, colon);
  if (!/^[a-z]+(\([^)]*\))?$/.test(prefix)) {
    return withoutTicket.trim();
  }
  return withoutTicket.slice(colon + 1).trim();
}

/**
 * Whether one open pull request belongs to the dependency-bump set.
 *
 * @param row the landing row
 * @param selector the title convention, and the label when the repository defines one
 * @returns true when this row is one of the set the roster counts
 */
export function isVulnRosterRow({ row, selector }: { row: LandingRow; selector: VulnRosterSelector }): boolean {
  const titleMatches = row.title.toLowerCase().includes(selector.titleContains.toLowerCase());
  if (!titleMatches) {
    return false;
  }
  const { label } = selector;
  if (label === undefined) {
    return true;
  }
  return row.labels.includes(label);
}

/**
 * Build the roster from a fleet read of one author's open pull requests.
 *
 * Ordered by pull-request number, oldest first, so a reader comparing two days' posts sees the same request
 * in the same place rather than watching the list reshuffle around whichever one CI happened to touch.
 *
 * @param rows every open pull request the read matched, already filtered to the repository and author
 * @param selector which of them are the dependency-bump set
 * @param target how many the row wants standing at once, or `undefined` for no cap
 * @returns the roster and its capacity
 */
export function vulnRosterOf({
  rows,
  selector,
  target,
}: {
  rows: readonly LandingRow[];
  selector: VulnRosterSelector;
  target: number | undefined;
}): VulnRoster {
  const entries = rows
    .filter((row) => isVulnRosterRow({ row, selector }))
    .toSorted((left, right) => left.number - right.number)
    .map((row): VulnRosterEntry => ({
      authorLogin: row.authorLogin,
      blockedOn: row.blockedOn,
      codeRabbit: row.codeRabbit,
      codeRabbitDetail: row.codeRabbitDetail,
      headOid: row.headOid,
      labels: row.labels,
      number: row.number,
      owedCodeowners: row.owedCodeowners,
      ready: row.ready,
      subject: vulnSubjectOfTitle({ title: row.title }),
      title: row.title,
      url: row.url,
    }));
  if (target === undefined) {
    return { capacity: { kind: "uncapped" }, entries };
  }
  return { capacity: { kind: "capped", remaining: Math.max(0, target - entries.length), target }, entries };
}
