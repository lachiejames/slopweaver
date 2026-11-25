/**
 * What passes between the control plane and one session's worker process over Node's IPC channel, and the one
 * configuration document the control plane hands the worker at launch. Pure: types, predicates and the encoders.
 *
 * The worker owns exactly one vendor connection for its whole life (`codexAcpWorker.ts`); the control plane never
 * speaks the vendor's protocol. So this wire is small and says what the card shows: the agent's words, a turn ending,
 * a failure.
 */
import type { ClaudeCredentialRoute } from "../credentialRouteWire";
import {
  type AppToolKind,
  type AppToolStatus,
  isAppToolKind,
  isAppToolStatus,
  isToolCallDigest,
  isToolIdentifier,
} from "../pictureWire";
import { APP_CLAUDE_EFFORTS, type AppClaudeEffort } from "../sessionControlProtocol";
import { type AppTurnUsage, isAppTurnUsage } from "../usageWire";

/** The environment variable carrying {@link WorkerLaunchConfig} into the worker, as one JSON document. */
export const WORKER_CONFIG_ENV = "SLOPWEAVER_SESSION_WORKER";

/** What every worker needs, whichever vendor it runs. */
interface WorkerLaunchCommon {
  /** The control plane's id for the session, echoed on every message so a stray one is dropped. */
  readonly sessionId: string;
  /** The directory the vendor session runs in. */
  readonly directory: string;
  /** The model asked for, when one was pinned. */
  readonly model?: string;
  /**
   * The vendor transcript this worker continues rather than starting a new one: the id the recovery journal recorded
   * when the session first came up. A resumed worker that reports any other id is refused.
   */
  readonly resumeVendorSessionId?: string;
}

/** A Codex worker: the packaged ACP adapter, driving the packaged Codex binary. */
export interface CodexWorkerLaunchConfig extends WorkerLaunchCommon {
  readonly vendor: "codex";
  /** The packaged ACP adapter's entry script. */
  readonly adapterEntry: string;
  /** The Codex executable the adapter drives. */
  readonly codexPath: string;
  /** The `$CODEX_HOME` the session's plan routes it to, set again on the adapter rather than trusted to survive. */
  readonly codexHome: string;
}

/** A Claude worker: the Agent SDK, driving the packaged native Claude Code binary. */
export interface ClaudeWorkerLaunchConfig extends WorkerLaunchCommon {
  readonly vendor: "claude";
  /** The native Claude Code executable the SDK runs. */
  readonly claudePath: string;
  readonly credential: ClaudeCredentialRoute;
  /** The rule files the seat's template leaves out, by absolute path. */
  readonly claudeMdExcludes: readonly string[];
  readonly effort?: AppClaudeEffort;
  /** The Slopweaver plugin directory the session loads, when the spawn resolved one. */
  readonly pluginDir?: string;
  /**
   * The UUID the app minted for the Claude transcript, handed to the SDK as its session id so the app knows which
   * transcript to resume before the session has said anything. Every message the SDK streams must carry it.
   */
  readonly vendorSessionId: string;
}

/** What the worker needs to open its one session — paths and choices, never a credential. */
export type WorkerLaunchConfig = CodexWorkerLaunchConfig | ClaudeWorkerLaunchConfig;

/** One instruction the control plane sends a worker. */
export type ToWorker =
  { readonly kind: "prompt"; readonly text: string } | { readonly kind: "cancel" } | { readonly kind: "close" };

/**
 * What a worker saw of one tool call: a patch, because a vendor's update may name only what changed. It carries the
 * digest of the call's id, its kind and status and a bare tool name, and NEVER a title, an input, an output or a
 * location: each can hold a command line, a path, a secret or the owner's private data (`../pictureWire.ts`). When the
 * call happened is the control plane's own receipt instant, so no time rides here.
 */
export interface ToolActivity {
  readonly toolCallId: string;
  /** The call that started the subagent making this one, when a subagent made it. */
  readonly parentToolCallId?: string;
  readonly name?: string;
  readonly toolKind?: AppToolKind;
  readonly status?: AppToolStatus;
}

/** One report a worker sends the control plane. */
export type FromWorker =
  /** The vendor session is open; `vendorSessionId` is the vendor's own id for it, the one a resume names. */
  | { readonly kind: "ready"; readonly sessionId: string; readonly vendorSessionId: string }
  | { readonly kind: "agent-text"; readonly sessionId: string; readonly text: string }
  | { readonly kind: "turn-ended"; readonly sessionId: string; readonly stopReason: string }
  | { readonly kind: "failed"; readonly sessionId: string; readonly message: string }
  | { readonly kind: "closed"; readonly sessionId: string }
  /** The model the vendor says the session runs on: Claude's per-turn init, Codex's model option at open. */
  | { readonly kind: "model-resolved"; readonly sessionId: string; readonly model: string }
  /** What one turn spent, sent ahead of that turn's `turn-ended`: already this turn's own, never a running total. */
  | { readonly kind: "turn-usage"; readonly sessionId: string; readonly usage: AppTurnUsage }
  /** How full Codex's context window is, mid-turn. Occupancy, not spend. */
  | {
      readonly kind: "context-occupancy";
      readonly sessionId: string;
      readonly usedTokens: number;
      readonly sizeTokens: number;
    }
  /** A tool call started, changed or ended: an observation, which never moves a turn. */
  | { readonly kind: "tool-activity"; readonly sessionId: string; readonly activity: ToolActivity };

