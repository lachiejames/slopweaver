/**
 * The owner's turns in ONE Codex rollout — the pure core of reading a Codex-hosted supervisor chair
 * (`../supervisor/codexChairRead.ts` is the shell that finds and streams the file).
 *
 * **It fails CLOSED.** Every line is judged, and a line it cannot place — not JSON, not an object, no instant, a
 * top-level kind outside the pinned wire, a `user_message` missing its words — ends the read with a named error
 * rather than being skipped. A skipped line could be an owner turn, and an undercount reads as "every turn is
 * covered", which is the one answer this reader must never give falsely.
 *
 * **What counts as the owner's turn is structural, never textual.** Codex's rollout wire (the `codex-rs`
 * `RolloutLine` envelope, `{ timestamp, type, payload }`, at `rust-v0.163.0`) writes a submitted prompt twice: as
 * the model-input `response_item` message and as the `event_msg` whose payload `type` is `user_message`. Only the
 * second is counted. Injected context — `<environment_context>`, AGENTS.md and user instructions, skill bodies — is
 * written as a `response_item` message with role `user`, never as a `user_message` event, so a generic user-role
 * item is never a turn; a `compacted` summary and its replacement history are context, not turns.
 *
 * **What it cannot tell apart, stated.** A prompt typed into the Codex compositor by anything other than the owner
 * (a raw `cmux send`) is the same `user_message` event as the owner's, so it is counted: an over-count, never an
 * under-count. A replayed `user_message` inside one file is counted again rather than deduplicated by text.
 * Whether mid-turn steered input is written as its own `user_message` is not confirmed from the wire; an
 * `event_msg` whose kind reads like user input but is not `user_message` is refused rather than ignored.
 *
 * A session in `paginated` history mode does not persist `user_message` events at all, so its rollout is refused.
 */
import { err, ok, type Result } from "#lib/result.js";
import { isRecord } from "../lib/parsers.js";
import { formatCodexRolloutPointer } from "./rolloutOwnerTurnPointer.js";

/** One line of a rollout, addressed in the file. */
export interface CodexRolloutLine {
  readonly line: string;
  /** 1-based. */
  readonly lineNumber: number;
  /** Where the line starts in the file, in bytes. */
  readonly byteOffset: number;
  /** True when the line held a byte that is not UTF-8, so `line` is a placeholder rather than its words. */
  readonly undecodable: boolean;
}

/** One owner turn read off a rollout. */
export interface CodexRolloutOwnerTurn {
  /** `codex-rollout:<thread>#<rollout>@<offset>`. */
  readonly pointer: string;
  readonly threadId: string;
  /** The turn's address inside the thread: `<rollout>@<offset>`, unique per line. */
  readonly turnId: string;
  /** The line's own ISO instant. */
  readonly timestamp: string;
  /** The submitted words, exactly as the event carries them. */
  readonly text: string;
  readonly lineNumber: number;
}

/** Why a rollout's owner turns could not be read. Every variant names the line it stopped on. */
export type CodexOwnerTurnParseError =
  | { readonly code: "ROLLOUT_LINE_INVALID"; readonly message: string; readonly lineNumber: number }
  | { readonly code: "ROLLOUT_ITEM_UNRECOGNISED"; readonly message: string; readonly lineNumber: number }
  | { readonly code: "SESSION_META_INVALID"; readonly message: string; readonly lineNumber: number }
  | { readonly code: "SESSION_THREAD_MISMATCH"; readonly message: string; readonly lineNumber: number }
  | { readonly code: "SESSION_HISTORY_UNSUPPORTED"; readonly message: string; readonly lineNumber: number }
  | { readonly code: "USER_MESSAGE_INVALID"; readonly message: string; readonly lineNumber: number };

