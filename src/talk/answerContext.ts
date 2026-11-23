/**
 * What the owner's words ANSWERED — the voice's turn before them and the triage verdict the relay stored — pure: a
 * call's lines and a turn's ruling in, one context out, and the lines every reading surface prints it as.
 *
 * The incident this closes: the voice asked "Needs more info here too?" and the owner answered with a bare yes. The
 * relay stored needs-more-info only in its row's prose, and the chair read the owner's words through three surfaces —
 * the relay's typed line, `talk unread` and the approved-draft tick gate — each printing that yes with no question
 * beside it. After a compaction the gate listed `slack draft approve` first and the chair ran it. A
 * bare "yes" is unreadable without what it answered, so every surface prints this.
 *
 * ## Which voice turn the owner answered
 *
 * The voice segment that BEGAN last, strictly before the owner's first segment of the stretch began, taken whole. A
 * voice turn of several sentences is one segment, so "Needs more info. Next: … Needs more info here too?" stays
 * together; the voice's "Yep, on it." after the owner's words began later, so it is never the question. Order is `beganIso`, the order
 * `foldCall` sorts segments in, never file position: a batch can land out of order (`./callRecord.ts`).
 *
 * ## A relay's words, found in its call
 *
 * A relay turn (`talk:<turnId>`) records no call. The call that carries a `relay` line for that turn is its call, and
 * the owner's stretch is the run of the owner's consecutive segments, begun before that line, whose words the relay's `heard` carries.
 * A turn whose call never recorded the relay — a typed steer, or a line still in flight — reads as not found, saying
 * so, never as a guess at the nearest question.
 */
import { type CallEntry, type CallSegment, OWNER_SPEAKER } from "./callRecord.js";
import { callSegmentAnchor } from "./cardUtterance.js";
import { type TriageRuling, triageRulingLine } from "./triageVocabulary.js";

/** The voice's turn the owner's words answered, and where to read it whole. */
export interface AnsweredVoiceTurn {
  /** `talk-call:<callId>#<segment id>`. */
  readonly pointer: string;
  readonly text: string;
  readonly beganIso: string;
}

/** The voice turn as a surface reads it: found, not found and why, or why the call could not be read. */
export type VoiceTurnRead =
  | { readonly kind: "found"; readonly turn: AnsweredVoiceTurn }
  | { readonly kind: "not-found"; readonly why: string }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * The triage verdict as a surface reads it. `none`: the relay carried no ruling. `not-recorded`: the turn was written
 * before relays stored one, so only its row's prose may say. `not-applicable`: no relay carried the owner's words, so none
 * could have ruled.
 */
export type TriageVerdictRead =
  | { readonly kind: "stored"; readonly ruling: TriageRuling }
  | { readonly kind: "none" }
  | { readonly kind: "not-recorded"; readonly slug: string }
  | { readonly kind: "not-applicable" }
  | { readonly kind: "unreadable"; readonly why: string };

/** What one utterance of the owner's answered. */
export interface AnswerContext {
  readonly voice: VoiceTurnRead;
  readonly triage: TriageVerdictRead;
}

/** What an anchor names for this read: a relay turn, one call utterance, or nothing a call can explain. */
export type AnswerContextRequest =
  | { readonly kind: "relay"; readonly turnId: string }
  | { readonly kind: "call"; readonly callId: string; readonly anchor: string }
  | { readonly kind: "other"; readonly anchor: string };

/** How many characters of the voice's turn a surface quotes — its END, where the question sits. */
export const ANSWERED_VOICE_CHARS = 240;

const CALL_ANCHOR = /^call:([0-9a-f-]{36})#.+$/u;

/**
 * Which read an utterance anchor asks for. A relay's turnId is lowercased, the spelling a turn is minted and filed in,
 * so the same UUID cased otherwise reads the same turn on a case-sensitive disk as on the owner's.
 *
 * @param anchor a landing's anchor: `talk:<turnId>`, `call:<callId>#<segment>`, or anything a session wrote
 * @returns the request
 */
