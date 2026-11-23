/**
 * The voice relays that never reached the supervisor's chat, and nothing has acted on — the half of the relay
 * that survives a dead cmux socket.
 *
 * What the owner says to the conversational voice AI must reach the supervisor. In a measured case five relays
 * registered their row and then failed the cmux hop, and
 * nothing made the chair look at the row: it was one p1 among thousands. So `handover reconcile`, which the
 * sweep runs every pass, reads this and folds its sentence into `intakeClause` — the same folded, required
 * field that already reports owner turns typed into the chair with no row behind them. A relay typed into the
 * chat is an owner turn there already; one that never arrived is the same word, landed somewhere else.
 *
 * ## What clears one: positive evidence of action, never a status
 *
 * A relay is not cleared by its row leaving `ready`. A settled
 * ask keeps `status: ready` (its terminal state is derived from `settlement`), and a dispatch is recorded in
 * the run journal, never in that field. So a relay clears on a settlement on its row, a run-journal event of work
 * being taken up at or after it was registered, or an intake mark on its `talk:<turnId>` pointer — and, before any of
 * those, on the chair holding it whatever the delivery grade said ({@link ChairHasRelay}). A row that is gone, or whose
 * anchor no longer names the turn, clears nothing — its absence is not proof anybody acted, and it is reported with
 * `rowPresent: false`.
 *
 * A relay `held` for the chair's quiet batch (`./relayCourierHandoff.ts`) has not reached the chat yet by design, so
 * it is not counted until its batch is overdue ({@link HELD_OVERDUE_AFTER_MS}).
 */
import type { RunEvent } from "../handover/ledger.js";

import { QUIET_BEFORE_DELIVERY_MS, REWAKE_AFTER_MS } from "./chairWake.js";
import type { Delivery } from "./deliveryOutcome.js";
import type { TurnRecord } from "./relayStore.js";

/** The delivery kinds that put the line in the supervisor's chat. Everything else — `null` included — did not. */
const REACHED_KINDS: ReadonlySet<Delivery["kind"]> = new Set(["typed", "queued"]);

/**
 * Run events that mean somebody took the row up. Passive ones — a probe, a gate, an artifact, a question — do
 * not: they can happen to a row nobody is working.
 */
export const RELAY_ACTION_KINDS: ReadonlySet<RunEvent["kind"]> = new Set([
  "abandoned",
  "claimed",
  "closed",
  "dispatched",
  "finished",
  "launched",
  "resumed",
  "started",
]);

/** How many slugs the sentence names before it counts the rest. `--json` carries every one. */
const NAMED_IN_CLAUSE = 5;

/** The part of a board row this read needs: which row, what it anchors, whether it ended, and its journal. */
export interface RelayRowEvidence {
  readonly slug: string;
  readonly anchor: string | undefined;
  readonly settled: boolean;
  readonly events: readonly RunEvent[];
}

/** One relay the chair has not seen and nothing has acted on. */
export interface UndeliveredRelay {
  readonly slug: string;
  readonly anchor: string;
  readonly registeredAtIso: string;
  /** Every word the voice heard the owner say on this relay, which a Queue card quotes from. */
  readonly heard: string;
  /** Present when the record kept only the end of what the owner said. */
  readonly heardTruncated?: true;
  /** Present when the relay was made while a call stretch was still open, so its words end mid-sentence. */
  readonly heardTailCut?: true;
  /**
   * The console card the owner was looking at as they said it (`hand:mon-rs-r1`, `ask:<slug>`), or empty — the one field that
   * files a relay to a card, which `handover currency` matches byte for byte.
   */
  readonly about: string;
  /** What became of its supervisor line; `null` when none was attempted. */
  readonly delivery: Delivery | null;
  /** False when no board row carries this slug AND this anchor — an integrity fault, never an acknowledgement. */
  readonly rowPresent: boolean;
}

