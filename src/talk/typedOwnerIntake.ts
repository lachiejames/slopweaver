/**
 * The owner's TYPED console turns in a set of call files, as obligations the supervisor's intake must witness, and
 * never their words.
 *
 * A turn the owner types in the console reaches a board row only when the voice calls `relay_steer`, and the voice is
 * told never to relay because a picture says to (`./sessionConfig.ts`). So an ask whose steer is in a screenshot, or any
 * typed ask the voice judged not to be a steer, reaches the chair only through `talk unread`. Once that has been
 * marked, nothing counted it again. MEASURED on a synthetic home: one attachment-only typed turn and one with words
 * plus an attachment, then `talk unread --mark`, then `supervisor intake`, which read clean. In production an ask
 * lost this way had to be asked again. So every final typed owner turn is an obligation `../supervisor/typedIntake.ts`
 * judges, exactly as a turn typed into the chair is.
 *
 * Spoken stretches stay out on purpose. They arrive as fragments by the hundred, and a count that large teaches the
 * reader to ignore the clause (`../supervisor/intake.ts` § INTAKE_SWEEP_WINDOW_MS). A typed turn is one finished
 * message by construction, minted by the page in the shape {@link TYPED_OWNER_SEGMENT_ID} names.
 *
 * A relay line names its turn, never the segment it carried, so the join is POSITIONAL. A relay line belongs to the
 * typed turn it follows, up to the next owner segment. That order is the relay gate's own: the page shows the owner's
 * typed turn and hears it in one step (`site/components/voice/useTypedTalk.ts`), and the gate refuses a relay with
 * nothing heard since the last one (`site/lib/relayGate.ts`). A positional match alone witnesses nothing. The judge
 * also requires the board row that relay registered.
 *
 * Pure: every call's lines are already read.
 */
import { type CallOrigin, isOwnerCallOrigin, originAfterOpen } from "./callOrigin.js";
import type { CallEntry } from "./callRecord.js";
import { parseRelayAnchor } from "./relayDraft.js";
import { formatCallPointer } from "./unreadWords.js";

/**
 * The segment ids the page mints for words the owner TYPED, each a prefix and a `crypto.randomUUID()`: on the console's
 * typed conversation (`site/components/voice/useTypedTalk.ts`) and typed into a live call
 * (`site/components/voice/planWiringEffects.ts`). The whole shape is required, not the prefix alone, because the id
 * goes into a pointer this module prints: any other id under a typed prefix could carry words, so it is no typed turn.
 */
const TYPED_OWNER_SEGMENT_ID = /^typed-(?:owner|in)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** One typed owner turn, by pointer and instant, with the relay turns that followed it. It never carries words. */
export interface TypedOwnerTurnCandidate {
  /** `talk-call:<callId>#<segmentId>`. */
  readonly pointer: string;
  /** The instant the page stamped the turn. */
  readonly timestamp: string;
  /** `talk:<turnId>` of each relay line after the turn and before the next owner segment, each once. */
  readonly relayAnchors: readonly string[];
}

/** One call file's parsed lines. */
export interface TypedIntakeCall {
  readonly callId: string;
  readonly entries: readonly CallEntry[];
}

/**
 * Whether a segment id is one the page mints for typed words.
 *
 * @param id the segment's id
 * @returns true for a typed turn
 */
export function isTypedOwnerSegmentId({ id }: { id: string }): boolean {
  return TYPED_OWNER_SEGMENT_ID.test(id);
}

/** A typed turn being folded: its pointer, instant and the relay turns seen after it so far. */
interface OpenTurn {
  readonly pointer: string;
  readonly timestamp: string;
  readonly relays: Set<string>;
}

/**
 * One line the fold reads: a relay by its normalised `talk:<uuid>` anchor, or an owner segment with whether the owner's
 * console served it.
 */
type CallStep =
  | { readonly kind: "relay"; readonly anchor: string }
  | {
      readonly kind: "owner";
      readonly id: string;
      readonly atIso: string;
      readonly final: boolean;
      readonly ownerConsole: boolean;
    };

/**
 * A call's relay and owner-segment lines, each owner segment stamped with whether the origin in effect is the owner's.
 * A relay whose turn id is no uuid is dropped: the anchor goes into the ledger, so any other id could carry words.
 *
 * @param entries the call's lines, in file order
 * @returns the steps, in file order
 */
