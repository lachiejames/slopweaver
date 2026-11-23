/**
 * What `/api/talk/relay` is posted and what its parse returns: the wire shape, its bounds, and the refusal arm every
 * field parser in `./talkRelayRequestFields.ts` and the parse in `./talkRelayRequest.ts` return.
 */
import { CARD_KEY } from "./cardKey";
import type { DiscussFirstWire } from "./discussFirst";
import type { RelayWorkspace } from "./relayWorkspace";
import {
  COPY_OFFER_LABEL_MAX_CODE_POINTS,
  COPY_OFFER_TEXT_MAX_CODE_POINTS,
  type CopyOfferWire,
} from "./runningListCopy";
import { RELAY_FRAME_DATA_URL_MAX } from "./screenFrame";
import type { TriageRulingWire } from "./triageWords";
import type { CandidateReaction } from "./workstreamCandidatesTypes";

/**
 * How much of the owner's transcribed words this route passes on, all of it to the verb on its stdin, which keeps every word
 * on the turn. A million UTF-16 units (`string.length`, which `heardSince` cuts at too, so the page never sends past
 * it; an astral character is two): over the longest call (`PLAN_CALL_LIMITS.lifetimeMs`, 90 minutes,
 * `./planCallContract.ts`) 11,111 a minute, far past any sustained speech, so what it bounds is a runaway log rather
 * than the owner; past it the page keeps their newest words. Two speech-rate bounds below it each fell to a
 * constructed stretch, and an argv-sized one to a large inherited environment, which is why the owner's words never
 * ride argv. At the bound the body is about 6 MB and the turn record at most about the same, under `safeJson`'s 32 MiB
 * warning. At 8,000 the route refused a stretch of 15,357 characters, and the page's tail cut that replaced the
 * refusal dropped the head instead. Repro: `grep -o "heard is [0-9]* characters[^\"]*"
 * $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 */
export const RELAY_HEARD_MAX = 1_000_000;

/**
 * The most one copy-tray offer costs in the body: six bytes for each code point of its message and label, the most one
 * costs JSON-escaped (`\u0000`; a code point past the BMP is four bytes raw, and a lone surrogate is refused), and room
 * for its id, `made` and keys.
 */
const RELAY_OFFER_MAX_BYTES = 6 * (COPY_OFFER_TEXT_MAX_CODE_POINTS + COPY_OFFER_LABEL_MAX_CODE_POINTS) + 1024;

/**
 * The body: a picture's data URL at its bound, the owner's words at theirs — six bytes for each UTF-16 unit, the most one
 * costs JSON-escaped (`\u0000`) — one copy-tray offer at its bound, and room for the reading and the JSON around them.
 */
export const RELAY_BODY_MAX_BYTES = RELAY_FRAME_DATA_URL_MAX + 6 * RELAY_HEARD_MAX + RELAY_OFFER_MAX_BYTES + 32 * 1024;

/** The card a relay is about — the one `./cardKey.ts` pattern `src/talk/relayDraft.ts` checks. */
export const ABOUT_KEY = CARD_KEY;

/** The shape `src/talk/relayDraft.ts` parses, restated here so a bad id is refused before a spawn. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** A read source's spelling: a tool name or a standing read. The verb checks it against its closed list. */
export const READ_SOURCE = /^[a-z][a-z_]{0,39}$/u;

/**
 * Why a relay carries no picture, as the verb spells it. `not-taken-this-turn`: the owner's screen is shared, but no frame was
 * taken on their word since the last relay, so the relay says so rather than grabbing one they never asked for.
 * `screen-recording-off`: the desktop app's own look was refused because macOS Screen Recording is off for it — no
 * share was open, so the row names the permission rather than a share that gave no frame.
 */
export type NoPictureReason = "screen-not-shared" | "capture-failed" | "screen-recording-off" | "not-taken-this-turn";

/** Every reason, in the order a refusal lists them. */
export const NO_PICTURE_REASON_LIST: readonly NoPictureReason[] = [
  "screen-not-shared",
  "capture-failed",
  "screen-recording-off",
  "not-taken-this-turn",
];

/** Every reason, for the parse. */
const NO_PICTURE_REASONS: ReadonlySet<string> = new Set<NoPictureReason>(NO_PICTURE_REASON_LIST);

