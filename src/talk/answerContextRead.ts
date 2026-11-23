/**
 * The read half of `./answerContext.ts`: every anchor a surface holds, resolved against the turn store and the call
 * files in one pass, so the renderers stay pure.
 *
 * A relay turn records no call, so its call is found by scanning the call index NEWEST FIRST for a file carrying a
 * `relay` line for that turn, every wanted turn in the same pass, stopping once each is found. Bounded by the index,
 * never by a clock or an mtime (`./unreadRead.ts` says why neither is proof). A relay is nearly always in a recent
 * call, so the scan usually stops within a file or two; a turn no call recorded — a typed steer — reads them all.
 * Measured: 190 indexed calls, 92M of call files (`du -sh "$SLOPWEAVER_HOME/talk/calls"`).
 */
import { join } from "node:path";

import { nonBlockingFileBytes } from "../lib/presentFile.js";
import {
  type AnswerContext,
  answerContextRequestOf,
  type TriageVerdictRead,
  type VoiceTurnRead,
  voiceForCallAnchor,
  voiceForRelay,
} from "./answerContext.js";
import { type CallEntry, type CallSegment, foldCall } from "./callRecord.js";
import { callsDir, readCallEntriesCounted } from "./callStore.js";
import { callSegmentAnchor } from "./cardUtterance.js";
import { heldTriageVerdictOf } from "./relayCutHold.js";
import { readTurn, type TurnRecord } from "./relayStore.js";
import { isMissing } from "./unreadCursorStore.js";
import { indexedCalls } from "./unreadRead.js";
import type { UnreadWord } from "./unreadWords.js";

/** One call's lines and segments, or why it could not be read. */
type CallRead =
  | { readonly kind: "read"; readonly entries: readonly CallEntry[]; readonly segments: readonly CallSegment[] }
  | { readonly kind: "unreadable"; readonly why: string };

/** The relay half a turn file gives: the owner's words, its row and its verdict. */
interface RelayTurn {
  readonly turnId: string;
  readonly heard: string;
  /** Whether `heard` is only the tail of what the owner said (a record from before the relay store kept the full text,`./relayStore.ts`). */
  readonly heardTruncated: boolean;
  readonly triage: TriageVerdictRead;
}

/**
 * What each anchor's words answered: the voice's turn before them and the triage verdict, read from the home.
 *
 * @param home the Slopweaver home the turns and calls live under
 * @param anchors utterance anchors — `talk:<turnId>`, `call:<callId>#<segment>`, or anything a session wrote
 * @returns one context per distinct anchor, keyed by it; every failure kept as a read, never an empty one
 */
export function readAnswerContexts({
  anchors,
  home,
}: {
  anchors: readonly string[];
  home: string;
}): ReadonlyMap<string, AnswerContext> {
  const calls = new Map<string, CallRead>();
  const callOf = ({ callId }: { callId: string }): CallRead => {
    const known = calls.get(callId);
    if (known !== undefined) {
      return known;
    }
    const read = readCall({ callId, home });
    calls.set(callId, read);
    return read;
  };
  const unique = [...new Set(anchors)];
  const relays = new Map<string, RelayTurn | { readonly unreadable: string }>();
  for (const anchor of unique) {
    const request = answerContextRequestOf({ anchor });
    if (request.kind === "relay") {
      relays.set(anchor, relayTurnOf({ home, turnId: request.turnId }));
    }
  }
  const wanted = [...relays.values()].flatMap((one) => ("turnId" in one ? [one.turnId] : []));
  const located = locateRelayCalls({ home, turnIds: wanted });
  const contexts = new Map<string, AnswerContext>();
  for (const anchor of unique) {
    const request = answerContextRequestOf({ anchor });
    if (request.kind === "call") {
      contexts.set(anchor, {
        triage: { kind: "not-applicable" },
        voice: callVoice({ call: callOf({ callId: request.callId }), request }),
      });
    } else if (request.kind === "other") {
      const why = `${anchor} names no call utterance or relay turn`;
      contexts.set(anchor, { triage: { kind: "not-applicable" }, voice: { kind: "not-found", why } });
    } else {
      contexts.set(anchor, relayContext({ callOf, located, relay: relays.get(anchor)! }));
    }
  }
  return contexts;
}