/** The voice-relay half of a reconciliation: read, or not, with the reason. */
export type VoiceRelayIntake =
  | { readonly kind: "read"; readonly relays: readonly UndeliveredRelay[] }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * Whether a relay's line is in the supervisor's chat.
 *
 * @param delivery what the verb recorded, or `null` when it typed nothing
 * @returns true only for `typed` and `queued`
 */
export function reachedSupervisorChat({ delivery }: { delivery: Delivery | null }): boolean {
  return delivery !== null && REACHED_KINDS.has(delivery.kind);
}

/**
 * How long a relay may stay `held` before its batch is overdue: the owner's two quiet minutes, then the ceiling a typed
 * batch waits before it is sent again (`./chairWake.ts`). A relay the owner keeps talking past stays held longer by
 * design, and is
 * counted here once this has passed — the chair then reads it with `talk log` rather than wait on the batch.
 */
export const HELD_OVERDUE_AFTER_MS = QUIET_BEFORE_DELIVERY_MS + REWAKE_AFTER_MS;

/**
 * Why the relays cannot be judged, when one is held at an instant that is not one: the turn parser takes any string as
 * a delivery's instant, and an overdue judgement over it would read as an ordinary late batch.
 *
 * @param records the relay records about to be judged
 * @returns the first malformed held instant, said, or `undefined` when every held one parses
 */
export function malformedHeldInstant({ records }: { records: readonly TurnRecord[] }): string | undefined {
  const bad = records.find(
    (record) => record.delivery?.kind === "held" && Number.isNaN(Date.parse(record.delivery.atIso)),
  );
  if (bad === undefined) {
    return undefined;
  }
  return `relay ${bad.turnId} is held at "${String(bad.delivery?.atIso)}", which is not an instant`;
}

/**
 * Whether a relay is held for the chair's quiet batch and that batch is not overdue yet — in flight by design, never
 * a relay that failed to arrive.
 *
 * @param delivery what the relay recorded
 * @param nowIso the instant judged at
 * @returns true only for a `held` delivery younger than {@link HELD_OVERDUE_AFTER_MS}
 */
function batchNotYetOverdue({ delivery, nowIso }: { delivery: Delivery | null; nowIso: string }): boolean {
  if (delivery?.kind !== "held") {
    return false;
  }
  return Date.parse(nowIso) - Date.parse(delivery.atIso) < HELD_OVERDUE_AFTER_MS;
}

/**
 * Whether the chair holds a relay whatever its delivery was graded: its line in a chair turn, or its words read through
 * `talk unread` (`./chairReceipt.ts`). A delivery graded `stranded` or `skipped` was in the chair's chat anyway, and a count
 * that called it never-reached would be wrong.
 */
export type ChairHasRelay = (options: { readonly record: TurnRecord }) => boolean;

/**
 * Whether a registered relay needs no look on its delivery alone: it reached the chat, an intake mark names it, its
 * batch is held and not yet overdue, or the chair holds it whatever its grade.
 */
function accountedFor({
  record,
  markedPointers,
  chairHas,
  nowIso,
}: {
  record: TurnRecord;
  markedPointers: ReadonlySet<string>;
  chairHas: ChairHasRelay;
  nowIso: string;
}): boolean {
  if (reachedSupervisorChat({ delivery: record.delivery }) || markedPointers.has(record.anchor)) {
    return true;
  }
  return batchNotYetOverdue({ delivery: record.delivery, nowIso }) || chairHas({ record });
}

/**
 * The registered relays that never reached the chat and carry no witness of action.
 *
 * @param records the current relay records inside the sweep window (`relayStore.readRelayTurns`)
 * @param rows the board, narrowed to what can witness a relay
 * @param markedPointers every pointer an intake mark names
 * @param chairHas whether the chair holds a relay its delivery grade says it never got
 * @param nowIso the instant a held relay's batch is judged overdue against
 * @returns the relays still owed a look, oldest first
 */
