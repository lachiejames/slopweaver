/**
 * What `handover reconcile`'s JSON says about the rows `tick open` might offer a seat on: the lists a finding is
 * looked up in, and which ready rows no spawn may be offered for and why. A list missing, or a reading that could
 * place a session on any row, is UNREADABLE rather than empty, so no line built on it says a row is free.
 * The lines themselves are `./digestActFirst.ts`. Pure.
 */
import { BOARD_PRIORITIES } from "../handover/rowKind.js";
import type { RowStanding } from "../handover/rowStanding.js";
import { isSafeSlug } from "../handover/runStore.js";
import { field, listOf, shortened, stringField } from "./digestRead.js";

/** Every standing `standingOf` (`../handover/rowStanding.ts`) can give a row. */
const ROW_STANDINGS = [
  "ready",
  "in-flight",
  "waiting-on-owner",
  "paused",
  "blocked",
] as const satisfies readonly RowStanding[];

/**
 * A reconcile row's standing as a line quotes it, or `standing UNKNOWN` when it is missing, empty, or not one the
 * list it sits on can carry — `held` is disjoint from `ready`, so a held row reading `ready` contradicts itself.
 *
 * @param row the reconcile row
 * @param allowed the standings the row's own list can carry
 * @returns the standing, or `standing UNKNOWN`
 */
export function standingText({ allowed, row }: { allowed: readonly RowStanding[]; row: unknown }): string {
  const read = stringField({ key: "standing", value: row });
  const standing = allowed.find((one) => one === read);
  if (standing === undefined) {
    return "standing UNKNOWN";
  }
  return standing;
}

/** The standings a row on reconcile's `held` can carry: every one but `ready`. */
export const HELD_STANDINGS: readonly RowStanding[] = ROW_STANDINGS.filter((one) => one !== "ready");

/** The standings a seated row (`aligned` or `misaligned`) can carry: any, since a ready row can be seated too. */
export const SEATED_STANDINGS: readonly RowStanding[] = ROW_STANDINGS;

/** The reconcile lists a finding is looked up in, or why the document cannot say. */
export type BoardLists =
  | {
      readonly held: readonly unknown[];
      readonly inFlight: readonly unknown[];
      readonly ready: readonly unknown[];
      readonly repolessRows: readonly unknown[];
      readonly sharedSlugs: readonly unknown[];
    }
  | { readonly unreadable: string };

/** The readable half of {@link BoardLists}. */
export type ReadLists = Exclude<BoardLists, { readonly unreadable: string }>;

/**
 * Whether a reconcile entry names a row: a non-empty string. An empty id names none, so it could stand for any
 * row a lookup asks about.
 *
 * @returns whether it names a row
 */
function namesRow({ id }: { id: unknown }): boolean {
  return typeof id === "string" && id.length > 0;
}

/**
 * How many of reconcile's ready rows name no id, any of which could be a doc claiming the id a line is about.
 *
 * @returns the count
 */
export function namelessReady({ lists }: { lists: ReadLists }): number {
  return lists.ready.filter((row) => !namesRow({ id: field({ key: "id", value: row }) })).length;
}

/**
 * Every id more than one row of reconcile's `held` and `ready` carries between them. The two are disjoint for a
 * doc and each holds it once (`Reconciliation.held` in `src/handover/reconcile.ts`), so a repeat is two docs on one
 * slug however `sharedSlugs` reads, and no spawn can be offered on it.
 *
 * @param held reconcile's held rows
 * @param ready reconcile's ready rows
 * @returns the repeated ids
 */
function repeatedIds({ held, ready }: { held: readonly unknown[]; ready: readonly unknown[] }): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const row of [...held, ...ready]) {
    const id = stringField({ key: "id", value: row });
    if (id !== undefined && seen.has(id)) {
      repeated.add(id);
    }
    if (id !== undefined) {
      seen.add(id);
    }
  }
  return repeated;
}

/**
 * Whether more than one doc claims an id — on reconcile's `sharedSlugs`, repeated between `held` and `ready`, or
 * repeated on `repolessRows`, which carries one slug per doc — so `handover set-repo` and
 * `cmux spawn` both refuse it.
 *
 * @param lists the readable reconcile lists
 * @param id the row id asked about
 * @returns whether the id is shared
 */
export function idShared({ id, lists }: { id: string; lists: ReadLists }): boolean {
  const repoless = lists.repolessRows.filter((one) => one === id).length;
  return (
    lists.sharedSlugs.includes(id) || repoless > 1 || repeatedIds({ held: lists.held, ready: lists.ready }).has(id)
  );
}

/**
 * Every reconcile list a finding's seatability rests on. An in-flight row sits in `aligned` or `misaligned`
 * wrapped as `{ rank, row }`, so those are unwrapped to their row. `sharedSlugs`
 * is every slug more than one doc claims, read off the whole board, so a duplicate split across two lists, or
 * with one copy on no list, is still seen.
 *
 * @param value the parsed reconcile JSON
 * @returns the lists, or why the document cannot say: a list it does not carry, or an in-flight session on no
 *   row id, which could be on any row
 */
