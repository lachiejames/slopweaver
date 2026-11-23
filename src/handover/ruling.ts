/**
 * What the owner decided about a row, read out of the one register every other derived field is read from.
 *
 * The ruling is derived from state the way the board derives everything else, rather than spliced into the row
 * document, which would be a lossier form of communication and state tracking.
 *
 * ## The defect, measured
 *
 * `handover answer` records the owner's ruling as an `answered` event and never touches the row. MEASURED on one
 * install: of **333 `answered` events across 241 runs**, 45 declared a ruling in so many words and **39 sat on
 * a row whose own text had nowhere to carry one** — 29 of those with over half the ruling's own vocabulary
 * absent from the entire document. So a sweep reported that a lock the owner had ruled on the day before
 * had never been decided, and nothing on the board could have contradicted it. Reproduce by counting
 * `answered` events under `~/.slopweaver/runs/*.jsonl` and checking each row's front-matter for `ruling:`.
 *
 * ## Two projections, and the separation is the whole safety property
 *
 * {@link latestRuling} is what a row DISPLAYS: the latest decision, whether it was recorded as the owner gave it or
 * reconstructed from an answer by the backfill. {@link latestFindingRuling} is what a team-facing door may
 * ACT on: the latest one recorded because the owner ruled on that finding, never a reconstruction.
 *
 * One field could not carry both. A backfilled ruling is a true record of a decision and is NOT an answer to
 * the question the finding gate asks — "did the owner see this finding and say what may reach the team" — so a
 * migration that also moved a door would be laundering history into permission. Reading them apart also
 * means a backfill can never REVOKE a permission: a reconstruction with a later decision instant becomes the
 * displayed ruling without touching what the door reads.
 *
 * Pure: events and an already-parsed doc in, evidence out. No filesystem, no clock.
 */

import type { HandoverDoc } from "./doc.js";
import type { ExplicitSteer } from "./explicitSteerTypes.js";
import type { RulingEvent, RunEvent } from "./ledger.js";
import { type RulingIntegrityError, RulingIntegrityErrors } from "./rulingErrors.js";

/**
 * One ruling, with where it came from attached.
 *
 * A union rather than a record with optional fields, because the two arms genuinely differ: a register
 * ruling has a decision instant and may name the answer it was reconstructed from, and an authored one — the
 * front-matter pair `handover rule` wrote before the event kind existed — has neither and never will. A flat
 * shape would let a reader ask an authored ruling when it was decided and get `undefined` back as though the
 * answer were unknown rather than inapplicable.
 */
export type RulingEvidence =
  /** The `ruling:`/`rulingAnchor:` pair in the row’s own front-matter — the AUTHORED form, and still correct. */
  | { readonly from: "authored"; readonly words: string; readonly anchor: string }
  /** A `ruling` event on the row's journal, which is where every new ruling goes. */
  | { readonly from: "register"; readonly event: RulingEvent; readonly decidedIso: string };

/** What the owner said, whichever register it came out of. @param evidence the ruling to read @returns their words */
export function rulingWords({ evidence }: { evidence: RulingEvidence }): string {
  return evidence.from === "authored" ? evidence.words : evidence.event.ruling;
}

/** Where the owner said it. @param evidence the ruling to read @returns the anchor a reader can go and check */
export function rulingAnchor({ evidence }: { evidence: RulingEvidence }): string {
  return evidence.from === "authored" ? evidence.anchor : evidence.event.anchor;
}

/**
 * The `answered` event a ruling was reconstructed from, or `undefined` when the owner ruled and it was recorded.
 *
 * @param evidence the ruling to read
 * @returns the source instant, present only on a backfilled register ruling
 */
export function rulingBackfilledFrom({ evidence }: { evidence: RulingEvidence }): string | undefined {
  return evidence.from === "authored" ? undefined : evidence.event.backfilledFrom;
}

/**
 * One ruling's place in decision order.
 *
 * `decidedIso` when it has one, `atIso` when it does not — a journal written before the field existed, and
 * every live `handover rule`, where the two are the same instant by construction. The unparseable arm is not
 * defensive clutter: the write path refuses an unparseable instant, but a journal is a hand-editable file
 * and `NaN` compares false against everything, so ordering by a raw `Date.parse` would make every LATER
 * ruling on that row lose to one bad line and vanish from the row.
 *
 * @param event the ruling to place
 * @returns milliseconds since the epoch, or the earliest possible position when nothing parses
 */