/* The factory, so every refusal carries the same words. */
const CodexOwnerTurnParseErrors = {
  historyUnsupported: ({ lineNumber, mode }: { lineNumber: number; mode: string }): CodexOwnerTurnParseError => ({
    code: "SESSION_HISTORY_UNSUPPORTED",
    lineNumber,
    message: `line ${String(lineNumber)}: the session's history mode is ${mode}, which does not write the owner's turns to its rollout`,
  }),
  itemUnrecognised: ({ lineNumber, kind }: { lineNumber: number; kind: string }): CodexOwnerTurnParseError => ({
    code: "ROLLOUT_ITEM_UNRECOGNISED",
    lineNumber,
    message: `line ${String(lineNumber)}: "${kind}" is not a rollout item this reader knows, so it could hold an owner turn`,
  }),
  lineInvalid: ({ lineNumber, why }: { lineNumber: number; why: string }): CodexOwnerTurnParseError => ({
    code: "ROLLOUT_LINE_INVALID",
    lineNumber,
    message: `line ${String(lineNumber)}: ${why}`,
  }),
  metaInvalid: ({ lineNumber, why }: { lineNumber: number; why: string }): CodexOwnerTurnParseError => ({
    code: "SESSION_META_INVALID",
    lineNumber,
    message: `line ${String(lineNumber)}: ${why}`,
  }),
  threadMismatch: ({
    lineNumber,
    expected,
    found,
  }: {
    lineNumber: number;
    expected: string;
    found: string;
  }): CodexOwnerTurnParseError => ({
    code: "SESSION_THREAD_MISMATCH",
    lineNumber,
    message: `line ${String(lineNumber)}: the rollout's session_meta names thread ${found}, not the chair's ${expected}`,
  }),
  userMessageInvalid: ({ lineNumber, why }: { lineNumber: number; why: string }): CodexOwnerTurnParseError => ({
    code: "USER_MESSAGE_INVALID",
    lineNumber,
    message: `line ${String(lineNumber)}: a user_message event ${why}`,
  }),
} as const;

/**
 * Every top-level rollout item kind on the pinned wire (`codex-rs` `RolloutItem`, `rust-v0.163.0`). A kind outside
 * this set fails the read until it is reviewed: it could be where a newer Codex writes the owner's words.
 */
const KNOWN_ROLLOUT_ITEM_KINDS: ReadonlySet<string> = new Set([
  "compacted",
  "event_msg",
  "inter_agent_communication",
  "inter_agent_communication_metadata",
  "realtime_item",
  "response_item",
  "retained_context",
  "security_risk_score",
  "session_meta",
  "token_usage_record",
  "turn_context",
  "world_state",
]);

/** The one event kind that is a submitted prompt. */
const USER_MESSAGE_EVENT = "user_message";

/**
 * An `event_msg` kind that reads like user input but is not {@link USER_MESSAGE_EVENT} — refused rather than ignored,
 * because mid-turn steered or queued input is the shape whose recording is unconfirmed.
 */
const USER_INPUT_LIKE = /user|steer|queue|input|prompt/i;

/** An ISO instant as the rollout envelope writes it. */
const ROLLOUT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The history modes a session_meta can carry; only the default (its wire byte is `legacy`) persists owner turns. */
const TURN_WRITING_HISTORY = "legacy";
const PAGINATED_HISTORY = "paginated";

/** What judging one line came to. */
type LineVerdict =
  | { readonly kind: "turn"; readonly turn: CodexRolloutOwnerTurn }
  | { readonly kind: "meta" }
  | { readonly kind: "other" };

/** The accumulator a streaming reader feeds one line at a time. */
export interface RolloutOwnerTurnFold {
  /** Judge the next line; after the first failure every later line is ignored and the failure stands. */
  readonly push: (line: CodexRolloutLine) => void;
  /** The turns, or the first failure — including a rollout that never named its session. */
  readonly finish: () => Result<readonly CodexRolloutOwnerTurn[], CodexOwnerTurnParseError>;
}

