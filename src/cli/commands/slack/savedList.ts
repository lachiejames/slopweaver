/**
 * The wire half of `slopweaver slack saved`: the shape of `saved.list`'s answer, one raw row as a pointer, and
 * how several answers on one load reconcile into one list — or say why they cannot.
 *
 * Split from `./savedCore.ts`, which decides what a whole CAPTURE amounts to; this file only ever sees answers
 * that were kept. Pure: no fs, no clock, no network.
 */
import { z } from "zod";

import { epochSecondsToIso } from "#lib/date.js";
import { slackPermalink } from "../../../corpus/slack/curated.js";
import { defineBoundary } from "../../../lib/boundary.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { isSlackTs } from "../../../lib/slackTs.js";

/** The one path a kept response may have. Anything else the page fetched is ignored. */
export const SAVED_LIST_PATH = "/api/saved.list";

/** A Slack conversation id: a channel, a private channel or a DM. */
const CONVERSATION_ID = /^[CDG][A-Z0-9]{8,}$/;

/** The list's own counts, exactly as the client was told them. */
export interface SlackSavedCounts {
  readonly total: number;
  readonly uncompleted: number;
  readonly uncompletedOverdue: number;
  readonly completed: number;
  readonly archived: number;
}

/** One saved item, as a pointer: where it is and what state the list holds it in. */
export interface SlackSavedItem {
  readonly itemType: string;
  /** The conversation the item lives in — the list's own `item_id`. */
  readonly channel: string;
  readonly ts: string;
  /** The message link, or `null` when the item's pointer is not a message this verb can link. */
  readonly permalink: string | null;
  /** Why there is no permalink, or `null` when there is one. */
  readonly unlinkableBecause: string | null;
  readonly state: string;
  readonly todoState: string;
  readonly isArchived: boolean;
  readonly savedAtIso: string | null;
  readonly dueAtIso: string | null;
  readonly completedAtIso: string | null;
  readonly snoozedUntilIso: string | null;
}

/**
 * `saved.list`'s answer. The key set is the atlas's (`atlas/slackApi/browser.ts`); every type is the one the
 * live read returned. Strict at every level, so a field Slack adds or renames is refused by name.
 */
const SAVED_ITEM = z.strictObject({
  date_completed: z.number(),
  date_created: z.number(),
  date_due: z.number(),
  date_snoozed_until: z.number(),
  date_updated: z.number(),
  is_archived: z.boolean(),
  item_id: z.string(),
  item_type: z.string(),
  state: z.string(),
  todo_state: z.string(),
  ts: z.string(),
});

/** The `ok: true` arm of `saved.list`'s answer. */
const SAVED_LIST_OK = z.strictObject({
  counts: z.strictObject({
    archived_count: z.number(),
    completed_count: z.number(),
    total_count: z.number(),
    uncompleted_count: z.number(),
    uncompleted_overdue_count: z.number(),
  }),
  ok: z.literal(true),
  response_metadata: z.strictObject({ next_cursor: z.string() }),
  saved_items: z.array(SAVED_ITEM),
});

/** One raw saved item. */
type SavedItemRaw = z.infer<typeof SAVED_ITEM>;

/** One parsed `saved.list` answer that said `ok`. */
type SavedListOk = z.infer<typeof SAVED_LIST_OK>;

/** The boundary every kept `saved.list` body is parsed through: either arm, strictly. */
const SAVED_LIST = defineBoundary({
  endpoint: "POST /api/saved.list (web client, internal)",
  schema: z.discriminatedUnion("ok", [SAVED_LIST_OK, z.strictObject({ error: z.string(), ok: z.literal(false) })]),
});

/** Why the kept `saved.list` answers cannot be read as one list. `code` is what a caller branches on. */
export interface SavedListError {
  readonly code:
    | "BODY_INVALID"
    | "ANSWERED_NOT_OK"
    | "COUNTS_DISAGREE"
    | "ITEM_DISAGREES"
    | "REPEATED_IN_ONE_ANSWER"
    | "ROWS_ABOVE_TOTAL";
  readonly message: string;
}

/** Builds every {@link SavedListError}, so each message is authored once. */
export const SavedListErrors = {
  answeredNotOk: ({ error }: { error: string }): SavedListError => ({
    code: "ANSWERED_NOT_OK",
    message: `saved.list answered ok:false — ${error}`,
  }),
  bodyInvalid: ({ message }: { message: string }): SavedListError => ({ code: "BODY_INVALID", message }),
  countsDisagree: (): SavedListError => ({
    code: "COUNTS_DISAGREE",
    message: "two saved.list calls on one load disagree about the list's counts",
  }),
  itemDisagrees: ({ key }: { key: string }): SavedListError => ({
    code: "ITEM_DISAGREES",
    message: `two saved.list calls on one load disagree about item ${key}`,
  }),
  repeatedInOneAnswer: ({ repeats }: { repeats: readonly string[] }): SavedListError => ({
    code: "REPEATED_IN_ONE_ANSWER",
    message: repeats.join("; "),
  }),
  rowsAboveTotal: ({ rows, total }: { rows: number; total: number }): SavedListError => ({
    code: "ROWS_ABOVE_TOTAL",
    message:
      `saved.list returned ${String(rows)} distinct item(s) but counts only ${String(total)} — ` +
      "its counts cannot describe these rows",
  }),
} as const;