export function answerContextRequestOf({ anchor }: { anchor: string }): AnswerContextRequest {
  if (anchor.startsWith("talk:") && anchor.length > "talk:".length) {
    return { kind: "relay", turnId: anchor.slice("talk:".length).toLowerCase() };
  }
  const call = CALL_ANCHOR.exec(anchor);
  if (call?.[1] !== undefined) {
    return { anchor, callId: call[1], kind: "call" };
  }
  return { anchor, kind: "other" };
}

/**
 * The voice's turn one segment of the owner's answered: the voice segment that began last, strictly before it began.
 *
 * @param callId the call, for the pointer
 * @param segments the call's segments in `foldCall` order, sorted by when each began
 * @param ownerSegmentId the owner's segment — the first of their stretch
 * @returns the voice's turn, or `undefined` when the owner's segment is not there or no voice segment began before it
 */
export function answeredVoiceTurn({
  callId,
  ownerSegmentId,
  segments,
}: {
  callId: string;
  ownerSegmentId: string;
  segments: readonly CallSegment[];
}): AnsweredVoiceTurn | undefined {
  const owner = segments.find((segment) => segment.id === ownerSegmentId && segment.who === OWNER_SPEAKER);
  if (owner === undefined) {
    return undefined;
  }
  const began = Date.parse(owner.beganIso);
  const voice = segments.findLast((segment) => segment.who === "voice" && Date.parse(segment.beganIso) < began);
  if (voice === undefined) {
    return undefined;
  }
  return { beganIso: voice.beganIso, pointer: `talk-call:${callId}#${voice.id}`, text: voice.text.trim() };
}

/**
 * The voice's turn one call utterance answered, its anchor matched as `talk transcript` mints it.
 *
 * @param anchor `call:<callId>#<first segment id>`, or its hashed form
 * @param segments the call's segments in `foldCall` order
 * @returns the read
 */
export function voiceForCallAnchor({
  anchor,
  callId,
  segments,
}: {
  anchor: string;
  callId: string;
  segments: readonly CallSegment[];
}): VoiceTurnRead {
  const owner = segments.find(
    (segment) => segment.who === OWNER_SPEAKER && callSegmentAnchor({ callId, segmentId: segment.id }) === anchor,
  );
  if (owner === undefined) {
    return { kind: "not-found", why: `call ${callId} holds no segment of the owner's that ${anchor} names` };
  }
  return voiceBefore({ callId, ownerSegmentId: owner.id, segments });
}

/**
 * The voice's turn a relay's words answered: the owner's stretch found in the call carrying the relay's line, then the voice
 * segment before it.
 *
 * @param callId the call whose lines these are
 * @param entries the call's lines in file order
 * @param segments the call's segments in `foldCall` order
 * @param turnId the relay turn
 * @param heard every word the relay carried of the owner's
 * @returns the read
 */
export function voiceForRelay({
  callId,
  entries,
  heard,
  segments,
  turnId,
}: {
  callId: string;
  entries: readonly CallEntry[];
  heard: string;
  segments: readonly CallSegment[];
  turnId: string;
}): VoiceTurnRead {
  const relay = entries.find((entry) => entry.kind === "relay" && entry.turnId?.toLowerCase() === turnId.toLowerCase());
  if (relay === undefined) {
    return { kind: "not-found", why: `call ${callId} records no relay line for turn ${turnId}` };
  }
  const first = firstSegmentCarried({ before: Date.parse(relay.atIso), heard, segments });
  if (first === undefined) {
    return { kind: "not-found", why: `no owner segment before the relay line in call ${callId} carries its words` };
  }
  return voiceBefore({ callId, ownerSegmentId: first, segments });
}

