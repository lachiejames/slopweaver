/**
 * The properties an opened Queue card carries the way a Linear issue's side panel does: status, priority, workstream or project, and what is related. ONE properties section, label left and value right; effort off the screen;
 * a workstream a citation whose hover gives its name and progress; no slug or internal id anywhere on it; and two
 * people properties, who this one message tags and who is in its thread, each a list of identity chips — the one place
 * on a card a chip is drawn, and never one for the owner.
 *
 * - **Every card carries a status and a priority.** Status is the board row's own when the card IS one (an ask),
 *   else the state its record is in. Priority is the most urgent band of the rows the card belongs to; a card on
 *   no row takes its Queue tier's default, the same reasoning the board's kind defaults carry (someone waiting
 *   in a thread outranks the fleet's own work, which outranks a check-in).
 * - **A default says it is one.** A band nobody chose — a row's kind default, written down by
 *   `handover set-priority --backfill` or never declared, or a tier default — is drawn with its reason, never as
 *   a judgement, and the reason never names a row by its slug.
 * - **Workstream is a tag** (`workstream=`), read off the card's own inherited tags, resolved against the workstreams
 *   register for its name and progress. A card with none draws no workstream line, never "none".
 * - **Related is the join, not a guess**: the rows the card belongs to (other than itself), what they are blocked
 *   by, and the pull requests they name — a row by its own words, never its slug.
 * - **People are a message's**: a parked post's recorded mentions are who it tags, and the authors of the thread it
 *   lands in, read live, are who is in it. A card that is no message draws neither line; a message that recorded
 *   neither says so rather than drawing no one.
 *
 * Pure: the card's record, tier, tags and rows in; the properties out ({@link cardProperties}, and the panel's one-call
 * {@link openedCardProperties}).
 */
import type { DraftContextState } from "../components/console/useDraftContext";
import type { Board, BoardRow } from "../components/live/read";
import type { LiveState } from "../components/live/useLive";
import { propertyPeople } from "./cardPeopleDisplay";
import { relatedOf } from "./cardPropertiesRelated";
import type { CardPriority, CardProperties, CardWorkstream, PeopleProperty } from "./cardPropertiesTypes";
import { readsConversation } from "./draftReads";
import { latestReadOf } from "./liveState";
import type { CardPeople } from "./personMentions";
import { boardReadingOf, cardJoinOf } from "./queueCardTags";
import type { QueueRow } from "./queueRows";
import { type CardRows, cardRows } from "./queueTagsInherited";
import type { WaitingTier } from "./waitingRank";
import { withOpen } from "./workstreamFilter";
import { type WorkstreamsReading, workstreamsOf } from "./workstreamsReading";
import { closedWords, type WorkstreamView } from "./workstreamTiles";

/** The band a card on no board row takes, by the tier it waits in — the board's kind-default reasoning, per tier. */
export const TIER_PRIORITY: Readonly<Record<WaitingTier, string>> = {
  "check-in": "p2",
  "fleet-blocked": "p1",
  "team-blocked": "p0",
};

/** What each tier's default says it is. */
const TIER_WHY: Readonly<Record<WaitingTier, string>> = {
  "check-in": "default for a check-in",
  "fleet-blocked": "default for work blocking the fleet",
  "team-blocked": "default for work a colleague waits on",
};

/**
 * The state a card's own record is in, in the panel's words — what a card on no board row shows as its status.
 *
 * @param record the card's record
 * @returns the status
 */
export function recordStatusOf({ record }: { record: QueueRow["record"] }): string {
  switch (record.kind) {
    case "ask":
      return record.row.status;
    case "hand":
      return "waiting on your hands";
    case "draft":
      return "held for your yes";
    case "post":
      return "parked for your yes";
    case "review":
      return "drafted for your yes";
    case "import":
      return "staged · waiting on your answer";
    case "pr":
      return `${record.row.draft ? "draft" : "open"} · ${record.row.action}`;
    case "act":
      return "done · waiting on your review";
    default: {
      const unhandled: never = record;
      return unhandled;
    }
  }
}

/**
 * The band one row ranks in: its derived `priority=` tag, else the `priority:` it declares, and whether anybody
 * chose it. `undefined` when the row publishes neither (a board cut before tags).
 *
 * @param own the row the card IS, said as "this row"; any other is "a row this card belongs to", never its slug
 * @returns the band and its source
 */
