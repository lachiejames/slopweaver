/**
 * The relays the owner made AFTER a yes, on the same call, while the card the yes was on or one of the next two was up —
 * what `slack draft approve` and `slack draft record --approved` read before binding the yes
 * (`../cli/commands/slack/draftApprovalGate.ts`'s `draftApprovalLaterRelayError`).
 *
 * Why: in a triage pass the voice relays the owner's ruling and opens the next card in the same answer, about a
 * second later, so an "oh wait, no" said after that is relayed about the NEXT card. An approval that read only the
 * anchor's own relay would let a yes on card N still bind after the owner took it back on card N+1.
 *
 * The window is counted in CARDS, never time: it opens after the anchor and closes at the third card opened after it.
 * Only a `triage_next` or `open_card` line saying `card opened` moves it, so a refused or skipped open never shortens
 * it. Approval does not expire by age (`../../skills/slack/reference/read-before-and-after.md`), so neither does this.
 *
 * Fail-closed throughout: a call that cannot be found or read whole, or a later relay whose turn cannot be read, is an
 * error — the record cannot prove the owner did not take the yes back, and that is the one thing a yes must not assume.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ApprovalRelayReadError, ApprovalRelayReadErrors } from "./approvalRelayReadErrors.js";
import type { CallEntry } from "./callRecord.js";
import { readCallEntriesCounted, readCalls } from "./callStore.js";
import { CARD_KEY } from "./cardKey.js";
import { relayCutHold } from "./relayCutHold.js";
import { readTurn } from "./relayStore.js";
import type { TriageRuling } from "./triageVocabulary.js";

/**
 * How far before the anchor relay was staged a call file's last write may be and still hold it: the page writes the
 * relay's `sending` line a few milliseconds before `talk relay` stages the turn, and a later line normally follows.
 */
const CALL_WRITE_SLACK_MS = 60 * 60 * 1000;

/** The card key inside a tool line's detail, unanchored. */
const CARD_KEY_BODY = CARD_KEY.source.replace(/^\^/u, "").replace(/\$$/u, "");

/**
 * The detail `open_card` writes (`site/components/voice/openCardRun.ts`), behind the `triage N/M[, tag]: ` prefix
 * `triage_next` adds (`site/components/voice/triageRun.ts`): the key, then `card opened` when it went through.
 */
const CARD_OPENED = new RegExp(`^(?:triage \\d+/\\d+(?:, [a-z]+)?: )?(${CARD_KEY_BODY}), card opened(?:,|$)`, "u");

/** The tools whose `card opened` line puts a card in front of the owner. */
const OPENING_TOOLS: ReadonlySet<string> = new Set(["triage_next", "open_card"]);

/** What the yes was said on: a relay turn, or a landing of one stretch of a call. */
export type ApprovalRelayAnchor =
  | {
      readonly kind: "relay";
      /** The anchor as the caller spelled it, for errors. */
      readonly anchor: string;
      readonly turnId: string;
      /** When the relay turn was staged, which bounds the calls that can hold it. */
      readonly stagedAtIso: string;
      /** The card the relay was about. */
      readonly card: string;
    }
  | {
      readonly kind: "card-landing";
      readonly anchor: string;
      readonly callId: string;
      readonly segmentId: string;
      /** The card the stretch landed on. */
      readonly card: string;
    };

/** How many cards had opened since the yes when a later relay was made: 0 is still the yes's own card. */
export type CardDistance = 0 | 1 | 2;

/** A relay after the yes as the call line records it, before its turn file is read. */
export interface LaterRelayLine {
  readonly turnId: string;
  readonly about: string;
  /** What the call line says the owner said. */
  readonly heard: string;
  readonly cardDistance: CardDistance;
}