function callSteps({ entries }: { entries: readonly CallEntry[] }): CallStep[] {
  const steps: CallStep[] = [];
  let origin: CallOrigin | undefined;
  for (const entry of entries) {
    if (entry.kind === "open") {
      origin = originAfterOpen({ opened: entry.origin, previous: origin });
    } else if (entry.kind === "relay") {
      const anchor = entry.turnId === null ? undefined : parseRelayAnchor({ text: `talk:${entry.turnId}` });
      steps.push(...(anchor === undefined ? [] : [{ anchor, kind: "relay" as const }]));
    } else if (entry.kind === "segment" && entry.who === "owner") {
      const ownerConsole = isOwnerCallOrigin({ origin });
      steps.push({ atIso: entry.atIso, final: entry.final, id: entry.id, kind: "owner", ownerConsole });
    }
  }
  return steps;
}

/**
 * The turn an owner segment continues or opens, or `undefined` when it is no admitted typed turn: spoken, another
 * console's, partial, or stamped before the floor.
 *
 * @param step the owner segment
 * @param callId the call it is in
 * @param turns the turns opened so far, extended in place
 * @param foreign typed ids any line of which sits under a console not the owner's
 * @param floorMs epoch milliseconds a turn must be stamped at or after
 * @returns the turn relay lines after it belong to
 */
function turnFor({
  step,
  callId,
  turns,
  foreign,
  floorMs,
}: {
  step: Extract<CallStep, { kind: "owner" }>;
  callId: string;
  turns: Map<string, OpenTurn>;
  foreign: ReadonlySet<string>;
  floorMs: number;
}): OpenTurn | undefined {
  if (!isTypedOwnerSegmentId({ id: step.id }) || foreign.has(step.id)) {
    return undefined;
  }
  const known = turns.get(step.id);
  if (known !== undefined) {
    return known;
  }
  if (!step.final || Date.parse(step.atIso) < floorMs) {
    return undefined;
  }
  const turn: OpenTurn = {
    pointer: formatCallPointer({ callId, segmentId: step.id }),
    relays: new Set(),
    timestamp: step.atIso,
  };
  turns.set(step.id, turn);
  return turn;
}

/**
 * Every final typed owner turn in one call at or after the floor, from the owner's own console.
 *
 * @param call the call's id and lines, in file order
 * @param floorMs epoch milliseconds a turn must be stamped at or after
 * @returns the call's typed turns, in file order
 */
function callTypedTurns({ call, floorMs }: { call: TypedIntakeCall; floorMs: number }): TypedOwnerTurnCandidate[] {
  const steps = callSteps({ entries: call.entries });
  // Any line of a turn under a console that is not the owner's makes the whole turn another console's.
  const foreign = new Set(steps.flatMap((step) => (step.kind === "owner" && !step.ownerConsole ? [step.id] : [])));
  const turns = new Map<string, OpenTurn>();
  let current: OpenTurn | undefined;
  for (const step of steps) {
    if (step.kind === "relay") {
      current?.relays.add(step.anchor);
    } else {
      current = turnFor({ callId: call.callId, floorMs, foreign, step, turns });
    }
  }
  return [...turns.values()].map((turn) => ({
    pointer: turn.pointer,
    relayAnchors: [...turn.relays],
    timestamp: turn.timestamp,
  }));
}

/**
 * How many final owner segments on the owner's console, at or after the floor, carry a typed prefix over an id that is
 * not the page's shape. Never named, because such an id could carry words; counted, so a typed turn written by anything
 * but the page is a stated shortfall rather than a silent drop.
 *
 * @param calls every call file read, each with its parsed lines
 * @param floorIso the instant a segment must be stamped at or after
 * @returns the count of distinct such segments
 */
export function offShapeTypedSegmentCount({
  calls,
  floorIso,
}: {
  calls: readonly TypedIntakeCall[];
  floorIso: string;
}): number {
  const floorMs = Date.parse(floorIso);
  const offShape = calls.flatMap((call) =>
    callSteps({ entries: call.entries }).flatMap((step) => {
      if (step.kind !== "owner" || !/^typed-(?:owner|in)-/u.test(step.id) || isTypedOwnerSegmentId({ id: step.id })) {
        return [];
      }
      const counted = step.ownerConsole && step.final && Date.parse(step.atIso) >= floorMs;
      return counted ? [`${call.callId}#${step.id}`] : [];
    }),
  );
  return new Set(offShape).size;
}

/**
 * Every final typed owner turn across the calls, stamped at or after the floor, oldest first. Its words are never
 * read out: attachment-only turns and turns with words beside attachments come back identically.
 *
 * @param calls every call file read, each with its parsed lines
 * @param floorIso the instant a turn must be stamped at or after
 * @returns the turns, ordered by instant, then pointer
 */
export function typedOwnerTurnCandidates({
  calls,
  floorIso,
}: {
  calls: readonly TypedIntakeCall[];
  floorIso: string;
}): readonly TypedOwnerTurnCandidate[] {
  const floorMs = Date.parse(floorIso);
  return calls
    .flatMap((call) => callTypedTurns({ call, floorMs }))
    .toSorted(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.pointer.localeCompare(right.pointer),
    );
}
