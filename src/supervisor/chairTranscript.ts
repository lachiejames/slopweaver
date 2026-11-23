/**
 * One chair's transcript, walked once: the owner turns inside a window and every cross-session message it
 * carried, gathered in the same pass. `./intakeRead.ts` decides WHICH transcripts are the chain and what
 * window each one owns; this module reads one of them.
 */
import { err, ok, type Result } from "../lib/result.js";
import { extractUserTurns, type HumanTurn } from "../transcripts/extract.js";
import { type PeerInbound, type PeerSend, type PeerSendResult, readPeerTraffic } from "../transcripts/peerTraffic.js";
import { formatTurnPointer, type TurnPointer } from "../transcripts/pointer.js";
import { readQueuedHumanPrompt } from "../transcripts/queuedTurn.js";
import type { TranscriptRecord, UndecodedLine } from "../transcripts/record.js";
import {
  findOnlyTranscript,
  type RawTranscriptLine,
  readRawTranscriptLine,
  transcriptLines,
} from "../transcripts/source.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import type { OwnerTurn } from "./intake.js";
import type { MarkableRecords } from "./intakeMarkTarget.js";

/**
 * The cross-session traffic one transcript carried, gathered while its records stream past — and the owner's
 * QUEUED turns, which ride the same walk because they live on lines `./record.ts` never decodes.
 */
interface TrafficSink {
  readonly inbound: PeerInbound[];
  readonly sends: PeerSend[];
  readonly results: PeerSendResult[];
  /** The owner's mid-turn messages, read by `../transcripts/queuedTurn.ts` off `attachment` lines. */
  readonly queuedTurns: HumanTurn[];
  /**
   * Every line that would not parse — torn, not an object, a malformed message, or past the size bound — any of
   * which may be a turn.
   */
  readonly undecoded: UndecodedLine[];
}

/** Append one raw line's cross-session traffic to `sink`. An oversized line carries no text to read. */
function gatherTraffic({ raw, sink }: { raw: RawTranscriptLine; sink: TrafficSink }): void {
  if ("oversized" in raw) {
    return;
  }
  const queued = readQueuedHumanPrompt({ line: raw.line, lineNumber: raw.lineNumber });
  if (queued !== undefined && "turn" in queued) {
    sink.queuedTurns.push(queued.turn);
  }
  if (queued !== undefined && "undecoded" in queued) {
    // A queued prompt of the owner's that would not read is named, as a malformed user record is, never skipped.
    sink.undecoded.push(queued.undecoded);
  }
  const traffic = readPeerTraffic({ line: raw.line, lineNumber: raw.lineNumber });
  if (traffic.inbound !== undefined) {
    sink.inbound.push(traffic.inbound);
  }
  for (const send of traffic.sends) {
    sink.sends.push(send);
  }
  for (const result of traffic.results) {
    sink.results.push(result);
  }
}

/** Whether a raw line is only whitespace. An oversized line is never blank: it is too long to have been read. */
function isBlank({ raw }: { raw: RawTranscriptLine }): boolean {
  return !("oversized" in raw) && raw.line.trim() === "";
}

/**
 * The decoded records of a raw stream, gathering every line's cross-session traffic into `sink` on the way.
 *
 * A generator rather than two passes because a chair's transcript runs to tens of megabytes and the owner-turn
 * fold already streams it; the traffic rides the same walk.
 */
function* recordsGathering({
  lines,
  sink,
}: {
  lines: Iterable<RawTranscriptLine>;
  sink: TrafficSink;
}): Generator<TranscriptRecord> {
  for (const raw of lines) {
    gatherTraffic({ raw, sink });
    const reading = readRawTranscriptLine({ raw });
    if ("record" in reading) {
      // A subagent's own turns are its parent's prompts, never the owner's — the main thread is the only one the owner types into.
      if (!reading.record.isSidechain) {
        yield reading.record;
      }
    } else if (reading.undecoded.why !== "not-a-message-role" && !isBlank({ raw })) {
      // A line that is not a message at all is a normal transcript line, and a blank one carries no record; one that
      // would not parse may be a turn.
      sink.undecoded.push(reading.undecoded);
    }
  }
}

/** Whether a turn is at or after the floor. A turn with no readable instant is kept — it cannot be shown to be old. */
function atOrAfter({ timestamp, sinceIso }: { timestamp: string; sinceIso: string | undefined }): boolean {
  if (sinceIso === undefined) {
    return true;
  }
  const at = Date.parse(timestamp);
  const floor = Date.parse(sinceIso);
  if (Number.isNaN(at) || Number.isNaN(floor)) {
    return true;
  }
  return at >= floor;
}

