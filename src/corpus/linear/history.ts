/**
 * Linear's two activity streams: the pure projection from raw GraphQL nodes into {@link HistoryEventRow}s for
 * the sibling history store, plus the BOUNDED per-issue summary that is the only part retrieval ever sees.
 *
 * ## Why a summary at all, if the events are stored
 *
 * The store is deliberately unreachable from the ranker (see {@link ../history/types}), which would otherwise
 * let a one-line event outrank the issue it belongs to. But "unreachable" and "unanswerable" are different
 * things: without a summary the corpus would hold every state change and still be unable to answer "when did
 * this stall?" — the events would exist and nothing would ever retrieve them.
 *
 * So the issue's own record carries a compact prose digest of its recent history in its searchable `text`.
 * `text`, specifically, and not `attrs`: `retrievalIndex.ts` indexes title, text and refs, so anything in
 * `attrs` is invisible to a query no matter how well-structured it is.
 *
 * One BRONZE document, correctly ranked, that mentions its own history — and the qualifier is load-bearing.
 * A distilled gold section can still surface a digest line as an independently rankable record; see
 * {@link ../history/types} for why that is pre-existing, out of scope, and recorded rather than fixed.
 *
 * ## The bound, and what it costs
 *
 * At most {@link SUMMARY_EVENT_LIMIT} events, at most {@link SUMMARY_CLAUSE_LIMIT} clauses each, hard-capped
 * at {@link SUMMARY_CHAR_CAP} characters. The measured distribution makes that a generous bound rather than a
 * tight one: mean 8.98 events per issue, median 7, p95 20. The events kept are the MOST RECENT, because "what
 * happened to this lately" is the question a summary can answer, but they are RENDERED oldest-first so the
 * digest reads as a sequence. And the summary is appended AFTER the authored description, so when a very long
 * issue does hit a limit it is the derived digest that clips, never what a human wrote.
 */
import { isRecord } from "../../lib/parsers.js";
import { stripNulls } from "../history/store.js";
import type { HistoryEventRow } from "../history/types.js";
import { optStr as str } from "../slack/shape.js";

/** At most this many events reach an issue's summary (measured p95 event depth is 20). */
export const SUMMARY_EVENT_LIMIT = 12;
/** At most this many change clauses per event, so one bulk edit cannot crowd out every other event. */
export const SUMMARY_CLAUSE_LIMIT = 3;
/** Hard character cap on the whole digest. Appended after the description, so only the digest clips. */
export const SUMMARY_CHAR_CAP = 3500;

/**
 * A timestamp field, or an HONEST empty sentinel when the source did not send one.
 *
 * Not a coalesce: the house rule bans `?? ""` because it hides a missing value behind a plausible one. Here the
 * empty string is the recorded fact — "this event carried no timestamp" — and the store's canonical sort puts
 * such an event first rather than pretending it happened now.
 */
function tsOf({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}

/** `displayName` off a nested user-like object. */
function actorName({ value }: { value: unknown }): string | undefined {
  return isRecord(value) ? str({ value: value["displayName"] }) : undefined;
}

/**
 * Project one raw `IssueHistory` node into an event row, or `undefined` when it has no usable identity.
 *
 * The payload is null-stripped and key-sorted here, at the parse edge, which is where the 3.5× size reduction
 * comes from: Linear returns an explicit `null` for every one of the ~80 `from*`/`to*` fields an event did not
 * touch, and 71.2% of the measured raw bytes were those nulls. Pure.
 *
 * @param node the raw history node
 * @param subjectId the issue identifier the event belongs to
 * @param container the issue's container (`linear/<TEAM>`)
 * @returns the event row, or `undefined`
 */
export function parseHistoryEvent({
  node,
  subjectId,
  container,
}: {
  node: unknown;
  subjectId: string;
  container: string;
}): HistoryEventRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const eventId = str({ value: node["id"] });
  if (eventId === undefined) {
    return undefined;
  }
  const actor = eventActor({ node });
  const changes = stripNulls({ value: withoutIdentity({ node }) });
  return {
    changes: isRecord(changes) ? changes : {},
    container,
    eventId,
    source: "linear",
    stream: "history",
    subjectId,
    // Ordering is our own concern: Linear returns descending `createdAt` and its `orderBy` direction is not
    // selectable, so arrival order is incidental and the store sorts by this value rather than trusting it.
    tsIso: tsOf({ value: node["createdAt"] }),
    version: 1,
    ...(actor !== undefined ? { actor } : {}),
  };
}