/**
 * What a relay's words answered at the moment its line is typed: the verdict from the record in hand, and the voice's
 * turn from the call that recorded the relay. A typed steer followed no voice turn, so no call is read for it. A
 * spoken one whose relay line the page has not yet written reads as not found, said on the line rather than guessed.
 * A spoken one not stated whole (`./relayCutHold.ts`) carries no send-it the line may read as the owner's: it reads as
 * unreadable, which leads with the hold, rather than as a yes that took effect.
 *
 * @param home the Slopweaver home the calls live under
 * @param record the registered turn being typed
 * @returns what its words answered
 */
export function relayAnswerAtDelivery({
  home,
  record,
}: {
  home: string;
  record: Pick<TurnRecord, "heardTailCut" | "slug" | "triageRuling" | "turnId" | "typed">;
}): AnswerContext {
  const triage = heldTriageVerdictOf({ record });
  if (record.typed) {
    return { triage, voice: { kind: "not-found", why: "the owner typed it on the console, after no voice turn" } };
  }
  const anchor = `talk:${record.turnId}`;
  return { triage, voice: readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice };
}

/**
 * What each unread stretch of the owner's words answered, keyed by its pointer: the voice's turn before it in its own call, and the
 * verdict the turn of the relay line recorded next after it stored. That relay is evidence, never attribution (a relay
 * line names no segment, `./unreadWords.ts`), so the report prints its turn beside the verdict; a stretch with no relay
 * after it among the unread lines reads as one no relay ruled on.
 *
 * @param home the Slopweaver home the turns and calls live under
 * @param words the unread stretches, each with its call, segment and next relay
 * @returns one context per stretch, keyed by its pointer
 */
export function readUnreadAnswerContexts({
  home,
  words,
}: {
  home: string;
  words: readonly Pick<UnreadWord, "callId" | "nextRelay" | "pointer" | "segmentId">[];
}): ReadonlyMap<string, AnswerContext> {
  const callAnchor = (word: (typeof words)[number]): string =>
    callSegmentAnchor({ callId: word.callId, segmentId: word.segmentId });
  const relayAnchors = (word: (typeof words)[number]): readonly string[] =>
    word.nextRelay?.turnId == null ? [] : [`talk:${word.nextRelay.turnId}`];
  const read = readAnswerContexts({
    anchors: words.flatMap((word) => [callAnchor(word), ...relayAnchors(word)]),
    home,
  });
  const contexts = new Map<string, AnswerContext>();
  for (const word of words) {
    const [relay] = relayAnchors(word);
    const triage: TriageVerdictRead = relay === undefined ? { kind: "not-applicable" } : read.get(relay)!.triage;
    contexts.set(word.pointer, { triage, voice: read.get(callAnchor(word))!.voice });
  }
  return contexts;
}

/** The voice turn one call anchor answered, from its call as read. */
function callVoice({
  call,
  request,
}: {
  call: CallRead;
  request: { readonly callId: string; readonly anchor: string };
}): VoiceTurnRead {
  if (call.kind === "unreadable") {
    return { kind: "unreadable", why: call.why };
  }
  return voiceForCallAnchor({ anchor: request.anchor, callId: request.callId, segments: call.segments });
}