export function rulingDecisionOrder({ event }: { event: RulingEvent }): number {
  const parsed = Date.parse(decidedIsoOf({ event }));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The instant the owner decided a ruling. A journal line written before `decidedIso` existed carries none, and that
 * line was a live `handover rule`, where deciding and recording are the same instant, so its `atIso` is it.
 */
function decidedIsoOf({ event }: { event: RulingEvent }): string {
  const { decidedIso } = event;
  if (decidedIso === undefined) {
    return event.atIso;
  }
  return decidedIso;
}

/**
 * A ruling's identity: where it was heard, when the owner decided, and what they said. Unique on a journal, because
 * {@link rulingAppendProblem} refuses a second record of the same decision.
 */
export interface RulingIdentity {
  readonly anchor: string;
  readonly decidedIso: string;
  readonly words: string;
}

/**
 * A journalled ruling's identity — the triple a reader compares two rulings by without holding either line.
 *
 * @param event the ruling
 * @returns its anchor, decision instant and words
 */
export function rulingIdentityOf({ event }: { event: RulingEvent }): RulingIdentity {
  return { anchor: event.anchor, decidedIso: decidedIsoOf({ event }), words: event.ruling };
}

/**
 * The latest ruling among a journal's events, by DECISION instant.
 *
 * ## Why decision time and not append order
 *
 * `artifact` — the register's other event-first field — takes the last event written and is right to: a
 * pointer corrected later is simply the truer pointer. A ruling is a dated decision, and the two orders come
 * apart the moment a backfill exists. The backfill of the 39 standing rulings appends TODAY's lines about
 * decisions the owner made earlier, so a row that has since gained a ruling would have it
 * superseded by an older one purely because the older one was written down later. Ties break toward the LAST
 * event, which is the append-order rule the rest of this register uses and the only ordering available when
 * two decisions share an instant.
 *
 * The whole journal is searched, never the current cycle: `currentCycle` is empty before the first
 * `started`, so a cycle-scoped read would lose every ruling on a row nobody ever ran — and there are 422 of
 * those on the measured board — and would lose an earlier cycle's ruling the moment a row was restarted.
 *
 * @param events the row's journal events, in order
 * @param liveOnly true to ignore reconstructions and consider only rulings recorded as the owner gave them
 * @returns the standing ruling event, or `undefined` when the journal holds none that qualify
 */
export function latestRulingEvent({
  events,
  liveOnly = false,
}: {
  events: readonly RunEvent[];
  liveOnly?: boolean;
}): RulingEvent | undefined {
  let standing: RulingEvent | undefined;
  let order = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (event.kind !== "ruling") {
      continue;
    }
    if (liveOnly && event.backfilledFrom !== undefined) {
      continue;
    }
    const placed = rulingDecisionOrder({ event });
    if (placed >= order) {
      standing = event;
      order = placed;
    }
  }
  return standing;
}

/** The row's front-matter ruling, which is only a ruling when both halves are there. */
function authoredRuling({ doc }: { doc: HandoverDoc }): RulingEvidence | undefined {
  if (doc.ruling === undefined || doc.rulingAnchor === undefined) {
    return undefined;
  }
  return { anchor: doc.rulingAnchor, from: "authored", words: doc.ruling };
}

/**
 * What this row SAYS the owner decided — the latest ruling of any provenance, or the front-matter pair when the
 * register is silent.
 *
 * The authored pair is the fallback and never competes on decision time: it has none, and inventing one to
 * sort it against events would be the second copy of a fact this whole design removes. So a row with any
 * ruling event reads that event, and a row with none reads what `handover rule` spliced into it before the
 * event kind existed — 90 rows on the measured board, every one of them still correct.
 *
 * @param doc the row as its front-matter declares it
 * @param events its journal's events, in order
 * @returns the standing ruling with its provenance, or `undefined` when nothing has ruled on this row
 */
export function latestRuling({
  doc,
  events,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
}): RulingEvidence | undefined {
  const event = latestRulingEvent({ events });
  if (event === undefined) {
    return authoredRuling({ doc });
  }
  return { decidedIso: decidedIsoOf({ event }), event, from: "register" };
}

