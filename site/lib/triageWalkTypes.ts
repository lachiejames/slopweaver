/**
 * The shapes of a voice triage pass (`./triageWalk.ts`): one Queue row as the walk reads it, one card's visit, the owner's
 * rulings, and the whole pass. Types only.
 */
import type { Kind } from "../components/console/queueKinds";
import type { QueueSection } from "./queueFocus";
import type { TriageLabel, TriageVerdict } from "./triageWords";
import type { WaitingTier } from "./waitingRank";

/** One Queue row as the walk reads it: what orders it, and its words' fingerprint. */
export interface TriageWalkRow {
  readonly key: string;
  readonly kind: Kind;
  readonly tier: WaitingTier;
  /** The section the Queue draws it in (`./queueFocus.ts`), its tier unless the owner's focus lifts it. */
  readonly section: QueueSection;
  readonly deferredIso?: string;
  /** Its card's words, so a card back with other words reads as rewritten. */
  readonly fingerprint: string;
}

/** One card's time in front of the owner. */
export interface TriageVisit {
  /** Said once by the call's time-up line, so a retried post never says it twice. */
  readonly visitId: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly presentedMs: number;
  /** A card the owner sent back, here again rewritten. */
  readonly rewritten: boolean;
  /** A card that reached the owner's Queue after the pass began. */
  readonly arrived: boolean;
  /** The owner has ruled it, so no clock is owed on it. */
  readonly ruled: boolean;
  /**
   * Its `open_card` went through: the card resolved on the owner's Queue and its words went to the voice to read out,
   * so it is the owner's to rule. Whether the screen moved does not decide it — a refused presentation is the "Open
   * cards" switch off, and the voice still reads the card. False while it opens, and a card whose open is refused is
   * never ruled: a relay running beside that open names a card the owner has not heard.
   */
  readonly opened: boolean;
}

/**
 * The card in front of the owner as the model's answer carrying a ruling BEGAN — the Codex turn's `turn/started`, as the page
 * heard it (`./triageTurnFronts.ts`): that visit's id, `undefined` when no card was. `seen: false` when the page never
 * heard that answer begin: the call named none, or it began before this page was listening.
 */
export type TriageFront = { readonly seen: true; readonly visitId: string | undefined } | { readonly seen: false };

/** One ruling the owner gave in the pass. */
export interface TriageRuled {
  readonly key: string;
  readonly verdict: TriageVerdict;
  readonly label: TriageLabel | undefined;
}

/** A card the owner ruled, with the words it was ruled on. */
export interface TriageSettled {
  readonly key: string;
  readonly fingerprint: string;
}

/** A card the owner sent back to be rewritten, and what the walk has seen of it since. */
export interface TriageOut {
  readonly key: string;
  readonly fingerprint: string;
  /** The walk has seen it off the owner's Queue since it was sent back. */
  readonly seenGone: boolean;
}

/** The whole pass. */
export interface TriageWalk {
  readonly walkId: string;
  /** The Queue's keys when the pass began, in the order the walk takes them. */
  readonly order: readonly string[];
  /**
   * The ordering basis: the board tags of the owner's focus when the order was last taken
   * (`QueueFocus.queueWorkstream`), each once, sorted. A focus switched on or off mid-pass changes it, and only then
   * are the unseen cards the pass began with re-ordered, an arrival still after them; a card
   * moving between tiers, or into or out of the owner's focus or their PR reviews while the focus stands, never
   * re-orders a pass, as nothing did before a focus existed.
   */
  readonly focus: readonly string[];
  /** Every key the owner has been shown, in the order shown; a rewritten card appears once. */
  readonly shown: readonly string[];
  readonly visits: number;
  readonly current: TriageVisit | undefined;
  /**
   * The card before the current one. The model may hand off the owner's ruling and ask for the next card in one
   * answer, and the two tool calls can run either way round, so a ruling naming the card just left is still
   * the ruling on THAT card, never on the one now in front of the owner — while neither is ruled (`triageVisitFor`,
   * `./triageWalk.ts`).
   */
  readonly previous: TriageVisit | undefined;
  readonly rulings: readonly TriageRuled[];
  readonly out: readonly TriageOut[];
  /** When `triage_next` last ran on it. */
  readonly touchedMs: number;
  /**
   * When `triage_end` stopped it (`stopTriageWalk`, `./triageWalkClock.ts`), until a `triage_next` picks it up;
   * `undefined` while it runs.
   */
  readonly stoppedMs: number | undefined;
  /**
   * Every card the owner has ruled, in this pass or one before it, once for each set of words it was ruled on —
   * recorded as the owner rules, so a second ruling on a card never forgets the first one's words. The walk never takes a card
   * while its words are any of those, judged at each pick, as a card the pass began with or as an arrival; with other
   * words it is a card to rule again.
   */
  readonly settled: readonly TriageSettled[];
  /**
   * The owner paused the clock (`triage_clock`): no time-up line on any card until they resume it. Without a pause
   * to call, the voice would end the pass, and the next one would begin again at the first card.
   */
  readonly paused: boolean;
}

/** The next card, and why it is next. */
export interface TriagePick {
  readonly visit: TriageVisit;
}