/** An integration's name off a `botActor`, so a bot-driven change has an author rather than none. */
function botName({ value }: { value: unknown }): string | undefined {
  return isRecord(value) ? str({ value: value["name"] }) : undefined;
}

/**
 * Who made one change. Linear names a person in `actor` and leaves it empty "in the case of integrations or
 * automations", naming that bot in `botActor` instead, so the person is read first and the bot only when no
 * person is named. `undefined` when the event names neither.
 */
function eventActor({ node }: { node: Record<string, unknown> }): string | undefined {
  const person = actorName({ value: node["actor"] });
  if (person !== undefined) {
    return person;
  }
  return botName({ value: node["botActor"] });
}

/** The payload minus the fields already promoted to typed row columns, so nothing is stored twice. */
function withoutIdentity({ node }: { node: Record<string, unknown> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "id" || key === "createdAt" || key === "actor" || key === "botActor") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Project one raw `IssueStateSpan` node into an event row, or `undefined` without an id.
 *
 * A span is keyed by `startedAt` — it has no `createdAt` at all — and carries NO actor by construction, which
 * is why it is additive to `history` rather than a replacement for it: it can say how long an issue sat in a
 * state, never who moved it there. Pure.
 *
 * @param node the raw span node
 * @param subjectId the issue identifier
 * @param container the issue's container
 * @returns the event row, or `undefined`
 */
export function parseStateSpan({
  node,
  subjectId,
  container,
}: {
  node: unknown;
  subjectId: string;
  container: string;
}): HistoryEventRow | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  const eventId = str({ value: node["id"] });
  if (eventId === undefined) {
    return undefined;
  }
  const changes = stripNulls({
    value: { endedAt: node["endedAt"], state: node["state"], stateId: node["stateId"] },
  });
  return {
    changes: isRecord(changes) ? changes : {},
    container,
    eventId,
    source: "linear",
    stream: "state",
    subjectId,
    tsIso: tsOf({ value: node["startedAt"] }),
    version: 1,
  };
}

/**
 * Every event row for one issue, from both streams.
 *
 * @param historyNodes the complete `history` node list
 * @param stateNodes the complete `stateHistory` node list
 * @param subjectId the issue identifier
 * @param container the issue's container
 * @returns the event rows (unsorted — the store owns canonical order)
 */
export function issueHistoryRows({
  historyNodes,
  stateNodes,
  subjectId,
  container,
}: {
  historyNodes: readonly unknown[];
  stateNodes: readonly unknown[];
  subjectId: string;
  container: string;
}): readonly HistoryEventRow[] {
  const events = historyNodes
    .map((node) => parseHistoryEvent({ container, node, subjectId }))
    .filter((row): row is HistoryEventRow => row !== undefined);
  const spans = stateNodes
    .map((node) => parseStateSpan({ container, node, subjectId }))
    .filter((row): row is HistoryEventRow => row !== undefined);
  return [...events, ...spans];
}

/** A transition whose from/to values are worth PRINTING — a readable name or a short scalar. */
const NAMED_TRANSITIONS: readonly { readonly from: string; readonly to: string; readonly label: string }[] = [
  { from: "fromState", label: "state", to: "toState" },
  { from: "fromAssignee", label: "assignee", to: "toAssignee" },
  { from: "fromPriority", label: "priority", to: "toPriority" },
  { from: "fromEstimate", label: "estimate", to: "toEstimate" },
  { from: "fromDueDate", label: "due", to: "toDueDate" },
];

