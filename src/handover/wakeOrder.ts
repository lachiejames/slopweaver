/**
 * The order `handover wake` serves its parks in — its checks reads, its finish asks and its few reseats — never
 * board order.
 *
 * ## Why not slug order
 *
 * MEASURED: 41 parks were due and the run
 * attempted three, in SLUG order. A reseated row re-parks within the hour, so the same alphabetically early rows
 * took every pass's attempts and a row late in the alphabet waited indefinitely; the chair hand-seated one every
 * few passes. MEASURED again (`slopweaver handover wake --dry-run`, and the attempts in
 * `$SLOPWEAVER_HOME/ledgers/handover-wake.jsonl`): 47 parks due, every reseat spent on `a-*`,
 * `audit-*`, `bot-*` and `error-*` slugs, while a row parked on a pull request whose CI went green was never
 * reseated — one of 29 drafts of the owner's left open by seats that did the work and parked.
 *
 * ## Least recently served, from the instant it became due
 *
 * A due park is served by {@link dueSinceIso}, the earliest instant it could have become due — a reseated row
 * re-parks with a fresh instant and goes to the back of the line on its own. A row whose reseat FAILED keeps its
 * park and its instant, so age alone would hand it the turn again on every tick: every capped pass therefore
 * serves the park waiting longest since its last turn, or since it became due when it has had none
 * ({@link leastRecentlyTried}).
 *
 * ## Open work first, a spawn that cannot succeed last
 *
 * Oldest-first alone spends the next several ticks on the oldest parks, which were nearly all on pull requests that
 * merged or closed days earlier — a reseat there only settles a row, while an open draft behind them is finished
 * work still not on main. So a reseat of a park whose pull request ended ranks after every other
 * ({@link inWakeOrder}). A park whose doc names no `repo:` ranks after both: `cmux spawn`
 * refuses that doc, and its age would otherwise put a spawn that cannot succeed ahead of every other park on every
 * tick. It is ranked, never skipped, so a doc that gains a `repo:` mid-run is still spawned when the budget reaches
 * it.
 *
 * Pure. No I/O.
 */
import type { ParkWake, ParkWakeJudgement } from "./parkWake.js";

/**
 * The earliest instant a park could have become due: a clock wake's own instant, or the park itself when that
 * instant had already passed; a checks wake's park, since the read carries no instant its checks finished at.
 *
 * @param parkedAtIso when the seat parked
 * @param wake what the park waits on
 * @returns the instant the park has been due since, at the latest
 */
export function dueSinceIso({ parkedAtIso, wake }: { parkedAtIso: string; wake: ParkWake }): string {
  if (wake.kind === "at" && Date.parse(wake.atIso) > Date.parse(parkedAtIso)) {
    return new Date(Date.parse(wake.atIso)).toISOString();
  }
  return new Date(Date.parse(parkedAtIso)).toISOString();
}

/**
 * Due parks longest due first, the slug breaking a tie so the order is total.
 *
 * @param due each due park's slug and the instant it has been due since
 * @returns the same entries, longest due first
 */
export function longestDueFirst<T extends { readonly slug: string; readonly dueSinceIso: string }>({
  due,
}: {
  due: readonly T[];
}): readonly T[] {
  return due.toSorted(
    (left, right) =>
      Date.parse(left.dueSinceIso) - Date.parse(right.dueSinceIso) || left.slug.localeCompare(right.slug),
  );
}

/**
 * The instant a park has waited since: its last turn, or — never tried — the instant it became due.
 *
 * @param lastTried each park's last turn instant, by key
 * @returns the instant to serve the park by, earliest first
 */
function waitingSince({
  lastTried,
  row,
}: {
  lastTried: ReadonlyMap<string, string>;
  row: { readonly dueSinceIso: string; readonly key: string };
}): number {
  const tried = lastTried.get(row.key);
  if (tried === undefined) {
    return Date.parse(row.dueSinceIso);
  }
  return Date.parse(tried);
}

/**
 * Parks in the order a capped pass serves them: the park that has waited longest since it was last served first —
 * since it became due, for a park never served — longest due breaking a tie. The one rotation behind all three
 * capped passes — the judging window's checks reads and the finish asks (`./wakeTurnStore.ts`), and the reseats
 * (the wake journal's attempts) — so a park whose read keeps timing out, whose finish keeps refusing or whose spawn
 * keeps failing goes behind every park that has waited longer, instead of taking the same turn on every tick.
 * Never-tried parks do NOT go first outright: a stream of fresh parks would then hold a
 * tried one back forever. A served park waits from that instant and a fresh one from its due
 * instant, so whatever arrives after a park's turn queues behind it.
 *
 * @param due the parks, each with the key its turns are recorded under
 * @param lastTried each park's last turn instant, by key
 * @returns the same entries in serving order
 */
export function leastRecentlyTried<
  T extends { readonly slug: string; readonly dueSinceIso: string; readonly key: string },
>({ due, lastTried }: { due: readonly T[]; lastTried: ReadonlyMap<string, string> }): readonly T[] {
  return longestDueFirst({ due }).toSorted(
    (left, right) => waitingSince({ lastTried, row: left }) - waitingSince({ lastTried, row: right }),
  );
}

/**
 * Which group a due park's reseat falls in, lowest served first: work still to land, then a park whose pull request
 * merged or closed, then one whose doc names no `repo:` for `cmux spawn` to open a worktree in.
 *
 * @param docRepo the park's doc's `repo:`, `undefined` when it names none
 * @param judgement this run's judgement of the park
 * @returns 0, 1 or 2
 */
function rankOf({ docRepo, judgement }: { docRepo: string | undefined; judgement: ParkWakeJudgement }): number {
  if (docRepo === undefined) {
    return 2;
  }
  const ended =
    judgement.kind === "due" && judgement.observed.kind === "checks" && judgement.observed.prState !== "OPEN";
  return Number(ended);
}

/**
 * Due parks in the order the wake spends its reseats: every park on work still to land first, then those whose pull
 * request ended, then any whose doc names no `repo:` — each group least recently tried first
 * ({@link leastRecentlyTried}).
 *
 * @param due the due parks, each with its doc's `repo:` and this run's judgement
 * @param lastTried each park's last reseat attempt, by key
 * @returns the same entries in reseat order
 */
export function inWakeOrder<
  T extends {
    readonly slug: string;
    readonly dueSinceIso: string;
    readonly key: string;
    readonly candidate: { readonly docRepo: string | undefined };
    readonly judgement: ParkWakeJudgement;
  },
>({ due, lastTried }: { due: readonly T[]; lastTried: ReadonlyMap<string, string> }): readonly T[] {
  return leastRecentlyTried({ due, lastTried }).toSorted(
    (left, right) =>
      rankOf({ docRepo: left.candidate.docRepo, judgement: left.judgement }) -
      rankOf({ docRepo: right.candidate.docRepo, judgement: right.judgement }),
  );
}