/** One relay anchor's context, from its turn and the call the scan located. */
function relayContext({
  callOf,
  located,
  relay,
}: {
  callOf: (call: { callId: string }) => CallRead;
  located: Located;
  relay: RelayTurn | { readonly unreadable: string };
}): AnswerContext {
  if ("unreadable" in relay) {
    return {
      triage: { kind: "unreadable", why: relay.unreadable },
      voice: { kind: "unreadable", why: relay.unreadable },
    };
  }
  // A tail is not where the owner's words began, and a later segment can repeat it whole, so no match on it is proof:
  // said, never guessed.
  if (relay.heardTruncated) {
    const why = "kept only the tail of the owner's words, so where they began cannot be told; read the call";
    return { triage: relay.triage, voice: { kind: "not-found", why } };
  }
  const blocked = located.blocked.get(relay.turnId.toLowerCase());
  if (blocked !== undefined) {
    return { triage: relay.triage, voice: { kind: "unreadable", why: blocked } };
  }
  const callId = located.found.get(relay.turnId.toLowerCase());
  if (callId === undefined) {
    const why =
      located.unreadable.length > 0
        ? `no readable call records a relay line for turn ${relay.turnId}, and ${located.unreadable.join("; ")}`
        : `no call records a relay line for turn ${relay.turnId}`;
    const voice: VoiceTurnRead =
      located.unreadable.length > 0 ? { kind: "unreadable", why } : { kind: "not-found", why };
    return { triage: relay.triage, voice };
  }
  const call = callOf({ callId });
  if (call.kind === "unreadable") {
    return { triage: relay.triage, voice: { kind: "unreadable", why: call.why } };
  }
  const voice = voiceForRelay({
    callId,
    entries: call.entries,
    heard: relay.heard,
    segments: call.segments,
    turnId: relay.turnId,
  });
  return { triage: relay.triage, voice };
}

/** One relay turn's words and verdict, or why its file could not be read. */
function relayTurnOf({ home, turnId }: { home: string; turnId: string }): RelayTurn | { readonly unreadable: string } {
  const turn = readTurn({ home, turnId });
  if (turn.isErr()) {
    return { unreadable: turn.error.message };
  }
  const { heard, heardTruncated } = turn.value;
  // The same hold as the delivery line: a ruling on words that may stop short never reads as stored, here or there.
  const triage = heldTriageVerdictOf({ record: turn.value });
  return { heard, heardTruncated: heardTruncated === true, triage, turnId };
}

/**
 * Which call carries each wanted turn's relay line, each turn a newer call names on a line that does not parse — so
 * an older call's relay line for it is not proof (Codex r14-01) — and every call file the scan could not read.
 */
interface Located {
  readonly blocked: ReadonlyMap<string, string>;
  readonly found: ReadonlyMap<string, string>;
  readonly unreadable: readonly string[];
}

/** Scan the call index newest first for each wanted turn's relay line, stopping once every one is settled. */
function locateRelayCalls({ home, turnIds }: { home: string; turnIds: readonly string[] }): Located {
  const blocked = new Map<string, string>();
  const found = new Map<string, string>();
  if (turnIds.length === 0) {
    return { blocked, found, unreadable: [] };
  }
  const index = indexedCalls({ home });
  if (index.isErr()) {
    return { blocked, found, unreadable: [`the call index could not be read: ${index.error.message}`] };
  }
  const unreadable: string[] = [];
  // The bare id narrows which calls are parsed; the parsed relay line decides, so a JSON spacing the writer never
  // uses still matches and an id mentioned off a relay line does not. A turnId is one UUID however its
  // hex is cased — `turnFiledElsewhere` files a turn that way — so both sides compare lowercased.
  const needles = new Map(turnIds.map((turnId) => [turnId.toLowerCase(), Buffer.from(turnId.toLowerCase())] as const));
  for (const callId of index.value.toReversed()) {
    if (found.size + blocked.size === needles.size) {
      break;
    }
    const why = scanCall({ blocked, callId, found, home, needles });
    if (why !== undefined) {
      unreadable.push(why);
    }
  }
  return { blocked, found, unreadable };
}

