/**
 * Whether the process running a `slopweaver` verb sits inside a session the desktop app hosts, and the app's word that
 * it does. Pure half ({@link appSessionClaim}) reads the environment; the checked half ({@link verifyAppSessionOrigin})
 * asks the app's control plane once over its transport.
 *
 * The app sets `SLOPWEAVER_APP_SESSION_ID` (`APP_SESSION_ID_ENV`, `./appProtocol.ts`) on every model child it starts,
 * over any value inherited, and the vendor host sets its own session id (`CLAUDE_CODE_SESSION_ID` or
 * `CODEX_THREAD_ID`, `../supervisor/session.ts`). A claim pairs the two; the app answers it only when the session the
 * app id names is reachable, is that vendor's, and runs exactly that vendor session (`desktop/src/sessionOrigin.ts`).
 *
 * Residue, stated: this is a same-user local control plane. A process that deliberately rewrites BOTH its app session
 * id and its vendor session id to another session's can impersonate that session once it has learned both, because
 * the owner-only socket is not a per-session authentication boundary. What the check does stop is an ordinary sibling
 * session substituting only another session's app id: its own vendor session id, which its host set, will not match.
 * Closing the residue would take a per-session capability or a peer-credential channel.
 */
import { err, ok, type Result } from "#lib/result.js";
import { isBareSessionId } from "../sessions/liveSessionStore.js";
import type { SupervisorSessionDetection, VisibleSupervisorSession } from "../supervisor/session.js";
import { sessionFromApp } from "./appHarness.js";
import { APP_SESSION_HANDLE_PREFIX, APP_SESSION_ID_ENV, type AppSessionSnapshot } from "./appProtocol.js";
import type { AppTransport, AppTransportFailure } from "./appSocketTransport.js";
import type { HarnessTarget } from "./sessionHarness.js";
import type { AppHarnessVendor } from "./wireBasics.js";

/** The variable cmux sets inside each of its workspaces; present beside an app id, the host is not one thing. */
const CMUX_WORKSPACE_ID_ENV = "CMUX_WORKSPACE_ID";

/** How long the app has to answer an origin claim: one registry read, nothing launched. */
const ORIGIN_TIMEOUT_MS = 10_000;

/** The app session id is set but names nothing, or no vendor session was detected to prove it by. */
export interface AppSessionIdMissingError {
  readonly code: "APP_SESSION_ID_MISSING";
  readonly message: string;
}

/** The app session id is not a bare control-plane id. */
export interface AppSessionIdMalformedError {
  readonly code: "APP_SESSION_ID_MALFORMED";
  readonly message: string;
}

/** The process carries an app session id beside another host's identity, so which session it is cannot be said. */
export interface AppSessionHostAmbiguousError {
  readonly code: "APP_SESSION_HOST_AMBIGUOUS";
  readonly message: string;
}

/** The app answered, and the claim did not match the session it holds. */
export interface AppSessionOriginRefusedError {
  readonly code: "APP_SESSION_ORIGIN_REFUSED";
  readonly message: string;
}

/** The app could not be asked, or did not answer in a shape this checkout reads. */
export interface AppSessionOriginUnavailableError {
  readonly code: "APP_SESSION_ORIGIN_UNAVAILABLE";
  readonly message: string;
}

/** Why a process's claim to be an app-hosted session was not established. */
export type AppSessionOriginError =
  | AppSessionIdMissingError
  | AppSessionIdMalformedError
  | AppSessionHostAmbiguousError
  | AppSessionOriginRefusedError
  | AppSessionOriginUnavailableError;

/** Each {@link AppSessionOriginError}, built with its message. */
export const AppSessionOriginErrors = {
  blankId: (): AppSessionIdMissingError => ({
    code: "APP_SESSION_ID_MISSING",
    message: `${APP_SESSION_ID_ENV} is set but blank, so it names no app session`,
  }),
  noVendorSession: ({ appSessionId }: { appSessionId: string }): AppSessionIdMissingError => ({
    code: "APP_SESSION_ID_MISSING",
    message: `${APP_SESSION_ID_ENV} names app session ${appSessionId}, but no Claude Code or Codex session id is set to prove it by`,
  }),
  malformedId: ({ appSessionId }: { appSessionId: string }): AppSessionIdMalformedError => ({
    code: "APP_SESSION_ID_MALFORMED",
    message: `${APP_SESSION_ID_ENV} is ${JSON.stringify(appSessionId)}, which is not a bare app session id`,
  }),
  cmuxAlsoSet: ({ appSessionId }: { appSessionId: string }): AppSessionHostAmbiguousError => ({
    code: "APP_SESSION_HOST_AMBIGUOUS",
    message: `${APP_SESSION_ID_ENV} names app session ${appSessionId} while ${CMUX_WORKSPACE_ID_ENV} names a cmux workspace, so this process is not one session`,
  }),
  bothVendors: ({ appSessionId }: { appSessionId: string }): AppSessionHostAmbiguousError => ({
    code: "APP_SESSION_HOST_AMBIGUOUS",
    message: `${APP_SESSION_ID_ENV} names app session ${appSessionId} while both a Claude Code and a Codex session id are set, so which vendor session it is cannot be said`,
  }),
  refused: ({ message }: { message: string }): AppSessionOriginRefusedError => ({
    code: "APP_SESSION_ORIGIN_REFUSED",
    message,
  }),
  unavailable: ({ message }: { message: string }): AppSessionOriginUnavailableError => ({
    code: "APP_SESSION_ORIGIN_UNAVAILABLE",
    message,
  }),
} as const;