/** A relay after the yes, with what its turn file says the owner said and ruled. */
export interface ApprovalLaterRelay {
  readonly turnId: string;
  /** Every word the owner said or typed on that turn, as its turn file keeps them. */
  readonly heard: string;
  /**
   * What the call line says the owner said on that turn. Both are read, never one trusted over the other: a call and a turn
   * file that disagree on the owner's words are two records, and either carrying a take-back is enough.
   */
  readonly callHeard: string;
  /** The card it was about, or empty for none. */
  readonly about: string;
  /** The owner's triage ruling, or `null` when the relay carried none. */
  readonly triageRuling: TriageRuling | null;
  readonly cardDistance: CardDistance;
  /**
   * Whether the relay SAYS its words were whole — typed, or a voice relay marked whole (`./relayCutHold.ts`). A ruling
   * on words that may stop short of a "no, wait" is never read as the owner's, so it can refuse a yes and never stand one.
   */
  readonly wordsWhole: boolean;
}

/** The shape of {@link readApprovalLaterRelays}, for a deps object that injects it. */
export type ReadApprovalLaterRelays = (args: {
  anchor: ApprovalRelayAnchor;
  home: string;
}) => Result<readonly ApprovalLaterRelay[], ApprovalRelayReadError>;

/**
 * The card a tool line opened, or `undefined` when it opened none — refused, skipped, a read, or another tool.
 *
 * @param entry one call line
 * @returns the card key
 */
export function cardOpenedBy({ entry }: { entry: CallEntry }): string | undefined {
  if (entry.kind !== "tool" || entry.refused || !OPENING_TOOLS.has(entry.name)) {
    return undefined;
  }
  return CARD_OPENED.exec(entry.detail)?.[1];
}

/**
 * The relays made after the yes on this call, in the order the owner spoke, while its card or one of the next two opened was up — each turn once, at its first line, and never the anchor's own turn.
 * Spoken order is the lines' instants, file order only on a tie: a keepalive batch can land ahead of an earlier one, and
 * the sink stamps every line strictly after the one queued before it (`site/lib/transcriptSink.ts`).
 *
 * @param anchor what the yes was said on
 * @param entries the call's lines as written
 * @returns the later relays, or why the call cannot say: the anchor is not on it, any turn on it has lines that
 *   disagree, or a relay inside the window carries no turn — a relay the gate shut keeps no words, so what the owner said
 *   there is unknown
 */
export function laterRelayLines({
  anchor,
  entries,
}: {
  anchor: ApprovalRelayAnchor;
  entries: readonly CallEntry[];
}): Result<readonly LaterRelayLine[], ApprovalRelayReadError> {
  const spoken = entries.toSorted((a, b) => spokenOrder({ a: a.atIso, b: b.atIso }));
  const start = anchorIndex({ anchor, entries: spoken });
  if (start === -1) {
    return err(ApprovalRelayReadErrors.callMissing({ anchor: anchor.anchor }));
  }
  const disagreeing = firstDisagreement({ spoken });
  if (disagreeing !== undefined) {
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why: disagreeing }));
  }
  const seen = relayTurnsIn({ entries: spoken.slice(0, start + 1) });
  const later: LaterRelayLine[] = [];
  for (const { distance, entry } of windowEntries({ after: spoken.slice(start + 1), card: anchor.card })) {
    if (entry.kind !== "relay") {
      continue;
    }
    if (entry.turnId === null) {
      const why = `the relay at ${entry.atIso} was ${entry.outcome} before it kept the owner's words`;
      return err(ApprovalRelayReadErrors.laterRelayUnreadable({ anchor: anchor.anchor, turnId: null, why }));
    }
    if (seen.has(entry.turnId)) {
      continue;
    }
    seen.add(entry.turnId);
    later.push({ about: entry.about, cardDistance: distance, heard: entry.heard, turnId: entry.turnId });
  }
  return ok(later);
}

/** The relay turns these lines carry, so a turn already relayed by the yes or before it is never read as later. */
function relayTurnsIn({ entries }: { entries: readonly CallEntry[] }): Set<string> {
  const turns = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "relay" && entry.turnId !== null) {
      turns.add(entry.turnId);
    }
  }
  return turns;
}

/**
 * The lines after the yes that sit inside the window, each with how many cards had opened by then — the lines that
 * opened a new card left out, and the walk stopped at the third card opened after the yes. Lazy, so a caller that
 * stops at an unreadable relay reads no line past it.
 */