const TOOL_ACTIVITY_KEYS: ReadonlySet<string> = new Set([
  "toolCallId",
  "parentToolCallId",
  "name",
  "toolKind",
  "status",
]);

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPaths({ value, keys }: { value: Readonly<Record<string, unknown>>; keys: readonly string[] }): boolean {
  return keys.every((key) => typeof value[key] === "string" && value[key].length > 0);
}

function isOptionalString({ value }: { value: unknown }): boolean {
  return value === undefined || typeof value === "string";
}

/** A tool activity of its declared fields alone, ids as digests and a bare name: no input, output or title rides. */
function isToolActivity({ value }: { value: unknown }): boolean {
  if (!isObject(value)) {
    return false;
  }
  const { parentToolCallId, name, toolKind, status } = value;
  return (
    Object.keys(value).every((key) => TOOL_ACTIVITY_KEYS.has(key)) &&
    isToolCallDigest(value["toolCallId"]) &&
    (parentToolCallId === undefined || isToolCallDigest(parentToolCallId)) &&
    (name === undefined || isToolIdentifier(name)) &&
    (toolKind === undefined || isAppToolKind(toolKind)) &&
    (status === undefined || isAppToolStatus(status))
  );
}

function isClaudeRoute({ value }: { value: unknown }): boolean {
  if (!isObject(value) || !hasPaths({ keys: ["secureStorageDir"], value })) {
    return false;
  }
  return value["kind"] === "store" || (value["kind"] === "setup-token" && hasPaths({ keys: ["tokenFilePath"], value }));
}

function isClaudeConfig({ value }: { value: Readonly<Record<string, unknown>> }): boolean {
  const excludes = value["claudeMdExcludes"];
  const effort = value["effort"];
  const resumed = value["resumeVendorSessionId"];
  return (
    hasPaths({ keys: ["claudePath", "vendorSessionId"], value }) &&
    // A resumed Claude transcript keeps its id, so the id the SDK must stream is the one it resumes.
    (resumed === undefined || resumed === value["vendorSessionId"]) &&
    isClaudeRoute({ value: value["credential"] }) &&
    Array.isArray(excludes) &&
    excludes.every((path) => typeof path === "string") &&
    (effort === undefined || APP_CLAUDE_EFFORTS.some((level) => level === effort)) &&
    isOptionalString({ value: value["pluginDir"] })
  );
}

/**
 * Whether a value is a launch configuration.
 *
 * @param value the parsed document
 * @returns true when it is one vendor's arm with every required path a non-empty string
 */
export function isWorkerLaunchConfig(value: unknown): value is WorkerLaunchConfig {
  if (
    !isObject(value) ||
    !hasPaths({ keys: ["sessionId", "directory"], value }) ||
    !isOptionalString({ value: value["model"] }) ||
    !isOptionalString({ value: value["resumeVendorSessionId"] }) ||
    value["resumeVendorSessionId"] === ""
  ) {
    return false;
  }
  if (value["vendor"] === "claude") {
    return isClaudeConfig({ value });
  }
  return value["vendor"] === "codex" && hasPaths({ keys: ["adapterEntry", "codexPath", "codexHome"], value });
}

/**
 * Whether an IPC message is an instruction to a worker.
 *
 * @param value what arrived
 * @returns true for a prompt with text, a cancel or a close
 */
export function isToWorker(value: unknown): value is ToWorker {
  if (!isObject(value)) {
    return false;
  }
  if (value["kind"] === "prompt") {
    return typeof value["text"] === "string";
  }
  return value["kind"] === "cancel" || value["kind"] === "close";
}

/**
 * Whether an IPC message is a report from a worker.
 *
 * @param value what arrived
 * @returns true for one of the reports, each with the fields it carries
 */
export function isFromWorker(value: unknown): value is FromWorker {
  if (!isObject(value) || typeof value["sessionId"] !== "string") {
    return false;
  }
  switch (value["kind"]) {
    case "ready": {
      return typeof value["vendorSessionId"] === "string" && value["vendorSessionId"].length > 0;
    }
    case "closed": {
      return true;
    }
    case "agent-text": {
      return typeof value["text"] === "string";
    }
    case "turn-ended": {
      return typeof value["stopReason"] === "string";
    }
    case "failed": {
      return typeof value["message"] === "string";
    }
    case "model-resolved": {
      return typeof value["model"] === "string" && value["model"].length > 0;
    }
    case "turn-usage": {
      return isAppTurnUsage(value["usage"]);
    }
    case "context-occupancy": {
      return [value["usedTokens"], value["sizeTokens"]].every(
        (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
      );
    }
    case "tool-activity": {
      return isToolActivity({ value: value["activity"] });
    }
    default: {
      return false;
    }
  }
}
