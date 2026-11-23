/**
 * `slopweaver github reviewer list --json`, read into what the pull-request page draws: per open pull request,
 * whether a reviewer was picked and not yet asked, and — when nobody usefully is on the hook — who to ask,
 * with the sentence the suggestion rests on.
 *
 * The page's own ask line is drawn from the LANDING row (`askTrail`, `bump`); this reading adds only what the
 * landing document cannot know, which is the owner's picks and the history across earlier pull requests. Strict for
 * the same reason `readLanding.ts` is: a row that will not parse refuses the whole reading, because a
 * suggestion silently dropped reads as "nobody to suggest".
 */
import { type Bag, bags, isBag, num, str, sub } from "../../lib/bag";
import type { SlackPeople, SlackPersonName } from "../../lib/slackPeople";

/** Which evidence a suggestion rests on — the verb's own tier word. */
export type ReviewerTier = "named-code-owner" | "team-history" | "repo-history";

/** One suggested reviewer, as the verb said it. */
export interface ReviewerSuggestion {
  /** The Slack member id. */
  readonly reviewer: string;
  readonly tier: ReviewerTier;
  /** One sentence a reader can check — the verb's words. */
  readonly basis: string;
}

/** One pull request's join. */
export interface ReviewerRow {
  readonly repoSlug: string;
  readonly number: number;
  /** The verb's hook word: `not-due`, `picked`, `asked`, `nobody-asked` or `unknown`. */
  readonly hook: string;
  /** Who the owner picked, and when, while the hook is `picked`. */
  readonly picked: { readonly reviewer: string; readonly atIso: string } | undefined;
  /** Who the newest ask went to first, while the hook is `asked`. */
  readonly primary: string | undefined;
  readonly suggestion:
    { readonly primary: ReviewerSuggestion; readonly alternatives: readonly ReviewerSuggestion[] } | undefined;
}

/** The whole reading. */
export interface Reviewers {
  readonly observedAtIso: string;
  /** The landing reading the join was made over — the page notes it when its own reading differs. */
  readonly readingId: string;
  /** How many asks the register holds; a short history is a young register, never an absence of asks. */
  readonly registerAsks: number;
  readonly rows: readonly ReviewerRow[];
  readonly people: SlackPeople;
}

const TIERS: readonly ReviewerTier[] = ["named-code-owner", "team-history", "repo-history"];

/** Whether a string is one of the verb's tier words. */
function isTier(value: string): value is ReviewerTier {
  return (TIERS as readonly string[]).includes(value);
}

/**
 * One suggestion.
 *
 * @returns it, or `undefined` when it will not parse
 */
function suggestionOf({ bag }: { bag: Bag }): ReviewerSuggestion | undefined {
  const reviewer = str({ bag, key: "reviewer" });
  const tier = str({ bag, key: "tier" });
  const basis = str({ bag, key: "basis" });
  if (reviewer === undefined || tier === undefined || basis === undefined || !isTier(tier)) {
    return undefined;
  }
  return { basis, reviewer, tier };
}

/**
 * A row's suggestion set: `undefined` when the verb offered none, `null` when what it offered will not parse.
 *
 * @returns the set, `undefined`, or `null`
 */
function suggestionSetOf({ row }: { row: Bag }): ReviewerRow["suggestion"] | null {
  if (row["suggestion"] === undefined) {
    return undefined;
  }
  const set = sub({ bag: row, key: "suggestion" });
  if (set === undefined) {
    return null;
  }
  const primaryBag = sub({ bag: set, key: "primary" });
  const alternativeBags = bags({ bag: set, key: "alternatives" });
  if (primaryBag === undefined || alternativeBags === undefined) {
    return null;
  }
  const primary = suggestionOf({ bag: primaryBag });
  const alternatives = alternativeBags.map((bag) => suggestionOf({ bag }));
  if (primary === undefined || alternatives.some((alt) => alt === undefined)) {
    return null;
  }
  return { alternatives: alternatives.filter((alt): alt is ReviewerSuggestion => alt !== undefined), primary };
}

/**
 * One row.
 *
 * @returns it, or `undefined` when it will not parse
 */
function rowOf({ bag }: { bag: Bag }): ReviewerRow | undefined {
  const repoSlug = str({ bag, key: "repoSlug" });
  const number = num({ bag, key: "number" });
  const hookBag = sub({ bag, key: "hook" });
  if (repoSlug === undefined || number === undefined || hookBag === undefined) {
    return undefined;
  }
  const hook = str({ bag: hookBag, key: "kind" });
  const suggestion = suggestionSetOf({ row: bag });
  if (hook === undefined || suggestion === null) {
    return undefined;
  }
  let picked: ReviewerRow["picked"];
  if (hook === "picked") {
    const reviewer = str({ bag: hookBag, key: "reviewer" });
    const atIso = str({ bag: hookBag, key: "atIso" });
    if (reviewer === undefined || atIso === undefined) {
      return undefined;
    }
    picked = { atIso, reviewer };
  }
  let primary: string | undefined;
  if (hook === "asked") {
    primary = str({ bag: hookBag, key: "primary" });
    if (primary === undefined) {
      return undefined;
    }
  }
  return { hook, number, picked, primary, repoSlug, suggestion };
}

/**
 * Read `github reviewer list --json`.
 *
 * Positional because `useLive` calls every reader by reference with the payload alone.
 *
 * @returns the reading, or `undefined` when the payload is not one
 */
export function readReviewers(payload: unknown): Reviewers | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const readingId = str({ bag: payload, key: "readingId" });
  const registerAsks = num({ bag: payload, key: "registerAsks" });
  const heldRows = bags({ bag: payload, key: "rows" });
  const heldPeople = sub({ bag: payload, key: "people" });
  if (
    observedAtIso === undefined ||
    readingId === undefined ||
    registerAsks === undefined ||
    heldRows === undefined ||
    heldPeople === undefined
  ) {
    return undefined;
  }
  const rows: ReviewerRow[] = [];
  for (const bag of heldRows) {
    const row = rowOf({ bag });
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  const people = new Map<string, SlackPersonName>();
  for (const id of Object.keys(heldPeople)) {
    const name = str({ bag: heldPeople, key: id });
    if (name === undefined) {
      return undefined;
    }
    people.set(id, { handle: undefined, name });
  }
  return { observedAtIso, people, readingId, registerAsks, rows };
}

/**
 * The join for one landing row, by repository and number.
 *
 * @returns the row, or `undefined` when the reviewer reading does not hold it
 */
export function reviewerRowFor({
  reviewers,
  repoSlug,
  number,
}: {
  reviewers: Reviewers;
  repoSlug: string;
  number: number;
}): ReviewerRow | undefined {
  return reviewers.rows.find((row) => row.repoSlug === repoSlug && row.number === number);
}
