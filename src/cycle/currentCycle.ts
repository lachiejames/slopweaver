/**
 * Which Linear cycle is CURRENT, answered as a join rather than a heuristic.
 *
 * The `cycle` object inlined on an issue carries only `{id, number, name}`, which is why a scan that opens
 * only bronze concludes the corpus cannot say. It can: the structures lane holds `kind: "cycle"` rows with
 * `attrs.startsAt` / `attrs.endsAt` and a `cycle_for` relation to the team. Measured on the real
 * home — `LC_ALL=C jq -r 'select(.kind=="cycle") | [.sourceId,(.attrs.startsAt!=null and .attrs.endsAt!=null)]
 * | @tsv' ~/.slopweaver/corpus/structures/linear.jsonl | sort -u` — 738 unique rows, every one carrying both
 * dates, resolving 19 teams with a live cycle.
 *
 * So the key is the cycle's UUID. The free-text `name` is never a key and the per-team `number` never has to
 * be reconciled: the same "Cycle 133" is number 44 on one team and 8 on another.
 *
 * Pure: the caller streams the rows and supplies the instant.
 */

import { isRecord } from "../lib/parsers.js";

/** One cycle the structures lane knows about, reduced to what a reconcile needs. */
export interface CycleWindow {
  readonly id: string;
  readonly name: string;
  readonly teamId: string | undefined;
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Read one structures line into a cycle window.
 *
 * @param line one raw JSONL line from the structures lane
 * @returns the cycle window, or `undefined` when the line is not a complete cycle row
 */
export function cycleWindowOf({ line }: { line: string }): CycleWindow | undefined {
  const parsed: unknown = safeParse({ line });
  if (!isRecord(parsed) || parsed["kind"] !== "cycle") {
    return undefined;
  }
  const attrs: unknown = parsed["attrs"];
  const identity: unknown = parsed["identity"];
  const id: unknown = parsed["sourceId"];
  if (!isRecord(attrs) || typeof id !== "string") {
    return undefined;
  }
  const { startsAt, endsAt } = attrs;
  if (typeof startsAt !== "string" || typeof endsAt !== "string") {
    return undefined;
  }
  const name = isRecord(identity) && typeof identity["name"] === "string" ? identity["name"] : "";
  return { endsAt, id, name, startsAt, teamId: cycleTeamOf({ relations: parsed["relations"] }) };
}

/** The team a cycle row binds itself to through its own `cycle_for` relation. */
function cycleTeamOf({ relations }: { relations: unknown }): string | undefined {
  if (!Array.isArray(relations)) {
    return undefined;
  }
  for (const relation of relations) {
    if (isRecord(relation) && relation["type"] === "cycle_for" && typeof relation["targetId"] === "string") {
      return relation["targetId"];
    }
  }
  return undefined;
}

/** `JSON.parse` that answers `undefined` rather than throwing, so one bad line never sinks a stream. */
function safeParse({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Every cycle spanning `nowIso`, keyed by cycle id.
 *
 * Deduped by id keeping the LAST row seen, because the structures lane is append-only across refreshes and
 * the same cycle appears once per generation.
 *
 * @param windows every cycle row read from the structures lane, in file order
 * @param nowIso the instant the answer is about
 * @returns the current cycles, by id
 */
export function currentCycles({
  windows,
  nowIso,
}: {
  windows: readonly CycleWindow[];
  nowIso: string;
}): ReadonlyMap<string, CycleWindow> {
  const byId = new Map<string, CycleWindow>();
  for (const window of windows) {
    byId.set(window.id, window);
  }
  const current = new Map<string, CycleWindow>();
  for (const [id, window] of byId) {
    if (window.startsAt <= nowIso && window.endsAt > nowIso) {
      current.set(id, window);
    }
  }
  return current;
}

/**
 * The earliest instant any current cycle opened — the staleness boundary a pass judges against.
 *
 * Answers `undefined` rather than an empty string when no cycle is current, because an empty boundary
 * compares as older than every timestamp and would silently mark the whole workspace stale.
 *
 * @param cycles the current cycles, as {@link currentCycles} returned them
 * @returns the earliest `startsAt`, or `undefined` when no cycle is current
 */
export function earliestCycleStart({ cycles }: { cycles: ReadonlyMap<string, CycleWindow> }): string | undefined {
  return [...cycles.values()].map((window) => window.startsAt).toSorted()[0];
}

/**
 * How many distinct TEAMS the current cycles cover.
 *
 * Reported rather than the cycle count, because a team is the unit the owner thinks in and two cycle rows can
 * belong to one team across generations.
 *
 * @param cycles the current cycles, as {@link currentCycles} returned them
 * @returns the number of distinct teams with a live cycle
 */
export function teamsWithCurrentCycle({ cycles }: { cycles: ReadonlyMap<string, CycleWindow> }): number {
  const teams = new Set<string>();
  for (const window of cycles.values()) {
    if (window.teamId !== undefined) {
      teams.add(window.teamId);
    }
  }
  return teams.size;
}
