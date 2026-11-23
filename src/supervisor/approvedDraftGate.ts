/**
 * The tick gate that makes a draft the owner already approved impossible to leave parked: a tick is refused while any
 * HELD Slack draft carrying their approval was recorded at or before the tick STARTED.
 *
 * Why it exists: an approved draft that nothing at a chair pass looks for stays parked "for the owner's yes" for hours,
 * because nothing on the row says the yes was already given.
 *
 * A row now says so (`../outbound/slack/draftApproval.ts`), and this is what looks. Its ways out are the four honest
 * ones: release it; re-cut it with a mechanical fix (the approval carries across `--supersedes`); re-cut it with
 * `--meaning-changed` when the words or the thread moved materially, which parks it for the owner's word again; or the
 * hatch.
 *
 * ## The deadline is this tick's START
 *
 * The same reading as `./unpickedSteerGate.ts`: a row recorded after the tick began is the next tick's, so a draft the
 * chair approves mid-pass never joins the set the pass it is fixing must clear.
 *
 * ## Residue, stated rather than discovered
 *
 * - A register line this build cannot read is passed over. The display fold (`../outbound/slack/draftLog.ts`) then
 *   hides every row such a line names, which would hide an approved row from this gate entirely. So the gate folds the
 *   readable events itself and REFUSES an approved row a passed-over line names, as state unknown: no verb on this
 *   build can release or drop it, and the line is usually a newer build's, so the route is a rebuilt seat. An approved
 *   `parked` line this build cannot validate is refused the same way, off its raw id, instant and `approval` key, and
 *   one that is not a park, JSON or not, leaves which park a later release spent unknown, so that release spends
 *   nothing. What stays unseen is a line that is not JSON at all; the count is named whenever the gate refuses.
 * - A row whose own instant does not parse is OWED, never passed: a malformed approved row would otherwise be one no
 *   pass ever sends.
 * - Two parks under ONE id are outside the register's contract: the verbs mint each id from 32 random bits
 *   (`../admit/slackDraftStore.ts`'s `mintSlackDraftId`), and a `released` or `dropped` event names only the id. The
 *   verbs act on the row the fold shows, the latest park, so a readable release or drop spends that park ALONE and an
 *   earlier approved one under the id stays owed, refused as state unknown, however many releases or drops follow it. A
 *   collision so costs a hatch, never a silent pass; without a release, every approved park still owes.
 * - Whether the words at the anchor MEAN yes to this draft is the recorder's judgement, never computed: a whole "no,
 *   don't send that" resolves exactly as "send it" does. So the row carries the owner's words, and the refusal quotes
 *   them and tells the releasing session to read them first and drop a row they do not approve. A keyword test for a
 *   negative was weighed and dropped — it would refuse "no em-dashes, send it" and pass a yes to some other draft.
 *
 * ## The owner's words on a draft's card owe a judgement
 *
 * The owner must never say "go send this" and find the draft unsent the next day. A yes landing on an
 * ask card naming a draft reached no row unless somebody passed `--approved`: the recorder's declaration was the only
 * way a yes reached a row, so a yes nobody declared was a row awaiting the owner's word forever.
 *
 * So a second obligation sits beside the first. Every active landing binds to the held drafts its card names
 * (`./draftLandingBinding.ts`), and a bound landing decided at or before the tick started is OWED until the row
 * carries a judgement recorded at or after the owner's words: `slack draft approve` (which then owes the send, above),
 * or `slack draft hold` with a typed reason the Queue card prints to the owner. A landing is not a yes — the owner may
 * have said "not yet" — so the gate forces the judgement and never makes it. A plain re-cut is not a judgement, nor is
 * one inheriting the approval; a re-cut declaring `--approved <anchor>` or `--meaning-changed` is.
 *
 * - A hold whose reason keeps the approval (`thread-moved`, `no-fleet-slot`, `slack-refused`) clears the send
 *   obligation: it is the stated reason not to send, in front of the owner. A later `approve` re-opens it.
 * - A landed card whose texts could not be read is owed as unknown, never passed as one that named no draft.
 * - A landing written after its draft was dropped binds the dropped cut, on a `post:`, ask or hand card alike: the
 *   transcript can land words the owner said before the drop after it, and the drop never weighed them. It is owed
 *   until the owner's words are re-recorded as an approved row at that anchor, or the card is put back (`talk restore`)
 *   with why the drop stands.
 * - A re-cut carrying the approval stands on the judgement, ledger count and blocking hold of the row it re-cuts, never
 *   on its own park: it judged no words, so a landing past that boundary stays owed.
 * - A card whose record is gone — a swept ask, a hand step no line holds — binds nothing. That is residue: the owner's
 *   words on it have no card left to bind through.
 *
 * Pure: the read is the shell's, taken once per tick (`../cli/commands/supervisor/tickRecordApprovedDrafts.ts`).
 */
