/**
 * The owner's MID-TURN messages — the turns `./record.ts` cannot see, and the half of the owner's voice that every
 * owner-turn reader would silently miss.
 *
 * ## The finding, measured
 *
 * A message the owner types while the chair is mid-turn is never written as a `type: "user"` record. Claude Code
 * queues it and writes an `attachment` line instead:
 *
 * ```json
 * {"type":"attachment","uuid":"…","timestamp":"…","cwd":"…",
 *  "attachment":{"type":"queued_command","commandMode":"prompt","origin":{"kind":"human"},"prompt":"<the owner's words>"}}
 * ```
 *
 * `./extract.ts` decodes `user` and `assistant` records only, so `../supervisor/chairTranscript.ts`, the
 * reconciliation's intake clause and the tick ledger's verbatim `ownerTurns` all read past those lines.
 * MEASURED over 28 supervisor transcripts (reproduce per transcript with
 * `grep '"queued_command"' <transcript.jsonl> | grep -c '"kind":"human"'`): **102** such records, against a
 * 7-day chain intake read that returned 96 turns while the supervisors' own hand-kept scratch copies of the owner's
 * turns numbered about 283. Nearly every long voice dump the owner gives lands this way, because the owner speaks
 * while the sweep is running. That is a large part of the information lost between
 * supervisors.
 *
 * ## A prompt that carries an image is an ARRAY, and it is still the owner's turn
 *
 * When the owner pastes a screenshot, `attachment.prompt` is not a string but a content-block array — `text` blocks
 * plus `image` blocks holding base64 bytes — exactly the shape a `user` record's `message.content` takes. So
 * the prompt is decoded by `./record.ts`'s `decodeContent`: text blocks joined, image bytes dropped, the
 * `[Image #n]` markers the owner sees kept as typed. An image-only prompt has no text and is not a turn. A
 * string-only reader missed every such ruling (two such rulings were measured missed; the fixtures are
 * `src/__tests__/fixtures/transcripts/queued-image-prompt/`).
 *
 * ## Why the marker is structural, not textual
 *
 * `attachment.origin.kind === "human"` is the harness's own statement that a person typed it; a peer
 * session's message on the same shape carries `origin.kind === "peer"` and is `./peerTraffic.ts`'s business.
 * `commandMode === "prompt"` separates a typed prompt from a task notification, which rides the same
 * `queued_command` shape with no origin at all. Both are required for the owner's turn; a prompt-mode line whose origin is
 * neither human nor peer is `unproven-origin`, named by the reader of the owner's words rather than read past.
 *
 * Pure: text in, a turn or nothing out. A substring gate, as `./peerTraffic.ts` has, so a transcript walk pays a
 * second parse only on the lines that can carry this shape — one that is sound for any JSON spelling (`mayBeQueued`).
 */

import { isRecord } from "../lib/parsers.js";
import { isBootRefusalWake } from "./bootRefusalWake.js";
import { type HumanTurn, trimWhiteSpace } from "./extract.js";
import { isFleetNudge } from "./fleetNudge.js";
import { decodeContent, provenanceMalformed, type UndecodedLine } from "./record.js";
import { isSpawnPickupLine } from "./spawnPickupLine.js";

/**
 * The word every qualifying line's decoded JSON carries. Matched without its quotes, so whitespace around a key or
 * value never hides a line.
 */
const GATE_WORD = "queued_command";

/**
 * Whether a line can hold a queued prompt, decided without parsing it. Sound for every valid JSON spelling: a string
 * decoding to `queued_command` either holds those bytes or spells one of its characters as a `\u` escape — JSON has
 * no other escape for a letter or `_` — so a line with neither cannot be one, and the gate never rejects a real one.
 */
function mayBeQueued({ line }: { line: string }): boolean {
  return line.includes(GATE_WORD) || line.includes("\\u");
}