/** Judge a `session_meta` payload against the chair's thread. */
function judgeMeta({
  payload,
  lineNumber,
  threadId,
}: {
  payload: Readonly<Record<string, unknown>>;
  lineNumber: number;
  threadId: string;
}): CodexOwnerTurnParseError | undefined {
  const id = payload["id"];
  if (typeof id !== "string" || id.length === 0) {
    return CodexOwnerTurnParseErrors.metaInvalid({ lineNumber, why: "a session_meta carries no thread id" });
  }
  if (id !== threadId) {
    return CodexOwnerTurnParseErrors.threadMismatch({ expected: threadId, found: id, lineNumber });
  }
  const mode = payload["history_mode"];
  if (mode === undefined || mode === TURN_WRITING_HISTORY) {
    return undefined;
  }
  if (mode === PAGINATED_HISTORY) {
    return CodexOwnerTurnParseErrors.historyUnsupported({ lineNumber, mode });
  }
  return CodexOwnerTurnParseErrors.metaInvalid({
    lineNumber,
    why: `history_mode ${JSON.stringify(mode)} is not one this reader knows`,
  });
}

/** Judge an `event_msg` payload: a turn, an ignored event, or a refusal. */
function judgeEvent({
  payload,
  line,
  timestamp,
  rolloutName,
  threadId,
}: {
  payload: Readonly<Record<string, unknown>>;
  line: CodexRolloutLine;
  timestamp: string;
  rolloutName: string;
  threadId: string;
}): Result<LineVerdict, CodexOwnerTurnParseError> {
  const kind = payload["type"];
  // An empty type names nothing, so it cannot be told apart from an unrecorded input kind.
  if (typeof kind !== "string" || kind.length === 0) {
    return err(
      CodexOwnerTurnParseErrors.lineInvalid({ lineNumber: line.lineNumber, why: "an event_msg carries no type" }),
    );
  }
  if (kind !== USER_MESSAGE_EVENT) {
    if (USER_INPUT_LIKE.test(kind)) {
      return err(
        CodexOwnerTurnParseErrors.itemUnrecognised({ kind: `event_msg/${kind}`, lineNumber: line.lineNumber }),
      );
    }
    return ok({ kind: "other" });
  }
  const text = payload["message"];
  if (typeof text !== "string") {
    return err(
      CodexOwnerTurnParseErrors.userMessageInvalid({ lineNumber: line.lineNumber, why: "carries no message string" }),
    );
  }
  const pointer = { byteOffset: line.byteOffset, rolloutName, threadId };
  return ok({
    kind: "turn",
    turn: {
      lineNumber: line.lineNumber,
      pointer: formatCodexRolloutPointer({ pointer }),
      text,
      threadId,
      timestamp,
      turnId: `${rolloutName}@${String(line.byteOffset)}`,
    },
  });
}

/** A line's `RolloutLine` envelope, its kind known and its instant readable. */
interface RolloutEnvelope {
  readonly kind: string;
  readonly timestamp: string;
  readonly payload: unknown;
}

/** Read one non-blank line's envelope, refusing a line that is not one. */
function readEnvelope({ line }: { line: CodexRolloutLine }): Result<RolloutEnvelope, CodexOwnerTurnParseError> {
  const { lineNumber } = line;
  if (line.undecodable) {
    return err(CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "the line is not UTF-8" }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.line);
  } catch {
    return err(
      CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "the line is not JSON — a torn or damaged write" }),
    );
  }
  if (!isRecord(parsed)) {
    return err(CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "the line is not a JSON object" }));
  }
  const kind = parsed["type"];
  const timestamp = parsed["timestamp"];
  if (typeof kind !== "string") {
    return err(CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "the line carries no item type" }));
  }
  if (!KNOWN_ROLLOUT_ITEM_KINDS.has(kind)) {
    return err(CodexOwnerTurnParseErrors.itemUnrecognised({ kind, lineNumber }));
  }
  const readableInstant =
    typeof timestamp === "string" && ROLLOUT_INSTANT.test(timestamp) && !Number.isNaN(Date.parse(timestamp));
  if (!readableInstant) {
    return err(CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "the line carries no readable instant" }));
  }
  return ok({ kind, payload: parsed["payload"], timestamp });
}

