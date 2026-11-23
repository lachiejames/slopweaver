/**
 * THE STOPPED-RECIPE SEAT — the sweep seats a repair for every stopped recipe set it reads, itself, the same tick, and
 * a tick that left one with neither a seat nor a hold cannot be recorded.
 *
 * ## The thing it makes impossible
 *
 * About ten "a recipe stopped and no seat has it" floating notes reached the owner in one day. The notes STAY:
 * silencing them would hide the stop from the owner, which is misalignment. The defect is the chair not keeping on top
 * of automatically seating these repairs, so the stop reaches the owner when it should not have to. The card asked a
 * seat to be put on the stop, and nothing in the sweep did so: every tick read the set, fired the note, and passed.
 *
 * So `supervisor tick open` reads `monitor check --only recipe-stopped` and seats ONE repair row for the open set
 * (`../cli/commands/supervisor/tickOpenStoppedRecipes.ts`), and `supervisor tick close` refuses a tick whose set has
 * neither a seat nor a hold (`../cli/commands/supervisor/tickCloseStoppedRecipes.ts`). This file is the pure half of
 * both, so the two can never disagree about which row answers which set.
 *
 * ## Which set, and which row
 *
 * The open set is the monitor's own: firing, or STEERED only because the owner closed its card — their
 * Done holds the card, never the repair, so that summary carries the set too. A stop a seat has taken, one the supervisor
 * holds and a corpus resync are already off it. A reading with a `blindSpot`, in any state, is a set the monitor could
 * not read whole, so it is unreadable rather than seated short or called clear.
 *
 * A repair row's slug is `repair-stopped-recipes-<episode>-<tick id>`. The EPISODE key (`../monitor/evaluateStopped.ts`
 * `repairSetOf`) covers each row's last run, so a set that recovered and stopped again is a new episode under the same
 * card; the tick id makes each ATTEMPT its own row, because a finished row cannot be spawned again. Every row of one episode shares the base, which is how both halves find the rows that already answer it.
 *
 * ## What answers a set at close
 *
 * Any one of: a live seat on a row of the episode (only an `observed` fleet's placements, as
 * `./recipeFailureGate.ts` reads them), a completed `spawned` action onto one, a `hold-rationale` on one, or a
 * `hold-rationale` on `{kind:"recipe"}` for EVERY recipe in the set — the very judgement that keeps a row off the card
 * from the next tick (`../live/automation/supervisorStops.ts`). A partial set of recipe holds answers nothing.
 *
 * Pure — documents in, a verdict out.
 */
import { isRecord } from "#lib/parsers.js";

import { isClosedByOwnerSteerId } from "../monitor/evaluateStopped.js";
import type { StoppedRepairSet } from "../monitor/types.js";
import { type ListReading, namedRowIdsOf, seatedRowIdsOf, spawnedRowsOf } from "./idleCapacityGate.js";

/** The slug prefix every sweep-registered repair row carries, and nothing else on the board does. */
const REPAIR_SLUG_PREFIX = "repair-stopped-recipes-";

/** The two reconciliation lists, between them every unseated ranked row. */
const OPEN_LISTS = ["ready", "held"] as const;

/** The stopped set one `monitor check --only recipe-stopped --json` document carries. */
export type StoppedRecipeSet =
  | { readonly kind: "clear" }
  | { readonly kind: "open"; readonly repair: StoppedRepairSet }
  | { readonly kind: "unreadable"; readonly why: string };

/** The close gate's verdict on one tick. */
export type StoppedRecipeVerdict =
  | { readonly kind: "clean" }
  | { readonly kind: "unreadable"; readonly why: string }
  | {
      readonly kind: "refused";
      readonly repair: StoppedRepairSet;
      /** Every row of the episode a spawn could seat — on the board, or registered by this tick's open. */
      readonly rows: readonly string[];
    };

/**
 * The repair set one value carries, or why it is not one: raw recipe ids, non-empty, sorted and deduplicated, and a
 * non-empty episode key — the exact shape `repairSetOf` writes, so anything else is a document from another build.
 */
