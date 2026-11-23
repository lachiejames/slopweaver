/**
 * The three stopped-row monitors' conditions — `recipe-stopped`, `corpus-sync-stopped` and `recipe-repairing` —
 * as pure functions over one read of the silent rows and the repairs register.
 *
 * Split from `./evaluate.ts` along the one seam they share: all three judge the same `SilentRow` set and the same
 * `taken` map, and between them every stopped row reaches the owner at most one way. A row
 * a seat has taken is `recipe-repairing`'s, an untaken corpus resync is `corpus-sync-stopped`'s, a row the
 * supervisor holds is the Automations page's, with its reason, and every other stopped row is `recipe-stopped`'s —
 * disjoint filters that together cover the set.
 */

import type { SilentRow } from "../live/automation/silentRows.js";
import { isCorpusResyncId } from "../live/resync/target.js";

import { subjectKey } from "./evaluate.js";
import type { MonitorReading, MonitorSubject, SteeredSummary, StoppedRepairSet } from "./types.js";

/**
 * The digest length of a stopped SET's key. A set's name is every row's id and cadence joined, so two sets
 * share a 20-character stem whenever their first row does, and six hex characters were found colliding by
 * search: `collision-recipe-name-22v` and `collision-recipe-name-7j0` both keyed
 * `collision-recipe-nam-cf06c9`, which would have left a changed set on the old
 * card. Sixteen fits the step id's 60-character budget beside the prefix, stem and occurrence suffix.
 */
const SET_KEY_DIGEST = 16;

/**
 * The key of one stopped set: every row's recipe id and cadence, sorted, duplicates kept.
 *
 * Each row is serialised as a JSON pair, never joined with a separator: a recipe id is any non-empty string,
 * so `a` and `b` stopped together and one recipe named `a 0 0 * * *,b` stopped alone once joined into the
 * same text, and the changed set kept the old card with no note.
 *
 * Not the ids alone. Two definitions may share a recipe id, so a set of ids cannot tell one stopped `dup`
 * from two, nor which of them stopped, and the card would never re-post.
 */
function setKey({ rows }: { rows: readonly SilentRow[] }): string {
  return subjectKey({
    digestLength: SET_KEY_DIGEST,
    name: rows
      .map((row) => JSON.stringify([row.recipeId, row.cadence]))
      .toSorted()
      .join(","),
  });
}

/**
 * The open set as the sweep's repair seat takes it ({@link StoppedRepairSet}): the RAW ids, since `automation repair`
 * is handed the id itself and never the card's quoted form, and the episode key over each row's id, cadence AND last
 * run. The card's own key omits the last run on purpose, so a set that recovered and stopped again re-uses it; the
 * episode key does not, so the chair never matches a fresh stop to a finished repair.
 */
function repairSetOf({ rows }: { rows: readonly SilentRow[] }): StoppedRepairSet {
  return {
    episodeKey: subjectKey({
      digestLength: SET_KEY_DIGEST,
      name: rows
        .map((row) => JSON.stringify([row.recipeId, row.cadence, row.lastRunAtIso]))
        .toSorted()
        .join(","),
    }),
    recipeIds: [...new Set(rows.map((row) => row.recipeId))].toSorted(),
  };
}

/**
 * A recipe id as a card can show it: as written, or JSON-quoted when a card's whitespace collapsing would
 * change it.
 *
 * A recipe id is any non-empty string, and every card field trims and collapses whitespace, so an id of one
 * space left a card naming no recipe at all, and `x.\ny` read exactly as `x. y`. Only an id with no edge whitespace and no whitespace but single spaces survives as written; any other
 * is quoted, so `" "` and `"x.\ny"` stay distinct. An id carrying a `"` is quoted too, or `" "` written
 * literally would read exactly as the quoted one-space id.
 */
function shownRecipeId({ recipeId }: { recipeId: string }): string {
  const survivesCollapse = recipeId.trim() === recipeId && !/[^\S ]| {2}|"/.test(recipeId);
  if (survivesCollapse) {
    return recipeId;
  }
  return JSON.stringify(recipeId);
}