/** A process's claim to run inside one app-hosted session: the app's id for it, and the vendor session it runs. */
export interface AppSessionClaim {
  readonly appSessionId: string;
  readonly session: VisibleSupervisorSession;
}

/**
 * Read whether this process claims an app-hosted session. Nothing here falls back: an app id beside a missing or
 * doubled vendor identity, or beside a cmux workspace, is an error, never a cmux session.
 *
 * @param env the process environment
 * @param detection the visible session `detectSupervisorSession` found in the same environment
 * @returns the claim, `undefined` when no app session id is set at all, or why the claim cannot stand
 */
export function appSessionClaim({
  env,
  detection,
}: {
  env: Readonly<Record<string, string | undefined>>;
  detection: SupervisorSessionDetection;
}): Result<AppSessionClaim | undefined, AppSessionOriginError> {
  const raw = env[APP_SESSION_ID_ENV];
  if (raw === undefined) {
    return ok(undefined);
  }
  const appSessionId = raw.trim();
  if (appSessionId === "") {
    return err(AppSessionOriginErrors.blankId());
  }
  if (!isBareSessionId({ sessionId: appSessionId })) {
    return err(AppSessionOriginErrors.malformedId({ appSessionId }));
  }
  const cmuxWorkspace = env[CMUX_WORKSPACE_ID_ENV];
  if (cmuxWorkspace !== undefined && cmuxWorkspace.trim() !== "") {
    return err(AppSessionOriginErrors.cmuxAlsoSet({ appSessionId }));
  }
  switch (detection.kind) {
    case "active": {
      return ok({ appSessionId, session: detection.session });
    }
    case "missing": {
      return err(AppSessionOriginErrors.noVendorSession({ appSessionId }));
    }
    case "ambiguous": {
      return err(AppSessionOriginErrors.bothVendors({ appSessionId }));
    }
    default: {
      const never: never = detection;
      return never;
    }
  }
}

/**
 * The app's vendor name for a visible session's host.
 *
 * @param session the claimed vendor session
 * @returns `claude` for a Claude Code session, `codex` for a Codex one
 */
function appVendorOf({ session }: { session: VisibleSupervisorSession }): AppHarnessVendor {
  return APP_VENDOR_OF_HOST[session.host];
}

/** The app's vendor name for each visible host, a table rather than a branch so neither name is a returned string. */
const APP_VENDOR_OF_HOST = {
  "claude-code": "claude",
  codex: "codex",
} as const satisfies Record<VisibleSupervisorSession["host"], AppHarnessVendor>;

/**
 * A transport failure in this check's vocabulary: the app's own origin refusal is a refusal, anything else is the
 * app not being asked or not answering in a shape this checkout reads.
 *
 * @param failure what the transport answered
 * @returns the typed error, carrying the app's or the transport's line
 */
function originErrorOf({ failure }: { failure: AppTransportFailure }): AppSessionOriginError {
  if (failure.kind === "refused" && failure.code === "ORIGIN_REFUSED") {
    return AppSessionOriginErrors.refused({ message: failure.message });
  }
  return AppSessionOriginErrors.unavailable({ message: failure.message });
}

/**
 * Whether the app's answer is about the very session the claim named, as the claim named it.
 *
 * @param snapshot the session the app answered with
 * @param claim what was claimed
 * @returns true only when the id, the handle and the vendor all echo the claim
 */
function echoesClaim({ snapshot, claim }: { snapshot: AppSessionSnapshot; claim: AppSessionClaim }): boolean {
  return (
    snapshot.sessionId === claim.appSessionId &&
    snapshot.handle === `${APP_SESSION_HANDLE_PREFIX}${claim.appSessionId}` &&
    snapshot.vendor === appVendorOf({ session: claim.session })
  );
}

/**
 * Ask the app whether the claimed session is this process's own, once. See the module's residue: a match shows the
 * caller holds both the app id and that session's vendor id, not that no same-user process rewrote both.
 *
 * @param claim what {@link appSessionClaim} read
 * @param transport the request channel to the app's control plane: the socket in production, a fake in a test
 * @returns the session as a harness target, or why the app would not vouch for it
 */
export async function verifyAppSessionOrigin({
  claim,
  transport,
}: {
  claim: AppSessionClaim;
  transport: AppTransport;
}): Promise<Result<HarnessTarget, AppSessionOriginError>> {
  const answered = await transport({
    request: {
      appSessionId: claim.appSessionId,
      kind: "session.origin",
      vendor: appVendorOf({ session: claim.session }),
      vendorSessionId: claim.session.id,
    },
    timeoutMs: ORIGIN_TIMEOUT_MS,
  });
  if (answered.isErr()) {
    return err(originErrorOf({ failure: answered.error }));
  }
  const response = answered.value;
  if (response.kind !== "session-origin") {
    return err(
      AppSessionOriginErrors.unavailable({ message: `the desktop app answered session.origin with ${response.kind}` }),
    );
  }
  if (!echoesClaim({ claim, snapshot: response.session })) {
    return err(
      AppSessionOriginErrors.refused({
        message: `the desktop app vouched for ${response.session.handle}, not the app session ${claim.appSessionId} this process claims`,
      }),
    );
  }
  return ok({ session: sessionFromApp({ snapshot: response.session }) });
}