function repairSetFrom({ value, where }: { value: unknown; where: string }): ListReading<StoppedRepairSet> {
  if (!isRecord(value)) {
    return { kind: "unreadable", why: `${where} carries no \`repair\` set — re-run it with this checkout` };
  }
  const { episodeKey, recipeIds } = value;
  if (typeof episodeKey !== "string" || episodeKey.length === 0) {
    return { kind: "unreadable", why: `${where}'s repair set carries no episode key` };
  }
  if (!Array.isArray(recipeIds) || !recipeIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
    return { kind: "unreadable", why: `${where}'s repair set is not a list of recipe ids` };
  }
  const canonical = [...new Set(recipeIds)].toSorted();
  if (recipeIds.length === 0 || canonical.join("\n") !== recipeIds.join("\n")) {
    return { kind: "unreadable", why: `${where}'s recipe ids are empty, unsorted or repeated` };
  }
  return { kind: "read", value: { episodeKey, recipeIds } };
}

/** The open set a steered reading still owes a seat — the owner's closed card's — or clear. */
function steeredSetOf({ steers }: { steers: unknown }): StoppedRecipeSet {
  if (!Array.isArray(steers)) {
    return { kind: "unreadable", why: "the steered recipe-stopped reading carries no `steers` list" };
  }
  const closed = steers.filter((steer) => isRecord(steer) && isClosedByOwnerSteerId({ steerId: steer["steerId"] }));
  if (closed.length === 0) {
    return { kind: "clear" };
  }
  if (closed.length > 1) {
    return {
      kind: "unreadable",
      why: "the steered recipe-stopped reading carries two summaries of the owner's closed cards",
    };
  }
  const repair = repairSetFrom({
    value: isRecord(closed[0]) ? closed[0]["repair"] : undefined,
    where: "the owner's closed set",
  });
  if (repair.kind === "unreadable") {
    return repair;
  }
  return { kind: "open", repair: repair.value };
}

/** The open set a firing reading carries: exactly one subject, read whole. */
function firingSetOf({ reading }: { reading: Record<string, unknown> }): StoppedRecipeSet {
  const subjects = reading["subjects"];
  if (!Array.isArray(subjects) || subjects.length !== 1 || !isRecord(subjects[0])) {
    return { kind: "unreadable", why: "the firing recipe-stopped reading does not carry exactly one subject" };
  }
  const repair = repairSetFrom({ value: subjects[0]["repair"], where: "the firing recipe-stopped subject" });
  if (repair.kind === "unreadable") {
    return repair;
  }
  return { kind: "open", repair: repair.value };
}

/**
 * The stopped set one `monitor check --only recipe-stopped --json` document carries: clear, open (firing, or steered
 * only by the owner's own close), or unreadable — never clear on a document it could not read.
 *
 * @param document the parsed `{actions, readings}` envelope
 * @returns the set
 */
export function stoppedSetOf({ document }: { document: unknown }): StoppedRecipeSet {
  const readings = isRecord(document) ? document["readings"] : undefined;
  if (!Array.isArray(readings)) {
    return { kind: "unreadable", why: "the recipe-stopped document carries no `readings` list" };
  }
  const ours = readings.filter((reading) => isRecord(reading) && reading["monitorId"] === "recipe-stopped");
  const [reading] = ours;
  if (ours.length !== 1 || !isRecord(reading)) {
    return { kind: "unreadable", why: `the document carries ${String(ours.length)} recipe-stopped readings, not one` };
  }
  // Whatever the state: a clear or steered verdict over recipes the monitor could not read is not whole either.
  const blindSpot = reading["blindSpot"];
  if (blindSpot !== undefined) {
    const said = typeof blindSpot === "string" ? blindSpot : "a blind spot that is not text";
    return { kind: "unreadable", why: `the monitor could not read every recipe (${said}), so the set is not whole` };
  }
  switch (reading["state"]) {
    case "clear":
      return { kind: "clear" };
    case "steered":
      return steeredSetOf({ steers: reading["steers"] });
    case "firing":
      return firingSetOf({ reading });
    case "unmeasurable":
      return { kind: "unreadable", why: `the monitor was unmeasurable: ${String(reading["because"])}` };
    default:
      return { kind: "unreadable", why: `the recipe-stopped reading's state ${String(reading["state"])} is unknown` };
  }
}