function* windowEntries({
  after,
  card,
}: {
  after: readonly CallEntry[];
  card: string;
}): Generator<{ entry: CallEntry; distance: CardDistance }> {
  let current = card;
  let distance: CardDistance = 0;
  for (const entry of after) {
    const opened = cardOpenedBy({ entry });
    if (opened === undefined || opened === current) {
      yield { distance, entry };
      continue;
    }
    const next = nextDistance({ distance });
    if (next === undefined) {
      return;
    }
    distance = next;
    current = opened;
  }
}

/**
 * The first turn anywhere on the call whose lines disagree on the card or the owner's words, said as the reason the call
 * cannot be read whole — or `undefined` when every turn's lines agree. The page writes every line of one relay from
 * the same attempt (`outcome`, `detail` and `say` move as it runs; `about` and `heard` never do), so a disagreement is a
 * damaged record wherever it sits, and checking the whole call leaves no line placement to hide one in.
 */
function firstDisagreement({ spoken }: { spoken: readonly CallEntry[] }): string | undefined {
  const firstLines = new Map<string, { about: string; heard: string }>();
  for (const entry of spoken) {
    if (entry.kind !== "relay" || entry.turnId === null) {
      continue;
    }
    const first = firstLines.get(entry.turnId);
    if (first === undefined) {
      firstLines.set(entry.turnId, { about: entry.about, heard: entry.heard });
      continue;
    }
    if (first.about !== entry.about || first.heard !== entry.heard) {
      return `talk:${entry.turnId}'s lines disagree on what it was about or what the owner said (at ${entry.atIso})`;
    }
  }
  return undefined;
}

/**
 * The relays the owner made after a yes, read off the call it was said on and each relay's own turn file.
 *
 * @param anchor what the yes was said on
 * @param home the Slopweaver home the call and turn files live under
 * @returns the later relays in the window, or why the record cannot say what the owner said after the yes
 */
export function readApprovalLaterRelays({
  anchor,
  home,
}: {
  anchor: ApprovalRelayAnchor;
  home: string;
}): Result<readonly ApprovalLaterRelay[], ApprovalRelayReadError> {
  const callId = approvalCallId({ anchor, home });
  if (callId.isErr()) {
    return err(callId.error);
  }
  const read = readCallEntriesCounted({ callId: callId.value, home });
  if (read.isErr()) {
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why: read.error.message }));
  }
  if (read.value.skipped > 0) {
    const why = `${String(read.value.skipped)} line(s) of call ${callId.value} do not parse`;
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why }));
  }
  const lines = laterRelayLines({ anchor, entries: read.value.entries });
  if (lines.isErr()) {
    return err(lines.error);
  }
  const relays: ApprovalLaterRelay[] = [];
  for (const line of lines.value) {
    const relay = laterRelayOf({ anchor: anchor.anchor, home, line });
    if (relay.isErr()) {
      return err(relay.error);
    }
    relays.push(relay.value);
  }
  return ok(relays);
}

/**
 * Which of two instants the owner spoke first: by millisecond, then by any digits past it, which `Date.parse` drops
 * — negative when `a` is first, 0 on a true tie so a stable sort keeps file order.
 */
function spokenOrder({ a, b }: { a: string; b: string }): number {
  const byMs = Date.parse(a) - Date.parse(b);
  if (byMs !== 0) {
    return byMs;
  }
  const subA = subMillisecondDigits({ iso: a });
  const subB = subMillisecondDigits({ iso: b });
  const width = Math.max(subA.length, subB.length);
  return subA.padEnd(width, "0").localeCompare(subB.padEnd(width, "0"));
}

/**
 * The fraction-of-a-second digits past the third, `""` when an instant carries none. Anchored to the seconds, since
 * the call schema takes anything `Date.parse` reads and a dotted date carries digits after a dot too.
 */
function subMillisecondDigits({ iso }: { iso: string }): string {
  const fraction = /:\d{2}\.(\d+)/u.exec(iso);
  if (fraction === null) {
    return "";
  }
  return fraction[1]!.slice(3);
}

