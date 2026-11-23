/**
 * The app harness: the session-harness seam (`./sessionHarness.ts`) over the desktop app's control plane — stage 2's
 * second implementation beside cmux (`./cmuxHarness.ts`), selected by `--harness app` and never by a fallback.
 *
 * A session here is one the app hosts: its card is on the owner's screen with a Stop control before its worker
 * starts a model (`desktop/src/visibleSessionLease.ts`). The vendor's own session id never crosses into this
 * process; the handle is `app:<id>`. Every failure maps into {@link SessionHarnessError} at one boundary,
 * {@link harnessErrorFromApp}, keeping the app's message so a verb's stderr says what the app said.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { AppHarnessRequest, AppHarnessResponse, AppSessionSnapshot } from "./appProtocol.js";
import {
  APP_SOCKET_ROOT,
  type AppTransport,
  type AppTransportFailure,
  socketAppTransport,
} from "./appSocketTransport.js";
import { type SessionHarnessError, SessionHarnessErrors, type SessionHarnessOperation } from "./errors.js";
import type {
  HarnessMessageOutcome,
  HarnessSession,
  HarnessTarget,
  SessionDelivery,
  SessionHarness,
} from "./sessionHarness.js";

/** The name the app harness records on a ledger row and names in a refusal. */
const APP_HARNESS_NAME = "app";

/** How long an ordinary request waits on the app — a close ends a process group, bounded well inside this. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * How long a press of a card's Stop waits on the app. Its worst case inside the app is 100s: the 5s the card has to
 * see the click (`desktop/src/sessionControl.ts`'s `PRESS_SEEN_MS`), the 75s close verb race
 * (`desktop/src/sessionStopRequests.ts`'s `STOP_VERB_MS`), up to 10s for the worker to exit
 * (`desktop/src/sessionHosting.ts`) and up to 10s of process-group SIGTERM then SIGKILL
 * (`desktop/src/sessionProcessGroup.ts`). This leaves 20s over that for the socket and the event loop.
 */
const PRESS_STOP_TIMEOUT_MS = 120_000;

/** The group every app session is listed under: the app has no windows-of-sessions the way cmux does. */
const APP_GROUP_ID = "app";

/**
 * A failure from the app transport in the seam's vocabulary.
 *
 * @param failure what the transport answered
 * @param operation the seam operation it came from
 * @param handle the handle the caller asked about, for a not-found
 * @param delivery the delivery a message asked for, so a refusal of it is the seam's own unsupported-delivery error
 * @returns the typed seam error
 */
export function harnessErrorFromApp({
  failure,
  operation,
  handle,
  delivery,
}: {
  failure: AppTransportFailure;
  operation: SessionHarnessOperation;
  handle: string;
  delivery?: SessionDelivery;
}): SessionHarnessError {
  if (failure.kind === "unreachable") {
    return SessionHarnessErrors.unavailable({ causeCode: failure.causeCode, message: failure.message, operation });
  }
  if (failure.kind === "refused" && failure.code === "SESSION_NOT_FOUND") {
    return SessionHarnessErrors.sessionNotFound({ handle, message: failure.message });
  }
  if (failure.kind === "refused" && failure.code === "DELIVERY_UNSUPPORTED" && delivery !== undefined) {
    return SessionHarnessErrors.deliveryUnsupported({
      delivery,
      implementation: APP_HARNESS_NAME,
      why: failure.message,
    });
  }
  const causeCode = failure.kind === "refused" ? failure.code : "MALFORMED";
  return SessionHarnessErrors.operationFailed({ causeCode, message: failure.message, operation });
}

/**
 * One app session as the seam reports it.
 *
 * @param snapshot the control plane's snapshot
 * @returns the harness session
 */
export function sessionFromApp({ snapshot }: { snapshot: AppSessionSnapshot }): HarnessSession {
  return {
    description: snapshot.ledgerKey,
    directory: snapshot.directory,
    groupId: APP_GROUP_ID,
    handle: snapshot.handle,
    id: snapshot.sessionId,
    latestConversationMessage: snapshot.lastAgentText,
    latestSubmittedAtIso: snapshot.lastSubmittedAtIso,
    latestSubmittedMessage: snapshot.lastSubmittedText,
    pinned: false,
    selected: false,
    title: snapshot.title,
  };
}

/**
 * What a message did, from the app's answer: held for the running turn's end, or sent into an idle session.
 *
 * @param response the app's `messaged` answer
 * @returns the seam's outcome
 */
export function messageOutcomeOf({
  response,
}: {
  response: Extract<AppHarnessResponse, { kind: "messaged" }>;
}): HarnessMessageOutcome {
  let disposition: HarnessMessageOutcome["disposition"] = "submitted";
  if (response.queued) {
    disposition = "queued";
  }
  return { disposition, interrupted: response.interrupted };
}

