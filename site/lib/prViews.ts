/**
 * The Pull requests page's one selector: a handful of states over the owner's open pull requests, each with how many it
 * holds, and the order the cards are drawn in. Pure.
 *
 * The states mirror the Queue page's views: waiting on review, waiting on code owner, waiting on platform, waiting on
 * CI, in the merge queue. Everything is the default, the highest-priority work comes first, and what needs the
 * owner's attention is the Queue's job, so no view here is "needs you".
 *
 * Every state is a predicate over a field `github landing` already printed for the row — its `action`, its
 * `humanWait.next` and its `blockedOn` — never a field this page adds, and never a second computation of whether a
 * pull request is green. States overlap on purpose, the way the Queue's views do: a row waiting
 * on the platform team's review is waiting on a code owner too.
 *
 * The one input beside the row is the set of pull requests the owner has picked a reviewer for: a pick supersedes the
 * verb's wait with an ask still to send (`drawnWaitOf`, `./reviewHook.ts`), the card's tag says so, and the state
 * reads the same wait the tag does, so a card tagged `ask` is never listed under Waiting on review.
 */
import type { LandingRow } from "../components/live/readLanding";

/** The query parameter the state rides in. */
export const PR_VIEW_PARAM = "view";

/**
 * Every act `github landing` emits, in the order the cards are drawn within one priority band, each with the words
 * the selector lists it under: what can land first, then what an agent or a person is working, then what nothing can
 * be said about yet, then drafts. `src/__tests__/unit/canon/landingActionHeadings.test.ts` fails when an act the
 * verb emits has no entry here, or this names one it never emits.
 */
export const PR_ACTION_ORDER = [
  { action: "press", label: "Ready to land" },
  { action: "spawn-ci", label: "Waiting on CI" },
  { action: "spawn-coderabbit", label: "Waiting on CodeRabbit" },
  { action: "answer-threads", label: "A reviewer is waiting on us" },
  { action: "blocked-on", label: "Waiting on code owner" },
  { action: "conflicting", label: "Conflicts" },
  { action: "pressed-not-queued", label: "Pressed, no longer queued" },
  { action: "queued", label: "In the merge queue" },
  { action: "stacked", label: "Stacked" },
  { action: "no-queue", label: "No merge queue" },
  { action: "opted-out", label: "Opted out" },
  { action: "unknown", label: "Not yet decidable" },
  { action: "draft", label: "Drafts" },
] as const;

/** One act the verb emits, as this page names it. */
type ActionView = (typeof PR_ACTION_ORDER)[number]["action"];

/** Every state the selector offers: all of them, the two derived ones, and one per act. */
export type PrView = "all" | "review" | "platform" | ActionView;

/**
 * The `humanWait.next` acts that mean a review is under way — somebody was asked or a channel has it, a nudge is
 * due, or the messages need settling. `ask`, `name-the-reviewer` and `sync-slack` are not: nobody has been asked
 * yet, or the Slack history is too stale to say (`src/review/humanWait.ts`).
 */
const REVIEW_UNDER_WAY: ReadonlySet<string> = new Set(["wait", "wait-on-channel", "bump", "read-the-messages"]);

/** A code-owner team whose own slug is `platform`, in any organisation: `@org/platform`. A user has no `/`. */
const PLATFORM_TEAM = /^@[^/\s]+\/platform$/i;

/** The states in the order the selector lists them, the owner's list first, each with its words. */
export const PR_VIEWS: readonly { readonly view: PrView; readonly label: string }[] = [
  { label: "Everything", view: "all" },
  { label: "Waiting on review", view: "review" },
  { label: "Waiting on code owner", view: "blocked-on" },
  { label: "Waiting on platform", view: "platform" },
  { label: "Waiting on CI", view: "spawn-ci" },
  { label: "In the merge queue", view: "queued" },
  ...PR_ACTION_ORDER.filter(
    (entry) => entry.action !== "blocked-on" && entry.action !== "spawn-ci" && entry.action !== "queued",
  ).map((entry) => ({ label: entry.label, view: entry.action })),
];

/**
 * A pull request's key in {@link inPrView}'s `picked` set — `owner/repo#n`, the way every card prints it.
 *
 * @returns the key
 */
export function prKeyOf({ row }: { row: { readonly repoSlug: string; readonly number: number } }): string {
  return `${row.repoSlug}#${String(row.number)}`;
}

/**
 * Whether a row is in a state.
 *
 * @param picked the {@link prKeyOf} keys of the pull requests the owner has picked a reviewer for
 * @returns true when the state holds the row
 */
export function inPrView({
  row,
  view,
  picked,
}: {
  row: LandingRow;
  view: PrView;
  picked: ReadonlySet<string>;
}): boolean {
  if (view === "all") {
    return true;
  }
  if (view === "review") {
    const underWay = row.humanWait !== undefined && REVIEW_UNDER_WAY.has(row.humanWait.next);
    return row.action === "blocked-on" && underWay && !picked.has(prKeyOf({ row }));
  }
  if (view === "platform") {
    return row.action === "blocked-on" && row.blockedOn.some((owner) => PLATFORM_TEAM.test(owner));
  }
  return row.action === view;
}