/** A string field on a record, or "" when it is absent or not a string. */
function str({ key, on }: { key: string; on: Record<string, unknown> }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/**
 * Read one transcript line as a queued owner turn, when it is one.
 *
 * @param line the raw JSONL line
 * @param lineNumber the 1-based position, carried into the turn so a caller can go straight to it
 * @returns the turn, or `undefined` for every line that is not a human `queued_command` prompt carrying a uuid
 */
export function readQueuedHumanTurn({ line, lineNumber }: { line: string; lineNumber: number }): HumanTurn | undefined {
  const reading = readQueuedHumanPrompt({ line, lineNumber });
  if (reading === undefined || !("turn" in reading) || reading.turn.uuid === "") {
    return undefined;
  }
  return reading.turn;
}

/** A main-thread `queued_command` line in prompt mode, parsed — whoever its origin names. */
function queuedPromptLine({
  line,
}: {
  line: string;
}): { readonly parsed: Record<string, unknown>; readonly attachment: Record<string, unknown> } | undefined {
  if (!mayBeQueued({ line })) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["type"] !== "attachment" || !isRecord(parsed["attachment"])) {
    return undefined;
  }
  // A subagent's queue is its parent's prompts, never the owner's: the main thread is the only one the owner types into.
  const attachment = parsed["attachment"];
  const promptMode = attachment["type"] === "queued_command" && attachment["commandMode"] === "prompt";
  if (parsed["isSidechain"] === true || !promptMode) {
    return undefined;
  }
  return { attachment, parsed };
}

/** A queued human prompt read: the owner's turn, or a prompt of the owner's whose content is malformed and so is not quoted. */
export type QueuedPromptReading = { readonly turn: HumanTurn } | { readonly undecoded: UndecodedLine };

/**
 * Read one transcript line as a queued human prompt, uuid or not — for a reader that must SAY it lost one with no
 * uuid rather than skip it (`../supervisor/chairTranscript.ts`). A prompt that is neither a string nor a content
 * array, or carries a malformed block, is `malformed-message`: quoting what is left would read as the owner's whole turn. One
 * whose origin is neither human nor peer is `unproven-origin`.
 *
 * @param line the raw JSONL line
 * @param lineNumber the 1-based position, carried into the turn so a caller can go straight to it
 * @returns the turn (its `uuid` "" when the line carries none), the malformed prompt, or `undefined` for a line
 * that is not a queued human prompt
 */
export function readQueuedHumanPrompt({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): QueuedPromptReading | undefined {
  const queued = queuedPromptLine({ line });
  if (queued === undefined) {
    return undefined;
  }
  const { attachment, parsed } = queued;
  // A provenance marker of the wrong shape is a prompt nothing proves the owner's, never one read as `=== true`.
  if (provenanceMalformed({ parsed })) {
    return { undecoded: { lineNumber, why: "malformed-message" } };
  }
  const origin = isRecord(attachment["origin"]) ? attachment["origin"] : {};
  if (origin["kind"] === "peer") {
    return undefined;
  }
  // A prompt-mode queued line whose origin is missing or names somebody new may well be the owner's, so it is named rather
  // than read past as traffic — a change to Claude Code's record shape would otherwise lose every one.
  if (origin["kind"] !== "human") {
    return { undecoded: { lineNumber, why: "unproven-origin" } };
  }
  const prompt = attachment["prompt"];
  const content = decodeContent({ content: prompt });
  const shapeless = typeof prompt !== "string" && !Array.isArray(prompt);
  if (shapeless || content.malformedBlocks > 0) {
    return { undecoded: { lineNumber, why: "malformed-message" } };
  }
  const text = trimWhiteSpace({ text: content.text });
  const uuid = str({ key: "uuid", on: parsed });
  // A resume or spawn pickup line typed while the seat was mid-turn queues exactly as the owner's words do, origin and
  // all (`isFleetNudge`, `isSpawnPickupLine`), and so does the courier's boot-refusal wake (`isBootRefusalWake`).
  const machineLine = isFleetNudge({ text }) || isSpawnPickupLine({ text }) || isBootRefusalWake({ text });
  if (text.length === 0 || machineLine) {
    return undefined;
  }
  // A queued line carries `promptSource` as a typed one does, and an accepted suggestion is not the owner's words.
  const accepted = parsed["promptSource"] === "suggestion_accepted";
  return {
    turn: {
      cwd: str({ key: "cwd", on: parsed }),
      lineNumber,
      source: accepted ? "suggestion-accepted" : "queued",
      text,
      timestamp: str({ key: "timestamp", on: parsed }),
      uuid,
    },
  };
}
