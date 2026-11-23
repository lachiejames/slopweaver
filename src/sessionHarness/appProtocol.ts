/**
 * The app session harness's wire: what a `slopweaver` verb sends the desktop app's control plane over its local
 * socket, and what comes back. One request per line, one response per line, both JSON.
 *
 * Written ONCE and copied byte for byte: `desktop/src/sessionControlProtocol.ts` is the canonical copy and
 * `src/sessionHarness/appProtocol.ts` the mirror the CLI imports, because the desktop builds apart from `src/` and
 * imports none of it. `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ.
 * So this file imports only its two mirrored siblings, `wireBasics.ts` (the words and shape checks both wires share)
 * and `usageWire.ts` (what a `usage` answer carries), under the one specifier both trees resolve; every check in it is
 * a type predicate either side wraps in its own `Result`.
 *
 * The vocabulary is the session harness's (`src/sessionHarness/sessionHarness.ts`): a session, a handle, a delivery.
 * The vendor's own session id never crosses this wire; the control plane keeps it.
 */
import { type AppUsageReport, isAppUsageReport } from "./usageWire.js";
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
 * The one protocol version both sides speak; a request or response carrying any other is refused. The socket's name
 * carries it too, so a verb from one version never reaches an app speaking another and reads its answer as malformed.
 */
export const APP_HARNESS_PROTOCOL_VERSION = 2;

/** The longest line either side accepts, in bytes, newline excluded. A longer one is refused, never truncated. */
export const APP_HARNESS_MAX_LINE_BYTES = 1_048_576;

/**
 * The prefix every app-hosted session's handle carries, so a handle names its harness on sight.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export const APP_SESSION_HANDLE_PREFIX = "app:";

/**
 * How a message reaches a session that may be mid-turn — the seam's own three outcomes.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppHarnessDelivery = "now" | "turn" | "later";

/**
 * How hard a Claude session thinks, in the Agent SDK's own levels; an unknown level is refused, never passed on.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Every {@link AppClaudeEffort}, which the CLI checks a seat's effort against before it asks for a launch. */
export const APP_CLAUDE_EFFORTS: readonly AppClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Which login a Claude session presents, by path only — a token never crosses this wire. `store` boots on the routed
 * credential store's own saved login; `setup-token` opens a token file the app hands the session as file descriptor 3,
 * beside an unbound store, exactly as a cmux seat's boot line does (`src/claude/seatPinning.ts`).
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type ClaudeCredentialRoute =
  | { readonly kind: "store"; readonly secureStorageDir: string }
  | { readonly kind: "setup-token"; readonly secureStorageDir: string; readonly tokenFilePath: string };

/** What every launch carries, whichever vendor runs it. */
interface AppLaunchCommon {
  /** The short human title the card shows. */
  readonly title: string;
  /** The directory the session runs in; it exists before the launch is asked for. */
  readonly directory: string;
  /** The ledger's label for the session, shown on the card. */
  readonly ledgerKey: string;
  /** The model asked for, when one was pinned. */
  readonly model?: string;
  /**
   * The state home the spawn recorded the session's ledger row under, when it named one: the card's Stop closes
   * through the verb under the same home, so the close lands on that row.
   */
  readonly ledgerHome?: string;
}

/**
 * A Codex launch.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface CodexAppLaunchSpec extends AppLaunchCommon {
  readonly vendor: "codex";
  /** The `$CODEX_HOME` the session's plan routes it to. */
  readonly codexHome: string;
  /**
   * The `instanceId` of the app whose `pong` named the binary the spawn's browser door judged. Each request is its own
   * connection, so another run of the app (a reinstall, a relaunch) can hold the socket by the launch; it refuses a
   * launch naming any instance but its own, so a judgment is never spent on an app it was not made against.
   */
  readonly judgedInstanceId: string;
}

/**
 * A Claude launch: the login it presents, and what it loads.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface ClaudeAppLaunchSpec extends AppLaunchCommon {
  readonly vendor: "claude";
  readonly credential: ClaudeCredentialRoute;
  /** The rule files the seat's template leaves out, by absolute path (`src/cmux/launchTemplate.ts`). */
  readonly claudeMdExcludes: readonly string[];
  readonly effort?: AppClaudeEffort;
  /** The Slopweaver plugin directory the seat loads, when the spawn resolved one. */
  readonly pluginDir?: string;
}