/**
 * A transition captured only as an ID pair.
 *
 * These print as "<thing> changed" rather than as a UUID arrow, and that is the honest rendering: the query
 * asks for `fromCycleId`/`toCycleId` rather than the cycle OBJECTS because resolving twenty-two nested objects
 * per event is what breached the per-query complexity ceiling. The ids ARE in the stored event, so a reader can
 * resolve them against the corpus's own cycles, projects and teams; a digest line just has nothing readable to
 * show inline.
 */
const ID_TRANSITIONS: readonly { readonly from: string; readonly to: string; readonly label: string }[] = [
  { from: "fromCycleId", label: "cycle", to: "toCycleId" },
  { from: "fromProjectId", label: "project", to: "toProjectId" },
  { from: "fromParentId", label: "parent", to: "toParentId" },
  { from: "fromTeamId", label: "team", to: "toTeamId" },
];

/** The boolean flags whose mere presence is the event, with the word to print for each. */
const FLAGS: readonly { readonly key: string; readonly word: string }[] = [
  { key: "archived", word: "archived" },
  { key: "trashed", word: "trashed" },
  { key: "autoArchived", word: "auto-archived" },
  { key: "autoClosed", word: "auto-closed" },
  { key: "updatedDescription", word: "description edited" },
];

/**
 * The field that names a transition's object, one per shape Linear sends, in the order they are tried.
 *
 * Linear's `from*`/`to*` object fields differ in shape by field — `{ displayName }` for a user, `{ name }` for a
 * state, `{ identifier }` for an issue — so each is tried in turn. `displayName` comes FIRST because a `User`
 * has both, and putting `name` first rendered every assignee transition as a bare dash.
 */
const TRANSITION_NAME_KEYS = ["displayName", "name", "identifier", "key", "title"] as const;

/**
 * A human-readable rendering of any transition value, or `—` for one that names nothing: absent, or an object
 * carrying none of {@link TRANSITION_NAME_KEYS}. Pure.
 */
function display({ value }: { value: unknown }): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!isRecord(value)) {
    return "—";
  }
  for (const key of TRANSITION_NAME_KEYS) {
    const named = str({ value: value[key] });
    if (named !== undefined) {
      return named;
    }
  }
  return "—";
}

/** The `+N label(s)` / `-N label(s)` clauses for one event, from the id lists. Pure. */
function labelClauses({ changes }: { changes: Readonly<Record<string, unknown>> }): readonly string[] {
  const clauses: string[] = [];
  for (const [key, sign] of [
    ["addedLabelIds", "+"],
    ["removedLabelIds", "-"],
  ] as const) {
    const list = changes[key];
    if (!Array.isArray(list) || list.length === 0) {
      continue;
    }
    clauses.push(`${sign}${String(list.length)} label(s)`);
  }
  return clauses;
}

/** The named from→to clauses. Pure. */
function namedClauses({ changes }: { changes: Readonly<Record<string, unknown>> }): readonly string[] {
  const clauses: string[] = [];
  for (const transition of NAMED_TRANSITIONS) {
    if (changes[transition.from] === undefined && changes[transition.to] === undefined) {
      continue;
    }
    clauses.push(
      `${transition.label} ${display({ value: changes[transition.from] })}→${display({ value: changes[transition.to] })}`,
    );
  }
  return clauses;
}

/** The `<thing> changed` clauses for id-only transitions, plus the long-text ones. Pure. */
function changedClauses({ changes }: { changes: Readonly<Record<string, unknown>> }): readonly string[] {
  const clauses: string[] = [];
  for (const transition of ID_TRANSITIONS) {
    if (changes[transition.from] !== undefined || changes[transition.to] !== undefined) {
      clauses.push(`${transition.label} changed`);
    }
  }
  // The title is captured verbatim but printed as a FACT: a renamed issue would otherwise put two full titles
  // into a digest that has eleven other events to fit.
  if (changes["fromTitle"] !== undefined || changes["toTitle"] !== undefined) {
    clauses.push("title changed");
  }
  if (changes["attachmentId"] !== undefined) {
    clauses.push("attachment changed");
  }
  return clauses;
}