/**
 * The slug every repair row of one stop episode starts with.
 *
 * @param episodeKey the set's episode key
 * @returns the base, which an attempt's slug extends with `-<tick id>`
 */
export function repairSlugBaseOf({ episodeKey }: { episodeKey: string }): string {
  return `${REPAIR_SLUG_PREFIX}${episodeKey}`;
}

/**
 * One repair attempt's slug: the episode's base and the tick that registered it.
 *
 * @param episodeKey the set's episode key
 * @param tickId the registering tick's ledger id, `<handoff>-tick-<n>`
 * @returns the slug
 */
export function repairSlugOf({ episodeKey, tickId }: { episodeKey: string; tickId: string }): string {
  return `${repairSlugBaseOf({ episodeKey })}-${tickId}`;
}

/** Whether a row id is an attempt of this episode. */
function ofEpisode({ id, episodeKey }: { id: string; episodeKey: string }): boolean {
  return id.startsWith(`${repairSlugBaseOf({ episodeKey })}-`);
}

/**
 * The dispatch brief a repair row carries, one instruction per line (`handover register --keep-lines`). Every recipe
 * id is JSON-quoted, so an id with a space or a line break in it is still one unambiguous argument to copy.
 *
 * @param recipeIds the raw ids of the stopped set
 * @param slug the row the brief is registered under
 * @returns the brief
 */
export function repairAsk({ recipeIds, slug }: { recipeIds: readonly string[]; slug: string }): string {
  const plural = recipeIds.length === 1 ? "recipe" : `${String(recipeIds.length)} recipes`;
  return [
    `Repair the stopped ${plural} the supervisor sweep read at tick open, which no seat had and no hold explained.`,
    `First \`slopweaver handover start ${slug}\`, then take each stop, so the owner's floating note becomes the repairing notice:`,
    ...recipeIds.map((id) => `  slopweaver automation repair ${JSON.stringify(id)} --row ${slug}`),
    "Then find why each stopped (`slopweaver automation due --json`, its definition, its slot ledger) and restore it.",
    "Do not finish until each has run since you took it (`slopweaver automation run-due --recipe <id>` runs one now),",
    "or a question for the owner is on their Queue saying exactly what only they can decide. Never a card asking the owner to seat this.",
  ].join("\n");
}

/** Every row id a reconciliation list carries, or unreadable on the first entry with none. */
function rowIdsOf({ reconciliation }: { reconciliation: Record<string, unknown> }): ListReading<readonly string[]> {
  const ids: string[] = [];
  for (const list of OPEN_LISTS) {
    const entries = reconciliation[list];
    if (!Array.isArray(entries)) {
      return { kind: "unreadable", why: `the reconciliation carries no \`${list}\` list` };
    }
    for (const [index, entry] of entries.entries()) {
      const id = isRecord(entry) ? entry["id"] : undefined;
      if (typeof id !== "string") {
        return { kind: "unreadable", why: `the reconciliation's ${list}[${String(index)}] carries no string id` };
      }
      ids.push(id);
    }
  }
  return { kind: "read", value: ids };
}

/** What a reconciliation says about one episode's repair rows. */
export interface EpisodeRows {
  /** Whether cmux was read: when not, a placed row may still have a live seat nobody could see. */
  readonly fleetObserved: boolean;
  /** The rows a LIVE seat is on — an observed fleet's placements only. */
  readonly seated: readonly string[];
  /** The rows still on the ranked board with no seat — `ready` or `held`. */
  readonly unseated: readonly string[];
}

/**
 * One episode's repair rows on the board. Only an `observed` fleet's placements are seats: with cmux unreadable the
 * same lists are open journals, never an agent alive (`./recipeFailureGate.ts` `liveSeatsOf`), so an `unavailable`
 * fleet seats nothing and every placed row is read as unseated.
 *
 * @param reconciliation the `handover reconcile --json` document the tick read
 * @param episodeKey the set's episode key
 * @returns the seated and unseated rows, or why the reconciliation would not read
 */