export function undeliveredRelays({
  records,
  rows,
  markedPointers,
  chairHas,
  nowIso,
}: {
  records: readonly TurnRecord[];
  rows: readonly RelayRowEvidence[];
  markedPointers: ReadonlySet<string>;
  chairHas: ChairHasRelay;
  nowIso: string;
}): readonly UndeliveredRelay[] {
  const owed: UndeliveredRelay[] = [];
  for (const record of records) {
    if (record.state !== "registered" || record.registeredAtIso === null) {
      continue;
    }
    if (accountedFor({ chairHas, markedPointers, nowIso, record })) {
      continue;
    }
    // Every row carrying this slug AND this anchor — two docs can share a slug, and keeping one per slug let
    // an unrelated later row mask the matching settled one (r3-sweep-delivers-3).
    const matching = rows.filter((row) => row.slug === record.slug && row.anchor === record.anchor);
    const registeredAtIso = record.registeredAtIso;
    if (matching.some((row) => actedOn({ registeredAtIso, row }))) {
      continue;
    }
    owed.push({
      about: record.about,
      anchor: record.anchor,
      delivery: record.delivery,
      heard: record.heard,
      ...(record.heardTruncated === true ? { heardTruncated: true } : {}),
      ...(record.heardTailCut === true ? { heardTailCut: true } : {}),
      registeredAtIso: record.registeredAtIso,
      rowPresent: matching.length > 0,
      slug: record.slug,
    });
  }
  return owed;
}

/** What a relay's own row shows was done with it: settled, or a run event of work being taken up. */
export type RelayRowAction =
  | { readonly kind: "settlement" }
  | { readonly kind: "run-event"; readonly eventKind: RunEvent["kind"]; readonly atIso: string };

/**
 * The evidence on a row that somebody acted on it since the relay registered: its settlement first, else the
 * earliest run event of work being taken up at or after registration.
 *
 * @param row the relay's row, matched on slug and anchor
 * @param registeredAtIso when the relay registered — an event before it is another cycle's
 * @returns the action, or `undefined` when the row carries none
 */
export function relayRowAction({
  row,
  registeredAtIso,
}: {
  row: RelayRowEvidence;
  registeredAtIso: string;
}): RelayRowAction | undefined {
  if (row.settled) {
    return { kind: "settlement" };
  }
  const floor = Date.parse(registeredAtIso);
  const event = row.events.find((one) => RELAY_ACTION_KINDS.has(one.kind) && Date.parse(one.atIso) >= floor);
  if (event === undefined) {
    return undefined;
  }
  return { atIso: event.atIso, eventKind: event.kind, kind: "run-event" };
}

/** Whether a row carries evidence somebody acted on it since the relay registered. */
function actedOn({ row, registeredAtIso }: { row: RelayRowEvidence; registeredAtIso: string }): boolean {
  return relayRowAction({ registeredAtIso, row }) !== undefined;
}

/**
 * The sentence `intakeClause` carries after the owner-turn one, or "" when every relay reached the chat or
 * was acted on — so a clean install reads exactly as it did before.
 *
 * @param report the voice-relay half
 * @returns one sentence, full stop included, or ""
 */
export function voiceRelayClause({ report }: { report: VoiceRelayIntake }): string {
  if (report.kind === "unavailable") {
    return `Voice relays unread: ${report.why}.`;
  }
  const count = report.relays.length;
  if (count === 0) {
    return "";
  }
  const named = report.relays.slice(0, NAMED_IN_CLAUSE).map((relay) => relay.slug);
  const more = count > NAMED_IN_CLAUSE ? `, and ${String(count - NAMED_IN_CLAUSE)} more` : "";
  return (
    `${String(count)} voice relay(s) never reached your chat and nothing has acted on them: ` +
    `${named.join(", ")}${more} — the owner's word; read each with slopweaver talk log.`
  );
}

/**
 * The command that records a relay was dealt with when acting on its row is not the right witness.
 *
 * @param relay the undelivered one, named by its `talk:<turnId>` anchor
 * @returns the `supervisor intake-mark` line, ready to paste
 */
export function relayMarkCommand({ relay }: { relay: UndeliveredRelay }): string {
  return `slopweaver supervisor intake-mark --turn ${relay.anchor} --as answered|card|no-ask --witness "<what it became>"`;
}
