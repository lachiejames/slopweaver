/**
 * The supervisor's INBOUND check: every message another session sent any chair in the chain, set against the
 * replies the chain made, and the ones nobody answered — above all the ones that landed after that chair had
 * already handed the pin on.
 *
 * ## The defect, measured
 *
 * The chair hands over on its own cadence (`skills/supervisor/SKILL.md` § 6a), so a report addressed to
 * the chair a sender correctly resolved can land after that chair stops reading. `SendMessage` still returns
 * success. MEASURED over 17 chairs: 19 messages arrived after the
 * successor took the pin and got no reply — 4 of them real reports, the rest a successor messaging its
 * predecessor — and both reports one session sent a retired chair went unanswered. Reproduce with
 * `slopweaver supervisor intake --since <iso>`, `<iso>` the start of the window.
 *
 * ## Derived at the pin, never written at handover
 *
 * Nothing is recorded when a chair hands over. A chair holds the pin for the TENURES the chain journal records
 * (`./chain.ts`'s `chairTenures`), so a message is placed against them after the fact. That is what makes it
 * fire on the pin transfer completing rather than on the outgoing chair's announcement, and what keeps it
 * working when a chair dies without handing over at all. A message landing inside ANY of the chair's tenures
 * is in-span, so a chair that took the pin back is never read as retired.
 *
 * ## What counts as answered, and what is not a report
 *
 * - **Answered**: any chair in the walk made a `SendMessage` to exactly the sender's address, at or after the
 *   message, whose result reported success. A successor replying clears its predecessor's item, which is the
 *   point. The ruling asked for "no SendMessage back to its sender", so ANY later successful send to that
 *   sender clears every earlier message from it — whether it was about that message is not decidable here.
 * - **Chain traffic**: a message whose `msg_id` a walked chair's own successful `SendMessage` delivered was
 *   sent BY a chair. It is counted apart and never carried. Matched on the id, never on a name.
 * - **Marked**: `slopweaver supervisor intake-mark --turn transcript:<chair>#<uuid>` — the same ledger the
 *   owner-turn check reads, because a chair often acts on a report through `cmux send` or a spawn without
 *   replying. A mark naming ANY record of the message clears it.
 *
 * ## Carried versus unanswered
 *
 * No reply is not proof nobody acted: 75 messages inside closed chairs had none, 34 of them on one chair. So
 * the two placements are reported differently, and every message this cannot place — an unreadable instant, a
 * chair the journal never recorded — is carried rather than softened, because an
 * integrity check fails closed. A message that arrived outside every tenure of its chair is
 * `carried` — no chair that was reading ever saw it — and it is listed and makes the verb exit non-zero. One
 * that arrived inside a tenure and got no reply is `unanswered` — counted, and listed only by the audit verb.
 *
 * Pure: messages, sends and marks in, a finding out.
 */

import type { PeerInbound, PeerSend, PeerSendResult } from "../transcripts/peerTraffic.js";
import { formatTurnPointer } from "../transcripts/pointer.js";
import type { ChairTenure } from "./chain.js";
import type { IntakeMark } from "./intake.js";

/** Everything one chair's transcript yielded for this check, with the tenures the chain gave it. */
export interface ChairTraffic {
  readonly chairSessionId: string;
  /** The floor messages are read from: the chair's first pin, raised to the caller's floor where that is later. */
  readonly fromIso: string | undefined;
  /** Every interval the chair held the pin, oldest first; the last is open while it still holds it. */
  readonly tenures: readonly ChairTenure[];
  readonly inbound: readonly PeerInbound[];
  readonly sends: readonly PeerSend[];
  readonly results: readonly PeerSendResult[];
}

/** Where a message landed relative to its chair's tenures. */
type InboundPlacement = "after-pin" | "in-span";