function rowPriority({ row, own }: { row: BoardRow; own: BoardRow | undefined }): CardPriority | undefined {
  const derived = row.tags.find((tag) => tag.key === "priority");
  const chosen = row.priority !== undefined && row.priorityFrom === undefined;
  let band = row.priority;
  if (derived !== undefined) {
    band = derived.value;
  }
  if (band === undefined) {
    return undefined;
  }
  let where = "a row this card belongs to";
  if (row === own) {
    where = "this row";
  }
  if (chosen) {
    return { band, source: "chosen", why: `stated on ${where}` };
  }
  return { band, source: "default", why: `the ${row.kind} default, on ${where}` };
}

/**
 * How far one workstream has got, in the words a hover reads: a tile's count against its own milestones, a gauge's
 * reading against its total, a local one's note, a closing one's closing day and state.
 *
 * @returns the progress line
 */
export function workstreamProgress({ view }: { view: WorkstreamView }): string {
  switch (view.kind) {
    case "outcome":
    case "standing":
      return view.progressLine;
    case "linked":
      return `${String(view.gauge.value)} of ${String(view.gauge.of)} ${view.gauge.source}`;
    case "local":
      return view.note;
    case "closing":
      return `${closedWords({ closedOn: view.closedOn })} · ${view.state}`;
    default: {
      const unhandled: never = view;
      return unhandled;
    }
  }
}

/**
 * Each workstream a card carries, resolved against the register for its name and progress.
 *
 * @param ids the card's `workstream=` values
 * @param register the workstreams register as the panel reads it
 * @returns one per id, in order
 */
export function cardWorkstreams({
  ids,
  register,
}: {
  ids: readonly string[];
  register: LiveState<WorkstreamsReading>;
}): readonly CardWorkstream[] {
  return ids.map((id) => {
    const href = `/workstreams${withOpen({ open: id, search: "" })}`;
    if (register.phase === "loading") {
      return { href, id, kind: "loading" };
    }
    if (register.phase === "not-measured") {
      return { href, id, kind: "failed", why: register.why };
    }
    // No register written holds no workstream, exactly as an empty one: an answer, never a failed read.
    const view = workstreamsOf({ reading: register.value }).find((each) => each.id === id);
    if (view === undefined) {
      return { href, id, kind: "unread", why: "the workstreams register holds no workstream by this name" };
    }
    return { href, id, kind: "read", name: view.name, progress: workstreamProgress({ view }) };
  });
}

/**
 * The people one id list names, as a property: each once, the owner left out.
 *
 * @returns the listed property
 */
function listed({ ids, people }: { ids: readonly string[]; people: CardPeople }): PeopleProperty {
  return { kind: "listed", ...propertyPeople({ ids, people }) };
}

/**
 * Who is in the thread a parked post lands in, off the conversation the panel read live: its authors, each once, the owner
 * left out. A conversation that is a channel's tail rather than a thread is no thread, and draws no line.
 *
 * @param state the conversation as the panel read it
 * @param people the roster the card resolves against
 * @returns the property, or `undefined` for a channel's tail
 */
export function threadPeopleOf({
  state,
  people,
}: {
  state: DraftContextState;
  people: CardPeople;
}): PeopleProperty | undefined {
  if (state.phase === "loading") {
    return { kind: "loading" };
  }
  if (state.phase === "not-measured") {
    return { kind: "failed", why: state.why };
  }
  if (state.context.scope !== "thread") {
    return undefined;
  }
  const ids = state.context.messages.map((message) => message.userId).filter((id): id is string => id !== undefined);
  return listed({ ids, people });
}

/**
 * Who a card's message tags and who is in its thread, from what its record carries: a parked post its recorded
 * mentions, and a thread it will read live (`loading` until the panel hands the reading over); a held reply records
 * neither, and says so; any other card is no message.
 *
 * @returns the two properties
 */
function messagePeople({ record, people }: { record: QueueRow["record"]; people: CardPeople }): {
  readonly tagged: PeopleProperty | undefined;
  readonly thread: PeopleProperty | undefined;
} {
  if (record.kind === "post") {
    const post = record.post;
    const ids = post.mentions.filter((mention) => mention.kind === "person").map((mention) => mention.target);
    let thread: PeopleProperty | undefined;
    if (post.thread !== undefined) {
      thread = { kind: "unread", why: "the thread is read only while the draft is held in a conversation" };
      if (readsConversation({ draft: post })) {
        thread = { kind: "loading" };
      }
    }
    return { tagged: listed({ ids, people }), thread };
  }
  if (record.kind === "draft") {
    const why = "the held reply records no people of its own";
    return { tagged: { kind: "unread", why }, thread: { kind: "unread", why } };
  }
  return { tagged: undefined, thread: undefined };
}