/**
 * `recipe-stopped` — a live standing recipe row has gone quiet past its own threshold.
 *
 * ONE SUBJECT FOR THE WHOLE STOPPED SET, keyed by which rows are in it. MEASURED on this install:
 * `slopweaver monitor check` read 46 stopped rows, so one card per row would have put 46 cards at the top of
 * the owner's queue on the first `--fire` — the flood the one-card-per-set rule bans. A set that changes is a new subject, so
 * a row newly stopping re-posts the card and re-raises the note, and the old card settles as it departs. Two
 * definitions sharing a recipe id land in the one card rather than colliding on one step id. The threshold
 * and the reason are `silentRows`' own (`../live/automation/silentRows.ts`) — this adds no second number and no
 * sixth reason.
 *
 * A row a seat has TAKEN (`../live/automation/repairTake.ts`) is not put to the owner: it moves to
 * `recipe-repairing`'s note. The card asks nothing it used to — no restart, repair or
 * retire choice, since the fix is never the owner's to pick — only that they seat a repair nobody has.
 *
 * A recorded steer (`../live/automation/steers.ts`) takes NO row off it: a steer answers the choice, never the
 * silence, and the card carries no choice to answer. MEASURED: `monitor check` read 29 rows
 * "restarting on a recorded steer" and posted nothing for them — seven corpus resyncs `corpus-sync-stopped`
 * carries, and 22 `resync-atlas-*` rows that reached the owner no way at all, the "silently stop working" outcome
 * this monitor exists to prevent. The corpus resyncs alone stay off this card, because that card is already loud for each of them.
 * Rows kept off are counted in `steers`, and the card is keyed by the OPEN rows alone, so one being taken or
 * recovering re-posts it and no kept-off row does.
 *
 * A row the SUPERVISOR HOLDS is kept off too: a `hold-rationale` or `recipe-held` on it since it last ran
 * (`../live/automation/supervisorStops.ts`) is a decision on record, so "no seat has it" is false of it, and the
 * Automations page already says the hold and its words. A decided hold must not stay at the top of the owner's
 * Queue once ruled on. MEASURED: `bump-drive-acme-admin`, held on the owner's standing word, still counted in the
 * stopped set. A capacity hold reaches the owner as the machine-hold note instead.
 *
 * @param rows every silent live row, worst first, as `silentRows` ordered them
 * @param taken recipe id → the row slug whose seat is repairing it, for every stop a live seat has taken
 * @param closed set key → when the owner closed its card, steered rather than re-posted ({@link closedSteers});
 *   absent for a reader with no card history
 * @returns firing over the rows no seat has, no hold explains and no other card carries, steered when none is left,
 *   or clear
 */
export function evaluateRecipeStopped({
  rows,
  taken,
  closed = new Map(),
}: {
  rows: readonly SilentRow[];
  taken: ReadonlyMap<string, string>;
  closed?: ReadonlyMap<string, string>;
}): MonitorReading {
  if (rows.length === 0) {
    return { monitorId: "recipe-stopped", state: "clear" };
  }
  const untaken = rows.filter((row) => !taken.has(row.recipeId));
  const nonCorpus = untaken.filter((row) => !isCorpusResyncId({ recipeId: row.recipeId }));
  const held = supervisorHeldRows({ rows: nonCorpus });
  const open = nonCorpus.filter((row) => !held.has(row));
  const steers = [
    ...corpusSummaries({ rows: untaken }),
    ...takenSummaries({ rows, taken }),
    ...heldSummaries({ count: held.size }),
  ];
  const [worst] = open;
  if (worst === undefined) {
    return { monitorId: "recipe-stopped", state: "steered", steers };
  }
  const withSteers = steers.length === 0 ? {} : { steers };
  const key = setKey({ rows: open });
  const closedSteer = closedSteers({
    closed,
    key,
    monitorId: "recipe-stopped",
    rows: open,
    since: open.map((row) => row.lastRunAtIso),
  });
  const repair = repairSetOf({ rows: open });
  if (closedSteer.length > 0) {
    // The owner's Done holds the CARD, never the repair: the set is still stopped and still nobody's, so the summary carries
    // it for the sweep to seat.
    const owed = closedSteer.map((summary) => ({ ...summary, repair }));
    return { monitorId: "recipe-stopped", state: "steered", steers: [...steers, ...owed] };
  }
  if (open.length === 1) {
    const subject: MonitorSubject = {
      id: shownRecipeId({ recipeId: worst.recipeId }),
      key,
      label: `${worst.reason}: ${worst.detail}`,
      repair,
    };
    return { monitorId: "recipe-stopped", state: "firing", subjects: [subject], ...withSteers };
  }
  const ids = [...new Set(open.map((row) => shownRecipeId({ recipeId: row.recipeId })))];
  const subject: MonitorSubject = {
    id: `${String(open.length)} recipes, worst ${ids[0]!}`,
    key,
    label: open.map((row) => `${shownRecipeId({ recipeId: row.recipeId })} ${row.reason}`).join("; "),
    repair,
  };
  return { monitorId: "recipe-stopped", state: "firing", subjects: [subject], ...withSteers };
}

