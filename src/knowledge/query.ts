/**
 * Filtering and grouping the register. Pure — rows in, rows out, no I/O.
 *
 * ## Why the query surface is deliberately thin
 *
 * A facet filter over scalar fields and a repeat count. Nothing else, and that is a decision rather than a
 * first cut: making everything queryable is useful, and the query layer that implies is a separate,
 * still-open piece of work. Building a rich local query surface here would be building the half that
 * gets DELETED rather than migrated when that lands — so this file does what a settle gate and a reading
 * session actually need, and stops.
 */
import type { LessonLearner, LessonRow, LessonSurface, LessonTier, LessonVerdict } from "./types.js";

/** A cluster of recordings that share an id — the same lesson, learned more than once. */
export interface LessonRepeat {
  /** The shared id. */
  readonly id: string;
  /** How many times it was recorded. */
  readonly count: number;
  /** The first recording, which is the one whose wording the cluster is named by. */
  readonly first: LessonRow;
  /** How many DISTINCT runs recorded it — the number that matters, since one run may record twice. */
  readonly runs: number;
}

/**
 * Keep only the rows matching every facet supplied. An absent facet does not filter.
 *
 * @param rows every row the register holds
 * @param domain keep only this domain
 * @param verdict keep only this verdict
 * @param tier keep only this tier
 * @param surface keep only this surface
 * @param learner keep only the fleet's rows, or only the owner's
 * @param run keep only rows recorded on this board row
 * @returns the matching rows, in their recorded order
 */
export function filterLessons({
  rows,
  domain,
  verdict,
  tier,
  surface,
  learner,
  run,
}: {
  rows: readonly LessonRow[];
  domain?: string | undefined;
  verdict?: LessonVerdict | undefined;
  tier?: LessonTier | undefined;
  surface?: LessonSurface | undefined;
  learner?: LessonLearner | undefined;
  run?: string | undefined;
}): readonly LessonRow[] {
  return rows.filter(
    (row) =>
      (domain === undefined || row.domain === domain) &&
      (verdict === undefined || row.verdict === verdict) &&
      (tier === undefined || row.tier === tier) &&
      (surface === undefined || row.surface === surface) &&
      (learner === undefined || row.learner === learner) &&
      (run === undefined || row.run === run),
  );
}

/**
 * Group rows by id and keep only the ids recorded more than once, most-repeated first.
 *
 * This is the owner's consolidation trigger made countable: if multiple agents have the same lesson, it is
 * time to turn that lesson into a standing rule or find some way to make it structurally impossible.
 *
 * **It groups by id and knows nothing about `learner`, deliberately — so a caller counting INDEPENDENT
 * learning narrows to one side FIRST.** An owner row and a fleet row for the same claim share an id (that
 * shared id is the whole series mechanism, `./types.ts`'s overview), so handing both to this function
 * reports `count: 2, runs: 2` for a claim exactly one fleet session ever learned. `knowledge list --repeats`
 * defaults to `--learner fleet` for that reason, and `./declared.ts` narrows the same way.
 *
 * `runs` is reported alongside `count` because they answer different questions and only one of them is the
 * trigger: two recordings from ONE run is a session writing the same thing twice, while two recordings from
 * two runs is two independent sessions having learned it. A consolidation decision reads `runs`.
 *
 * @param rows the rows to group, already filtered if the caller wanted them filtered
 * @returns one entry per repeated id, ordered by distinct runs then total count, both descending
 */
export function repeatedLessons({ rows }: { rows: readonly LessonRow[] }): readonly LessonRepeat[] {
  const byId = new Map<string, LessonRow[]>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing === undefined) {
      byId.set(row.id, [row]);
      continue;
    }
    existing.push(row);
  }
  const repeats: LessonRepeat[] = [];
  for (const [id, group] of byId) {
    const first = group[0];
    if (group.length < 2 || first === undefined) {
      continue;
    }
    repeats.push({ count: group.length, first, id, runs: new Set(group.map((row) => row.run)).size });
  }
  return repeats.toSorted((a, b) => b.runs - a.runs || b.count - a.count || a.id.localeCompare(b.id));
}
