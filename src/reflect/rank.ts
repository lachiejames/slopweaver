/**
 * RANKING, DEDUP AND THE CAP — the pure half of the reflection loop's miner.
 *
 * The collectors in `./collect.ts` are the impure edge; everything here takes findings and folded ledger
 * state as arguments and returns a decision. No filesystem, no clock, no model (AGENTS.md rule 2).
 *
 * ## Three bounds, and each of them is a scar
 *
 * **A hard cap of five surfaced candidates per run**, enforced by this function rather than by review. An
 * unbounded V1 pass once emitted 3,355 candidates in one go, which is not a work list — it is a
 * denial-of-service on the owner's attention. Rule 7 says the same thing about every outbound surface and
 * says the SCHEMA enforces shape: the form refuses a sixth rather than truncating one.
 *
 * **A per-source share of that cap**, so one noisy substrate cannot crowd out four quiet ones. That is how
 * the 3,355 were produced — they were 3,355 of a single kind. The share is deliberately strict: a run where
 * only one collector found anything surfaces two findings and says so, rather than filling five slots with
 * one substrate's opinion of the day.
 *
 * **A terminal drop.** A finding the owner graded `drop` is never proposed again, however many times the
 * miner rediscovers it. It does not even reach the backlog — a dropped finding sitting in a ranked list is
 * a finding that will be argued about again.
 *
 * ## What the backlog is for
 *
 * Everything past the cap accumulates rather than evaporating, and the next run prefers the top of it over
 * inventing anew. That is why {@link rankFindings} returns the remainder ranked rather than discarding it,
 * and why the miner records a `backlogged` sighting for each: a finding that sat in the backlog for a week
 * is visibly chronic through the same one counter as everything else.
 */
import {
  type FrictionFinding,
  findingId,
  hasConsequence,
  type ReflectSource,
  recurringImpact,
  scoreOf,
} from "./finding.js";
import { dayOf, type SeenState } from "./seen.js";

/**
 * The most findings one run puts in front of the owner. A number in the design rather than a matter of
 * judgement — see the module header.
 */
export const SURFACE_CAP = 5;

/**
 * The most any one collector may contribute to those five.
 *
 * Two, against seven sources: filling the brief takes at least three substrates agreeing that today had
 * friction, and no single one can ever hold the floor.
 */
export const PER_SOURCE_CAP = 2;

/** A finding with everything the ledger and the arithmetic added to it. */
export interface RankedFinding {
  /** The stable id, from `findingId`. */
  readonly id: string;
  /** The finding, with `impact` already lifted by recurrence. */
  readonly finding: FrictionFinding;
  /**
   * The impact as it stood before the recurrence lift — that is, AFTER the Tier 2 cross-reference and
   * before {@link recurringImpact}. The brief prints both so a reader can check the arithmetic.
   */
  readonly baseImpact: number;
  /** Distinct days the seen-ledger has this finding on, including today. */
  readonly daysSeen: number;
  /** How many prior runs surfaced it and were not acted on. */
  readonly priorSurfacings: number;
  /** The owner's latest grade on it, read from the fold, so a brief prints its own history rather than re-measuring. */
  readonly grade: SeenState["grade"];
  /** What the latest closing grade said closed it. */
  readonly closedBy: SeenState["closedBy"];
  /** When that closing grade was written. */
  readonly closedAtIso: SeenState["closedAtIso"];
  /** `(impact * safety) / cost`, with the lifted impact. */
  readonly score: number;
}

/** How many runs already surfaced a finding. One the seen-ledger holds no state for was never sighted, so none. */
function priorSurfacingsOf({ state }: { state: SeenState | undefined }): number {
  if (state === undefined) {
    return 0;
  }
  return state.surfacedCount;
}

/**
 * Attach identity, recurrence and score to raw collector output, and refuse anything already dropped.
 *
 * `daysSeen` counts today, so a first sighting is 1 rather than 0 — "seen on one day" is a truer sentence
 * than "seen on no days" about something the miner is looking at right now. It counts today ONCE: when the
 * ledger already holds a sighting dated today — the 06:30 row ran, and this is a second `brief` — the stored
 * count already includes it, and adding one would read a finding first seen this morning as seen on two days.
 *
 * @param findings everything the collectors returned this run
 * @param states the folded seen-ledger, keyed by finding id
 * @param tsIso this run's instant, whose UTC day is "today"
 * @returns one prepared candidate per surviving finding, unsorted
 */
