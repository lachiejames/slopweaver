/**
 * What `handover reconcile --json` prints beside its ranking about the rows no spawn may be offered for
 * (`src/cli/commands/handover/reconcileRun.ts`), read back for the Fleet page's doctrine panel and never re-derived:
 *
 * - `repolessRows` (no `repo:`, so `cmux spawn` refuses it), `supersededSupervisors` (a chair a later one retired),
 *   `sharedSlugs` (more than one doc claims the slug) and `trunkMovedRows` (a finding whose evidence the trunk changed
 *   since it was asked) — each HELD before it can be ready (`src/handover/rowStanding.ts`);
 * - their companions saying where the verb could not look: `supersessionUnresolved`, `trunkUnread` and
 *   `trunkPullsUnchecked`, so an empty list is never read as a measured zero when it was not measured;
 * - `releasedRows`, the open runs a session deliberately let go of (`src/handover/releasedRows.ts`).
 *
 * Same vintage rule as `held` in `./readWorkstreams.ts`: a document carrying NONE of the six always-printed keys, nor
 * `releasedRows`, is an older build of the verb, which one shared `$SLOPWEAVER_HOME` keeps supplying, and reads `absent`; one carrying some
 * but not all, or one that will not read, is a defect and reads `malformed`, naming why. Unlike a malformed `held`, it
 * does NOT refuse the whole reconciliation: only the doctrine panel reads these lists, so the panel names the defect as
 * a place not checked and every other reader of the reconciliation keeps it.
 * `releasedRows` is younger than the other six, so its absence alone is a vintage too, and reads `undefined`.
 */
import { type Bag, bags, isBag, str, strings, sub } from "../../lib/bag";

/** One scope the verb could not check, and the rows it offered without the check. */
export interface ReconcileUnreadScope {
  /** The repository whose trunk could not be checked, `owner/name` (`src/handover/trunkMoved.ts`). */
  readonly repo: string;
  readonly why: string;
  readonly slugs: readonly string[];
}

/** The open runs deliberately released, or why the verb could not count them. */
export type ReconcileReleased =
  | { readonly kind: "read"; readonly ids: readonly string[] }
  | { readonly kind: "unread"; readonly unreadableIds: readonly string[]; readonly why: string };

/** Every hold the verb printed. */
export interface ReconcileHoldLists {
  readonly repoless: readonly string[];
  readonly superseded: readonly string[];
  /** Why no chair could be judged superseded, when none could — absent when the verb looked. */
  readonly supersessionUnresolved: string | undefined;
  readonly shared: readonly string[];
  readonly trunkMoved: readonly string[];
  readonly trunkUnread: readonly ReconcileUnreadScope[];
  readonly trunkPullsUnchecked: readonly ReconcileUnreadScope[];
  /** `undefined` on a reading from a build before the field. */
  readonly released: ReconcileReleased | undefined;
}

/** The holds as one document carried them: read, from an older build, or not readable. */
export type ReconcileHolds =
  | { readonly kind: "read"; readonly lists: ReconcileHoldLists }
  | { readonly kind: "absent" }
  | {
      readonly kind: "malformed";
      readonly why: string;
      /** Every row id the hold lists still carried legibly, so each is named as unchecked rather than lost. */
      readonly named: readonly string[];
      /** Every repository a trunk scope still named legibly, each a place not checked too. */
      readonly repos: readonly string[];
    };

/** The six keys every current build prints. */
const HOLD_KEYS = [
  "repolessRows",
  "supersededSupervisors",
  "sharedSlugs",
  "trunkMovedRows",
  "trunkUnread",
  "trunkPullsUnchecked",
] as const;

/**
 * The slugs of a list of records each carrying `slug`, deduplicated.
 *
 * @returns the slugs, or `undefined` when the list or one entry will not read
 */
function slugsOf({ bag, key }: { bag: Bag; key: string }): readonly string[] | undefined {
  const rows = bags({ bag, key });
  if (rows === undefined) {
    return undefined;
  }
  const slugs: string[] = [];
  for (const row of rows) {
    const slug = str({ bag: row, key: "slug" });
    if (slug === undefined) {
      return undefined;
    }
    slugs.push(slug);
  }
  return [...new Set(slugs)];
}

/**
 * A `{ repo, why, slugs }` list.
 *
 * @returns the scopes, or `undefined` when the list or one entry will not read
 */
function scopesOf({ bag, key }: { bag: Bag; key: string }): readonly ReconcileUnreadScope[] | undefined {
  const rows = bags({ bag, key });
  if (rows === undefined) {
    return undefined;
  }
  const scopes: ReconcileUnreadScope[] = [];
  for (const row of rows) {
    // The repository is a place not checked too, so a scope without one does not read.
    const repo = str({ bag: row, key: "repo" });
    const why = str({ bag: row, key: "why" });
    const slugs = strings({ bag: row, key: "slugs" });
    if (repo === undefined || why === undefined || slugs === undefined) {
      return undefined;
    }
    scopes.push({ repo, slugs, why });
  }
  return scopes;
}

/**
 * `releasedRows`: absent is an older build, present and unreadable is a defect.
 *
 * @returns the released read, `undefined` for an older build, or `false` when it will not read
 */
function releasedOf({ bag }: { bag: Bag }): ReconcileReleased | undefined | false {
  if (!("releasedRows" in bag)) {
    return undefined;
  }
  const released = sub({ bag, key: "releasedRows" });
  if (released === undefined) {
    return false;
  }
  const kind = str({ bag: released, key: "kind" });
  if (kind === "read") {
    const ids = strings({ bag: released, key: "ids" });
    return ids === undefined ? false : { ids, kind };
  }
  if (kind === "unread") {
    const unreadableIds = strings({ bag: released, key: "unreadableIds" });
    const why = str({ bag: released, key: "why" });
    return unreadableIds === undefined || why === undefined ? false : { kind, unreadableIds, why };
  }
  return false;
}

