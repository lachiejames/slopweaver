/**
 * THE UNSEATED-RECIPE-FAILURE GATE — a tick that read a broken automation's finding with no seat on it cannot be
 * RECORDED without spawning one onto it or naming it in a reason.
 *
 * ## The thing it makes impossible
 *
 * Self-healing: the fleet spins up its own seats to fix broken integrations, and it must be structurally
 * impossible for a failure to sit unseated. The failure case: a scheduled corpus resync failed, and its
 * finding `recipe-failing-resync-corpus-notion-<firing instant>-a1` was registered with no `repo:`, so the
 * board held it off RUN NOW (`../handover/rowStanding.ts`), the idle-capacity gate (`./idleCapacityGate.ts`, which
 * reads `ready` only) owed it nothing, and every tick for twelve hours passed while the corpus went stale. The owner
 * found it on their own sidebar, and the chair's spawn then failed in front of them on the missing repo.
 *
 * `../cli/commands/automation/slotFailureHold.ts` now files that finding WITH a repo. This gate is the other half:
 * whatever state a failure finding is in, a tick that saw it and left it unseated has to say so.
 *
 * ## The predicate, exactly
 *
 * It refuses when the reconciliation's `ready` or `held` list carries a row whose id starts `recipe-failing-` (the
 * slug `../live/automation/failureHold.ts` `failureFindingSlug` mints, and nothing else does) that
 *
 * 1. is not `waiting-on-owner` or `paused` — each of those already carries a recorded reason, the owner's open question or
 *    the person `pausedOn:` names (`../handover/paused.ts` `pausedStateOf`, the only way into `PAUSED`), and
 *    re-demanding one is the copied rationale every sibling gate refuses to accept — nor in `disconnectedRows`,
 *    held for an integration this install is not connected to, whose declared `needs` tag is that reason;
 * 2. no live seat is on — the three placement lists, read by the idle-capacity gate's own reader, and only when the
 *    reconciliation's `fleet` was `observed`: an `unavailable` fleet's placements are open journals, not seats, and
 *    `handover reconcile` places no workspace on such a row unless a pid in its process tree is a registered Claude
 *    Code session (`../cli/commands/handover/recipeFailureSeats.ts`), so a shell or a `vim` a dead seat left
 *    behind leaves it owed;
 * 3. this tick did not complete a `spawned` action onto, subject `{kind:"handover", id:<slug>}`;
 * 4. and no `hold-rationale` judgement names, subject `{kind:"handover", id:<slug>}`.
 *
 * `ready`, `held` and the seated rows cover the ranked board (`../handover/reconcile.ts` § `held`), so a failure
 * finding a tick read is in one of them. Unlike the idle-capacity gate this one is NOT conditioned on capacity or
 * priority: a broken integration is owed a seat whatever the machine says, and a machine hold is a reason the chair
 * narrates. Every row must be answered by name — there is no wildcard subject.
 *
 * ## A gate that cannot SEE refuses too
 *
 * A reconciliation with no `ready` or `held` list, an entry with no string id and standing, or a placement list that
 * will not read is a reading this tick never took: `unreadable`, for the reason every sibling gate gives. So is a
 * missing `fleet`, but only once a failure finding is owed — a board with none needs no seat read — and so is a
 * missing `duplicateRecipeFailures` list. A NON-EMPTY one is unreadable whatever is owed: reconciliation is keyed by
 * row id, so one seat on a slug two docs claim seats both and drops both from `held`. An absent
 * `repolessRows` list is NOT unreadable: it only words the way out, and a reading that predates it judges the same.
 *
 * Pure — the draft's actions and judgements and the reconciliation in, a verdict out;
 * `../cli/commands/supervisor/tickRecordGates.ts` renders the refusal and the recorder reads the hatch.
 */
import { isRecord } from "../lib/parsers.js";
import { disconnectedSlugsOf } from "./disconnectedRows.js";
import { type ListReading, namedRowIdsOf, seatedRowIdsOf, spawnedRowsOf } from "./idleCapacityGate.js";

/** The slug prefix every recipe failure finding carries, and nothing else on the board does. */
export const RECIPE_FAILURE_PREFIX = "recipe-failing-";

/** The two reconciliation lists, between them every unseated ranked row. */
const OPEN_LISTS = ["ready", "held"] as const;

/** Standings that already carry a recorded reason — the owner's word, or a named person. */
const REASONED_STANDINGS: ReadonlySet<string> = new Set(["waiting-on-owner", "paused"]);