/** One message nothing answered or marked. */
export interface OpenInbound {
  readonly chairSessionId: string;
  /** `transcript:<chair>#<uuid>` — what `supervisor intake-mark --turn` takes to clear it. */
  readonly pointer: string;
  readonly placement: InboundPlacement;
  readonly message: PeerInbound;
}

/** What checking the chain's inbound found. */
export interface InboundFinding {
  /** Arrived when its chair held no pin, and nothing answered or marked it — the finding. */
  readonly carried: readonly OpenInbound[];
  /** Arrived while its chair held the pin, with no reply and no mark. */
  readonly unanswered: readonly OpenInbound[];
  /** Messages read in the window, one per `msg_id`. */
  readonly read: number;
  readonly answered: number;
  readonly marked: number;
  /** Messages a chair sent another chair. */
  readonly chainTraffic: number;
  /** Open messages still younger than the grace window. */
  readonly inGrace: number;
}

/** A finding over nothing — what a read that yielded no chairs reports. */
export const EMPTY_INBOUND: InboundFinding = {
  answered: 0,
  carried: [],
  chainTraffic: 0,
  inGrace: 0,
  marked: 0,
  read: 0,
  unanswered: [],
};

/** Compare two instants: true only when both parse and `left` is at or after `right`. */
function atOrAfter({ left, right }: { left: string; right: string }): boolean {
  const at = Date.parse(left);
  const floor = Date.parse(right);
  return !Number.isNaN(at) && !Number.isNaN(floor) && at >= floor;
}

/**
 * Whether a message sits inside the window the chair is responsible for reading from.
 *
 * A message with no readable instant is kept, as the owner-turn read keeps one: it cannot be shown to be old.
 */
function inWindow({ message, fromIso }: { message: PeerInbound; fromIso: string | undefined }): boolean {
  if (fromIso === undefined || Number.isNaN(Date.parse(message.timestamp))) {
    return true;
  }
  return atOrAfter({ left: message.timestamp, right: fromIso });
}

/** Whether a message is younger than the grace window. An unreadable instant is NOT young. */
function young({ message, nowIso, graceMs }: { message: PeerInbound; nowIso: string; graceMs: number }): boolean {
  const at = Date.parse(message.timestamp);
  const now = Date.parse(nowIso);
  return !Number.isNaN(at) && !Number.isNaN(now) && now - at < graceMs;
}

/**
 * Whether a message landed while its chair held the pin.
 *
 * A message whose own instant will not read is placed inside NO tenure, so it is carried: a message nobody can place is "could not establish", and an integrity check fails CLOSED rather than
 * reporting it as something a chair saw.
 */
function whileHeld({ message, tenures }: { message: PeerInbound; tenures: readonly ChairTenure[] }): boolean {
  return tenures.some(
    (tenure) =>
      atOrAfter({ left: message.timestamp, right: tenure.fromIso }) &&
      (tenure.untilIso === undefined || !atOrAfter({ left: message.timestamp, right: tenure.untilIso })),
  );
}

/** What one message was judged to be. The two placements are the open verdicts; the rest close it. */
type InboundVerdict = "chain-traffic" | "answered" | "marked" | "in-grace" | InboundPlacement;

/** What every verdict is judged against, gathered once over the whole chain. */
interface JudgeContext {
  /** Every `SendMessage` whose own result reported success. */
  readonly delivered: readonly PeerSend[];
  /** Every `msg_id` a chair's successful `SendMessage` delivered. */
  readonly sentByChain: ReadonlySet<string>;
  readonly markedPointers: ReadonlySet<string>;
  readonly nowIso: string;
  readonly graceMs: number;
}

/** One message in the window: its first record, every pointer naming a record of it, and its chair. */
interface GroupedInbound {
  readonly chair: ChairTraffic;
  readonly message: PeerInbound;
  readonly pointer: string;
  readonly aliases: readonly string[];
}