/**
 * Whether a posted reason is one the verb spells.
 *
 * @returns true when the value is one of the verb's no-picture reasons
 */
export function isNoPictureReason(value: unknown): value is NoPictureReason {
  return typeof value === "string" && NO_PICTURE_REASONS.has(value);
}

/** What the page posts: the parse's input, spelled once so the widget builds exactly this. */
export interface TalkRelayWire {
  readonly turnId: string;
  readonly heard: string;
  /**
   * Whether `heard` ends mid-sentence: `cut` a call stretch was still open when the voice relayed, `whole` every one
   * had finished (`./relayGate.ts`'s `heardTailOf`). A record whose relay never said is never read as a whole yes.
   */
  readonly heardTail?: HeardTail;
  readonly about: string;
  /**
   * The OTHER Queue cards the owner's words also answer (`./alsoAnsweredCards.ts`), which the verb lands beside `about`
   * — each one the page served the owner this call and still held. Absent when none, and kept by a words-alone retry.
   */
  readonly alsoAnswers?: readonly string[];
  /** The voice's reading — present in full mode, ABSENT in heard-only mode. */
  readonly say?: string;
  readonly readsAfter: readonly string[];
  /** Present only on the retry of a refused relay: the owner's words alone, with no `say` and no `readsAfter`. */
  readonly wordsAlone?: true;
  /**
   * Present only when `about` is a check-in (`act:`) and the owner's words are their verdict on it: which cards that verdict
   * reaches — every card of the same kind in the same place, or this one alone (`src/talk/checkInRuling.ts`).
   */
  readonly covers?: CheckInCovers;
  /**
   * Present only when the owner's words are their ruling on a workstream candidate the voice read to them: its id and
   * the reaction, as a pair, never beside `covers` — one turn carries one ruling (`src/talk/candidateRuling.ts`).
   */
  readonly candidate?: string;
  readonly reaction?: CandidateReaction;
  /**
   * Present only in a triage pass, when the owner's words rule the card `about` names: the verdict, a label when one
   * was given, and what was wrong when it was named on a card sent back — never beside another ruling
   * (`src/talk/triageVocabulary.ts`).
   */
  readonly triage?: TriageRulingWire["verdict"];
  readonly label?: NonNullable<TriageRulingWire["label"]>;
  readonly feedback?: NonNullable<TriageRulingWire["feedback"]>;
  /**
   * Whose work the owner's words are, as the page placed them at hand-off (`./relayWorkspace.ts`) and carried
   * unchanged from there — absent when the card the owner spoke over is itself a finding, so the row stays one.
   */
  readonly workspace?: RelayWorkspace;
  /**
   * The newest copy-tray offer since the last relay (`./relayGate.ts`'s `offeredSince`), exactly as it landed — the text
   * the owner was reacting to, never a verdict on it. Absent when none landed, and on a words-alone retry.
   */
  readonly offered?: CopyOfferWire;
  /**
   * When the owner's words ask for a fix on a team repository (`./discussFirst.ts`): whether this relay puts the
   * discuss-first question or carries the ask past one this call put. Absent otherwise.
   */
  readonly discussFirst?: DiscussFirstWire;
  readonly screen:
    | { readonly kind: "attached"; readonly dataUrl: string }
    | { readonly kind: "none"; readonly reason: NoPictureReason };
  /** `e2e` when the desktop test instance sent it, which the route refuses before anything runs. */
  readonly instance?: "e2e";
}

/**
 * A relay as the page posts it: marked when the desktop test instance runs the call, so the route refuses it.
 *
 * @param wire the relay
 * @param instance `e2e` on the test instance, else `undefined`
 * @returns the relay, carrying the marker only when there is one
 */
export function relayWireForInstance({
  wire,
  instance,
}: {
  wire: TalkRelayWire;
  instance: "e2e" | undefined;
}): TalkRelayWire {
  if (instance === undefined) {
    return wire;
  }
  return { ...wire, instance };
}

/** The owner's ruling on a workstream candidate, as `talk relay --candidate --reaction` takes it. */
export interface CandidateRulingWire {
  readonly candidate: string;
  readonly reaction: CandidateReaction;
}

/** A candidate id's shape, the one the candidates file holds it to. */
export const CANDIDATE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;

