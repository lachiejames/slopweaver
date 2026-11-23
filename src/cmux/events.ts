/**
 * The cmux event stream's frame model, as pure functions — parsing and folding, no socket.
 *
 * Measured live against cmux 0.64.22. A subscription opens with ONE `ack` frame and then a `type:"event"`
 * frame per hook firing, across every workspace:
 *
 * ```json
 * {"type":"ack","protocol":"cmux-events","version":1,"boot_id":"…","subscription_id":"…",
 *  "replay_count":84,"filters":{"categories":[],"names":[]},"heartbeat_interval_seconds":15,
 *  "resume":{"after_seq":78100,"oldest_seq":78080,"latest_seq":82175,"next_seq":82176,"gap":false}}
 * {"type":"event","seq":78163,"id":"<boot>-78163","name":"agent.hook.Stop","category":"agent",
 *  "occurred_at":"<ISO instant>","workspace_id":"8D47…","surface_id":null,
 *  "payload":{"_source":"claude","cwd":"…","session_id":"cmux-feed-v1:Y2xhdWRl:<base64 uuid>","phase":"received",…}}
 * ```
 *
 * cmux wraps `session_id` as `cmux-feed-v1:<base64 source>:<base64 id>`; it once sent `claude-<uuid>`, and
 * `normaliseCmuxSessionId` turns the wrapped form back into that one, which every reader joins on.
 *
 * Two fields carry the whole supervision story and are worth naming here rather than leaving to be
 * rediscovered: `workspace_id` IS present at the top level of an agent-hook frame (so an event maps to a
 * session without a cwd cross-reference), and `phase` is `received` then `completed` for the SAME hook, so a
 * naive count double-counts every tool call. `resume.gap` is the honest signal that a cursor fell off the
 * retained buffer — cmux keeps 4,096 events in memory and the rest in `~/.cmuxterm/events.jsonl`.
 */
import { absentAs, absentAsNumber } from "#lib/absent.js";
import { isRecord } from "../lib/parsers.js";

/** The hook names a supervisor actually acts on, and what each one means for a session's state. */
export const SUPERVISION_EVENT_NAMES = [
  "agent.hook.SessionStart",
  "agent.hook.UserPromptSubmit",
  "agent.hook.Stop",
  "agent.hook.Notification",
  "agent.hook.AskUserQuestion",
  "agent.hook.PreToolUse",
] as const;

/** One decoded event frame, narrowed to the fields this repository uses. */
export interface CmuxEvent {
  readonly seq: number;
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly occurredAtIso: string;
  readonly workspaceId: string | undefined;
  readonly surfaceId: string | undefined;
  /** `received` or `completed` for a hook that reports both; `undefined` for frames that carry no phase. */
  readonly phase: string | undefined;
  /** The agent session's own cwd, the one reliable way to tie an event to a worktree. */
  readonly cwd: string | undefined;
  /** The agent CLI's session id (`claude-…`), when the payload names one, unwrapped by `normaliseCmuxSessionId`. */
  readonly sessionId: string | undefined;
  /** The tool a `PreToolUse` frame names, when it names one. */
  readonly toolName: string | undefined;
  /**
   * Which agent CLI fired the hook, as cmux names it in `payload._source` — `claude` on every one of the 8,160 frames
   * in this machine's retained log (`grep -o '"_source":"[a-z-]*"' ~/.cmuxterm/events.jsonl | sort | uniq -c`).
   */
  readonly agentSource: string | undefined;
}

/** The subscription's opening frame — what cmux could and could not replay. */
export interface CmuxEventAck {
  readonly subscriptionId: string;
  readonly replayCount: number;
  readonly oldestSeq: number | undefined;
  readonly latestSeq: number | undefined;
  readonly nextSeq: number | undefined;
  /** True when the requested cursor had already fallen out of the retained buffer — events were MISSED. */
  readonly gap: boolean;
}

/** What an event with no `category` is filed under, so a filter never sees a blank. */
const UNKNOWN_CATEGORY = "unknown";

/**
 * The `occurred_at` stamp for a frame that carries none.
 *
 * Deliberately a value `Date.parse` REJECTS rather than an epoch: a fold that treats a missing timestamp as
 * 1970 would report every such session as silent for fifty years, which is a confident wrong answer where
 * `NaN` produces the honest "cannot tell" branch (`classifySession` falls through to `working`).
 */
const NO_TIMESTAMP = "unknown";

/** What a subscription cmux did not name is called in a diagnostic. */
const UNIDENTIFIED_SUBSCRIPTION = "unidentified";

/**
 * The wrapper cmux puts round an agent hook's session id: `cmux-feed-v1:<base64 source>:<base64 id>`. Every one of the
 * 10,874 frames in this machine's retained log carried it, where the frames above once carried
 * `claude-<uuid>` (`grep -o '"session_id":"[a-z0-9-]*[:-]' ~/.cmuxterm/events.jsonl | sort | uniq -c`).
 */
const CMUX_FEED_ID = /^cmux-feed-v1:([A-Za-z0-9+/_-]+={0,2}):([A-Za-z0-9+/_-]+={0,2})$/u;