/**
 * One call's part of the scan: the wanted turns whose relay line it records go into `found`, and those it names only
 * where a line does not parse go into `blocked`, since the torn line may be their relay line.
 *
 * @param blocked each turn a newer call named on a torn line, keyed by its lowercased id, beside why — added to here
 * @param found each turn already located, keyed by its lowercased id — added to here
 * @param needles each wanted turn's lowercased id, beside its bytes
 * @returns why the call, or a relay line in it the scan needed, could not be read; `undefined` otherwise
 */
function scanCall({
  blocked,
  callId,
  found,
  home,
  needles,
}: {
  blocked: Map<string, string>;
  callId: string;
  found: Map<string, string>;
  home: string;
  needles: ReadonlyMap<string, Buffer>;
}): string | undefined {
  const bytes = callBytes({ callId, home });
  if (typeof bytes === "string") {
    return bytes;
  }
  if (bytes === undefined) {
    return undefined;
  }
  // Latin-1 lowercasing keeps every byte's offset and never turns a multibyte UTF-8 byte into ASCII.
  const lowered = Buffer.from(bytes.toString("latin1").toLowerCase(), "latin1");
  const hits = [...needles].filter(
    ([turnId, needle]) => !found.has(turnId) && !blocked.has(turnId) && lowered.includes(needle),
  );
  if (hits.length === 0) {
    return undefined;
  }
  const relayed = relayTurnIdsOf({ callId, home });
  for (const [turnId] of hits) {
    if (relayed.ids.has(turnId)) {
      found.set(turnId, callId);
    } else if (relayed.unreadable !== undefined) {
      blocked.set(
        turnId,
        `call ${callId} names turn ${turnId} and ${relayed.unreadable}, so its relay line may be torn`,
      );
    }
  }
  const missed = hits.some(([turnId]) => !found.has(turnId));
  return missed ? relayed.unreadable : undefined;
}

/**
 * One call file's bytes.
 *
 * @returns the bytes, `undefined` for a call whose file is gone, or why it could not be read
 */
function callBytes({ callId, home }: { callId: string; home: string }): Buffer | string | undefined {
  try {
    return nonBlockingFileBytes({ path: join(callsDir({ home }), `${callId}.jsonl`) });
  } catch (cause) {
    if (isMissing({ cause })) {
      return undefined;
    }
    return `call ${callId} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/**
 * The turns a call's parsed relay lines name, and why a relay line may be missing from them: a file that did not read,
 * or a line that did not parse and may be the very relay line looked for.
 */
function relayTurnIdsOf({ callId, home }: { callId: string; home: string }): {
  readonly ids: ReadonlySet<string>;
  readonly unreadable: string | undefined;
} {
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return { ids: new Set(), unreadable: `call ${callId} could not be read: ${read.error.message}` };
  }
  const ids = new Set(
    read.value.entries.flatMap((entry) =>
      entry.kind === "relay" && entry.turnId !== null ? [entry.turnId.toLowerCase()] : [],
    ),
  );
  if (read.value.skipped > 0) {
    return { ids, unreadable: `${String(read.value.skipped)} line(s) of call ${callId} do not parse` };
  }
  return { ids, unreadable: undefined };
}

/**
 * One call's lines and its folded segments, or why it could not be read. A line that did not parse makes the whole
 * call unreadable here: the voice turn the owner answered is the LAST one before the owner's words, and the torn line may be it, so
 * naming the last one that parsed would be a guess printed as the question.
 */
function readCall({ callId, home }: { callId: string; home: string }): CallRead {
  const read = readCallEntriesCounted({ callId, home });
  if (read.isErr()) {
    return { kind: "unreadable", why: read.error.message };
  }
  if (read.value.skipped > 0) {
    return {
      kind: "unreadable",
      why: `${String(read.value.skipped)} line(s) of call ${callId} do not parse, and the voice turn the owner answered may be one of them`,
    };
  }
  const call = foldCall({ callId, entries: read.value.entries, skipped: read.value.skipped });
  if (call === undefined) {
    return { kind: "unreadable", why: `call ${callId} has no readable line` };
  }
  return { entries: read.value.entries, kind: "read", segments: call.segments };
}
