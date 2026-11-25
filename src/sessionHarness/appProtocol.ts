/**
 * The app session harness's wire: what a `slopweaver` verb sends the desktop app's control plane over its local
 * socket, and what comes back. One request per line, one response per line, both JSON.
 *
 * Written ONCE and copied byte for byte: `desktop/src/sessionControlProtocol.ts` is the canonical copy and
 * `src/sessionHarness/appProtocol.ts` the mirror the CLI imports, because the desktop builds apart from `src/` and
 * imports none of it. `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` fails the moment the two differ.
 * So this file imports only its mirrored siblings, `wireBasics.ts` (the words and shape checks every wire shares),
 * `usageWire.ts` (what a `usage` answer carries), `pictureWire.ts` (what a `picture` answer carries) and
 * `launchSpecWire.ts` (what a launch asks for, and the login a Claude launch presents through `credentialRouteWire.ts`),
 * under the one specifier both trees resolve; every check in it is a type predicate either side wraps in its own
 * `Result`.
 *
 * The vocabulary is the session harness's (`src/sessionHarness/sessionHarness.ts`): a session, a handle, a delivery.
 * The vendor's own session id the control plane holds never crosses this wire: a `session.origin` request carries the
 * id the CALLER claims, for the control plane to compare, and no answer ever carries the one it holds.
 */
import { type AppLaunchSpec, isAppLaunchSpec } from "./launchSpecWire.js";
import { type AppSessionPicture, isAppSessionPicture } from "./pictureWire.js";
import { type AppUsageReport, isAppUsageReport } from "./usageWire.js";
import {
  APP_SESSION_STATES,
  type AppHarnessVendor,
  type AppSessionState,
  hasOptionalStrings,
  hasStrings,
  isObject,
} from "./wireBasics.js";

export {
  APP_CLAUDE_EFFORTS,
  type AppClaudeEffort,
  type AppLaunchSpec,
  type ClaudeAppLaunchSpec,
  type CodexAppLaunchSpec,
} from "./launchSpecWire.js";

/**
 * The one protocol version both sides speak; a request or response carrying any other is refused. The socket's name
 * carries it too, so a verb from one version never reaches an app speaking another and reads its answer as malformed:
 * an app built before a bump is unreachable to the verbs after it until the app is rebuilt.
 */
export const APP_HARNESS_PROTOCOL_VERSION = 3;

/**
 * The environment variable naming the control plane's own id for the session a model process runs in. The app sets it
 * on every model child it starts, over any value inherited, so a `slopweaver` verb run from inside a hosted session can
 * claim that session with `session.origin`; it is the one variable the app adds to a model child for this.
 */
export const APP_SESSION_ID_ENV = "SLOPWEAVER_APP_SESSION_ID";

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
  /**
   * Read, and change nothing: the launch the app's recovery journal recorded for a session it hosted before, answered
   * `launch-spec`, so a resume can be planned on the routed login that session opened on. Refused unless the journal
   * holds that session up and never stopped, and this run of the app is not hosting it. An app from before it refuses
   * it as `BAD_REQUEST`.
   */
  | { readonly kind: "launch.inspect"; readonly sessionId: string }
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
  | { readonly kind: "usage.read" }
  /** One hosted session's facts picture, answered `picture`. An app from before it refuses it as `BAD_REQUEST`. */
  | { readonly kind: "picture.read"; readonly handle: string }
  /**
   * Whether the caller runs inside the hosted session `appSessionId` names: answered `session-origin` only when that
   * session is reachable, is `vendor`'s, and the vendor session id the control plane holds for it is exactly
   * `vendorSessionId`; refused `ORIGIN_REFUSED` otherwise, never saying which id the control plane holds.
   */
  | {
      readonly kind: "session.origin";
      readonly appSessionId: string;
      readonly vendor: AppHarnessVendor;
      readonly vendorSessionId: string;
    };

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
  /** The launch the recovery journal recorded for `sessionId`, exactly as it was opened. */
  | { readonly kind: "launch-spec"; readonly sessionId: string; readonly spec: AppLaunchSpec }
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
  | { readonly kind: "usage"; readonly report: AppUsageReport }
  | { readonly kind: "picture"; readonly picture: AppSessionPicture }
  /** The session a `session.origin` claim named, which the claim matched. */
  | { readonly kind: "session-origin"; readonly session: AppSessionSnapshot };

/**
 * Why the control plane did not carry a request out.
 * @internal to the CLI's copy: the desktop's copy of this mirrored file is its consumer
 */
export type AppHarnessRefusalCode =
  | "BAD_REQUEST"
  | "SESSION_NOT_FOUND"
  | "DELIVERY_UNSUPPORTED"
  | "LAUNCH_FAILED"
  | "OPERATION_FAILED"
  | "ORIGIN_REFUSED";

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
  "ORIGIN_REFUSED",
]);

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
    case "launch.inspect": {
      return hasStrings({ keys: ["sessionId"], value }) && value["sessionId"] !== "";
    }
    case "launch.deliver": {
      return hasStrings({ keys: ["launchToken", "text"], value });
    }
    case "launch.abort": {
      return hasStrings({ keys: ["launchToken"], value });
    }
    case "resolve":
    case "picture.read": {
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
    case "session.origin": {
      return (
        hasStrings({ keys: ["appSessionId", "vendorSessionId"], value }) &&
        value["appSessionId"] !== "" &&
        value["vendorSessionId"] !== "" &&
        (value["vendor"] === "codex" || value["vendor"] === "claude")
      );
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
    case "launch-spec": {
      return hasStrings({ keys: ["sessionId"], value }) && value["sessionId"] !== "" && isAppLaunchSpec(value["spec"]);
    }
    case "delivered":
    case "resolved":
    case "stop-pressed":
    case "session-origin": {
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
    case "picture": {
      return isAppSessionPicture(value["picture"]);
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