export function prepareCandidates({
  findings,
  states,
  tsIso,
}: {
  findings: readonly FrictionFinding[];
  states: ReadonlyMap<string, SeenState>;
  tsIso: string;
}): readonly RankedFinding[] {
  const today = dayOf({ tsIso });
  const prepared: RankedFinding[] = [];
  for (const finding of findings) {
    const id = findingId({ signal: finding });
    const state = states.get(id);
    if (state?.dropped === true) {
      continue;
    }
    let daysSeen = 1;
    if (state !== undefined) {
      daysSeen = state.latestSightingDay === today ? state.daysSeen : state.daysSeen + 1;
    }
    const impact = recurringImpact({ base: finding.impact, daysSeen, occurrences: finding.occurrences });
    const lifted = { ...finding, impact };
    prepared.push({
      baseImpact: finding.impact,
      closedAtIso: state?.closedAtIso,
      closedBy: state?.closedBy,
      daysSeen,
      grade: state?.grade,
      finding: lifted,
      id,
      priorSurfacings: priorSurfacingsOf({ state }),
      score: scoreOf({ finding: lifted }),
    });
  }
  return prepared;
}

/**
 * Sort candidates into the order a brief prints them: score descending, then id ascending.
 *
 * The tie-break is the content-hash id rather than a timestamp or a source order, and that is the point of
 * it — two runs over the same day produce the same ordering, so a disagreement between two briefs is a
 * disagreement about the evidence rather than about the sort.
 *
 * @param candidates the prepared candidates
 * @returns a new array in rank order
 */
export function byRank({ candidates }: { candidates: readonly RankedFinding[] }): readonly RankedFinding[] {
  return candidates.toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * What one run decided to do with everything it found.
 *
 * @internal
 */
export interface RankedSelection {
  /** The findings that reach the owner, at most {@link SURFACE_CAP} of them, in rank order. */
  readonly surfaced: readonly RankedFinding[];
  /** Everything else, in rank order, so the next run prefers the top of it over inventing anew. */
  readonly backlog: readonly RankedFinding[];
  /**
   * Per source, how many findings the share held back — the honest report that a substrate had more to say.
   * Only sources that were actually held back appear, so an empty list means the cap alone decided.
   */
  readonly heldBySource: readonly { readonly source: ReflectSource; readonly held: number }[];
  /**
   * How many candidates were held because they state no measured consequence. A card the
   * owner cannot read an impact off is not raised. Held candidates go to the backlog — recurrence still counts them
   * — and take no slot of the cap or of their source's share.
   */
  readonly heldUnmeasured: number;
}

/** How much of the cap a source has taken so far in this walk: one with nothing surfaced yet has taken none. */
function capTakenBy({
  source,
  takenBySource,
}: {
  source: ReflectSource;
  takenBySource: ReadonlyMap<ReflectSource, number>;
}): number {
  const taken = takenBySource.get(source);
  if (taken === undefined) {
    return 0;
  }
  return taken;
}

/** Count one more finding the share held back for a source; its first one held starts the count at one. */
function countHeld({ held, source }: { held: Map<ReflectSource, number>; source: ReflectSource }): void {
  const prior = held.get(source);
  if (prior === undefined) {
    held.set(source, 1);
    return;
  }
  held.set(source, prior + 1);
}

/**
 * Rank every candidate, surface at most the cap, and keep the rest as a ranked backlog.
 *
 * The two bounds are applied in one walk over the ranked list, so a finding held back by its source's share
 * keeps its rank in the backlog rather than being re-sorted against candidates it already outranked.
 *
 * @param candidates the prepared candidates, in any order
 * @param cap the most findings that may reach the owner this run
 * @param perSourceCap the most any one collector may contribute to that number
 * @returns what to surface, what to hold, and which sources the share held back
 */
export function rankFindings({
  candidates,
  cap = SURFACE_CAP,
  perSourceCap = PER_SOURCE_CAP,
}: {
  candidates: readonly RankedFinding[];
  cap?: number;
  perSourceCap?: number;
}): RankedSelection {
  const ranked = byRank({ candidates });
  const surfaced: RankedFinding[] = [];
  const backlog: RankedFinding[] = [];
  const takenBySource = new Map<ReflectSource, number>();
  const held = new Map<ReflectSource, number>();
  let heldUnmeasured = 0;
  for (const candidate of ranked) {
    const source = candidate.finding.source;
    const taken = capTakenBy({ source, takenBySource });
    if (!hasConsequence({ finding: candidate.finding })) {
      heldUnmeasured += 1;
      backlog.push(candidate);
      continue;
    }
    if (surfaced.length >= cap) {
      backlog.push(candidate);
      continue;
    }
    if (taken >= perSourceCap) {
      countHeld({ held, source });
      backlog.push(candidate);
      continue;
    }
    takenBySource.set(source, taken + 1);
    surfaced.push(candidate);
  }
  return {
    backlog,
    heldBySource: [...held.entries()]
      .map(([source, count]) => ({ held: count, source }))
      .toSorted((a, b) => b.held - a.held || a.source.localeCompare(b.source)),
    heldUnmeasured,
    surfaced,
  };
}