/**
 * What a team-facing door may act on — the latest ruling recorded because the owner ruled, never a reconstruction.
 *
 * A backfilled ruling is skipped here whatever its decision instant, which is what makes the backfill
 * incapable of either manufacturing or revoking permission. The authored pair still counts: it was written
 * by `handover rule` in exactly the case this gate exists for.
 *
 * @param doc the row as its front-matter declares it
 * @param events its journal's events, in order
 * @returns the ruling a door may rely on, or `undefined` when only reconstructions and nothing else exist
 */
export function latestFindingRuling({
  doc,
  events,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
}): RulingEvidence | undefined {
  const event = latestRulingEvent({ events, liveOnly: true });
  if (event === undefined) {
    return authoredRuling({ doc });
  }
  return { decidedIso: decidedIsoOf({ event }), event, from: "register" };
}

/**
 * The row's standing EXPLICIT STEER — the latest ruling, when that ruling is one.
 *
 * Latest by decision instant, exactly as every other ruling read here: an ordinary ruling the owner gives later
 * supersedes the steer, because the exception is for the instance they named and their newest word is what stands. A
 * reconstruction counts: it is an answer the owner really gave, so one decided after the steer ENDS it, the
 * narrowing direction. It can never MAKE one, carrying none (`./rowEventSchema.ts`, `./rulingLineDecode.ts`).
 *
 * @param events the row's journal events, in order
 * @returns the steering ruling as the journal holds it, or `undefined` when the row's standing ruling is not one
 */
export function standingExplicitSteer({ events }: { events: readonly RunEvent[] }): SteerRuling | undefined {
  const event = latestRulingEvent({ events, liveOnly: false });
  return event !== undefined && isSteerRuling(event) ? event : undefined;
}

/** A ruling that carries an explicit steer, the field known present. */
export type SteerRuling = RulingEvent & { readonly explicitSteer: ExplicitSteer };

/**
 * Whether a ruling carries an explicit steer. A reconstruction never does, even one built in memory past the write
 * schema and the decoder that both refuse it: a backfill authors no override.
 */
function isSteerRuling(event: RulingEvent): event is SteerRuling {
  return event.explicitSteer !== undefined && event.backfilledFrom === undefined;
}

/** Whether two rulings record the same decision: same words, same anchor, same decision instant. */
function sameDecision({ left, right }: { left: RulingEvent; right: RulingEvent }): boolean {
  return (
    left.ruling === right.ruling &&
    left.anchor === right.anchor &&
    decidedIsoOf({ event: left }) === decidedIsoOf({ event: right })
  );
}

/**
 * Why this row's register refuses the ruling about to be appended to it — `undefined` when it may be.
 *
 * Two families of check, and both are FACTS rather than policy, so neither has an override.
 *
 * **Duplicate identity.** The same words, anchor and decision instant already on the journal is one decision
 * being recorded twice, which would make a row read as though the owner ruled the same way on two occasions. Equal
 * words at a DIFFERENT decision instant are two decisions and are both kept — the owner does say the same thing
 * twice.
 *
 * **Source integrity, for a reconstruction only.** A backfilled ruling must name exactly one `answered`
 * event on THIS row's journal, at that exact instant, whose decoded answer equals the words being recorded
 * byte for byte, and no earlier ruling may already name it. Nothing is extracted from the answer, so
 * substring games cannot arise: the adversarial case — an answer reading *The owner did
 * not say "raise the PR"; they said wait* yielding a ruling that says the opposite — needs a substring match
 * to exist at all.
 *
 * What this cannot do, said plainly rather than left to be discovered: exact equality proves what the
 * answering session RECORDED, never who said it. The register authenticates no human
 * (`.claude/rules/cross-session-messages.md`), so the words are that session's record of the owner's ruling and the
 * anchor is where to go and check it.
 *
 * @param event the ruling about to be appended
 * @param events the row's journal as it stands, decoded
 * @returns the one typed reason to refuse, or `undefined`
 */
export function rulingAppendProblem({
  event,
  events,
}: {
  event: RulingEvent;
  events: readonly RunEvent[];
}): RulingIntegrityError | undefined {
  for (const earlier of events) {
    if (earlier.kind !== "ruling") {
      continue;
    }
    if (sameDecision({ left: earlier, right: event })) {
      return RulingIntegrityErrors.alreadyRecorded({ decidedIso: decidedIsoOf({ event: earlier }) });
    }
    if (event.backfilledFrom !== undefined && earlier.backfilledFrom === event.backfilledFrom) {
      return RulingIntegrityErrors.sourceAlreadyRecorded({ sourceAtIso: event.backfilledFrom });
    }
  }
  return rulingSourceProblem({ event, events });
}