/** Where the yes sits in the call's lines: a relay's first line, or a stretch's last snapshot; -1 when absent. */
function anchorIndex({ anchor, entries }: { anchor: ApprovalRelayAnchor; entries: readonly CallEntry[] }): number {
  if (anchor.kind === "relay") {
    return entries.findIndex((entry) => entry.kind === "relay" && entry.turnId === anchor.turnId);
  }
  return entries.findLastIndex((entry) => entry.kind === "segment" && entry.id === anchor.segmentId);
}

/** The distance once one more card opens, or `undefined` when that card is past the window. */
function nextDistance({ distance }: { distance: CardDistance }): CardDistance | undefined {
  if (distance === 0) {
    return 1;
  }
  if (distance === 1) {
    return 2;
  }
  return undefined;
}

/**
 * The one call the yes was said on: named by a landing's anchor, or the single recent call whose relays carry the
 * turn. Any recent call that could not be read might be that call, so it refuses rather than passing over it. The
 * approval's fence locks the call this names (`./callFence.ts`), so the later relays it reads cannot move under it.
 *
 * @param anchor what the yes was said on
 * @param home the Slopweaver home the call files live under
 * @returns the call id, or why no one call holds the yes
 */
export function approvalCallId({
  anchor,
  home,
}: {
  anchor: ApprovalRelayAnchor;
  home: string;
}): Result<string, ApprovalRelayReadError> {
  if (anchor.kind === "card-landing") {
    return ok(anchor.callId);
  }
  const staged = Date.parse(anchor.stagedAtIso);
  if (Number.isNaN(staged)) {
    const why = `the relay's staged instant ${anchor.stagedAtIso} is not an instant`;
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why }));
  }
  const sinceIso = new Date(staged - CALL_WRITE_SLACK_MS).toISOString();
  const calls = readCalls({ home, keep: { sinceIso } });
  if (calls.isErr()) {
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why: calls.error.message }));
  }
  if (calls.value.unreadable.length > 0) {
    const why = calls.value.unreadable.join("; ");
    return err(ApprovalRelayReadErrors.callUnreadable({ anchor: anchor.anchor, why }));
  }
  const holding = calls.value.calls
    .filter((call) => call.notes.some((note) => note.kind === "relay" && note.turnId === anchor.turnId))
    .map((call) => call.callId);
  const only = holding[0];
  if (only === undefined) {
    return err(ApprovalRelayReadErrors.callMissing({ anchor: anchor.anchor }));
  }
  if (holding.length > 1) {
    return err(ApprovalRelayReadErrors.callAmbiguous({ anchor: anchor.anchor, callIds: holding }));
  }
  return ok(only);
}

/** One later relay with its turn file's words and ruling; a turn the call and its file disagree on is unreadable. */
function laterRelayOf({
  anchor,
  home,
  line,
}: {
  anchor: string;
  home: string;
  line: LaterRelayLine;
}): Result<ApprovalLaterRelay, ApprovalRelayReadError> {
  const unreadable = ({ why }: { why: string }) =>
    err(ApprovalRelayReadErrors.laterRelayUnreadable({ anchor, turnId: line.turnId, why }));
  const turn = readTurn({ home, turnId: line.turnId });
  if (turn.isErr()) {
    return unreadable({ why: turn.error.message });
  }
  if (turn.value.about !== line.about) {
    return unreadable({ why: `the call says it was about "${line.about}", its turn file "${turn.value.about}"` });
  }
  const ruling = turn.value.triageRuling;
  if (ruling === undefined) {
    return unreadable({ why: "its turn file predates storing the owner's triage ruling" });
  }
  return ok({
    about: line.about,
    callHeard: line.heard,
    cardDistance: line.cardDistance,
    heard: turn.value.heard,
    triageRuling: ruling,
    turnId: line.turnId,
    wordsWhole: turn.value.typed || relayCutHold({ heardTailCut: turn.value.heardTailCut }) === undefined,
  });
}