/**
 * The properties an opened card draws, found through the same join its tags came through
 * (`./queueCardTags.ts` `cardJoinOf`), so the two never disagree about which rows the card belongs to.
 *
 * @param row the opened card
 * @param board the board as the Queue reads it, ready or not
 * @param people the roster the card resolves people against
 * @param workstreams the workstreams register, for each workstream's name and progress
 * @returns the properties
 */
export function openedCardProperties({
  row,
  board,
  people,
  workstreams,
}: {
  row: QueueRow;
  board: LiveState<Board>;
  people: CardPeople;
  workstreams: LiveState<WorkstreamsReading>;
}): CardProperties {
  const join = cardJoinOf({ record: row.record });
  const reading = boardReadingOf({ board });
  return cardProperties({
    board: board.phase === "ready" ? board.value.rows : [],
    boardRead: latestReadOf({ state: board }),
    people,
    record: row.record,
    rows: cardRows({ board: reading, ...join }),
    self: join.pullRequest,
    tags: row.tags,
    tier: row.tier,
    workstreams,
  });
}

/**
 * The properties one opened card draws.
 *
 * @param record the card's record, which names its status when it is no board row
 * @param tier the Queue tier it waits in, whose default a card on no row takes
 * @param tags the card's inherited tags, read for workstream and pull requests
 * @param rows the board rows the card belongs to ({@link CardRows})
 * @param self the card's own pull request, `owner/repo#N`, when it is one
 * @param board every row the board read, so a row another waits on reads in its own words
 * @param boardRead the board's latest read, which says whether rows not yet found are still reading or failed
 * @param people the roster the card resolves people against
 * @param workstreams the workstreams register
 * @returns the properties
 */
export function cardProperties({
  record,
  tier,
  tags,
  rows: found,
  self,
  board,
  boardRead,
  people,
  workstreams,
}: {
  record: QueueRow["record"];
  tier: WaitingTier;
  tags: QueueRow["tags"];
  rows: CardRows;
  self: string | undefined;
  board: readonly BoardRow[];
  boardRead: ReturnType<typeof latestReadOf>;
  people: CardPeople;
  workstreams: LiveState<WorkstreamsReading>;
}): CardProperties {
  const own = record.kind === "ask" ? record.row : undefined;
  const rows = found.phase === "ready" ? found.rows : [];
  let priority: CardPriority = { band: TIER_PRIORITY[tier], source: "default", why: TIER_WHY[tier] };
  const banded = rows
    .map((row) => rowPriority({ own, row }))
    .filter((band) => band !== undefined)
    .toSorted((left, right) => left.band.localeCompare(right.band) || (left.source === "chosen" ? -1 : 1));
  const urgent = banded.at(0);
  if (urgent !== undefined) {
    priority = urgent;
  }
  const caveats: string[] = [];
  let boardMark: CardProperties["board"];
  if (found.phase === "unread" && boardRead.phase === "not-measured") {
    boardMark = { kind: "failed", why: boardRead.why };
  } else if (found.phase === "unread") {
    boardMark = { kind: "reading" };
  } else if (found.unread.length > 0) {
    boardMark = {
      kind: "failed",
      why: `${found.unread.join(", ")} did not read, so this card may belong to a row not shown`,
    };
  }
  // A slug naming several rows is the data, not a failed read: which one the record meant is not provable.
  if (found.phase === "ready" && found.ambiguous.length > 0) {
    caveats.push(`${found.ambiguous.join(", ")} names several board rows, so none of them is shown as this card's`);
  }
  const { tagged, thread } = messagePeople({ people, record });
  const listsPeople = tagged?.kind === "listed" || thread?.kind === "listed";
  if (listsPeople && ![...people.values()].some((person) => person.self)) {
    caveats.push("who you are was not read off any message sent as you, so you may be listed among the people");
  }
  const values = ({ key }: { key: string }): readonly string[] =>
    tags.filter((tag) => tag.key === key).map((tag) => tag.value);
  return {
    board: boardMark,
    caveats,
    priority,
    related: relatedOf({ board, own, pullTags: values({ key: "pr" }), rows, self }),
    status: { source: own === undefined ? "record" : "row", value: recordStatusOf({ record }) },
    tagged,
    thread,
    workstreams: cardWorkstreams({ ids: values({ key: "workstream" }), register: workstreams }),
  };
}
