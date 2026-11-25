/**
 * The app session harness's picture wire: what one hosted session has DONE in this run of the app, as the control
 * plane answers a `picture.read`. This is the picture's FACTS layer only — which tools the session called, of which
 * kind, how each ended — and never what the session said, what it was asked, or a tool's input or output: a tool's
 * input and output can hold a secret or the owner's private data, and a vendor's tool title is commonly the command
 * line or the path itself, so no title crosses this wire at all. A tool call's id and its parent's cross only as a
 * digest (`TOOL_CALL_DIGEST`), so no vendor string does; the tool's name, its own identity, crosses only as one bare
 * identifier (`TOOL_IDENTIFIER`), so never a command with arguments, a sentence or a path through a directory.
 *
 * Written ONCE and copied byte for byte, exactly as the session wire is: `desktop/src/pictureWire.ts` is the
 * canonical copy and `src/sessionHarness/pictureWire.ts` the mirror the CLI imports.
 * `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ. So this file imports
 * only its mirrored sibling, under the one specifier both trees resolve.
 */
import {
  APP_SESSION_STATES,
  type AppHarnessVendor,
  type AppSessionState,
  hasOnlyKeys,
  hasOptionalStrings,
  hasStrings,
  isObject,
} from "./wireBasics.js";

/**
 * What a tool call does: ACP's own tool kinds, and `delegate` for a Claude call that hands work to a subagent.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppToolKind =
  "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "delegate" | "other";

/** Every {@link AppToolKind}, in the order a picture prints its counts. */
export const APP_TOOL_KINDS: readonly AppToolKind[] = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "delegate",
  "other",
];

/**
 * Where a tool call is: ACP's own statuses, which a Claude call's start and result map onto.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppToolStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * The most tool calls a picture holds in flight; a call seen past it is counted as dropped, never stored.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export const APP_PICTURE_IN_FLIGHT_CAP = 64;

/**
 * The most ended tool calls a picture keeps, newest first; the counts by kind keep every one.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export const APP_PICTURE_COMPLETED_CAP = 20;

/**
 * The longest tool name a picture carries, in bytes.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export const APP_PICTURE_TEXT_BYTES = 256;

/** A tool name a picture may carry: one bare identifier, never a command with arguments, a sentence or a path. */
const TOOL_IDENTIFIER = /^[A-Za-z0-9_.:-]+$/u;

/** A tool call id or parent id as a picture carries it: the SHA-256 of the vendor's id, never the id itself. */
const TOOL_CALL_DIGEST = /^sha256:[0-9a-f]{64}$/u;

/**
 * One tool call the session made. `lastObservedAtIso` is when the app last heard of it, which for an ended call is
 * when it ended. Every instant is the app's own receipt time: neither vendor stamps when a tool ran.
 */
export interface AppToolFact {
  /** The digest of the vendor's id for the call: it pairs a start with its end and carries nothing the vendor wrote. */
  readonly toolCallId: string;
  /** The digest of the call that started this one's subagent, when a subagent made it. */
  readonly parentToolCallId?: string;
  /** The vendor's own name for the tool, when it gave one that is a bare identifier. */
  readonly name?: string;
  readonly toolKind: AppToolKind;
  readonly status: AppToolStatus;
  readonly startedAtIso: string;
  readonly lastObservedAtIso: string;
}

/**
 * What one session has done in this run of the app.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface AppSessionFacts {
  /** Every call seen, by kind. A floor while `droppedActivityEvents` is above zero. */
  readonly countsByKind: Readonly<Record<AppToolKind, number>>;
  /** The calls not yet ended, oldest first. */
  readonly inFlight: readonly AppToolFact[];
  /** The calls that ended, newest first. */
  readonly lastCompleted: readonly AppToolFact[];
  readonly firstActivityAtIso?: string;
  readonly lastActivityAtIso?: string;
  /** Reports about a new call that arrived while the in-flight list was full, so were not stored. */
  readonly droppedActivityEvents: number;
}

/** One session's picture, read at one instant: who it is, and what it has done. */
export interface AppSessionPicture {
  readonly readAtIso: string;
  readonly session: {
    readonly sessionId: string;
    readonly handle: string;
    readonly vendor: AppHarnessVendor;
    readonly title: string;
    readonly state: AppSessionState;
  };
  readonly facts: AppSessionFacts;
}