/**
 * Parse every kept `saved.list` body, stopping at the first that is not a readable `ok` answer.
 *
 * @param bodies the kept bodies, in capture order
 * @returns every `ok` answer, or why one could not be read
 */
export function parseSavedListBodies({
  bodies,
}: {
  bodies: readonly unknown[];
}): Result<readonly SavedListOk[], SavedListError> {
  const parsed: SavedListOk[] = [];
  for (const body of bodies) {
    const one = SAVED_LIST.parse({ value: body });
    if (one.isErr()) {
      return err(SavedListErrors.bodyInvalid({ message: one.error.message }));
    }
    if (!one.value.ok) {
      return err(SavedListErrors.answeredNotOk({ error: one.value.error }));
    }
    parsed.push(one.value);
  }
  return ok(parsed);
}

/**
 * An epoch-seconds field as an instant, with `0` read as "never set" — which is how the list leaves a date it has
 * no value for.
 *
 * @param seconds the raw field
 * @returns the ISO instant, or `null` for an unset one
 */
function instantOf({ seconds }: { seconds: number }): string | null {
  if (seconds === 0) {
    return null;
  }
  const iso = epochSecondsToIso({ seconds });
  if (iso === undefined) {
    return null;
  }
  return iso;
}

/**
 * Shape one raw saved item into a pointer, refusing to build a link the pointer cannot honestly back.
 *
 * @param raw one `saved_items[]` entry
 * @param workspaceUrl the workspace's base URL, which every permalink hangs off
 * @returns the shaped item
 */
export function itemOf({ raw, workspaceUrl }: { raw: SavedItemRaw; workspaceUrl: string }): SlackSavedItem {
  let unlinkableBecause: string | null = null;
  if (raw.item_type !== "message") {
    unlinkableBecause = `item type "${raw.item_type}" is not a message, so no message link is built for it`;
  } else if (!CONVERSATION_ID.test(raw.item_id)) {
    unlinkableBecause = `item_id "${raw.item_id}" is not a conversation id`;
  } else if (!isSlackTs({ ts: raw.ts })) {
    unlinkableBecause = `ts "${raw.ts}" is not a Slack message timestamp`;
  }
  return {
    channel: raw.item_id,
    completedAtIso: instantOf({ seconds: raw.date_completed }),
    dueAtIso: instantOf({ seconds: raw.date_due }),
    isArchived: raw.is_archived,
    itemType: raw.item_type,
    permalink: unlinkableBecause === null ? slackPermalink({ channelId: raw.item_id, ts: raw.ts, workspaceUrl }) : null,
    savedAtIso: instantOf({ seconds: raw.date_created }),
    snoozedUntilIso: instantOf({ seconds: raw.date_snoozed_until }),
    state: raw.state,
    todoState: raw.todo_state,
    ts: raw.ts,
    unlinkableBecause,
  };
}

/**
 * Each per-state count beside the rows this load holds in that state.
 *
 * @param counts what saved.list says the whole list holds
 * @param items the rows this load holds
 * @param observedAt when the page was read, so an open row due before it is one Slack calls overdue
 * @returns one tally per state, in a fixed order
 */
function stateTallies({
  counts,
  items,
  observedAt,
}: {
  counts: SlackSavedCounts;
  items: readonly SlackSavedItem[];
  observedAt: string;
}): readonly { label: string; counted: number; held: number }[] {
  const now = Date.parse(observedAt);
  const isOverdue = (item: SlackSavedItem): boolean =>
    item.todoState === "uncompleted" && item.dueAtIso !== null && Date.parse(item.dueAtIso) < now;
  const states: readonly { label: string; counted: number; holds: (item: SlackSavedItem) => boolean }[] = [
    { counted: counts.uncompleted, holds: (item) => item.todoState === "uncompleted", label: "uncompleted" },
    { counted: counts.uncompletedOverdue, holds: isOverdue, label: "overdue" },
    { counted: counts.completed, holds: (item) => item.todoState === "completed", label: "completed" },
    { counted: counts.archived, holds: (item) => item.isArchived, label: "archived" },
  ];
  return states.map(({ counted, holds, label }) => ({ counted, held: items.filter(holds).length, label }));
}

/**
 * Whether any count says the list holds more than this load does — its total, or any one state's count — so a
 * read is a first load of a longer list even when the total alone claims every row is here.
 *
 * @param counts what saved.list says the whole list holds
 * @param items the rows this load holds
 * @param observedAt when the page was read
 * @returns true when some count exceeds the rows it describes
 */
export function countsExceedRows({
  counts,
  items,
  observedAt,
}: {
  counts: SlackSavedCounts;
  items: readonly SlackSavedItem[];
  observedAt: string;
}): boolean {
  if (counts.total > items.length) {
    return true;
  }
  return stateTallies({ counts, items, observedAt }).some(({ counted, held }) => counted > held);
}