/** One chair's sends that its OWN successful results back, with the ids those deliveries carried. */
function deliveredBy({ chair }: { chair: ChairTraffic }): { sends: readonly PeerSend[]; msgIds: readonly string[] } {
  const succeeded = new Map(
    chair.results.filter((result) => result.success).map((result) => [result.toolUseId, result]),
  );
  const sends = chair.sends.filter((send) => succeeded.has(send.toolUseId));
  const msgIds = sends.map((send) => succeeded.get(send.toolUseId)!.msgId).filter((msgId) => msgId !== "");
  return { msgIds, sends };
}

/**
 * The context every verdict reads: the sends and delivered ids that a successful result backs, and the marks.
 *
 * A call and its result are joined WITHIN one chair. Pooling them fails: one chair's successful result validated another chair's failed send that reused the call id, and
 * a report that nobody answered read as answered.
 *
 * @param chairs every chair walked
 * @param marks the intake ledger
 * @param nowIso the grace window's instant
 * @param graceMs the grace window
 * @returns the context
 */
function contextOf({
  chairs,
  marks,
  nowIso,
  graceMs,
}: {
  chairs: readonly ChairTraffic[];
  marks: readonly IntakeMark[];
  nowIso: string;
  graceMs: number;
}): JudgeContext {
  const perChair = chairs.map((chair) => deliveredBy({ chair }));
  return {
    delivered: perChair.flatMap((chair) => chair.sends),
    graceMs,
    markedPointers: new Set(marks.map((mark) => mark.pointer)),
    nowIso,
    sentByChain: new Set(perChair.flatMap((chair) => chair.msgIds)),
  };
}

/**
 * Whether `candidate` should lead its group instead of the record currently leading it.
 *
 * An UNREADABLE instant wins over any readable one: under the chair's fail-closed ruling a message with a record
 * nobody can place is unplaceable whatever its other records say, so a dated duplicate must not talk it back
 * inside a tenure. Otherwise the earlier instant leads, and a tie keeps the
 * record met first.
 */
function arrivedBefore({ candidate, lead }: { candidate: PeerInbound; lead: PeerInbound }): boolean {
  const at = Date.parse(candidate.timestamp);
  const held = Date.parse(lead.timestamp);
  if (Number.isNaN(at)) {
    return !Number.isNaN(held);
  }
  return !Number.isNaN(held) && at < held;
}

/** One `msg_id`'s records while they are folded: every alias, the record leading it, and whether it counts. */
interface InboundGroup {
  aliases: string[];
  lead: { chair: ChairTraffic; message: PeerInbound };
  counted: boolean;
}

/** The group already held for this record's `msg_id`, else a fresh one it leads, stored as it is made. */
function groupFor({
  groups,
  chair,
  message,
}: {
  groups: Map<string, InboundGroup>;
  chair: ChairTraffic;
  message: PeerInbound;
}): InboundGroup {
  const held = groups.get(message.msgId);
  if (held !== undefined) {
    return held;
  }
  const fresh: InboundGroup = { aliases: [], counted: false, lead: { chair, message } };
  groups.set(message.msgId, fresh);
  return fresh;
}

/**
 * Every message with at least one record inside its chair's window, one entry per `msg_id`, led by the record
 * with its EARLIEST readable instant — when it actually arrived, whatever order the records sit in the file.
 *
 * Two record-level choices, each answering a counterexample. Aliases are
 * collected from every record before the window is applied, so a mark naming a record just before the floor
 * still clears the message. And the lead is the earliest record, never the first one inside
 * the window, because reply order, grace and tenure placement all read the lead's instant: led by a later
 * duplicate, a message answered inside its chair's tenure read as unanswered and after the pin. The window decides only WHETHER a message is counted.
 */