/** Whether a turn is before the ceiling. A turn with no readable instant is kept, for the same reason. */
function before({ timestamp, untilIso }: { timestamp: string; untilIso: string | undefined }): boolean {
  if (untilIso === undefined) {
    return true;
  }
  const at = Date.parse(timestamp);
  const ceiling = Date.parse(untilIso);
  if (Number.isNaN(at) || Number.isNaN(ceiling)) {
    return true;
  }
  return at < ceiling;
}

/** A turn of the owner's inside the window that no anchor can name: it carries no uuid, or one an earlier turn already has. */
interface UnaddressableTurn {
  readonly lineNumber: number;
  readonly timestamp: string;
  readonly why: "no uuid" | "duplicate uuid";
}

/** One transcript, walked once: its owner turns in the window, and all of its cross-session traffic. */
export interface ChairRead {
  readonly turns: readonly OwnerTurn[];
  readonly traffic: TrafficSink;
  /** The owner's turns in the window left out because no anchor could name them alone — a reader says so, never skips. */
  readonly unaddressable: readonly UnaddressableTurn[];
}

/**
 * The turns a unique uuid addresses, and every other one named. A duplicate keeps the FIRST, which is the one its
 * anchor resolves to; the later one is named, since the anchor can never reach it.
 */
function addressable({ turns }: { turns: readonly HumanTurn[] }): {
  readonly kept: readonly HumanTurn[];
  readonly unaddressable: readonly UnaddressableTurn[];
} {
  const seen = new Set<string>();
  const kept: HumanTurn[] = [];
  const unaddressable: UnaddressableTurn[] = [];
  for (const turn of turns) {
    if (turn.uuid === "") {
      unaddressable.push({ lineNumber: turn.lineNumber, timestamp: turn.timestamp, why: "no uuid" });
    } else if (seen.has(turn.uuid)) {
      unaddressable.push({ lineNumber: turn.lineNumber, timestamp: turn.timestamp, why: "duplicate uuid" });
    } else {
      seen.add(turn.uuid);
      kept.push(turn);
    }
  }
  return { kept, unaddressable };
}

/**
 * Walk one transcript once, keeping the owner turns inside the window and every cross-session message.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the transcript to walk
 * @param sinceIso the owner turns' floor, or `undefined` for the whole file
 * @param untilIso the owner turns' ceiling, or `undefined` for the whole file
 * @returns the turns and the traffic, or why the transcript could not be read completely
 */
export function readChairTranscript({
  projectsDir,
  sessionId,
  sinceIso,
  untilIso,
}: {
  projectsDir: string;
  sessionId: string;
  sinceIso: string | undefined;
  untilIso: string | undefined;
}): Result<ChairRead> {
  const path = findOnlyTranscript({ projectsDir, sessionId });
  if (path.isErr()) {
    return err([path.error.message]);
  }
  const stream = transcriptLines({ path: path.value });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  const sink: TrafficSink = { inbound: [], queuedTurns: [], results: [], sends: [], undecoded: [] };
  const extracted = extractUserTurns({ records: recordsGathering({ lines: stream.value.lines, sink }) });
  if (stream.value.problems.length > 0) {
    return err(stream.value.problems);
  }
  // The owner's queued turns are merged in FILE order with the typed ones: a voice dump given mid-tick is a turn
  // of the owner's exactly as a typed one is, and `../transcripts/queuedTurn.ts` carries the measurement of how
  // many were being read past. The uuid check runs over the WHOLE file, as `findOwnerTurn` resolves an anchor, and
  // what it leaves out is returned rather than dropped.
  const inWindow = ({ timestamp }: { timestamp: string }): boolean =>
    atOrAfter({ sinceIso, timestamp }) && before({ timestamp, untilIso });
  const checked = addressable({
    turns: [...extracted.turns, ...sink.queuedTurns].toSorted((left, right) => left.lineNumber - right.lineNumber),
  });
  const turns = checked.kept.filter(inWindow).map((turn) => ({
    lineNumber: turn.lineNumber,
    pointer: formatTurnPointer({ pointer: { sessionId, turnUuid: turn.uuid } }),
    sessionId,
    source: turn.source,
    text: turn.text,
    timestamp: turn.timestamp,
    turnUuid: turn.uuid,
    ...(turn.tailCut === true ? { tailCut: true as const } : {}),
    ...(turn.spliced === true ? { spliced: true as const } : {}),
  }));
  return ok({ traffic: sink, turns, unaddressable: checked.unaddressable.filter(inWindow) });
}