/** What the control plane needs to open one session — never a credential, never the ledger. */
export type AppLaunchSpec = CodexAppLaunchSpec | ClaudeAppLaunchSpec;

/** One session as the control plane reports it. */
export interface AppSessionSnapshot {
  /** The control plane's own id for the session, stable for its life. */
  readonly sessionId: string;
  /** `app:` and the id: the handle every verb addresses. */
  readonly handle: string;
  readonly vendor: AppHarnessVendor;
  readonly title: string;
  readonly directory: string;
  readonly ledgerKey: string;
  readonly state: AppSessionState;
  readonly openedAtIso: string;
  /** The last text a message delivered, when one was. */
  readonly lastSubmittedText?: string;
  readonly lastSubmittedAtIso?: string;
  /** The tail of what the agent last said, when it said anything. */
  readonly lastAgentText?: string;
}

/** One request a verb sends. */
export type AppHarnessRequest =
  | { readonly kind: "ping" }
  | { readonly kind: "launch.prepare"; readonly spec: AppLaunchSpec }
  /**
   * Prepare a session this app hosted before, under its own id and on the vendor transcript the app's recovery
   * journal recorded for it, answered `prepared` exactly as a new launch is. Refused unless the journal holds that
   * session up and never stopped, under the same launch identity, with every process group it led gone or provably
   * its own. An app from before it refuses it as `BAD_REQUEST`.
   */
  | { readonly kind: "launch.resume"; readonly sessionId: string; readonly spec: AppLaunchSpec }
  | { readonly kind: "launch.deliver"; readonly launchToken: string; readonly text: string }
  | { readonly kind: "launch.abort"; readonly launchToken: string }
  | { readonly kind: "list" }
  | { readonly kind: "resolve"; readonly handle: string }
  | {
      readonly kind: "message";
      readonly sessionId: string;
      readonly text: string;
      readonly delivery: AppHarnessDelivery;
    }
  | { readonly kind: "interrupt"; readonly sessionId: string }
  | { readonly kind: "close"; readonly sessionId: string }
  /**
   * Click the session's card's own Stop control, as the owner would: answered only once the card's navigation handler
   * saw that press and the stop it started has finished. An app from before it refuses it as `BAD_REQUEST`.
   */
  | { readonly kind: "stop.press"; readonly sessionId: string }
  /** Every hosted session's usage, answered `usage`. An app from before it refuses it as `BAD_REQUEST`. */
  | { readonly kind: "usage.read" };

/** One answer the control plane sends back to a request it carried out. */
export type AppHarnessResponse =
  /**
   * `codexPath` is the Codex binary the app's sessions run, so the browser door judges that binary's server list
   * rather than whichever `codex` the verb's PATH finds. `instanceId` names this run of the app, minted once at its
   * start, so a launch can name the app its door was judged against. An app from before them answers without either.
   */
  | {
      readonly kind: "pong";
      readonly appPid: number;
      readonly startedAtIso: string;
      readonly codexPath?: string;
      readonly instanceId?: string;
    }
  | { readonly kind: "prepared"; readonly launchToken: string; readonly session: AppSessionSnapshot }
  | { readonly kind: "delivered"; readonly session: AppSessionSnapshot }
  | { readonly kind: "aborted" }
  | { readonly kind: "sessions"; readonly sessions: readonly AppSessionSnapshot[] }
  | { readonly kind: "resolved"; readonly session: AppSessionSnapshot }
  /** `queued` is a message held for the running turn's end; `interrupted` says that turn was cancelled for it. */
  | { readonly kind: "messaged"; readonly interrupted: boolean; readonly queued: boolean }
  | { readonly kind: "interrupted" }
  | { readonly kind: "closed"; readonly forced: boolean; readonly session: AppSessionSnapshot }
  /** The card's Stop was pressed and its stop finished: `session` is the session as that stop left it. */
  | { readonly kind: "stop-pressed"; readonly session: AppSessionSnapshot }
  | { readonly kind: "usage"; readonly report: AppUsageReport };