/**
 * Why a reconstruction's SOURCE does not check out against this journal — `undefined` when it does, or when
 * the ruling is not a reconstruction at all.
 *
 * The source half of {@link rulingAppendProblem}, exported so a READER applies the very rule the writer
 * applied rather than a second copy of it: `handover audit-rulings` asks whether an already-recorded
 * reconstruction still names exactly one answer that says what it says. Calling the whole append check there
 * would be wrong, because a recorded event is its own duplicate.
 *
 * @param event the ruling whose source is in question
 * @param events the row's journal, decoded
 * @returns the one typed reason the source does not hold, or `undefined`
 */
export function rulingSourceProblem({
  event,
  events,
}: {
  event: RulingEvent;
  events: readonly RunEvent[];
}): RulingIntegrityError | undefined {
  return event.backfilledFrom === undefined
    ? undefined
    : sourceProblem({ event, events, sourceAtIso: event.backfilledFrom });
}

/** The one spelling `Date.prototype.toISOString()` produces — and therefore every `atIso` this register writes. */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Whether an instant is in the canonical `toISOString()` spelling, which is the only spelling source matching
 * will compare.
 *
 * **It FAILS CLOSED, and that is the design rather than a limitation.** Five adversarial review passes each
 * found a new spelling that some comparison matched loosely: an offset, a sub-millisecond digit, an extended
 * `+002026` year, and a space-separated `0001-01-01 00:00:00.000Z` that `Date.parse` reads as the year 2001.
 * Every one of them is a way to name an answer the ruling does not come from. Normalising spellings is a
 * list that never ends, so none is normalised: in canonical form one instant has exactly one spelling, so
 * two answers at one moment have byte-identical `atIso` and plain string equality finds both. Anything else
 * is refused. Nothing is lost by it — every `atIso` this repository writes comes out of `toISOString()`.
 *
 * Exported so a manifest naming a source instant is held to the same spelling the source check will compare.
 *
 * @param iso the instant as it was written
 * @returns true only for the canonical spelling
 */
export function isCanonicalInstant({ iso }: { iso: string }): boolean {
  if (!CANONICAL_INSTANT.test(iso)) {
    return false;
  }
  // The shape alone admits a calendar that does not exist — `1999-02-30T12:00:00.000Z` fits it, and
  // `Date.parse` quietly rolls it over into March. So canonical is defined
  // as what it means: the text survives a round trip through `toISOString()` unchanged.
  const parsed = Date.parse(iso);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === iso;
}

/** The source half of {@link rulingAppendProblem}, split out to keep one reason per function. */
function sourceProblem({
  event,
  events,
  sourceAtIso,
}: {
  event: RulingEvent;
  events: readonly RunEvent[];
  sourceAtIso: string;
}): RulingIntegrityError | undefined {
  if (decidedIsoOf({ event }) !== sourceAtIso) {
    return RulingIntegrityErrors.sourceTimeInvalid({ decidedIso: decidedIsoOf({ event }), sourceAtIso });
  }
  // Matched by exact CANONICAL spelling — see `isCanonicalInstant` for the four review passes that set it.
  if (!isCanonicalInstant({ iso: sourceAtIso })) {
    return RulingIntegrityErrors.sourceMissing({ sourceAtIso });
  }
  const answers = events.filter(
    (earlier): earlier is Extract<RunEvent, { kind: "answered" }> => earlier.kind === "answered",
  );
  // Uniqueness is a claim about EVERY answer on the journal, so one in any other spelling means the claim
  // cannot be made — it could be the same moment written some other way.
  const unplaceable = answers.filter((earlier) => !isCanonicalInstant({ iso: earlier.atIso }));
  if (unplaceable.length > 0) {
    return RulingIntegrityErrors.sourceAmbiguous({ found: unplaceable.length, sourceAtIso });
  }
  const sources = answers.filter((earlier) => earlier.atIso === sourceAtIso);
  const source = sources[0];
  if (source === undefined) {
    return RulingIntegrityErrors.sourceMissing({ sourceAtIso });
  }
  if (sources.length > 1) {
    return RulingIntegrityErrors.sourceAmbiguous({ found: sources.length, sourceAtIso });
  }
  if (source.answer !== event.ruling) {
    return RulingIntegrityErrors.sourceWordsMismatch({ sourceAtIso });
  }
  return undefined;
}