/**
 * Every change clause one event describes, before the per-event cap is applied. Pure.
 *
 * @param changes the event's null-stripped payload
 * @returns the clauses, in a stable order
 */
export function eventClauses({ changes }: { changes: Readonly<Record<string, unknown>> }): readonly string[] {
  return [
    ...namedClauses({ changes }),
    ...labelClauses({ changes }),
    ...changedClauses({ changes }),
    ...FLAGS.filter((flag) => changes[flag.key] === true).map((flag) => flag.word),
  ];
}

/** The date part of an ISO timestamp — the digest needs the day, not the millisecond. Pure. */
function isoDay({ tsIso }: { tsIso: string }): string {
  const separator = tsIso.indexOf("T");
  return separator > 0 ? tsIso.slice(0, separator) : tsIso;
}

/**
 * One event as a digest line, or `undefined` when it describes no change worth naming. Pure.
 *
 * @param row the event row
 * @returns the line, or `undefined`
 */
export function summaryLine({ row }: { row: HistoryEventRow }): string | undefined {
  if (row.stream === "state") {
    const state = display({ value: row.changes["state"] });
    return state === "—" ? undefined : `${isoDay({ tsIso: row.tsIso })} in ${state}`;
  }
  const clauses = eventClauses({ changes: row.changes });
  if (clauses.length === 0) {
    return undefined;
  }
  const shown = clauses.slice(0, SUMMARY_CLAUSE_LIMIT);
  const elided =
    clauses.length > SUMMARY_CLAUSE_LIMIT ? ` (+${String(clauses.length - SUMMARY_CLAUSE_LIMIT)} more)` : "";
  return `${isoDay({ tsIso: row.tsIso })} ${actorLabel({ row })}: ${shown.join(" · ")}${elided}`;
}

/**
 * Who a digest line says made the change. A history event Linear attributed to neither a person nor a bot
 * carries no `actor` (see {@link parseHistoryEvent}), and the line then says "someone" rather than naming
 * nobody. Pure.
 */
function actorLabel({ row }: { row: HistoryEventRow }): string {
  const { actor } = row;
  if (actor === undefined) {
    return "someone";
  }
  return actor;
}

/**
 * The bounded history digest folded into an issue's searchable `text`, or `""` when there is nothing to say.
 *
 * Takes the MOST RECENT {@link SUMMARY_EVENT_LIMIT} events but renders them oldest-first, so the digest reads
 * as a sequence while still being about what happened lately. Only the `history` stream is rendered: a state
 * SPAN says nothing a state TRANSITION has not already said, and including both would double every line.
 *
 * @param rows this issue's event rows (any order)
 * @returns the digest block, or `""`
 */
export function issueHistoryDigest({ rows }: { rows: readonly HistoryEventRow[] }): string {
  const ordered = rows
    .filter((row) => row.stream === "history")
    .toSorted((left, right) => left.tsIso.localeCompare(right.tsIso));
  const recent = ordered.slice(Math.max(0, ordered.length - SUMMARY_EVENT_LIMIT));
  const lines = recent.map((row) => summaryLine({ row })).filter((line): line is string => line !== undefined);
  if (lines.length === 0) {
    return "";
  }
  const hidden = ordered.length - recent.length;
  const header = hidden > 0 ? `Activity (latest ${String(lines.length)} of ${String(ordered.length)}):` : "Activity:";
  const block = [header, ...lines].join("\n");
  return block.length <= SUMMARY_CHAR_CAP ? block : `${block.slice(0, SUMMARY_CHAR_CAP - 1)}…`;
}