/** The voice's turn before one segment of the owner's, or why there is none. */
function voiceBefore({
  callId,
  ownerSegmentId,
  segments,
}: {
  callId: string;
  ownerSegmentId: string;
  segments: readonly CallSegment[];
}): VoiceTurnRead {
  const turn = answeredVoiceTurn({ callId, ownerSegmentId, segments });
  if (turn === undefined) {
    return { kind: "not-found", why: `the voice said nothing in call ${callId} before the owner's words began` };
  }
  return { kind: "found", turn };
}

/**
 * The first segment of a run of the owner's segments, begun before the relay line, whose words joined are exactly
 * `heard`'s — the latest such run, the voice's turns between them skipped. Exact, so a later segment whose words merely
 * end `heard` ("please" inside "yes please") is never taken for the run.
 *
 * @returns the run's first segment's index, or `undefined` when no run of the owner's carries exactly what the relay heard
 */
function exactRunStart({
  before,
  heard,
  segments,
}: {
  before: number;
  heard: string;
  segments: readonly CallSegment[];
}): number | undefined {
  const target = normalisedWords({ text: heard });
  const ownerSegments = segments.flatMap((segment, index) => {
    const words = segment.who === OWNER_SPEAKER ? normalisedWords({ text: segment.text }) : "";
    return words !== "" && Date.parse(segment.beganIso) < before ? [{ index, words }] : [];
  });
  for (let end = ownerSegments.length - 1; end >= 0; end -= 1) {
    let joined = "";
    for (let start = end; start >= 0; start -= 1) {
      joined = joined === "" ? ownerSegments[start]!.words : `${ownerSegments[start]!.words} ${joined}`;
      if (joined === target) {
        return ownerSegments[start]!.index;
      }
      if (joined.length >= target.length || !target.endsWith(` ${joined}`)) {
        break;
      }
    }
  }
  return undefined;
}

/**
 * The first segment of the owner's stretch the relay carried. A run of the owner's segments whose words are exactly
 * `heard`'s decides ({@link exactRunStart}). Failing that — a transcript that drifted from what the relay heard — the
 * latest segment of the owner's, begun before the relay line, whose words `heard` carries, then back through each
 * earlier segment of the owner's whose words `heard` carries BEFORE the ones already matched. Either way the walk
 * crosses the voice's turns: a relay that heard "yes" and then "actually no" around a second question began at the
 * first, so the turn it answered is the one before "yes". Requiring each earlier match to sit earlier in `heard`
 * keeps a word the owner said in a previous relay from pulling the walk back.
 */
function firstSegmentCarried({
  before,
  heard,
  segments,
}: {
  before: number;
  heard: string;
  segments: readonly CallSegment[];
}): string | undefined {
  const exact = exactRunStart({ before, heard, segments });
  if (exact !== undefined) {
    return segments[exact]!.id;
  }
  const carried = ` ${normalisedWords({ text: heard })} `;
  const needleOf = (segment: CallSegment): string | undefined => {
    const words = segment.who === OWNER_SPEAKER ? normalisedWords({ text: segment.text }) : "";
    return words === "" ? undefined : ` ${words} `;
  };
  const last = segments.findLastIndex((segment) => {
    const needle = needleOf(segment);
    return Date.parse(segment.beganIso) < before && needle !== undefined && carried.includes(needle);
  });
  if (last === -1) {
    return undefined;
  }
  let first = last;
  let at = carried.lastIndexOf(needleOf(segments[last]!)!);
  for (let index = last - 1; index >= 0; index -= 1) {
    const needle = needleOf(segments[index]!);
    if (needle === undefined) {
      continue;
    }
    // The latest start that still ends on the space this match shares with the one after it.
    const latestStart = at - needle.length + 1;
    const found = latestStart < 0 ? -1 : carried.lastIndexOf(needle, latestStart);
    if (found === -1) {
      break;
    }
    first = index;
    at = found;
  }
  return segments[first]!.id;
}

/** Words only, lowercased and single-spaced, so a transcript's punctuation never decides a match. */
function normalisedWords({ text }: { text: string }): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