export function boardLists({ value }: { value: unknown }): BoardLists {
  const read = new Map<string, readonly unknown[]>();
  for (const key of ["aligned", "held", "misaligned", "ready", "repolessRows", "sharedSlugs"]) {
    const list = listOf({ key, value });
    if (list === undefined) {
      return { unreadable: `reconcile carries no ${key} list` };
    }
    read.set(key, list);
  }
  const inFlight = [...read.get("aligned")!, ...read.get("misaligned")!].map((one) =>
    field({ key: "row", value: one }),
  );
  const unplaced = inFlight.filter((row) => !namesRow({ id: field({ key: "id", value: row }) })).length;
  if (unplaced > 0) {
    return { unreadable: `reconcile places ${String(unplaced)} session(s) on no row id` };
  }
  // An entry a lookup cannot read could be the very id it looks for, so it hides a hold, a missing
  // repo or a second claimant rather than ruling one out.
  const unreadable = [
    { key: "held", ok: read.get("held")!.every((row) => namesRow({ id: field({ key: "id", value: row }) })) },
    { key: "repolessRows", ok: read.get("repolessRows")!.every((one) => namesRow({ id: one })) },
    { key: "sharedSlugs", ok: read.get("sharedSlugs")!.every((one) => namesRow({ id: one })) },
  ].find(({ ok }) => !ok);
  if (unreadable !== undefined) {
    return { unreadable: `reconcile's ${unreadable.key} list carries an entry that names no row id` };
  }
  return {
    held: read.get("held")!,
    inFlight,
    ready: read.get("ready")!,
    repolessRows: read.get("repolessRows")!,
    sharedSlugs: read.get("sharedSlugs")!,
  };
}

/** The ready rows sorted by whether a spawn may be offered on them, each exclusion with its ids. */
export interface ReadySort {
  /** Each ready row carrying an id the run journal accepts and the label and priority every board row has. */
  readonly identified: readonly { readonly id: string; readonly row: unknown }[];
  /** How many ready rows carry no such id. */
  readonly unidentified: number;
  /** Ids whose row lacks the label, priority or ready standing a ready `BoardRow` carries, so it will not read as one. */
  readonly incomplete: readonly string[];
  /** Ids more than one doc claims. */
  readonly shared: readonly string[];
  /** Ids whose row names no `repo:`. */
  readonly repoless: readonly string[];
  /** Ids reconcile already places a session on. */
  readonly placed: readonly string[];
}

/**
 * Which ready rows no spawn may be offered for. `cmux spawn` refuses a slug more than one doc claims,
 * one the run journal refuses (`""`, `../x`) and a row naming no `repo:`; a row reconcile already places a
 * session on is not one to seat, and one lacking a field every `BoardRow` (`../handover/rank.ts`) carries is not
 * a reading to offer a seat on.
 *
 * @param lists the readable reconcile lists
 * @returns the sort
 */
export function sortReady({ lists }: { lists: ReadLists }): ReadySort {
  const slugged = lists.ready.flatMap((row) => {
    const id = stringField({ key: "id", value: row });
    return id === undefined || !isSafeSlug({ slug: id }) ? [] : [{ id, row }];
  });
  const identified = slugged.filter(({ row }) => boardRowComplete({ row }));
  const inFlight = new Set(lists.inFlight.map((row) => stringField({ key: "id", value: row })));
  const ids = [...new Set(identified.map(({ id }) => id))];
  const shared = ids.filter((id) => idShared({ id, lists }));
  return {
    identified,
    incomplete: [...new Set(slugged.filter(({ row }) => !boardRowComplete({ row })).map(({ id }) => id))],
    placed: ids.filter((id) => !shared.includes(id) && inFlight.has(id)),
    repoless: ids.filter((id) => !shared.includes(id) && lists.repolessRows.includes(id)),
    shared,
    unidentified: lists.ready.length - slugged.length,
  };
}

/**
 * Whether a ready row carries the non-empty label and the board priority every `BoardRow` is written with, and
 * says it is ready in both fields `BoardRow` derives that from: a row on `ready` reading `paused`, or
 * `ready: false`, contradicts the list it sits on, and `cmux spawn` refuses a row that is not ready.
 *
 * @param row one row of reconcile's `ready` list, as parsed
 * @returns whether it does
 */
export function boardRowComplete({ row }: { row: unknown }): boolean {
  const label = stringField({ key: "label", value: row });
  const priority = stringField({ key: "priority", value: row });
  const saysReady =
    stringField({ key: "standing", value: row }) === "ready" && field({ key: "ready", value: row }) === true;
  return label !== undefined && label !== "" && BOARD_PRIORITIES.some((one) => one === priority) && saysReady;
}

/**
 * One line per exclusion {@link sortReady} found, naming its ids, so no ready row leaves the count silently.
 *
 * @returns the lines, none when nothing was excluded
 */
export function exclusionLines({ sort }: { sort: ReadySort }): readonly string[] {
  const named = [
    { ids: sort.incomplete, why: "lack the label, priority or ready standing every ready board row carries," },
    { ids: sort.shared, why: "more than one doc claims," },
    { ids: sort.repoless, why: "name no repo:," },
    { ids: sort.placed, why: "reconcile already places a session on," },
  ].filter(({ ids }) => ids.length > 0);
  const unidentified =
    sort.unidentified > 0
      ? [`seatable: ${String(sort.unidentified)} ready row(s) carry no id cmux spawn accepts, so none is offered`]
      : [];
  return [
    ...unidentified,
    ...named.map(
      ({ ids, why }) =>
        `seatable: ${String(ids.length)} ready id(s) ${why} so none is offered — ${shortened({ text: ids.join(", ") })}`,
    ),
  ];
}