/**
 * `corpus-sync-stopped` — a corpus source's scheduled resync has gone quiet past its own threshold.
 *
 * A sync that stops firing is a floating note and
 * top of queue. This is `recipe-stopped` narrowed to the `resync-corpus-*` rows, and it does NOT defer to a
 * recorded steer. MEASURED: all seven corpus resyncs had last succeeded days earlier with 22
 * firings missed each, and `monitor check` read `recipe-stopped STEERED — nothing to ask the owner`. The steer said
 * who seats them; nothing said they were not being seated. A steer answers the choice, never the silence — and
 * `recipe-stopped` now leaves these rows to this card rather than to the steer.
 *
 * One subject for the whole stopped set, keyed by which rows are in it, exactly as `recipe-stopped` is and for
 * the same measured reason. The threshold and the reasons are `silentRows`' own — no second number, no age.
 * The label is built from the row's structured fields alone, never its free-text `detail`: a detail quoting
 * a pull-request citation is refused by the posting form's citation check, and a refused card is no card.
 *
 * A row a seat has TAKEN is left to `recipe-repairing`'s note, exactly as `recipe-stopped` leaves it: a taken
 * row IS being seated, which is the one thing this card says nothing is doing.
 *
 * @param rows every silent live row, worst first, as `silentRows` ordered them — steered or not
 * @param taken recipe id → the row slug whose seat is repairing it
 * @returns firing over the stopped corpus rows no seat has, or clear when none is left
 */
export function evaluateCorpusSyncStopped({
  rows,
  taken,
}: {
  rows: readonly SilentRow[];
  taken: ReadonlyMap<string, string>;
}): MonitorReading {
  const stopped = rows.filter((row) => isCorpusResyncId({ recipeId: row.recipeId }) && !taken.has(row.recipeId));
  const [worst] = stopped;
  if (worst === undefined) {
    return { monitorId: "corpus-sync-stopped", state: "clear" };
  }
  const key = setKey({ rows: stopped });
  if (stopped.length === 1) {
    const subject: MonitorSubject = {
      id: shownRecipeId({ recipeId: worst.recipeId }),
      key,
      label: `${worst.reason} ×${String(worst.missedSlots)}`,
    };
    return { monitorId: "corpus-sync-stopped", state: "firing", subjects: [subject] };
  }
  const subject: MonitorSubject = {
    id: `${String(stopped.length)} corpus sources`,
    key,
    label: stopped
      .map((row) => `${shownRecipeId({ recipeId: row.recipeId })} ${row.reason} ×${String(row.missedSlots)}`)
      .join("; "),
  };
  return { monitorId: "corpus-sync-stopped", state: "firing", subjects: [subject] };
}

/**
 * `recipe-repairing` — a stopped recipe a seat has taken the repair of: the NOTICE the owner is owed.
 *
 * A job that has stopped working but is being fixed reaches the owner as a floating card, never as a queue card
 * or something blocked on them, and never silently stops working. So every stopped row a live seat has taken — steered or not, corpus or not, since a steer answers
 * the choice and a take says who is on it — is named here with its seat, on ONE subject for the set, keyed by
 * every recipe, cadence and seat in it: a new take or a changed seat re-raises the note, and a row whose repair
 * finishes drops out, settling the note as it goes.
 *
 * @param rows every silent live row, worst first, as `silentRows` ordered them
 * @param taken recipe id → the row slug whose seat is repairing it
 * @param closed set key → when the owner closed its note, steered rather than re-raised ({@link closedSteers})
 * @param takenIso recipe id → when its live take was recorded; a take after the owner's close re-opens the set
 * @returns firing over the taken stops, or clear when no stop is taken
 */