/**
 * Whether which rows a state holds depends on the owner's reviewer picks as well as on the landing reading. Only Waiting on
 * review does: a pick takes a row out of it. So an empty Waiting on review is proven only when the reviewer reading
 * behind the picks is current too.
 *
 * @returns true when {@link inPrView} reads `picked` for this state
 */
export function prViewReadsPicks({ view }: { view: PrView }): boolean {
  return view === "review";
}

/** How a board priority band ranks, highest first; a row no band covers ranks after every band. */
const BAND_RANK: Readonly<Record<string, number>> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/**
 * Where a row ranks: its board row's priority band, then its act in {@link PR_ACTION_ORDER}. An act this page has no
 * entry for ranks after every known one rather than vanishing.
 *
 * @param priorities each board row's priority band, by slug
 * @returns the band rank and the act rank
 */
function rankOf({ row, priorities }: { row: LandingRow; priorities: ReadonlyMap<string, string> }): {
  band: number;
  act: number;
} {
  let band = Object.keys(BAND_RANK).length;
  if (row.boardRowSlug !== undefined) {
    const priority = priorities.get(row.boardRowSlug);
    if (priority !== undefined && Object.hasOwn(BAND_RANK, priority)) {
      band = BAND_RANK[priority]!;
    }
  }
  let act = PR_ACTION_ORDER.findIndex((entry) => entry.action === row.action);
  if (act === -1) {
    act = PR_ACTION_ORDER.length;
  }
  return { act, band };
}

/**
 * The rows a state holds, in the order the cards are drawn: the highest-priority work first, then
 * by act, each in the reading's own order.
 *
 * @param rows the rows the work context shows
 * @param priorities each board row's priority band, by slug — empty while the board has not read, which leaves the
 *   act order alone
 * @param picked the {@link prKeyOf} keys of the pull requests the owner has picked a reviewer for
 * @returns the rows to draw
 */
export function prRowsForView({
  rows,
  view,
  priorities,
  picked,
}: {
  rows: readonly LandingRow[];
  view: PrView;
  priorities: ReadonlyMap<string, string>;
  picked: ReadonlySet<string>;
}): readonly LandingRow[] {
  const ranked = rows
    .filter((row) => inPrView({ picked, row, view }))
    .map((row, index) => ({ index, rank: rankOf({ priorities, row }), row }));
  ranked.sort((a, b) => a.rank.band - b.rank.band || a.rank.act - b.rank.act || a.index - b.index);
  return ranked.map((entry) => entry.row);
}

/**
 * How many rows each state holds, in the selector's order — or no count for any state while the population is not
 * counted (`pullRequestPopulation.ts`): a reading taken without drafts, or one GitHub's own open list does not
 * reconcile with, holds rows that are not every open pull request of the owner's, so Everything's number would be as wrong as
 * Drafts', and the selector prints none rather than a zero it never measured.
 *
 * @param rows the rows the work context shows
 * @param measured whether those rows are the owner's whole open population, from `pullRequestPopulationOf`
 * @param picked the {@link prKeyOf} keys of the pull requests the owner has picked a reviewer for
 * @returns each state with its words and its count
 */
export function prViewCounts({
  rows,
  measured,
  picked,
}: {
  rows: readonly LandingRow[];
  measured: boolean;
  picked: ReadonlySet<string>;
}): readonly { readonly view: PrView; readonly label: string; readonly count: number | undefined }[] {
  return PR_VIEWS.map(({ view, label }) => {
    if (!measured) {
      return { count: undefined, label, view };
    }
    return { count: rows.filter((row) => inPrView({ picked, row, view })).length, label, view };
  });
}

/**
 * The state an address names, or Everything for none and for a word that is not a state — a mistyped link opens on
 * every card rather than an empty page that reads as a verdict.
 *
 * @param value the `view` parameter, or `null` when the address has none
 * @returns the state
 */
export function prViewOf({ value }: { value: string | null }): PrView {
  const known = PR_VIEWS.find((each) => each.view === value);
  if (known === undefined) {
    return "all";
  }
  return known.view;
}

/**
 * The words a state is listed under.
 *
 * @returns the label
 */
export function prViewLabel({ view }: { view: PrView }): string {
  return PR_VIEWS.find((each) => each.view === view)!.label;
}

/**
 * Set the state in a query string, keeping every other parameter; Everything drops it.
 *
 * @param search the current query string, with or without its `?`
 * @returns the new query string, `?`-prefixed, or `""` when nothing is left
 */
export function withPrView({ search, view }: { search: string; view: PrView }): string {
  const params = new URLSearchParams(search);
  params.delete(PR_VIEW_PARAM);
  if (view !== "all") {
    params.set(PR_VIEW_PARAM, view);
  }
  const query = params.toString();
  if (query === "") {
    return "";
  }
  return `?${query}`;
}
