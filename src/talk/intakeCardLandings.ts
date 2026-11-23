/**
 * Landings the chair's intake marks already prove, for the one card a steer reached no ledger row on — pure.
 *
 * The Queue page read stale: a card the owner had steered on stayed on it. MEASURED on one reading: an
 * `ask:` card ranked first eleven hours after the owner rejected it aloud. The voice had put the card
 * in front of the owner, so the transcript lands nothing said over it (`./cardUtterance.ts`
 * `transcriptCardUtterances`), and the relay the voice made of the owner's words named no card (`about: ""`), so
 * `talk relay` landed nothing either. The chair DID record the turn: an `answered` intake mark whose pointer names that
 * exact segment of that call.
 *
 * So this joins exactly that, and nothing looser: an `answered` or `card` mark witnessed by a relay row
 * (`talk-<12 hex>`, and carried by `talk relay`'s receipt ledger), its `talk-call:<callId>#<segment>` pointer, the
 * segment of the OWNER's with that id in that call's file, and the register card the voice had open when the owner
 * began it. Never words matched against a card's text. A mark the chair witnessed with anything but a relay is it
 * answering the OWNER's question — a request to hear more — and the card still waits on the owner's word; MEASURED on the
 * same reading, admitting those derived 127 landings over 24 cards, most of them questions. A mark naming a segment the voice did not open a card for is not this module's: the transcript already
 * lands those.
 *
 * The derived row is a `landed` row with `source: "intake"`, published beside the ledger's by `talk cards` and never
 * written to the ledger, so a `talk restore` written after the mark lifts it exactly as it lifts a ledger landing.
 */
import type { IntakeMark } from "../supervisor/intake.js";
import type { CallEntry } from "./callRecord.js";
import {
  activeCardLandings,
  type CardLandedRow,
  type CardLandingRow,
  landingStillHolds,
  utteranceLandings,
} from "./cardLanding.js";
import { callSegmentAnchor } from "./cardUtterance.js";
import { namesOneRegisterCard } from "./prCardKey.js";
import { normaliseSay } from "./relayAskText.js";
import { parseCallPointer } from "./unreadWords.js";

/** The mark kinds that say a turn was acted on: a card, or an answer. `no-ask` says it asked for nothing. */
const ACTED_KINDS: ReadonlySet<IntakeMark["kind"]> = new Set(["answered", "card"]);

/**
 * A relay row slug at the head of a mark's witness: `talk relay` names its row `talk-<12 hex>`. The relay is what makes
 * the turn a steer — the voice carried the owner's words to the chair as work — and its row is the work a session acts on.
 * The slug stands bare, or before a colon or whitespace: the chair's three measured shapes (27/13/52 of 92), and never
 * the head of a longer token such as `talk-<12 hex>_extra`.
 */
const RELAY_SLUG = /^talk-[0-9a-f]{12}(?=$|[:\s])/u;

/** One mark that names a voice-opened card but could not become a landing, and why. */
export interface IntakeLandingGap {
  readonly pointer: string;
  readonly why: string;
}

/** What the marks prove: the landings, and every voice-opened card a mark named that could not be landed. */
export interface IntakeLandings {
  readonly landings: readonly CardLandedRow[];
  readonly gaps: readonly IntakeLandingGap[];
}

/** One call's lines, or why they did not read. */
export type CallRead =
  { readonly kind: "read"; readonly entries: readonly CallEntry[] } | { readonly kind: "unread"; readonly why: string };

/** The call and segment an intake mark's pointer names, when it names one. */
function markedCallSegment({
  pointer,
}: {
  pointer: string;
}): { readonly callId: string; readonly segmentId: string } | undefined {
  const parsed = parseCallPointer({ text: pointer });
  if (parsed === undefined) {
    return undefined;
  }
  const body = parsed.slice(parsed.indexOf(":") + 1);
  const hash = body.indexOf("#");
  return { callId: body.slice(0, hash), segmentId: body.slice(hash + 1) };
}

/**
 * Every call an acted-on mark names, so the edge reads only those files.
 *
 * @param marks the intake ledger, in file order
 * @returns the distinct call ids, in the order first named
 */
export function markedCallIds({ marks }: { marks: readonly IntakeMark[] }): readonly string[] {
  const ids = marks
    .filter((mark) => ACTED_KINDS.has(mark.kind))
    .map((mark) => markedCallSegment({ pointer: mark.pointer })?.callId)
    .filter((callId): callId is string => callId !== undefined);
  return [...new Set(ids)];
}