export function evaluateRecipeRepairing({
  rows,
  taken,
  closed = new Map(),
  takenIso = new Map(),
}: {
  rows: readonly SilentRow[];
  taken: ReadonlyMap<string, string>;
  closed?: ReadonlyMap<string, string>;
  takenIso?: ReadonlyMap<string, string>;
}): MonitorReading {
  const repairing = rows.filter((row) => taken.has(row.recipeId));
  const recipes = [...new Set(repairing.map((row) => row.recipeId))];
  const [first] = recipes;
  if (first === undefined) {
    return { monitorId: "recipe-repairing", state: "clear" };
  }
  const key = subjectKey({
    digestLength: SET_KEY_DIGEST,
    name: repairing
      .map((row) => JSON.stringify([row.recipeId, row.cadence, taken.get(row.recipeId)]))
      .toSorted()
      .join(","),
  });
  const pairs = recipes.map((recipeId) => `${shownRecipeId({ recipeId })} → seat ${taken.get(recipeId)!}`);
  const closedSteer = closedSteers({
    closed,
    key,
    monitorId: "recipe-repairing",
    rows: repairing,
    since: [
      ...repairing.map((row) => row.lastRunAtIso),
      ...recipes.flatMap((recipeId) => {
        const iso = takenIso.get(recipeId);
        return iso === undefined ? [] : [iso];
      }),
    ],
  });
  if (closedSteer.length > 0) {
    return { monitorId: "recipe-repairing", state: "steered", steers: closedSteer };
  }
  if (recipes.length === 1) {
    const subject: MonitorSubject = {
      id: shownRecipeId({ recipeId: first }),
      key,
      label: pairs.join("; "),
      repairedBy: taken.get(first)!,
    };
    return { monitorId: "recipe-repairing", state: "firing", subjects: [subject] };
  }
  const subject: MonitorSubject = {
    id: `${String(recipes.length)} stopped recipes`,
    key,
    label: pairs.join("; "),
  };
  return { monitorId: "recipe-repairing", state: "firing", subjects: [subject] };
}

/** Why a set the owner closed reads as steered, per monitor that holds one. */
const CLOSED_SET_WHY: Readonly<Record<"recipe-stopped" | "recipe-repairing", string>> = {
  "recipe-repairing": "you closed this note, and none of its recipes has run since",
  "recipe-stopped": "you closed this card, and none of its recipes has run since",
};

/** The summary id a set the owner closed is counted under. */
export const CLOSED_BY_OWNER_SUMMARY_ID = "closed-by-owner" as const;

/**
 * Whether a steer id read off a summary is the closed-set one.
 *
 * @param steerId the id as stored, which may not be a string at all
 * @returns true for exactly {@link CLOSED_BY_OWNER_SUMMARY_ID}
 */
export function isClosedByOwnerSteerId({ steerId }: { steerId: unknown }): boolean {
  return steerId === CLOSED_BY_OWNER_SUMMARY_ID;
}

/**
 * The steer a set the owner already closed reads as, or none.
 *
 * Both monitors fire on every supervisor tick, and the open card is a monitor's only memory, so the owner's Done on
 * a set that has not changed would come straight back as its next occurrence on the next tick, and again after each
 * Done. So a set whose key the owner closed reads STEERED until one of its rows runs after the
 * close — a run means the stop they saw ended and this is a new one — and a set they closed that comes back after a
 * row joined and left reads steered again, since nothing in it changed. Steered rather than a firing subject held
 * back, so the pass settles any other open card of the monitor: a held arrival settles no departure, which kept a
 * now-false card for a larger set open. Only the owner's close counts; the pass's own settles do not
 * (`./heldKeys.ts` § `closedByOwner`). For `recipe-repairing` a take recorded after the owner's close re-opens it as a
 * run does: a seat taking the repair again is a new repair the owner has not seen.
 *
 * @param monitorId which monitor's wording to steer with
 * @param key the set's key
 * @param rows the set's rows
 * @param closed key → the instant the owner closed it
 * @param since each instant that counts as the set moving — a row's last run, a take — null where there is none
 * @returns one summary, or none
 */