/** One recipe failure finding a tick left with no seat, no spawn and no reason. */
interface UnseatedRecipeFailure {
  readonly id: string;
  /** The board's standing for it — `ready`, `blocked` or `in-flight`. */
  readonly standing: string;
  /** Whether it names no `repo:`, so `handover set-repo` comes before any spawn. */
  readonly repoless: boolean;
}

/** The gate's verdict on one tick. */
export type RecipeFailureVerdict =
  | { readonly kind: "clean" }
  | { readonly kind: "unreadable"; readonly why: string }
  | { readonly kind: "refused"; readonly rows: readonly UnseatedRecipeFailure[] };

/** One open failure finding as decoded off a list. */
interface OpenFailure {
  readonly id: string;
  readonly standing: string;
}

/** One reconciliation list decoded into board rows, or unreadable on the first entry that is not one. */
function boardRowsOf({
  entries,
  list,
}: {
  readonly entries: unknown;
  readonly list: string;
}): ListReading<readonly OpenFailure[]> {
  if (!Array.isArray(entries)) {
    return {
      kind: "unreadable",
      why: `the reconciliation carries no \`${list}\` list — re-run \`slopweaver handover reconcile --json\` with this checkout`,
    };
  }
  const rows: OpenFailure[] = [];
  for (const [index, entry] of entries.entries()) {
    const id = isRecord(entry) ? entry["id"] : undefined;
    const standing = isRecord(entry) ? entry["standing"] : undefined;
    if (typeof id !== "string" || typeof standing !== "string") {
      return {
        kind: "unreadable",
        why: `the reconciliation's ${list}[${String(index)}] is not a board row with a string id and standing`,
      };
    }
    rows.push({ id, standing });
  }
  return { kind: "read", value: rows };
}

/**
 * Every recipe failure finding in `ready` and `held` that is OWED a seat — not in a reasoned standing — in list
 * order, once each. Every entry is decoded, so a malformed one anywhere is an unreadable reconciliation rather than
 * a row silently dropped. The standing is filtered BEFORE the dedupe: an id listed once reasoned and once not is
 * owed, never cleared by whichever occurrence came first (review pass r2).
 */
function openFailuresOf({
  reconciliation,
}: {
  reconciliation: Record<string, unknown>;
}): ListReading<readonly OpenFailure[]> {
  const found = new Map<string, OpenFailure>();
  for (const list of OPEN_LISTS) {
    const rows = boardRowsOf({ entries: reconciliation[list], list });
    if (rows.kind === "unreadable") {
      return rows;
    }
    const owed = rows.value.filter(
      ({ id, standing }) => id.startsWith(RECIPE_FAILURE_PREFIX) && !REASONED_STANDINGS.has(standing),
    );
    for (const row of owed) {
      if (!found.has(row.id)) {
        found.set(row.id, row);
      }
    }
  }
  return { kind: "read", value: [...found.values()] };
}

/**
 * The finding slugs two live docs claim. Reconciliation is keyed by row id, so one seat on such a slug seats every
 * doc carrying it and drops them all from `held`: a non-empty list is a reading no seat can be judged on. An absent
 * list is `undefined`, unreadable only once a finding is owed, the way a missing `fleet` is.
 */
function duplicatesOf({
  reconciliation,
}: {
  reconciliation: Record<string, unknown>;
}): ListReading<readonly string[] | undefined> {
  const listed = reconciliation["duplicateRecipeFailures"];
  if (listed === undefined) {
    return { kind: "read", value: undefined };
  }
  if (!Array.isArray(listed) || !listed.every((slug): slug is string => typeof slug === "string")) {
    return { kind: "unreadable", why: "the reconciliation's `duplicateRecipeFailures` is not a list of slugs" };
  }
  if (listed.length > 0) {
    return {
      kind: "unreadable",
      why:
        `two live docs claim the recipe failure finding slug ${listed.join(", ")}, so no seat on it can be told ` +
        "from the other doc's — rename one doc's `slug:` or archive the stale one, then re-run `slopweaver handover reconcile --json`",
    };
  }
  return { kind: "read", value: listed };
}

/**
 * The owed rows the disconnected hold exempts, or unreadable when the reading contradicts itself. That hold is its
 * own recorded reason — the row DECLARED the need with a `needs` tag (`../handover/integrationNeeds.ts`) — so no
 * seat is owed while it stands: a seat on it would fail its first read. The hold demotes a row to `blocked`, so a
 * row it names standing anywhere else is a reading no exemption can be judged on.
 */