/**
 * The verdict a relay turn's stored ruling reads as.
 *
 * @param triageRuling the turn record's field: absent on a turn written before relays stored one, `null` for none
 * @param slug the relay's row, whose prose a not-recorded verdict points at
 * @returns the read
 */
export function triageVerdictOf({
  slug,
  triageRuling,
}: {
  slug: string;
  triageRuling: TriageRuling | null | undefined;
}): TriageVerdictRead {
  if (triageRuling === undefined) {
    return { kind: "not-recorded", slug };
  }
  if (triageRuling === null) {
    return { kind: "none" };
  }
  return { kind: "stored", ruling: triageRuling };
}

/**
 * Whether the verdict makes "not the owner's yes" the judgement a surface leads with: anything but a stored send-it, no ruling
 * carried, or a landing no relay ruled on. A verdict nobody can read leads with the hold too — the safe way round.
 *
 * @param triage the verdict as read
 * @returns true when the hold command goes first
 */
export function verdictLeadsWithHold({ triage }: { triage: TriageVerdictRead }): boolean {
  if (triage.kind === "stored") {
    return triage.ruling.verdict !== "send-it";
  }
  return triage.kind === "not-recorded" || triage.kind === "unreadable";
}

/**
 * The voice's turn as a surface quotes it: its last {@link ANSWERED_VOICE_CHARS} characters, cut from the front.
 * Control characters flatten to a space with the whitespace, so no character of the quote escapes to more than its
 * UTF-8 bytes in a `--json` report — `\u0001` would be six, as would a lone surrogate — and the quote is at most three
 * bytes a character.
 *
 * @param text the voice's whole turn
 * @param chars how many characters to keep
 * @returns the quote, double quotes turned single so it nests in a line
 */
export function quotedVoice({ chars, text }: { chars: number; text: string }): string {
  const flat = text
    .replaceAll(/[\s\p{Cc}]+/gu, " ")
    .trim()
    .replaceAll('"', "'");
  if (flat.length <= chars) {
    return flat.toWellFormed();
  }
  // A cut can split a surrogate pair, and a lone surrogate escapes to six bytes, so the quote is made well-formed.
  return `… ${flat.slice(flat.length - Math.max(0, chars - 2))}`.toWellFormed();
}

/**
 * A reason, or a slug, as a surface prints it: its first {@link ANSWERED_VOICE_CHARS} characters, flattened as
 * {@link quotedVoice} flattens a quote. A reason can join every unreadable call file's error, and a hand-edited record
 * can carry any slug, so either carried whole could outgrow the part a report must fit.
 */
function boundedText({ text }: { text: string }): string {
  const flat = text
    .replaceAll(/[\s\p{Cc}]+/gu, " ")
    .trim()
    .replaceAll('"', "'");
  if (flat.length <= ANSWERED_VOICE_CHARS) {
    return flat.toWellFormed();
  }
  return `${flat.slice(0, ANSWERED_VOICE_CHARS - 2)} …`.toWellFormed();
}

/**
 * A context as a printed report carries it: the voice's turn cut to the quote every surface prints, and every reason
 * and slug to {@link boundedText}. A voice turn may be as long as a call stores (`CALL_TEXT_CHARS`), and carried whole
 * it alone can outgrow the batch a report must fit, so a read that marks could never move past it. The pointer reads the turn whole.
 *
 * @param context the context as read
 * @returns the same context, every free text in it bounded
 */
export function printableAnswer({ context }: { context: AnswerContext }): AnswerContext {
  return { triage: printableTriage({ triage: context.triage }), voice: printableVoice({ voice: context.voice }) };
}

/** The voice's turn as a report carries it: the quote, or the reason bounded. */
function printableVoice({ voice }: { voice: VoiceTurnRead }): VoiceTurnRead {
  if (voice.kind === "found") {
    return {
      kind: "found",
      turn: { ...voice.turn, text: quotedVoice({ chars: ANSWERED_VOICE_CHARS, text: voice.turn.text }) },
    };
  }
  return { kind: voice.kind, why: boundedText({ text: voice.why }) };
}

