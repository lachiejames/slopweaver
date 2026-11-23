/**
 * The control plane: carries out each request a `slopweaver` verb sends over the socket (`sessionSocketServer.ts`)
 * against the sessions this app hosts (`sessionHosting.ts`). A launch, fresh or resumed, is `sessionLaunch.ts`'s,
 * which puts the card on screen with its Stop control BEFORE the worker that runs a model is started.
 */
import {
  APP_HARNESS_PROTOCOL_VERSION,
  type AppHarnessRequest,
  type AppHarnessRequestEnvelope,
  type AppHarnessResponse,
  type AppHarnessResponseEnvelope,
} from "./sessionControlProtocol";
import { applySessionEvent, hostedSessions, SessionRefusal, snapshotOf } from "./sessionHosting";
import {
  instanceId,
  prepareSession,
  resumeSessionOnce,
  type SessionControlHost,
  sessionForToken,
} from "./sessionLaunch";
import { entryForHandle } from "./sessionRegistryShape";
import { stoppedWhole } from "./sessionStopRequests";
import { usageReportOf } from "./sessionUsage";
import { pressSessionStop } from "./sessionWindow";

/** How long a press of a card's Stop waits for the card's own handler to see the click. */
const PRESS_SEEN_MS = 5000;

const startedAtIso = new Date().toISOString();

function deliver({
  sessionId,
  text,
  delivery,
}: {
  sessionId: string;
  text: string;
  delivery: "now" | "turn" | "later";
}): { interrupted: boolean; queued: boolean } {
  const step = applySessionEvent({
    event: { atIso: new Date().toISOString(), delivery, kind: "message", sessionId, text },
  });
  if (step.refusal !== undefined) {
    throw new SessionRefusal(step.refusal.code, step.refusal.message);
  }
  return { interrupted: step.interrupted === true, queued: step.queued === true };
}

async function answer({
  request,
  host,
}: {
  request: AppHarnessRequest;
  host: SessionControlHost;
}): Promise<AppHarnessResponse> {
  switch (request.kind) {
    case "ping": {
      return { appPid: process.pid, codexPath: host.paths.codex.codexPath, instanceId, kind: "pong", startedAtIso };
    }
    case "launch.prepare": {
      return prepareSession({ host, spec: request.spec });
    }
    case "launch.resume": {
      return resumeSessionOnce({ host, sessionId: request.sessionId, spec: request.spec });
    }
    case "launch.deliver": {
      const sessionId = sessionForToken({ launchToken: request.launchToken });
      applySessionEvent({ event: { kind: "launch-settled", sessionId } });
      deliver({ delivery: "later", sessionId, text: request.text });
      return { kind: "delivered", session: snapshotOf({ sessionId }) };
    }
    case "launch.abort": {
      const sessionId = sessionForToken({ launchToken: request.launchToken });
      applySessionEvent({ event: { kind: "launch-settled", sessionId } });
      await stoppedWhole({ sessionId });
      return { kind: "aborted" };
    }
    case "list": {
      return { kind: "sessions", sessions: [...hostedSessions().values()].map((entry) => entry.snapshot) };
    }
    case "resolve": {
      const entry = entryForHandle({ handle: request.handle, registry: hostedSessions() });
      if (entry === undefined) {
        throw new SessionRefusal("SESSION_NOT_FOUND", `no app session ${request.handle}`);
      }
      return { kind: "resolved", session: entry.snapshot };
    }
    case "message": {
      return { ...deliver(request), kind: "messaged" };
    }
    case "interrupt": {
      snapshotOf({ sessionId: request.sessionId });
      applySessionEvent({ event: { kind: "interrupt", sessionId: request.sessionId } });
      return { kind: "interrupted" };
    }
    case "close": {
      snapshotOf({ sessionId: request.sessionId });
      const ended = await stoppedWhole({ sessionId: request.sessionId });
      return { forced: ended.killed, kind: "closed", session: snapshotOf({ sessionId: request.sessionId }) };
    }
    case "stop.press": {
      snapshotOf({ sessionId: request.sessionId });
      const pressed = await pressSessionStop({ sessionId: request.sessionId, timeoutMs: PRESS_SEEN_MS });
      if (pressed.isErr()) {
        throw new SessionRefusal("OPERATION_FAILED", pressed.error);
      }
      await pressed.value;
      return { kind: "stop-pressed", session: snapshotOf({ sessionId: request.sessionId }) };
    }
    case "usage.read": {
      return {
        kind: "usage",
        report: usageReportOf({ atIso: new Date().toISOString(), entries: hostedSessions().values() }),
      };
    }
    default: {
      const never: never = request;
      return never;
    }
  }
}

/**
 * Carry out one request.
 *
 * @param envelope the request as it arrived
 * @param host what the control plane reaches in the rest of the app
 * @returns the answer, or the refusal with its code
 */
export async function handleSessionRequest({
  envelope,
  host,
}: {
  envelope: AppHarnessRequestEnvelope;
  host: SessionControlHost;
}): Promise<AppHarnessResponseEnvelope> {
  const base = { protocolVersion: APP_HARNESS_PROTOCOL_VERSION, requestId: envelope.requestId };
  try {
    return { ...base, outcome: "answered", response: await answer({ host, request: envelope.request }) };
  } catch (error: unknown) {
    if (error instanceof SessionRefusal) {
      return { ...base, code: error.code, message: error.message, outcome: "refused" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ...base, code: "OPERATION_FAILED", message, outcome: "refused" };
  }
}