/** Judge one non-blank line. */
function judgeLine({
  line,
  rolloutName,
  threadId,
}: {
  line: CodexRolloutLine;
  rolloutName: string;
  threadId: string;
}): Result<LineVerdict, CodexOwnerTurnParseError> {
  const { lineNumber } = line;
  const envelope = readEnvelope({ line });
  if (envelope.isErr()) {
    return err(envelope.error);
  }
  const { kind, payload, timestamp } = envelope.value;
  if (kind === "session_meta") {
    if (!isRecord(payload)) {
      return err(CodexOwnerTurnParseErrors.metaInvalid({ lineNumber, why: "a session_meta carries no payload" }));
    }
    const refused = judgeMeta({ lineNumber, payload, threadId });
    return refused === undefined ? ok({ kind: "meta" }) : err(refused);
  }
  if (kind === "event_msg") {
    if (!isRecord(payload)) {
      return err(CodexOwnerTurnParseErrors.lineInvalid({ lineNumber, why: "an event_msg carries no payload" }));
    }
    return judgeEvent({ line, payload, rolloutName, threadId, timestamp });
  }
  return ok({ kind: "other" });
}

/**
 * A fold over one rollout's lines, for a reader that streams the file rather than holding it.
 *
 * The rollout must name its session before anything else: its first non-blank line is a `session_meta` for the
 * chair's own thread, and every later `session_meta` must name that thread too.
 *
 * @param rolloutName the rollout file's basename, which every pointer carries
 * @param threadId the chair's thread id, which the rollout's `session_meta` must name
 * @returns the fold
 */
export function rolloutOwnerTurnFold({
  rolloutName,
  threadId,
}: {
  rolloutName: string;
  threadId: string;
}): RolloutOwnerTurnFold {
  const turns: CodexRolloutOwnerTurn[] = [];
  let failure: CodexOwnerTurnParseError | undefined;
  let metaSeen = false;
  let lastLine = 0;
  return {
    finish: () => {
      if (failure !== undefined) {
        return err(failure);
      }
      if (!metaSeen) {
        return err(
          CodexOwnerTurnParseErrors.metaInvalid({ lineNumber: lastLine, why: "the rollout never names its session" }),
        );
      }
      return ok(turns);
    },
    push: (line) => {
      lastLine = line.lineNumber;
      // An undecodable line is never blank, whatever its placeholder text reads as: it is judged, and refused.
      if (failure !== undefined || (!line.undecodable && line.line.trim().length === 0)) {
        return;
      }
      const verdict = judgeLine({ line, rolloutName, threadId });
      if (verdict.isErr()) {
        failure = verdict.error;
        return;
      }
      if (!metaSeen && verdict.value.kind !== "meta") {
        failure = CodexOwnerTurnParseErrors.metaInvalid({
          lineNumber: line.lineNumber,
          why: "the rollout does not open with a session_meta",
        });
        return;
      }
      if (verdict.value.kind === "meta") {
        metaSeen = true;
      }
      if (verdict.value.kind === "turn") {
        turns.push(verdict.value.turn);
      }
    },
  };
}

/**
 * The owner's turns in one rollout's lines, in file order.
 *
 * @param lines every line of the rollout, in order
 * @param rolloutName the rollout file's basename
 * @param threadId the chair's thread id
 * @returns the turns, or the first line it could not place
 */
export function parseCodexOwnerTurns({
  lines,
  rolloutName,
  threadId,
}: {
  lines: Iterable<CodexRolloutLine>;
  rolloutName: string;
  threadId: string;
}): Result<readonly CodexRolloutOwnerTurn[], CodexOwnerTurnParseError> {
  const fold = rolloutOwnerTurnFold({ rolloutName, threadId });
  for (const line of lines) {
    fold.push(line);
  }
  return fold.finish();
}