/**
 * Why the control plane did not carry a request out.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppHarnessRefusalCode =
  "BAD_REQUEST" | "SESSION_NOT_FOUND" | "DELIVERY_UNSUPPORTED" | "LAUNCH_FAILED" | "OPERATION_FAILED";

/**
 * A request on the wire.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export interface AppHarnessRequestEnvelope {
  readonly protocolVersion: number;
  readonly requestId: string;
  readonly request: AppHarnessRequest;
}

/** A response on the wire: the answer, or the refusal with its code and a line to print. */
export type AppHarnessResponseEnvelope =
  | {
      readonly protocolVersion: number;
      readonly requestId: string;
      readonly outcome: "answered";
      readonly response: AppHarnessResponse;
    }
  | {
      readonly protocolVersion: number;
      readonly requestId: string;
      readonly outcome: "refused";
      readonly code: AppHarnessRefusalCode;
      readonly message: string;
    };

const DELIVERIES: ReadonlySet<string> = new Set(["now", "turn", "later"]);
const REFUSALS: ReadonlySet<string> = new Set([
  "BAD_REQUEST",
  "SESSION_NOT_FOUND",
  "DELIVERY_UNSUPPORTED",
  "LAUNCH_FAILED",
  "OPERATION_FAILED",
]);

const COMMON_LAUNCH_KEYS: readonly string[] = ["vendor", "title", "directory", "ledgerKey", "model", "ledgerHome"];

function isCredentialRoute(value: unknown): value is ClaudeCredentialRoute {
  if (!isObject(value)) {
    return false;
  }
  if (value["kind"] === "store") {
    return (
      hasStrings({ keys: ["secureStorageDir"], value }) && hasOnlyKeys({ keys: ["kind", "secureStorageDir"], value })
    );
  }
  return (
    value["kind"] === "setup-token" &&
    hasStrings({ keys: ["secureStorageDir", "tokenFilePath"], value }) &&
    hasOnlyKeys({ keys: ["kind", "secureStorageDir", "tokenFilePath"], value })
  );
}

function isClaudeLaunchSpec(value: Readonly<Record<string, unknown>>): boolean {
  const excludes = value["claudeMdExcludes"];
  const effort = value["effort"];
  return (
    hasOnlyKeys({ keys: [...COMMON_LAUNCH_KEYS, "credential", "claudeMdExcludes", "effort", "pluginDir"], value }) &&
    isCredentialRoute(value["credential"]) &&
    Array.isArray(excludes) &&
    excludes.every((path) => typeof path === "string") &&
    (effort === undefined || APP_CLAUDE_EFFORTS.some((level) => level === effort)) &&
    hasOptionalStrings({ keys: ["pluginDir"], value })
  );
}