/** The line a NON-EMPTY segment's words come from: its first final line, else its latest snapshot. */
function wordsLine({
  lines,
}: {
  lines: readonly Extract<CallEntry, { kind: "segment" }>[];
}): Extract<CallEntry, { kind: "segment" }> {
  const final = lines.find((line) => line.final);
  if (final !== undefined) {
    return final;
  }
  return lines.reduce((held, line) => (Date.parse(line.atIso) >= Date.parse(held.atIso) ? line : held));
}

/**
 * The owner's segment with this id, its words by `./callRecord.ts`'s own rule — a final line wins over any snapshot,
 * else the latest snapshot — so a partial arriving late never replaces a final; its card and the instant
 * the owner began it are the earliest line's, as `./cardUtterance.ts`'s stretch fold reads them.
 */
function ownerSegment({ entries, segmentId }: { entries: readonly CallEntry[]; segmentId: string }):
  | {
      readonly open: string | undefined;
      readonly openBy: "voice" | undefined;
      readonly text: string;
      readonly beganIso: string;
    }
  | undefined {
  const lines = entries.filter(
    (entry): entry is Extract<CallEntry, { kind: "segment" }> => entry.kind === "segment" && entry.id === segmentId,
  );
  if (lines.length === 0) {
    return undefined;
  }
  const first = lines.reduce((held, line) => (Date.parse(line.atIso) < Date.parse(held.atIso) ? line : held));
  // Whose segment it is is the earliest line's, as the stretch fold reads it: a later line cannot claim it.
  if (first.who !== "owner") {
    return undefined;
  }
  const words = wordsLine({ lines });
  let beganIso = first.atIso;
  if (first.beganIso !== undefined) {
    beganIso = first.beganIso;
  }
  return { beganIso, open: first.open, openBy: first.openBy, text: words.text };
}

/** What one mark proves: nothing, a gap, or a landing on a card the voice had open. */
type MarkProof =
  | { readonly kind: "nothing" }
  | { readonly kind: "gap"; readonly gap: IntakeLandingGap }
  | { readonly kind: "landed"; readonly landing: CardLandedRow };

/** The voice-opened card a mark's segment was spoken over, with its anchor, when it names one. */
function markedCard({ calls, mark }: { calls: ReadonlyMap<string, CallRead>; mark: IntakeMark }):
  | { readonly kind: "gap"; readonly gap: IntakeLandingGap }
  | {
      readonly kind: "card";
      readonly anchor: string;
      readonly cardKey: string;
      readonly segment: NonNullable<ReturnType<typeof ownerSegment>>;
      /** The anchors of the owner's other segments over the same card in this call. */
      readonly siblings: readonly string[];
    }
  | undefined {
  const named = markedCallSegment({ pointer: mark.pointer });
  if (!ACTED_KINDS.has(mark.kind) || named === undefined) {
    return undefined;
  }
  const read = calls.get(named.callId);
  if (read === undefined) {
    return { gap: { pointer: mark.pointer, why: `call ${named.callId} was not read` }, kind: "gap" };
  }
  if (read.kind === "unread") {
    return { gap: { pointer: mark.pointer, why: `call ${named.callId} did not read: ${read.why}` }, kind: "gap" };
  }
  const segment = ownerSegment({ entries: read.entries, segmentId: named.segmentId });
  // The shape is checked before the kind, and a bare `pr:<number>` names no one card.
  const open = segment?.open;
  const isCard = namesOneRegisterCard({ key: open });
  if (segment?.openBy !== "voice" || open === undefined || !isCard) {
    return undefined;
  }
  const anchor = callSegmentAnchor({ callId: named.callId, segmentId: named.segmentId });
  // Every other segment of the owner's over the same card in this call may be part of the same utterance, and a
  // ledger landing anchored at any of them already records it: deriving then would duplicate it.
  // Each candidate is folded whole, exactly as the marked one is, so a later line cannot make a segment the owner's.
  const otherIds = new Set(
    read.entries.flatMap((entry) => (entry.kind === "segment" && entry.id !== named.segmentId ? [entry.id] : [])),
  );
  const siblings = [...otherIds]
    .filter((segmentId) => ownerSegment({ entries: read.entries, segmentId })?.open === open)
    .map((segmentId) => callSegmentAnchor({ callId: named.callId, segmentId }));
  return { anchor, cardKey: open, kind: "card", segment, siblings };
}

