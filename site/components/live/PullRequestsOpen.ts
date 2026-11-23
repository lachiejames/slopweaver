/**
 * Which pull request the page's panel shows — the `?open=<n>&repo=<owner/repo>` deep link and its row in the
 * current reading — and the board priority bands the cards are ordered by.
 */

import { prPlacement } from "../../lib/registerPlacementDirect";
import { type WorkspacePlacement, type WorkspacePlacer } from "../../lib/workspacePlacement";
import { type Board } from "./read";
import { type LandingReading, type LandingRow } from "./readLanding";
import { type LiveState } from "./useLive";

/**
 * The pull request the panel holds: its repository and its number. Two repositories can each hold a pull request with
 * the same number, so the panel never holds a number alone.
 */
export interface OpenedPullRequest {
  readonly number: number;
  readonly repoSlug: string;
}

/**
 * The `?open=<n>&repo=<owner/repo>` deep link, or nothing when `open` is absent or not a whole number, or `repo` is
 * absent or empty — a number names no pull request until its repository does.
 *
 * @returns the pull request to open on arrival
 */
export function openParamOf({
  params,
}: {
  params: { get: (key: string) => string | null };
}): OpenedPullRequest | undefined {
  const raw = params.get("open");
  const repo = params.get("repo");
  if (raw === null || repo === null || repo === "") {
    return undefined;
  }
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    return undefined;
  }
  return { number, repoSlug: repo };
}

/**
 * One string per deep link, so the page can tell the address moved to ANOTHER pull request in place (the shell's
 * `router.push` keeps the page mounted) and reopen the panel on it, rather than keeping the one it arrived on.
 * The same number in two repositories is two links; no link is the empty string.
 *
 * @param linked the address's own pull request ({@link openParamOf})
 * @returns its repository and number as one string
 */
export function linkedPullKeyOf({ linked }: { linked: OpenedPullRequest | undefined }): string {
  if (linked === undefined) {
    return "";
  }
  return `${linked.repoSlug}#${String(linked.number)}`;
}

/**
 * The row the panel shows: the one carrying its repository and number in the CURRENT reading AND in this context,
 * so the panel follows a fresh reading and closes when the selector switches away from its row; nothing while the
 * reading is not ready or the pull request is on no row this context shows.
 *
 * @param opened the pull request the panel holds
 * @param shows whether this context shows a row with a given placement
 * @param placer the organisation's address readers, which place each row
 * @returns the row to show
 */
export function openedRowOf({
  opened,
  placer,
  state,
  shows,
}: {
  opened: OpenedPullRequest | undefined;
  placer: WorkspacePlacer;
  state: LiveState<LandingReading>;
  shows: (row: { readonly placement: WorkspacePlacement }) => boolean;
}): LandingRow | undefined {
  if (opened === undefined || state.phase !== "ready") {
    return undefined;
  }
  const { number, repoSlug } = opened;
  return state.value.landing.rows.find(
    (row) =>
      row.number === number &&
      row.repoSlug.toLowerCase() === repoSlug.toLowerCase() &&
      shows({ placement: prPlacement({ placer, row }) }),
  );
}

/**
 * The board's priority band for every row slug that carries one, so a pull request whose board row is p0 is drawn
 * above one whose row is p2, because the highest-priority work belongs first.
 *
 * @returns slug → band, empty until the board has read
 */
export function prioritiesOf({ board }: { board: Board | undefined }): ReadonlyMap<string, string> {
  const bands = new Map<string, string>();
  if (board === undefined) {
    return bands;
  }
  for (const row of board.rows) {
    if (row.priority !== undefined) {
      bands.set(row.slug, row.priority);
    }
  }
  return bands;
}