/**
 * Whether a value is one launch spec, each vendor's arm carrying only its own keys.
 *
 * @param value anything parsed off the wire, or out of the app's recovery journal
 * @returns true when it is a Codex or a Claude launch with every field the shape the protocol declares
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppLaunchSpec(value: unknown): value is AppLaunchSpec {
  if (
    !isObject(value) ||
    !hasStrings({ keys: ["title", "directory", "ledgerKey"], value }) ||
    !hasOptionalStrings({ keys: ["model", "ledgerHome"], value })
  ) {
    return false;
  }
  if (value["vendor"] === "claude") {
    return isClaudeLaunchSpec(value);
  }
  return (
    value["vendor"] === "codex" &&
    hasStrings({ keys: ["codexHome", "judgedInstanceId"], value }) &&
    hasOnlyKeys({ keys: [...COMMON_LAUNCH_KEYS, "codexHome", "judgedInstanceId"], value })
  );
}

/**
 * Whether a value is one session snapshot.
 *
 * @param value anything parsed off the wire
 * @returns true when every field is the shape the protocol declares
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppSessionSnapshot(value: unknown): value is AppSessionSnapshot {
  return (
    isObject(value) &&
    hasStrings({ keys: ["sessionId", "handle", "title", "directory", "ledgerKey", "openedAtIso"], value }) &&
    (value["vendor"] === "codex" || value["vendor"] === "claude") &&
    typeof value["state"] === "string" &&
    APP_SESSION_STATES.has(value["state"]) &&
    hasOptionalStrings({ keys: ["lastSubmittedText", "lastSubmittedAtIso", "lastAgentText"], value })
  );
}

function isRequest(value: unknown): value is AppHarnessRequest {
  if (!isObject(value)) {
    return false;
  }
  switch (value["kind"]) {
    case "ping":
    case "list":
    case "usage.read": {
      return true;
    }
    case "launch.prepare": {
      return isAppLaunchSpec(value["spec"]);
    }
    case "launch.resume": {
      return hasStrings({ keys: ["sessionId"], value }) && value["sessionId"] !== "" && isAppLaunchSpec(value["spec"]);
    }
    case "launch.deliver": {
      return hasStrings({ keys: ["launchToken", "text"], value });
    }
    case "launch.abort": {
      return hasStrings({ keys: ["launchToken"], value });
    }
    case "resolve": {
      return hasStrings({ keys: ["handle"], value });
    }
    case "message": {
      return (
        hasStrings({ keys: ["sessionId", "text"], value }) &&
        typeof value["delivery"] === "string" &&
        DELIVERIES.has(value["delivery"])
      );
    }
    case "interrupt":
    case "close":
    case "stop.press": {
      return hasStrings({ keys: ["sessionId"], value });
    }
    default: {
      return false;
    }
  }
}

function isResponse(value: unknown): value is AppHarnessResponse {
  if (!isObject(value)) {
    return false;
  }
  switch (value["kind"]) {
    case "pong": {
      return (
        typeof value["appPid"] === "number" &&
        hasStrings({ keys: ["startedAtIso"], value }) &&
        hasOptionalStrings({ keys: ["codexPath", "instanceId"], value })
      );
    }
    case "prepared": {
      return hasStrings({ keys: ["launchToken"], value }) && isAppSessionSnapshot(value["session"]);
    }
    case "delivered":
    case "resolved":
    case "stop-pressed": {
      return isAppSessionSnapshot(value["session"]);
    }
    case "aborted":
    case "interrupted": {
      return true;
    }
    case "sessions": {
      const sessions = value["sessions"];
      return Array.isArray(sessions) && sessions.every((session) => isAppSessionSnapshot(session));
    }
    case "messaged": {
      return typeof value["interrupted"] === "boolean" && typeof value["queued"] === "boolean";
    }
    case "closed": {
      return typeof value["forced"] === "boolean" && isAppSessionSnapshot(value["session"]);
    }
    case "usage": {
      return isAppUsageReport(value["report"]);
    }
    default: {
      return false;
    }
  }
}

/**
 * Whether a parsed line is a request envelope this protocol version accepts.
 *
 * @param value one line, parsed
 * @returns true for a well-formed request at the current version
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export function isAppHarnessRequestEnvelope(value: unknown): value is AppHarnessRequestEnvelope {
  return (
    isObject(value) &&
    value["protocolVersion"] === APP_HARNESS_PROTOCOL_VERSION &&
    typeof value["requestId"] === "string" &&
    value["requestId"].length > 0 &&
    isRequest(value["request"])
  );
}

/**
 * Whether a parsed line is a response envelope this protocol version accepts.
 *
 * @param value one line, parsed
 * @returns true for a well-formed answer or refusal at the current version
 */
export function isAppHarnessResponseEnvelope(value: unknown): value is AppHarnessResponseEnvelope {
  if (
    !isObject(value) ||
    value["protocolVersion"] !== APP_HARNESS_PROTOCOL_VERSION ||
    typeof value["requestId"] !== "string"
  ) {
    return false;
  }
  if (value["outcome"] === "answered") {
    return isResponse(value["response"]);
  }
  return (
    value["outcome"] === "refused" &&
    typeof value["code"] === "string" &&
    REFUSALS.has(value["code"]) &&
    typeof value["message"] === "string"
  );
}

/**
 * The socket the control plane listens on: one per user, under `/tmp` rather than `$SLOPWEAVER_HOME`, because a
 * darwin socket path is capped at 104 bytes and a worktree's home can be longer than that on its own.
 *
 * @param uid the user the app and the verb both run as
 * @param root the directory the per-user directory sits in; `/tmp` in production, a sandbox in a test
 * @returns the directory to create owner-only, and the socket path inside it
 */
export function appHarnessSocketPath({ uid, root }: { uid: number; root: string }): {
  directory: string;
  socket: string;
} {
  const directory = `${root}/slopweaver-${String(uid)}`;
  return { directory, socket: `${directory}/session-harness-v${String(APP_HARNESS_PROTOCOL_VERSION)}.sock` };
}