/** Which cards the owner's verdict on a check-in reaches, as `talk relay --covers` spells it. */
export type CheckInCovers = "rule" | "this";

/** A check-in's queue key: the act the voice read out, the one prefix a ruling may name. */
export const CHECK_IN_KEY = /^act:[A-Za-z0-9._-]{1,160}$/u;

/** Whether the relayed words end mid-sentence, as `talk relay --heard-tail` spells it. */
export type HeardTail = "cut" | "whole";

/** A relay the route may spawn the verb for. */
export interface ParsedTalkRelay {
  readonly turnId: string;
  readonly heard: string;
  /** Whether `heard` ends mid-sentence, or `undefined` when the page did not say. */
  readonly heardTail: HeardTail | undefined;
  readonly about: string;
  /** The other Queue cards the owner's words also answer, in the order named; empty when none. */
  readonly alsoAnswers: readonly string[];
  /** The voice's reading, or `undefined` in heard-only mode. */
  readonly say: string | undefined;
  readonly readsAfter: readonly string[];
  /** Whether this is the retry of a refused relay, carrying the owner's words alone. */
  readonly wordsAlone: boolean;
  /** Which check-in cards the owner's verdict reaches, or `undefined` when the relay is not a ruling on one. */
  readonly covers: CheckInCovers | undefined;
  /** The owner's ruling on a workstream candidate, or `undefined` when the relay is not one. */
  readonly candidateRuling: CandidateRulingWire | undefined;
  /** The owner's triage verdict and label on the card `about` names, or `undefined` when the relay is not one. */
  readonly triageRuling: TriageRulingWire | undefined;
  /** Whose work the owner's words are, or `undefined` when the page stated none. */
  readonly workspace: RelayWorkspace | undefined;
  /** The copy-tray offer the owner was reacting to, exactly as it landed, or `undefined` when the relay carries none. */
  readonly offered: CopyOfferWire | undefined;
  /** The discuss-first question this relay put, or carried the owner's ask past, or `undefined` when it names no team fix. */
  readonly discussFirst: DiscussFirstWire | undefined;
  readonly screen:
    | { readonly kind: "attached"; readonly bytes: Uint8Array }
    | { readonly kind: "none"; readonly reason: NoPictureReason };
}

/**
 * What the parse came to: a relay, or the sentence and status of a refusal — and whether that refusal was of
 * the voice's reading or its reads alone, which a words-alone retry drops (`site/lib/relayRetry.ts`).
 */
export type TalkRelayParse =
  | { readonly kind: "relay"; readonly relay: ParsedTalkRelay }
  | {
      readonly kind: "refused";
      readonly why: string;
      readonly status: 400 | 403 | 413;
      readonly wordsAloneRetry: boolean;
    };

/** The refusal arm alone, which every helper below may return. */
export type Refused = Extract<TalkRelayParse, { readonly kind: "refused" }>;

/**
 * A refusal, spelled once.
 *
 * @returns the refusal arm, never retried as words alone
 */
export function refused({ why, status }: { why: string; status: 400 | 403 | 413 }): Refused {
  return { kind: "refused", status, why, wordsAloneRetry: false };
}

/**
 * The refusal for a relay the desktop TEST instance sent, or for a marker that is not exactly `e2e`. A relay types the
 * owner's steer into the chair's intake as theirs, and the walk's speech is never theirs, so a marked one is refused before the
 * route stages or spawns anything — a 403, never retried as words alone.
 *
 * @param value the body's `instance`
 * @returns the refusal, or `undefined` for a relay that carries no marker
 */
export function testInstanceRefusal({ value }: { value: unknown }): Refused | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== "e2e") {
    return refused({ status: 400, why: "instance must be e2e when present" });
  }
  return refused({
    status: 403,
    why: "the desktop e2e test instance relays nothing: its speech is the walk's, never the owner's steer",
  });
}

/**
 * How many reads one relay may name. Every read the gate can record is a distinct name — the read tools and the
 * standing reads (`RELAY_READ_SOURCES` in `src/talk/relayDraft.ts`) — so this is room above
 * that, never a cut below it: a relay refused for naming too many reads would lose the owner's words over something the
 * words alone never carried.
 */
export const RELAY_READS_MAX = 32;