function exemptDisconnected({
  owed,
  disconnected,
}: {
  owed: readonly OpenFailure[];
  disconnected: ReadonlySet<string>;
}): ListReading<readonly OpenFailure[]> {
  const contradicted = owed.find((row) => disconnected.has(row.id) && row.standing !== "blocked");
  if (contradicted !== undefined) {
    return {
      kind: "unreadable",
      why:
        `the reconciliation holds ${contradicted.id} for a disconnected integration but lists it as ` +
        `${contradicted.standing} — re-run \`slopweaver handover reconcile --json\` with this checkout`,
    };
  }
  return { kind: "read", value: owed.filter((row) => !disconnected.has(row.id)) };
}

/** The row ids the reconciliation says name no `repo:` — empty on a reading that predates the list. */
function repolessIdsOf({ reconciliation }: { reconciliation: Record<string, unknown> }): ReadonlySet<string> {
  const listed = reconciliation["repolessRows"];
  if (!Array.isArray(listed)) {
    return new Set();
  }
  return new Set(listed.filter((id): id is string => typeof id === "string"));
}

/**
 * The rows a LIVE seat is on. Only an `observed` fleet's placement lists say that: with cmux unreadable,
 * `handover reconcile` fills the same lists from open run journals, which prove a cycle nobody closed and never an
 * agent alive (`../handover/reconcile.ts` `eligible`), so they seat nobody here. A `fleet` that is neither value is
 * a reading this tick never took.
 */
function liveSeatsOf({
  reconciliation,
}: {
  reconciliation: Record<string, unknown>;
}): ListReading<ReadonlySet<string>> {
  const fleet = reconciliation["fleet"];
  if (fleet === "unavailable") {
    return { kind: "read", value: new Set() };
  }
  if (fleet !== "observed") {
    return {
      kind: "unreadable",
      why: "the reconciliation does not say whether its fleet was observed, so no placement can be read as a live seat",
    };
  }
  return seatedRowIdsOf({ reconciliation });
}

/**
 * Judge one tick against the recipe failure findings it read: refused while any is left with no seat, no completed
 * spawn and no hold-rationale naming it.
 *
 * @param actions what the tick did — a completed `spawned` action on `{kind:"handover"}` answers its row
 * @param judgements what the tick concluded — a `hold-rationale` on `{kind:"handover"}` answers its row
 * @param reconciliation the `handover reconcile --json` document this tick already read
 * @returns the verdict the recorder acts on
 */
export function judgeRecipeFailures({
  actions,
  judgements,
  reconciliation,
}: {
  actions: unknown;
  judgements: unknown;
  reconciliation: unknown;
}): RecipeFailureVerdict {
  if (!isRecord(reconciliation)) {
    return { kind: "unreadable", why: "the reconciliation is not a JSON object" };
  }
  const duplicated = duplicatesOf({ reconciliation });
  if (duplicated.kind === "unreadable") {
    return duplicated;
  }
  const disconnected = disconnectedSlugsOf({ reconciliation });
  if (disconnected.kind === "unreadable") {
    return disconnected;
  }
  const open = openFailuresOf({ reconciliation });
  if (open.kind === "unreadable") {
    return open;
  }
  const exempted = exemptDisconnected({ disconnected: new Set(disconnected.value), owed: open.value });
  if (exempted.kind === "unreadable") {
    return exempted;
  }
  const owed = exempted.value;
  if (owed.length === 0) {
    return { kind: "clean" };
  }
  if (duplicated.value === undefined) {
    return {
      kind: "unreadable",
      why:
        "the reconciliation carries no `duplicateRecipeFailures` list, so a finding slug two docs claim could be " +
        "hiding one — re-run `slopweaver handover reconcile --json` with this checkout",
    };
  }
  const seated = liveSeatsOf({ reconciliation });
  if (seated.kind === "unreadable") {
    return seated;
  }
  const spawned = spawnedRowsOf({ actions }).rowIds;
  const named = namedRowIdsOf({ ceilingId: null, judgements });
  const repoless = repolessIdsOf({ reconciliation });
  const rows = owed
    .filter((row) => !seated.value.has(row.id) && !spawned.has(row.id) && !named.has(row.id))
    .map((row) => ({ id: row.id, repoless: repoless.has(row.id), standing: row.standing }));
  if (rows.length === 0) {
    return { kind: "clean" };
  }
  return { kind: "refused", rows };
}