function groupInbound({ chairs }: { chairs: readonly ChairTraffic[] }): readonly GroupedInbound[] {
  const groups = new Map<string, InboundGroup>();
  for (const chair of chairs) {
    for (const message of chair.inbound) {
      const group = groupFor({ chair, groups, message });
      group.aliases.push(formatTurnPointer({ pointer: { sessionId: chair.chairSessionId, turnUuid: message.uuid } }));
      group.counted = group.counted || inWindow({ fromIso: chair.fromIso, message });
      if (arrivedBefore({ candidate: message, lead: group.lead.message })) {
        group.lead = { chair, message };
      }
    }
  }
  return [...groups.values()]
    .filter((group) => group.counted)
    .map(({ aliases, lead }) => ({
      aliases,
      chair: lead.chair,
      message: lead.message,
      pointer: formatTurnPointer({ pointer: { sessionId: lead.chair.chairSessionId, turnUuid: lead.message.uuid } }),
    }));
}

/** Judge one message, in the order the verdicts outrank each other. */
function verdictOf({ item, context }: { item: GroupedInbound; context: JudgeContext }): InboundVerdict {
  const { message } = item;
  if (context.sentByChain.has(message.msgId)) {
    return "chain-traffic";
  }
  const replied = context.delivered.some(
    (send) => send.to === message.senderName && atOrAfter({ left: send.timestamp, right: message.timestamp }),
  );
  if (replied) {
    return "answered";
  }
  if (item.aliases.some((alias) => context.markedPointers.has(alias))) {
    return "marked";
  }
  if (young({ graceMs: context.graceMs, message, nowIso: context.nowIso })) {
    return "in-grace";
  }
  return whileHeld({ message, tenures: item.chair.tenures }) ? "in-span" : "after-pin";
}

/**
 * Set every chair's inbound against the chain's replies and the intake ledger.
 *
 * @param chairs every chair walked, in succession order
 * @param marks the intake ledger
 * @param nowIso the instant the grace window is judged at
 * @param graceMs how long an open message may sit before it counts — the owner-turn check's own window, passed
 *   in rather than imported so this module and `./intake.ts` do not import each other
 * @returns the finding
 */
export function judgeInbound({
  chairs,
  marks,
  nowIso,
  graceMs,
}: {
  chairs: readonly ChairTraffic[];
  marks: readonly IntakeMark[];
  nowIso: string;
  graceMs: number;
}): InboundFinding {
  const context = contextOf({ chairs, graceMs, marks, nowIso });
  const judged = groupInbound({ chairs }).map((item) => ({ item, verdict: verdictOf({ context, item }) }));
  const count = ({ verdict }: { verdict: InboundVerdict }): number =>
    judged.filter((entry) => entry.verdict === verdict).length;
  const open = ({ placement }: { placement: InboundPlacement }): readonly OpenInbound[] =>
    judged
      .filter((entry) => entry.verdict === placement)
      .map(({ item }) => ({
        chairSessionId: item.chair.chairSessionId,
        message: item.message,
        placement,
        pointer: item.pointer,
      }));
  return {
    answered: count({ verdict: "answered" }),
    carried: open({ placement: "after-pin" }),
    chainTraffic: count({ verdict: "chain-traffic" }),
    inGrace: count({ verdict: "in-grace" }),
    marked: count({ verdict: "marked" }),
    read: judged.length,
    unanswered: open({ placement: "in-span" }),
  };
}

/**
 * The inbound finding as one sentence for the intake clause, or "" when nothing is open.
 *
 * Counts, never quotes — the messages come out of `slopweaver supervisor intake`.
 *
 * @param finding what the check found
 * @returns one sentence, full stop included, or ""
 */
export function inboundSentence({ finding }: { finding: InboundFinding }): string {
  if (finding.carried.length === 0 && finding.unanswered.length === 0) {
    return "";
  }
  return (
    `${String(finding.carried.length)} message(s) from other sessions landed on a chair after it handed over ` +
    `and ${String(finding.unanswered.length)} more got no reply inside a chair's own span; ` +
    "`slopweaver supervisor intake` lists them."
  );
}