/**
 * What a readable transcript still left out, worded as `../profile/supervisorWords.ts` words it: a line that would
 * not parse carries no instant, so it may be a turn inside the window, a turn no anchor can name alone is dropped,
 * and a turn an unclosed wrapper cut short shows only its head.
 *
 * @param read one transcript's walk that succeeded
 * @returns one line per kind of gap, empty when the walk saw everything
 */
export function chairReadGaps({ read }: { read: ChairRead }): readonly string[] {
  const lost = read.traffic.undecoded;
  const unnamed = read.unaddressable;
  // A spliced turn kept every word the owner typed, only joined; a tail-cut one lost words, so only that counts.
  const cut = read.turns.filter((turn) => turn.tailCut === true);
  return [
    ...(lost.length === 0
      ? []
      : [
          `${String(lost.length)} line(s) would not parse (first: line ${String(lost[0]!.lineNumber)}, ${lost[0]!.why}), so an owner turn may be among them`,
        ]),
    ...(unnamed.length === 0
      ? []
      : [
          `${String(unnamed.length)} owner turn(s) have no anchor of their own (first: line ${String(unnamed[0]!.lineNumber)}, ${unnamed[0]!.why}), so they are not listed`,
        ]),
    ...(cut.length === 0
      ? []
      : [
          `${String(cut.length)} owner turn(s) lost their tail to an unclosed wrapper (first: line ${String(cut[0]!.lineNumber)}), so each is shown in part`,
        ]),
  ];
}

/**
 * Every owner turn in one transcript, addressed.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the transcript to walk
 * @param sinceIso the floor, or `undefined` for the whole file
 * @param untilIso the ceiling — the instant a successor took the pin — or `undefined` for the whole file
 * @returns the turns in file order, or why the transcript could not be read completely
 */
export function readOwnerTurns({
  projectsDir,
  sessionId,
  sinceIso,
  untilIso,
}: {
  projectsDir: string;
  sessionId: string;
  sinceIso: string | undefined;
  untilIso?: string | undefined;
}): Result<readonly OwnerTurn[]> {
  return readChairTranscript({ projectsDir, sessionId, sinceIso, untilIso }).map((read) => read.turns);
}

/**
 * Every record of one transcript a `transcript:` intake mark can witness, read whole in one walk — the owner's turns and the
 * messages other sessions sent it. No window: `findOwnerTurn` resolves an anchor over the whole file, and
 * `./inbound.ts` collects a message's aliases before its window is applied, so a mark is checked the same way.
 *
 * @param projectsDir `~/.claude/projects`
 * @param sessionId the transcript to walk
 * @returns the uuids a mark may name, or why the transcript could not be read completely
 */
export function readMarkableRecords({
  projectsDir,
  sessionId,
}: {
  projectsDir: string;
  sessionId: string;
}): Result<MarkableRecords> {
  return readChairTranscript({ projectsDir, sessionId, sinceIso: undefined, untilIso: undefined }).map((read) => ({
    inboundUuids: new Set(read.traffic.inbound.map((message) => message.uuid)),
    ownerTurnUuids: new Set(read.turns.map((turn) => turn.turnUuid)),
  }));
}

/**
 * The one turn a pointer names, read off its own transcript — what makes a transcript anchor CHECKABLE.
 *
 * @param projectsDir `~/.claude/projects`
 * @param pointer the turn to find
 * @returns the turn, or why it is not there
 */
export function findOwnerTurn({
  projectsDir,
  pointer,
}: {
  projectsDir: string;
  pointer: TurnPointer;
}): Result<OwnerTurn, SupervisorCoreError> {
  const turns = readOwnerTurns({ projectsDir, sessionId: pointer.sessionId, sinceIso: undefined });
  if (turns.isErr()) {
    return err(SupervisorCoreErrors.transcriptUnreadable({ reasons: turns.error }));
  }
  const found = turns.value.find((turn) => turn.turnUuid === pointer.turnUuid);
  if (found === undefined) {
    return err(
      SupervisorCoreErrors.turnNotFound({ pointer: formatTurnPointer({ pointer }), sessionId: pointer.sessionId }),
    );
  }
  return ok(found);
}