/** What one mark proves, given the landings already derived and the ledger. */
function markProof({
  calls,
  derived,
  ledgerRows,
  mark,
  relaySlugs,
}: {
  calls: ReadonlyMap<string, CallRead>;
  derived: ReadonlyMap<string, CardLandedRow>;
  ledgerRows: readonly CardLandingRow[];
  mark: IntakeMark;
  relaySlugs: ReadonlySet<string>;
}): MarkProof {
  const card = markedCard({ calls, mark });
  if (card === undefined) {
    return { kind: "nothing" };
  }
  if (card.kind === "gap") {
    return card;
  }
  const { anchor, cardKey, segment, siblings } = card;
  const ledgered = utteranceLandings({ anchor, cardKey, laterAnchors: siblings, rows: ledgerRows }).length > 0;
  // An earlier mark on a sibling already derived this utterance's landing.
  const alreadyDerived = [anchor, ...siblings].some((at) => derived.has(`${at}\0${cardKey}`));
  if (alreadyDerived || ledgered) {
    return { kind: "nothing" };
  }
  // A turn the chair answered without relaying is the owner asking, not steering: the card still waits on the owner's word.
  const workSlug = RELAY_SLUG.exec(mark.witness)?.[0];
  if (workSlug === undefined) {
    return { kind: "nothing" };
  }
  // The shape is only `talk relay`'s mint; a row registered by hand under it is not a relay.
  if (!relaySlugs.has(workSlug)) {
    return { gap: { pointer: mark.pointer, why: `${workSlug} is no relay the receipt ledger carries` }, kind: "gap" };
  }
  // A restore lifts a derived landing by instant (`landingStillHolds`), so one marked at no readable instant could
  // never be lifted: it lands nothing, and says so.
  if (Number.isNaN(Date.parse(mark.markedAtIso))) {
    return {
      gap: { pointer: mark.pointer, why: `the mark's instant ${mark.markedAtIso} does not parse` },
      kind: "gap",
    };
  }
  const words = normaliseSay({ say: segment.text });
  if (words === "") {
    return { gap: { pointer: mark.pointer, why: `${cardKey}: the owner's segment carries no words` }, kind: "gap" };
  }
  const landing: CardLandedRow = {
    anchor,
    atIso: mark.markedAtIso,
    cardKey,
    decidedIso: segment.beganIso,
    kind: "landed",
    source: "intake",
    words,
    workSlug,
  };
  return { kind: "landed", landing };
}

/**
 * The landings the intake marks prove, one per utterance and card, earliest mark first. A mark whose utterance the
 * ledger already landed on that card — active or restored since — derives nothing: the ledger is the record there.
 *
 * @param marks the intake ledger, in file order
 * @param calls each call a mark names, read or with why not
 * @param ledgerRows the card-landing ledger, in file order
 * @param relaySlugs every slug a `talk relay` receipt carries: the only witnesses that make a turn a steer
 * @returns the derived landings and the gaps
 */
export function deriveIntakeCardLandings({
  calls,
  ledgerRows,
  marks,
  relaySlugs,
}: {
  calls: ReadonlyMap<string, CallRead>;
  ledgerRows: readonly CardLandingRow[];
  marks: readonly IntakeMark[];
  relaySlugs: ReadonlySet<string>;
}): IntakeLandings {
  const landings = new Map<string, CardLandedRow>();
  const gaps: IntakeLandingGap[] = [];
  // An undated mark would make the comparator answer NaN and leave dated ones out of order: sort the
  // dated ones, and let each undated one follow to report its gap.
  const undated = marks.filter((mark) => Number.isNaN(Date.parse(mark.markedAtIso)));
  const dated = marks
    .filter((mark) => !Number.isNaN(Date.parse(mark.markedAtIso)))
    .toSorted((a, b) => Date.parse(a.markedAtIso) - Date.parse(b.markedAtIso));
  const ordered = [...dated, ...undated];
  for (const mark of ordered) {
    const proof = markProof({ calls, derived: landings, ledgerRows, mark, relaySlugs });
    if (proof.kind === "gap") {
      gaps.push(proof.gap);
    } else if (proof.kind === "landed") {
      landings.set(`${proof.landing.anchor}\0${proof.landing.cardKey}`, proof.landing);
    }
  }
  return { gaps, landings: [...landings.values()] };
}

/**
 * The ledger's active landings, then each derived one the ledger has not lifted since it was marked.
 *
 * @param ledgerRows the card-landing ledger, in file order
 * @param derived the landings the intake marks prove
 * @returns every landing holding a card off the owner's queue
 */
export function activeCardLandingsWithIntake({
  derived,
  ledgerRows,
}: {
  derived: readonly CardLandedRow[];
  ledgerRows: readonly CardLandingRow[];
}): readonly CardLandedRow[] {
  const standing = derived.filter((landed) => landingStillHolds({ landed, rows: ledgerRows }));
  return [...activeCardLandings({ rows: ledgerRows }), ...standing];
}