function closedSteers({
  monitorId,
  key,
  rows,
  closed,
  since,
}: {
  monitorId: "recipe-stopped" | "recipe-repairing";
  key: string;
  rows: readonly SilentRow[];
  closed: ReadonlyMap<string, string>;
  since: readonly (string | null)[];
}): readonly SteeredSummary[] {
  const closedIso = closed.get(key);
  if (closedIso === undefined) {
    return [];
  }
  const closedMs = Date.parse(closedIso);
  if (Number.isNaN(closedMs)) {
    return [];
  }
  // An instant AT the owner's close, or one that will not read, cannot be ordered before it: an ambiguous order falls loud.
  const movedSince = since.some((iso) => {
    if (iso === null) {
      return false;
    }
    const ms = Date.parse(iso);
    return Number.isNaN(ms) || ms >= closedMs;
  });
  if (movedSince) {
    return [];
  }
  return [{ count: rows.length, instead: CLOSED_SET_WHY[monitorId], steerId: CLOSED_BY_OWNER_SUMMARY_ID }];
}

/** The summary id rows a seat has taken are counted under beside the recorded steers. */
export const REPAIR_TAKEN_SUMMARY_ID = "repair-taken";

/**
 * How many stopped rows a live seat has taken, as one summary beside the steers, or none when no row is taken.
 *
 * @param rows every silent row
 * @param taken recipe id → the row slug repairing it
 * @returns zero or one summary
 */
function takenSummaries({
  rows,
  taken,
}: {
  rows: readonly SilentRow[];
  taken: ReadonlyMap<string, string>;
}): readonly SteeredSummary[] {
  const count = rows.filter((row) => taken.has(row.recipeId)).length;
  if (count === 0) {
    return [];
  }
  return [
    { count, instead: "a seat is repairing it, named on the recipe-repairing note", steerId: REPAIR_TAKEN_SUMMARY_ID },
  ];
}

/** The summary id the stopped rows the supervisor holds, with its reason on record, are counted under. */
export const SUPERVISOR_HELD_SUMMARY_ID = "supervisor-held";

/**
 * The stopped rows a supervisor hold keeps off `recipe-stopped`: held since they last ran, and alone under their
 * recipe id.
 *
 * The tick ledger names a hold by recipe id only, and `explainSilentRows` gives every row under one id the same
 * answer, so a hold recorded inside one definition's window would also read as held on a sibling definition that
 * ran after it. A row sharing its id is therefore kept on the card: the side that cannot
 * be told falls loud, never silent.
 *
 * @param rows the untaken, non-corpus stopped rows
 * @returns the rows held
 */
function supervisorHeldRows({ rows }: { rows: readonly SilentRow[] }): ReadonlySet<SilentRow> {
  const alone = (row: SilentRow): boolean => rows.filter((other) => other.recipeId === row.recipeId).length === 1;
  return new Set(rows.filter((row) => row.supervisorStop?.kind === "held" && alone(row)));
}

/**
 * The stopped rows the supervisor holds, as one summary beside the steers, or none.
 *
 * @param count how many {@link supervisorHeldRows} kept off the card
 * @returns zero or one summary
 */
function heldSummaries({ count }: { count: number }): readonly SteeredSummary[] {
  if (count === 0) {
    return [];
  }
  return [
    {
      count,
      instead: "the supervisor holds it, its reason on the Automations page",
      steerId: SUPERVISOR_HELD_SUMMARY_ID,
    },
  ];
}

/** The summary id the corpus resyncs `recipe-stopped` leaves to `corpus-sync-stopped` are counted under. */
export const CORPUS_CARD_SUMMARY_ID = "corpus-sync-stopped";

/**
 * How many untaken stopped rows are corpus resyncs, left to `corpus-sync-stopped`'s own loud card, as one summary.
 *
 * A count rather than the ids: a line of recipe ids is the wall of text rule 7 bans, and that card names them.
 *
 * @param rows the untaken silent rows
 * @returns zero or one summary
 */
function corpusSummaries({ rows }: { rows: readonly SilentRow[] }): readonly SteeredSummary[] {
  const count = rows.filter((row) => isCorpusResyncId({ recipeId: row.recipeId })).length;
  if (count === 0) {
    return [];
  }
  return [{ count, instead: "each is on the corpus-sync-stopped card", steerId: CORPUS_CARD_SUMMARY_ID }];
}