/** The verdict as a report carries it: a reason or a slug bounded, a stored ruling as stored (closed words only). */
function printableTriage({ triage }: { triage: TriageVerdictRead }): TriageVerdictRead {
  if (triage.kind === "unreadable") {
    return { kind: "unreadable", why: boundedText({ text: triage.why }) };
  }
  if (triage.kind === "not-recorded") {
    return { kind: "not-recorded", slug: boundedText({ text: triage.slug }) };
  }
  return triage;
}

/**
 * The voice's turn as one clause.
 *
 * @param voice the voice turn as read
 * @returns `answering the voice's "<quote>" (<pointer>)`, or what stopped it being found
 */
function answeredVoiceClause({ voice }: { voice: VoiceTurnRead }): string {
  if (voice.kind === "found") {
    return `answering the voice's "${quotedVoice({ chars: ANSWERED_VOICE_CHARS, text: voice.turn.text })}" (${voice.turn.pointer})`;
  }
  if (voice.kind === "not-found") {
    return `the voice turn the owner answered was not found: ${boundedText({ text: voice.why })}`;
  }
  return `the voice turn the owner answered could not be read: ${boundedText({ text: voice.why })}`;
}

/**
 * The triage verdict as one clause.
 *
 * @param triage the verdict as read
 * @returns `triage verdict <code>: <what it asks>`, or what a verdict-less read means
 */
export function triageVerdictClause({ triage }: { triage: TriageVerdictRead }): string {
  if (triage.kind === "stored") {
    return `triage verdict ${triage.ruling.verdict}: ${triageRulingLine({ ruling: triage.ruling })}`;
  }
  if (triage.kind === "none") {
    return "triage verdict: none — the relay carried no ruling";
  }
  if (triage.kind === "not-recorded") {
    return `triage verdict: NOT RECORDED — the relay predates stored verdicts; read row ${boundedText({ text: triage.slug })}'s text for one before treating the owner's words as a yes`;
  }
  if (triage.kind === "not-applicable") {
    return "triage verdict: none — no relay carried these words, so none ruled on them";
  }
  return `triage verdict: could not be read — ${boundedText({ text: triage.why })}`;
}

/**
 * The triage verdict in the fewest words, for a one-line surface whose every character is budgeted (the relay's typed
 * line): the code and the class of defect, never the sentence {@link triageVerdictClause} prints.
 *
 * @param triage the verdict as read
 * @returns `triage verdict <code>`, its feedback and label when stored, or what a verdict-less read means
 */
export function compactVerdictClause({ triage }: { triage: TriageVerdictRead }): string {
  if (triage.kind === "stored") {
    const label = triage.ruling.label === undefined ? "" : `, label ${triage.ruling.label}`;
    const feedback = triage.ruling.feedback === undefined ? "" : `, what was wrong: ${triage.ruling.feedback}`;
    return `triage verdict ${triage.ruling.verdict}${label}${feedback}`;
  }
  if (triage.kind === "none") {
    return "triage verdict: none";
  }
  if (triage.kind === "not-recorded") {
    return `triage verdict: NOT RECORDED (read row ${triage.slug})`;
  }
  if (triage.kind === "not-applicable") {
    return "triage verdict: none (no relay)";
  }
  return "triage verdict: could not be read";
}

/**
 * The two lines a multi-line surface prints under the owner's words.
 *
 * @param context what the owner's words answered
 * @param indent the leading spaces each line carries
 * @returns the voice's turn line, then the verdict line
 */
export function answerContextLines({ context, indent }: { context: AnswerContext; indent: string }): readonly string[] {
  return [
    `${indent}${answeredVoiceClause({ voice: context.voice })}`,
    `${indent}${triageVerdictClause({ triage: context.triage })}`,
  ];
}