export function episodeRowsOf({
  reconciliation,
  episodeKey,
}: {
  reconciliation: unknown;
  episodeKey: string;
}): ListReading<EpisodeRows> {
  if (!isRecord(reconciliation)) {
    return { kind: "unreadable", why: "the reconciliation is not a JSON object" };
  }
  const fleet = reconciliation["fleet"];
  if (fleet !== "observed" && fleet !== "unavailable") {
    return { kind: "unreadable", why: "the reconciliation does not say whether its fleet was observed" };
  }
  const placed = seatedRowIdsOf({ reconciliation });
  if (placed.kind === "unreadable") {
    return placed;
  }
  const listed = rowIdsOf({ reconciliation });
  if (listed.kind === "unreadable") {
    return listed;
  }
  const ours = ({ ids }: { ids: Iterable<string> }): string[] =>
    [...new Set(ids)].filter((id) => ofEpisode({ episodeKey, id }));
  const fleetObserved = fleet === "observed";
  const seated = fleetObserved ? ours({ ids: placed.value }) : [];
  const unseated = ours({ ids: [...listed.value, ...placed.value] }).filter((id) => !seated.includes(id));
  return { kind: "read", value: { fleetObserved, seated, unseated } };
}

/** Every recipe id a `hold-rationale` names with subject `{kind:"recipe"}`. */
function heldRecipeIdsOf({ judgements }: { judgements: unknown }): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(judgements)) {
    return ids;
  }
  for (const judgement of judgements) {
    const subject = isRecord(judgement) ? judgement["subject"] : undefined;
    if (!isRecord(judgement) || judgement["kind"] !== "hold-rationale" || !isRecord(subject)) {
      continue;
    }
    const id = subject["id"];
    if (subject["kind"] === "recipe" && typeof id === "string") {
      ids.add(id);
    }
  }
  return ids;
}

/** Every row this tick's open registered, read off its `state-amended` actions. */
function registeredRowsOf({ actions }: { actions: unknown }): readonly string[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions.flatMap((action) => {
    const subject = isRecord(action) ? action["subject"] : undefined;
    const registered =
      isRecord(action) && action["kind"] === "state-amended" && action["outcome"] === "completed" && isRecord(subject);
    const id = isRecord(subject) ? subject["id"] : undefined;
    return registered && subject["kind"] === "handover" && typeof id === "string" ? [id] : [];
  });
}

/**
 * Judge one tick against the stopped set it read: refused while the set is open and no seat, completed spawn or hold
 * answers it; unreadable when the set or the board could not be read whole.
 *
 * @param document the tick's `recipe-stopped` reading, parsed
 * @param actions what the tick did — a completed `spawned` action onto a row of the episode answers it
 * @param judgements what the tick concluded — a `hold-rationale` on a row of the episode, or on every recipe, answers it
 * @param reconciliation the `handover reconcile --json` document this tick read
 * @returns the verdict the close acts on
 */
export function judgeStoppedRecipes({
  document,
  actions,
  judgements,
  reconciliation,
}: {
  document: unknown;
  actions: unknown;
  judgements: unknown;
  reconciliation: unknown;
}): StoppedRecipeVerdict {
  const set = stoppedSetOf({ document });
  if (set.kind !== "open") {
    return set.kind === "clear" ? { kind: "clean" } : set;
  }
  const { repair } = set;
  const { episodeKey } = repair;
  const rows = episodeRowsOf({ episodeKey, reconciliation });
  if (rows.kind === "unreadable") {
    return rows;
  }
  const spawned = [...spawnedRowsOf({ actions }).rowIds].some((id) => ofEpisode({ episodeKey, id }));
  const heldRow = [...namedRowIdsOf({ ceilingId: null, judgements })].some((id) => ofEpisode({ episodeKey, id }));
  const heldRecipes = heldRecipeIdsOf({ judgements });
  const everyRecipeHeld = repair.recipeIds.every((id) => heldRecipes.has(id));
  if (rows.value.seated.length > 0 || spawned || heldRow || everyRecipeHeld) {
    return { kind: "clean" };
  }
  const registered = registeredRowsOf({ actions }).filter((id) => ofEpisode({ episodeKey, id }));
  return { kind: "refused", repair, rows: [...new Set([...rows.value.unseated, ...registered])] };
}