import { heldOnApproval } from "../outbound/slack/draftApproval.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { recordedCutOf } from "../outbound/slack/draftSpent.js";
import type { AnswerContext } from "../talk/answerContext.js";
import { landedAnchors } from "../talk/cardLanding.js";
import type { BoundDraftLanding, DraftLandingBindings, UnreadableDraftLanding } from "./draftLandingBinding.js";

/**
 * A `parked` line carrying an `approval`, with no readable release or drop after it, that the fold does not show held:
 * unreadable on this build, or hidden by a later park under the same id. Only its id and instant are
 * trusted, so it is owed exactly like a readable row and named as state unknown.
 */
export interface UnreadApprovedRow {
  readonly id: string;
  /** Absent when the line carries no string instant — owed, like a row whose instant does not parse. */
  readonly tsIso: string | undefined;
}

/**
 * What the shell read of the draft register: EVERY row its readable events fold to, the rows a passed-over line names,
 * and how many lines were passed over — or why it could not be read.
 */
export type ApprovedDraftRead =
  | {
      readonly kind: "read";
      readonly items: readonly SlackDraftItem[];
      readonly unsureIds: readonly string[];
      readonly unreadApproved: readonly UnreadApprovedRow[];
      readonly skippedLines: number;
      /** Every active landing bound to a held draft its card names, and every landing whose card did not read. */
      readonly landings: DraftLandingBindings;
      /**
       * What each of those landings' words answered — the voice's turn and the relay's stored verdict — keyed by
       * landing anchor, so the refusal never hands the chair a bare "yes". Only
       * the renderer reads it; the verdict never turns on it.
       */
      readonly answers: ReadonlyMap<string, AnswerContext>;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The gate's verdict on one tick; `drafts` are the held rows owed — approved and unsent with no hold, or carrying the
 * owner's word while a passed-over line names them — `unsureIds` the owed rows a passed-over line names, `landings` the bound
 * landings no judgement answers yet, and `unreadableLandings` the landed cards whose drafts are unknown.
 */
export type ApprovedDraftVerdict =
  | { readonly kind: "clean" }
  | {
      readonly kind: "refused";
      readonly drafts: readonly SlackDraftItem[];
      readonly unsureIds: readonly string[];
      readonly unreadApproved: readonly UnreadApprovedRow[];
      readonly skippedLines: number;
      readonly landings: readonly BoundDraftLanding[];
      readonly unreadableLandings: readonly UnreadableDraftLanding[];
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Judge one tick: refused while any held approved row recorded at or before it started stands unsent with no hold, any
 * held row carrying the owner's word is one a passed-over line names, or any landing decided at or before it has no judgement
 * after it; unreadable when the read failed or the tick's own
 * start does not parse.
 *
 * @param read what the shell read
 * @param startedIso when this tick started — a row recorded after it is the next tick's
 * @returns the verdict
 */
export function judgeApprovedDrafts({
  read,
  startedIso,
}: {
  read: ApprovedDraftRead;
  startedIso: string;
}): ApprovedDraftVerdict {
  if (read.kind === "unreadable") {
    return read;
  }
  const deadline = Date.parse(startedIso);
  if (Number.isNaN(deadline)) {
    return { kind: "unreadable", why: `the tick's start ${startedIso} does not parse, so no deadline can be judged` };
  }
  const unsure = new Set(read.unsureIds);
  const owed = read.items.filter(
    (item) =>
      (heldOnApproval({ item }) &&
        item.hold === undefined &&
        !recordedAfter({ deadline, tsIso: approvalRecordedIso({ item }) })) ||
      hiddenWithOwnerWord({ item, unsure }),
  );
  const unreadOwed = read.unreadApproved.filter((row) => !recordedAfter({ deadline, tsIso: row.tsIso }));
  const landings = read.landings.bound.filter(
    (bound) =>
      !recordedAfter({ deadline, tsIso: bound.landing.decidedIso }) && !landingAnswered({ bound, items: read.items }),
  );
  const unreadableLandings = read.landings.unreadable.filter(
    (one) => !recordedAfter({ deadline, tsIso: one.landing.decidedIso }),
  );
  if (owed.length === 0 && unreadOwed.length === 0 && landings.length === 0 && unreadableLandings.length === 0) {
    return { kind: "clean" };
  }
  const owedIds = [...owed.map((item) => item.id), ...landings.map((bound) => bound.item.id)];
  return {
    drafts: owed,
    kind: "refused",
    landings,
    skippedLines: read.skippedLines,
    unreadApproved: unreadOwed,
    unreadableLandings,
    unsureIds: [...new Set(owedIds.filter((id) => unsure.has(id)))],
  };
}

/**
 * Whether a held row carries the owner's word — their yes, a change of meaning waiting on it, or a yes a hold set down
 * — while a register line this build cannot read names it. The display fold hides such a row, so its reason is off the
 * Queue card, and whatever that line says, the row's state is unknown: it is owed until the seat reads it, whatever its
 * instant, so a hold this build does not know cannot leave the owner's word hidden while every tick passes.
 */
function hiddenWithOwnerWord({ item, unsure }: { item: SlackDraftItem; unsure: ReadonlySet<string> }): boolean {
  if (item.state !== "held" || !unsure.has(item.id)) {
    return false;
  }
  return (
    item.draft.approval !== undefined || item.draft.meaningChanged !== undefined || item.hold?.setDown !== undefined
  );
}

/** When a row's approval was recorded: by the judgement that set it, else by the park that carried it. */
function approvalRecordedIso({ item }: { item: SlackDraftItem }): string {
  if (item.judgedIso === undefined) {
    return item.draft.tsIso;
  }
  return item.judgedIso;
}

/**
 * Whether the bound row carries a judgement OF THE OWNER'S WORDS recorded at or after they landed: their approval, a
 * hold recording that the words were not a yes, or a declared change of meaning. A hold that keeps an approval (`thread-moved`,
 * `no-fleet-slot`, `slack-refused`) says why a yes is not sent, so on a row with no approval it answers nothing and the
 * landing stays owed. Nor does it re-date an older change of meaning it sits over: the row's instant is then the
 * hold's, so a change of meaning answers only while it is the latest judgement — no hold, or its own. A judgement or a
 * landing instant that does not parse answers nothing either. A judgement that counted the landing ledger is ordered
 * by it rather than by instants: a landing whose words were written at or past the rows it read is one it never saw,
 * however early the owner spoke them, so it stays owed.
 *
 * @param bound one landing and the held cut it binds to
 * @returns true when the cut's latest judgement answers the owner's words
 */
export function judgedSince({ bound }: { bound: BoundDraftLanding }): boolean {
  const { item } = bound;
  const hold = item.hold === undefined ? undefined : item.hold.reason;
  const meaningStands = item.draft.meaningChanged !== undefined && (hold === undefined || hold === "meaning-changed");
  const answered = item.draft.approval !== undefined || meaningStands || hold === "not-owner-yes";
  return answered && judgementSaw({ bound, judge: item });
}

/**
 * Whether a row's judgement had the bound landing's words in front of it: ordered by the landing ledger when both
 * counted it, else by instants; a judgement with no instant, or one that does not parse, saw nothing.
 */
function judgementSaw({ bound, judge }: { bound: BoundDraftLanding; judge: SlackDraftItem }): boolean {
  if (judge.judgedIso === undefined) {
    return false;
  }
  if (judge.judgedLandings !== undefined && bound.ledgerRow !== undefined) {
    return bound.ledgerRow < judge.judgedLandings;
  }
  const judged = Date.parse(judge.judgedIso);
  const decided = Date.parse(bound.landing.decidedIso);
  return !Number.isNaN(judged) && !Number.isNaN(decided) && judged >= decided;
}

/**
 * Whether a bound landing is answered. On a held cut, by the cut's own judgement ({@link judgedSince}). On a dropped
 * cut the landing outran, by a row carrying the owner's approval at that very landing's anchor that the register
 * records as the dropped row's message ({@link recordedCutOf}) — its words re-recorded with `--approved <anchor>`,
 * which then owe the send — and never by the dropped row's own state, whose judgements all predate the words the drop
 * never weighed. One utterance can land on two cards, so a different draft approved at the same anchor answers only its
 * own landing. That approval answers only the words it judged: an utterance that grew on the card after it, written at
 * or past the ledger rows it counted, stays owed even once its carrier is released.
 * Putting the card back (`talk restore`) lifts the landing itself.
 */
function landingAnswered({ bound, items }: { bound: BoundDraftLanding; items: readonly SlackDraftItem[] }): boolean {
  if (bound.item.state !== "dropped") {
    return judgedSince({ bound });
  }
  const anchors = landedAnchors({ row: bound.landing });
  return items.some(
    (item) =>
      item.draft.approval !== undefined &&
      anchors.includes(item.draft.approval.anchor) &&
      recordedCutOf({ carrier: item, items, row: bound.item }) &&
      judgementSaw({ bound, judge: item }),
  );
}

/** Whether a row was recorded after the deadline; a row whose instant does not parse was not. */
function recordedAfter({ deadline, tsIso }: { deadline: number; tsIso: string | undefined }): boolean {
  if (tsIso === undefined) {
    return false;
  }
  const recorded = Date.parse(tsIso);
  return !Number.isNaN(recorded) && recorded > deadline;
}