/**
 * One base64 part of a feed id as text, `undefined` unless it decodes exactly. Node's decoder drops what it cannot read
 * rather than refusing it (`Buffer.from("Y2xhdWRl$", "base64url")` reads `claude`), so the bytes must re-encode to the
 * very characters sent, and to the very UTF-8 they decoded from.
 */
function feedPart({ encoded }: { encoded: string }): string | undefined {
  const body = encoded.replace(/=+$/u, "");
  const padding = encoded.length - body.length;
  if (body.length % 4 === 1 || (padding > 0 && encoded.length % 4 !== 0)) {
    return undefined;
  }
  const bytes = Buffer.from(body, "base64url");
  if (bytes.toString("base64url") !== body.replaceAll("+", "-").replaceAll("/", "_")) {
    return undefined;
  }
  const text = bytes.toString("utf8");
  if (text === "" || !Buffer.from(text, "utf8").equals(bytes)) {
    return undefined;
  }
  return text;
}

/**
 * A hook's session id in the `<source>-<id>` form every reader of `CmuxEvent.sessionId` joins on — `claude-<uuid>` for
 * a Claude Code session — unwrapping cmux's `cmux-feed-v1:` envelope. An id in the older bare form passes through
 * unchanged, and so does a feed id whose parts do not decode, so a reader still refuses it rather than seeing a guess.
 *
 * @param raw the payload's `session_id`, exactly as cmux sent it
 * @returns the session id a transcript, a title and a perf join can key on
 */
export function normaliseCmuxSessionId({ raw }: { raw: string }): string {
  const match = CMUX_FEED_ID.exec(raw);
  if (match === null) {
    return raw;
  }
  const source = feedPart({ encoded: match[1]! });
  const id = feedPart({ encoded: match[2]! });
  if (source === undefined || id === undefined) {
    return raw;
  }
  if (id.startsWith(`${source}-`)) {
    return id;
  }
  return `${source}-${id}`;
}

/** Read one string field out of a record, or `undefined`. */
function str({ value, field }: { value: Record<string, unknown>; field: string }): string | undefined {
  const raw = value[field];
  return typeof raw === "string" ? raw : undefined;
}

/** Read one number field out of a record, or `undefined`. */
function num({ value, field }: { value: Record<string, unknown>; field: string }): number | undefined {
  const raw = value[field];
  return typeof raw === "number" ? raw : undefined;
}

/** Read one string field off the frame itself, else off its payload, or `undefined` when neither carries it. */
function frameOrPayloadStr({
  decoded,
  field,
  payload,
}: {
  decoded: Record<string, unknown>;
  field: string;
  payload: Record<string, unknown>;
}): string | undefined {
  const onFrame = str({ field, value: decoded });
  if (onFrame !== undefined) {
    return onFrame;
  }
  return str({ field, value: payload });
}

/**
 * Decode one stream frame as an event, or `undefined` when it is not one (an ack, a heartbeat, or noise).
 *
 * @param line one complete frame from the subscription
 * @returns the narrowed event, or `undefined`
 */
export function parseEventFrame({ line }: { line: string }): CmuxEvent | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded) || decoded["type"] !== "event") {
    return undefined;
  }
  const seq = num({ field: "seq", value: decoded });
  const id = str({ field: "id", value: decoded });
  const name = str({ field: "name", value: decoded });
  if (seq === undefined || id === undefined || name === undefined) {
    return undefined;
  }
  const payload = isRecord(decoded["payload"]) ? decoded["payload"] : {};
  const rawSessionId = str({ field: "session_id", value: payload });
  return {
    agentSource: str({ field: "_source", value: payload }),
    category: absentAs({ value: str({ field: "category", value: decoded }), whenAbsent: UNKNOWN_CATEGORY }),
    cwd: str({ field: "cwd", value: payload }),
    id,
    name,
    occurredAtIso: absentAs({ value: str({ field: "occurred_at", value: decoded }), whenAbsent: NO_TIMESTAMP }),
    phase: str({ field: "phase", value: payload }),
    seq,
    sessionId: rawSessionId === undefined ? undefined : normaliseCmuxSessionId({ raw: rawSessionId }),
    surfaceId: frameOrPayloadStr({ decoded, field: "surface_id", payload }),
    toolName: str({ field: "tool_name", value: payload }),
    workspaceId: frameOrPayloadStr({ decoded, field: "workspace_id", payload }),
  };
}

/**
 * Decode one stream frame as the subscription's ack, or `undefined` when it is not one.
 *
 * @param line one complete frame from the subscription
 * @returns the narrowed ack, or `undefined`
 */
export function parseAckFrame({ line }: { line: string }): CmuxEventAck | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(decoded) || decoded["type"] !== "ack") {
    return undefined;
  }
  const resume = isRecord(decoded["resume"]) ? decoded["resume"] : {};
  return {
    gap: resume["gap"] === true,
    latestSeq: num({ field: "latest_seq", value: resume }),
    nextSeq: num({ field: "next_seq", value: resume }),
    oldestSeq: num({ field: "oldest_seq", value: resume }),
    replayCount: absentAsNumber({ value: num({ field: "replay_count", value: decoded }), whenAbsent: 0 }),
    subscriptionId: absentAs({
      value: str({ field: "subscription_id", value: decoded }),
      whenAbsent: UNIDENTIFIED_SUBSCRIPTION,
    }),
  };
}