/**
 * Name every todo state whose count disagrees with the rows this load holds in that state.
 *
 * A notice rather than a refusal: how Slack's per-state counts relate to one another is not measured, so a
 * disagreement is stated beside the list, never used to discard it. A count BELOW its rows is always named. A
 * count ABOVE its rows is named only while the total claims every row is here — past that the GAP line already
 * says the rest is unread. A `todo_state` other than the two the live read returned is named too.
 *
 * @param counts what saved.list says the whole list holds
 * @param items the rows this load holds
 * @param observedAt when the page was read, so an open row due before it is one Slack calls overdue
 * @returns one line per state whose count cannot describe its rows, empty when every count can
 */
export function countsAgainstRows({
  counts,
  items,
  observedAt,
}: {
  counts: SlackSavedCounts;
  items: readonly SlackSavedItem[];
  observedAt: string;
}): string[] {
  const notes: string[] = [];
  const unknown = [...new Set(items.map((item) => item.todoState))].filter(
    (todoState) => todoState !== "uncompleted" && todoState !== "completed",
  );
  if (unknown.length > 0) {
    notes.push(
      `saved.list returned todo_state ${unknown.map((todoState) => `"${todoState}"`).join(", ")}, which this verb ` +
        "does not know — those rows were checked against no open or completed count",
    );
  }
  const totalCoversRows = counts.total <= items.length;
  for (const { counted, held, label } of stateTallies({ counts, items, observedAt })) {
    const tally = `saved.list counts ${String(counted)} ${label} item(s) but this load holds ${String(held)}`;
    if (held > counted) {
      notes.push(`${tally} — its counts do not describe these rows`);
    }
    if (held < counted && totalCoversRows) {
      notes.push(`${tally} while its total says every row is here — a row is unread, or its counts contradict`);
    }
  }
  return notes;
}

/** The identity of one saved row: its conversation and its timestamp. */
function keyOf({ raw }: { raw: SavedItemRaw }): string {
  return `${raw.item_id}/${raw.ts}`;
}

/**
 * Every row one answer returns more than once, named with how many times.
 *
 * A repeat ACROSS calls is the client asking twice; a repeat inside ONE answer is a list that does not describe
 * itself, and merging it would hide a count below the rows returned.
 *
 * @param one one `ok` answer
 * @returns one line per repeated row, empty when none repeats
 */
function repeatsInOneAnswer({ one }: { one: SavedListOk }): string[] {
  const times = new Map<string, number>();
  for (const raw of one.saved_items) {
    const key = keyOf({ raw });
    const prior = times.get(key);
    times.set(key, prior === undefined ? 1 : prior + 1);
  }
  return [...times]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `saved.list returned item ${key} ${String(count)} times in one answer`);
}

/**
 * Merge every answer's rows by identity, refusing a repeat inside one answer or two answers that disagree.
 *
 * @param parsed every `ok` answer the page received
 * @returns each distinct row once, or why the answers cannot be merged
 */
function mergeCalls({ parsed }: { parsed: readonly SavedListOk[] }): Result<Map<string, SavedItemRaw>, SavedListError> {
  const seen = new Map<string, SavedItemRaw>();
  for (const one of parsed) {
    const repeats = repeatsInOneAnswer({ one });
    if (repeats.length > 0) {
      return err(SavedListErrors.repeatedInOneAnswer({ repeats }));
    }
    for (const raw of one.saved_items) {
      const key = keyOf({ raw });
      const prior = seen.get(key);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(raw)) {
        return err(SavedListErrors.itemDisagrees({ key }));
      }
      seen.set(key, raw);
    }
  }
  return ok(seen);
}

/**
 * Merge every kept call into one list: duplicates by `item_id` + `ts` must agree exactly, and so must counts.
 *
 * @param parsed every `ok` answer the page received
 * @returns the unique raw items, the agreed counts, whether any call offered a next page and how many rows each
 *   call held, or why the calls disagree
 */
export function reconcile({ parsed }: { parsed: readonly SavedListOk[] }): Result<
  {
    counts: SlackSavedCounts;
    nextCursorPresent: boolean;
    raws: readonly SavedItemRaw[];
    rowsPerCall: readonly number[];
  },
  SavedListError
> {
  const first = parsed[0]!;
  const countsKey = JSON.stringify(first.counts);
  if (parsed.some((one) => JSON.stringify(one.counts) !== countsKey)) {
    return err(SavedListErrors.countsDisagree());
  }
  const merged = mergeCalls({ parsed });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const seen = merged.value;
  if (seen.size > first.counts.total_count) {
    return err(SavedListErrors.rowsAboveTotal({ rows: seen.size, total: first.counts.total_count }));
  }
  return ok({
    counts: {
      archived: first.counts.archived_count,
      completed: first.counts.completed_count,
      total: first.counts.total_count,
      uncompleted: first.counts.uncompleted_count,
      uncompletedOverdue: first.counts.uncompleted_overdue_count,
    },
    nextCursorPresent: parsed.some((one) => one.response_metadata.next_cursor !== ""),
    raws: [...seen.values()],
    rowsPerCall: parsed.map((one) => one.saved_items.length),
  });
}