/**
 * Whether a value is a tool kind this wire knows.
 *
 * @param value anything parsed off the wire or a worker's report
 * @returns true for one of {@link APP_TOOL_KINDS}
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppToolKind(value: unknown): value is AppToolKind {
  return APP_TOOL_KINDS.some((kind) => kind === value);
}

/**
 * Whether a value is a tool status this wire knows.
 *
 * @param value anything parsed off the wire or a worker's report
 * @returns true for pending, in progress, completed or failed
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppToolStatus(value: unknown): value is AppToolStatus {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "failed";
}

/**
 * Whether a value is a tool name a picture may carry: a bare identifier within {@link APP_PICTURE_TEXT_BYTES}, so
 * never a command with arguments, a sentence or a path through a directory.
 *
 * @param value anything parsed off the wire, a worker's report or a vendor's message
 * @returns true for a non-empty run of letters, digits and `_.:-` alone (ASCII, so its length is its bytes)
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isToolIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= APP_PICTURE_TEXT_BYTES && TOOL_IDENTIFIER.test(value);
}

/**
 * Whether a value is a tool call id or parent id as a picture carries it: `sha256:` and 64 lowercase hex digits, the
 * digest of the vendor's id, so a vendor that puts a command or a path in its id still sends none of it.
 *
 * @param value anything parsed off the wire or a worker's report
 * @returns true for a digest alone
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isToolCallDigest(value: unknown): value is string {
  return typeof value === "string" && TOOL_CALL_DIGEST.test(value);
}

const FACT_KEYS: readonly string[] = [
  "toolCallId",
  "parentToolCallId",
  "name",
  "toolKind",
  "status",
  "startedAtIso",
  "lastObservedAtIso",
];

function isToolFact({ value, ended }: { value: unknown; ended: boolean }): boolean {
  if (!isObject(value)) {
    return false;
  }
  const { parentToolCallId, name, status } = value;
  return (
    hasOnlyKeys({ keys: FACT_KEYS, value }) &&
    isToolCallDigest(value["toolCallId"]) &&
    (parentToolCallId === undefined || isToolCallDigest(parentToolCallId)) &&
    (name === undefined || isToolIdentifier(name)) &&
    isAppToolKind(value["toolKind"]) &&
    isAppToolStatus(status) &&
    (status === "completed" || status === "failed") === ended &&
    hasStrings({ keys: ["startedAtIso", "lastObservedAtIso"], value })
  );
}

function isCountsByKind(value: unknown): value is Readonly<Record<AppToolKind, number>> {
  return (
    isObject(value) &&
    hasOnlyKeys({ keys: APP_TOOL_KINDS, value }) &&
    APP_TOOL_KINDS.every((kind) => {
      const count = value[kind];
      return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
    })
  );
}

function isFactList({ value, ended, cap }: { value: unknown; ended: boolean; cap: number }): boolean {
  return Array.isArray(value) && value.length <= cap && value.every((fact) => isToolFact({ ended, value: fact }));
}

function isSessionFacts(value: unknown): value is AppSessionFacts {
  if (!isObject(value)) {
    return false;
  }
  const dropped = value["droppedActivityEvents"];
  return (
    hasOnlyKeys({
      keys: [
        "countsByKind",
        "inFlight",
        "lastCompleted",
        "firstActivityAtIso",
        "lastActivityAtIso",
        "droppedActivityEvents",
      ],
      value,
    }) &&
    isCountsByKind(value["countsByKind"]) &&
    isFactList({ cap: APP_PICTURE_IN_FLIGHT_CAP, ended: false, value: value["inFlight"] }) &&
    isFactList({ cap: APP_PICTURE_COMPLETED_CAP, ended: true, value: value["lastCompleted"] }) &&
    hasOptionalStrings({ keys: ["firstActivityAtIso", "lastActivityAtIso"], value }) &&
    (value["firstActivityAtIso"] === undefined) === (value["lastActivityAtIso"] === undefined) &&
    typeof dropped === "number" &&
    Number.isSafeInteger(dropped) &&
    dropped >= 0
  );
}

/**
 * Whether a value is one session's picture, carrying exactly the fields this wire declares and nothing that could
 * smuggle a tool's input, output or title in beside them.
 *
 * @param value the `picture` of a `picture` answer
 * @returns true when the session header and every fact are the shape this wire declares, within its caps
 */
export function isAppSessionPicture(value: unknown): value is AppSessionPicture {
  if (!isObject(value) || !hasStrings({ keys: ["readAtIso"], value }) || !isObject(value["session"])) {
    return false;
  }
  const session = value["session"];
  return (
    hasOnlyKeys({ keys: ["readAtIso", "session", "facts"], value }) &&
    hasOnlyKeys({ keys: ["sessionId", "handle", "vendor", "title", "state"], value: session }) &&
    hasStrings({ keys: ["sessionId", "handle", "title"], value: session }) &&
    (session["vendor"] === "codex" || session["vendor"] === "claude") &&
    typeof session["state"] === "string" &&
    APP_SESSION_STATES.has(session["state"]) &&
    isSessionFacts(value["facts"])
  );
}