/**
 * An array's entries walked by index, never through a method the value could carry as its own, so salvage stays total
 * over any input the vintage read itself accepts.
 *
 * @returns the entries, empty when the value is not an array
 */
function entriesOf({ value }: { value: unknown }): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: unknown[] = [];
  try {
    for (let index = 0; index < value.length; index += 1) {
      entries.push(value[index]);
    }
  } catch {
    // An index that throws ends the walk; what was read before it is still named (as `../../lib/bag.ts`'s `bags`).
  }
  return entries;
}

/**
 * The string elements of an array, one level deep.
 *
 * @returns the strings, empty when the value is not an array
 */
function stringsIn({ value }: { value: unknown }): readonly string[] {
  return entriesOf({ value }).filter((entry) => typeof entry === "string");
}

/**
 * The strings an array carries as row ids: each string element, and each record element's `slug` and the strings in
 * its `slugs`. Two levels and no further, the deepest any hold list nests an id, so a document nested arbitrarily
 * deep costs its length and never the stack.
 *
 * @returns the ids, empty when the value is not an array
 */
function idsInList({ value }: { value: unknown }): readonly string[] {
  return entriesOf({ value }).flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    if (!isBag(entry)) {
      return [];
    }
    return [...[entry["slug"]].filter((slug) => typeof slug === "string"), ...stringsIn({ value: entry["slugs"] })];
  });
}

/**
 * Every row id a malformed holds set still carries legibly, whichever of its lists failed to read, so a row it did
 * name is named as unchecked rather than dropped with the list beside it.
 *
 * @returns the ids, sorted and once each
 */
function salvagedIdsOf({ bag }: { bag: Bag }): readonly string[] {
  const ids = HOLD_KEYS.flatMap((key) => idsInList({ value: bag[key] }));
  const released = bag["releasedRows"];
  if (isBag(released)) {
    ids.push(...idsInList({ value: released["ids"] }), ...idsInList({ value: released["unreadableIds"] }));
  }
  return [...new Set(ids)].toSorted();
}

/**
 * Every repository a malformed holds set's trunk scopes still name legibly, whether or not the scope beside it read.
 *
 * @returns the repositories, sorted and once each
 */
function salvagedReposOf({ bag }: { bag: Bag }): readonly string[] {
  const repos = (["trunkUnread", "trunkPullsUnchecked"] as const).flatMap((key) =>
    entriesOf({ value: bag[key] }).flatMap((entry) => {
      if (!isBag(entry) || typeof entry["repo"] !== "string") {
        return [];
      }
      return [entry["repo"]];
    }),
  );
  return [...new Set(repos)].toSorted();
}

/**
 * The malformed outcome, carrying every place the set still named legibly.
 *
 * @param why what made the set malformed
 * @returns the outcome
 */
function malformedOf({ bag, why }: { bag: Bag; why: string }): ReconcileHolds {
  return { kind: "malformed", named: salvagedIdsOf({ bag }), repos: salvagedReposOf({ bag }), why };
}

/**
 * The holds off one reconciliation document.
 *
 * @returns which of the three outcomes the document is in
 */
export function reconcileHoldsOf({ bag }: { bag: Bag }): ReconcileHolds {
  const missing = HOLD_KEYS.filter((key) => !(key in bag));
  // `releasedRows` is younger than the six, so a document carrying it without them is no build's, never a vintage
  //: it reads malformed, keeping the ids it carries.
  if (missing.length === HOLD_KEYS.length && !("releasedRows" in bag)) {
    return { kind: "absent" };
  }
  if (missing.length > 0) {
    return malformedOf({ bag, why: `it carries some hold lists but not ${missing.join(", ")}` });
  }
  // The shared list readers iterate, which a hostile array can make throw; a throw is a list that will not read, never
  // an exception escaping into the reconciliation it sits beside.
  try {
    return listsOf({ bag });
  } catch {
    return malformedOf({ bag, why: "a hold list it carries will not read" });
  }
}

/**
 * The holds off a document carrying all six keys.
 *
 * @returns the lists read, or malformed when one will not read
 */
function listsOf({ bag }: { bag: Bag }): ReconcileHolds {
  const repoless = strings({ bag, key: "repolessRows" });
  const superseded = strings({ bag, key: "supersededSupervisors" });
  const shared = strings({ bag, key: "sharedSlugs" });
  const trunkMoved = slugsOf({ bag, key: "trunkMovedRows" });
  const trunkUnread = scopesOf({ bag, key: "trunkUnread" });
  const trunkPullsUnchecked = scopesOf({ bag, key: "trunkPullsUnchecked" });
  const released = releasedOf({ bag });
  const unresolvedPresent = "supersessionUnresolved" in bag;
  const supersessionUnresolved = str({ bag, key: "supersessionUnresolved" });
  if (
    repoless === undefined ||
    superseded === undefined ||
    shared === undefined ||
    trunkMoved === undefined ||
    trunkUnread === undefined ||
    trunkPullsUnchecked === undefined ||
    released === false ||
    (unresolvedPresent && supersessionUnresolved === undefined)
  ) {
    return malformedOf({ bag, why: "a hold list it carries will not read" });
  }
  return {
    kind: "read",
    lists: {
      released,
      repoless,
      shared,
      superseded,
      supersessionUnresolved,
      trunkMoved,
      trunkPullsUnchecked,
      trunkUnread,
    },
  };
}