/** One request to the app, and how to read the one answer kind it expects. */
interface AppAsk<T> {
  readonly request: AppHarnessRequest;
  readonly operation: SessionHarnessOperation;
  /** The handle the caller asked about, which a not-found names. */
  readonly handle: string;
  /** The answer's payload, or `undefined` when the app answered with another kind. */
  readonly pick: (response: AppHarnessResponse) => T | undefined;
  /** How long the app has to answer. */
  readonly timeoutMs: number;
}

/** Ask the app once, mapping a transport failure or an answer of the wrong kind into the seam's typed error. */
async function sendToApp<T>({
  transport,
  request,
  operation,
  handle,
  pick,
  timeoutMs,
}: AppAsk<T> & { transport: AppTransport }): Promise<Result<T, SessionHarnessError>> {
  const answered = await transport({ request, timeoutMs });
  if (answered.isErr()) {
    const delivery = request.kind === "message" ? { delivery: request.delivery } : {};
    return err(harnessErrorFromApp({ failure: answered.error, handle, operation, ...delivery }));
  }
  const picked = pick(answered.value);
  if (picked === undefined) {
    return err(
      SessionHarnessErrors.operationFailed({
        causeCode: "UNEXPECTED_ANSWER",
        message: `the desktop app answered ${request.kind} with ${answered.value.kind}`,
        operation,
      }),
    );
  }
  return ok(picked);
}

/** The states a list keeps: a closed or failed session is history, not something a verb can reach. */
const REACHABLE: ReadonlySet<AppSessionSnapshot["state"]> = new Set(["starting", "idle", "running"]);

/** Ask the app to press a session's card Stop, answered once the stop that click started has settled. */
async function pressStopOver({
  target,
  transport,
}: {
  target: HarnessTarget;
  transport: AppTransport;
}): Promise<Result<void, SessionHarnessError>> {
  const pressed = await sendToApp({
    handle: target.session.handle,
    operation: "press-stop",
    pick: (response) => (response.kind === "stop-pressed" ? true : undefined),
    request: { kind: "stop.press", sessionId: target.session.id },
    timeoutMs: PRESS_STOP_TIMEOUT_MS,
    transport,
  });
  return pressed.map(() => undefined);
}

/**
 * The app harness over a transport.
 *
 * @param transport the request channel — the socket in production, a fake in a test
 * @returns the harness
 */
export function appSessionHarnessOver({ transport }: { transport: AppTransport }): SessionHarness {
  const send = async <T>(asked: Omit<AppAsk<T>, "timeoutMs">): Promise<Result<T, SessionHarnessError>> =>
    sendToApp({ ...asked, timeoutMs: REQUEST_TIMEOUT_MS, transport });
  const close: SessionHarness["close"] = async ({ target }) =>
    send({
      handle: target.session.handle,
      operation: "close",
      pick: (response) =>
        response.kind === "closed" ? { forced: response.forced, kind: "closed" as const } : undefined,
      request: { kind: "close", sessionId: target.session.id },
    });
  return {
    close,
    interrupt: async ({ target }) =>
      send({
        handle: target.session.handle,
        operation: "interrupt",
        pick: (response) => (response.kind === "interrupted" ? true : undefined),
        request: { kind: "interrupt", sessionId: target.session.id },
      }).then((sent) => sent.map(() => undefined)),
    list: async () =>
      send({
        handle: "",
        operation: "list",
        pick: (response) =>
          response.kind === "sessions"
            ? response.sessions
                .filter((snapshot) => REACHABLE.has(snapshot.state))
                .map((snapshot) => sessionFromApp({ snapshot }))
            : undefined,
        request: { kind: "list" },
      }),
    message: async ({ target, text, delivery }) =>
      send({
        handle: target.session.handle,
        operation: "message",
        pick: (response) => (response.kind === "messaged" ? messageOutcomeOf({ response }) : undefined),
        request: { delivery, kind: "message", sessionId: target.session.id, text },
      }),
    pressStop: async ({ target }) => pressStopOver({ target, transport }),
    // A park closes the session at rest; the app never holds a close, so the mode has nothing to settle.
    park: async ({ target }) =>
      (await close({ target })).map((closed) => ({
        forced: closed.kind === "closed" && closed.forced,
        kind: "parked" as const,
        session: target.session,
      })),
    resolve: async ({ handle }) =>
      send({
        handle,
        operation: "resolve",
        pick: (response) =>
          response.kind === "resolved" ? { session: sessionFromApp({ snapshot: response.session }) } : undefined,
        request: { handle, kind: "resolve" },
      }),
  };
}

/**
 * Run one body against the app harness over the installed app's socket.
 *
 * @param body what to do with the harness
 * @returns whatever `body` returned
 */
export async function withAppSessionHarness<T>({
  body,
}: {
  body: (options: { harness: SessionHarness }) => Promise<T>;
}): Promise<T> {
  return body({ harness: appSessionHarnessOver({ transport: socketAppTransport({ root: APP_SOCKET_ROOT }) }) });
}
