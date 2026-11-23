/*
 * The app harness over a scripted transport: what each seam operation asks the desktop app, and how each answer —
 * or refusal, or silence — comes back in the seam's own vocabulary.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import {
  appSessionHarnessOver,
  harnessErrorFromApp,
  messageOutcomeOf,
  sessionFromApp,
} from "../../../sessionHarness/appHarness.js";
import {
  APP_HARNESS_PROTOCOL_VERSION,
  type AppHarnessRequest,
  type AppHarnessResponse,
  type AppSessionSnapshot,
} from "../../../sessionHarness/appProtocol.js";
import {
  type AppTransport,
  type AppTransportFailure,
  readResponseLine,
} from "../../../sessionHarness/appSocketTransport.js";

const SNAPSHOT: AppSessionSnapshot = {
  directory: "/work/acme",
  handle: "app:0b5e",
  lastAgentText: "done",
  ledgerKey: "abc-1",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: "0b5e",
  state: "idle",
  title: "abc-1",
  vendor: "codex",
};

/** A transport that answers every request with one response, recording what it was asked. */
function scripted({ answer }: { answer: AppHarnessResponse }): { transport: AppTransport; asked: AppHarnessRequest[] } {
  const asked: AppHarnessRequest[] = [];
  const transport: AppTransport = async ({ request }) => {
    asked.push(request);
    return ok(answer);
  };
  return { asked, transport };
}

/** A transport that refuses every request with one failure. */
function failing({ failure }: { failure: AppTransportFailure }): AppTransport {
  return async () => err(failure);
}

const TARGET = { session: sessionFromApp({ snapshot: SNAPSHOT }) };

describe("sessionFromApp", () => {
  it("lists an app session under its handle and id, never pinned", () => {
    expect(TARGET.session).toEqual({
      description: "abc-1",
      directory: "/work/acme",
      groupId: "app",
      handle: "app:0b5e",
      id: "0b5e",
      latestConversationMessage: "done",
      latestSubmittedAtIso: undefined,
      latestSubmittedMessage: undefined,
      pinned: false,
      selected: false,
      title: "abc-1",
    });
  });
});

describe("messageOutcomeOf", () => {
  it("reads a held message as queued and a sent one as submitted", () => {
    expect(messageOutcomeOf({ response: { interrupted: true, kind: "messaged", queued: true } })).toEqual({
      disposition: "queued",
      interrupted: true,
    });
    expect(messageOutcomeOf({ response: { interrupted: false, kind: "messaged", queued: false } })).toEqual({
      disposition: "submitted",
      interrupted: false,
    });
  });
});

describe("harnessErrorFromApp", () => {
  it("names an app that is not serving as unavailable", () => {
    const error = harnessErrorFromApp({
      failure: { causeCode: "ENOENT", kind: "unreachable", message: "open the app" },
      handle: "app:0b5e",
      operation: "list",
    });
    expect(error.code).toBe("HARNESS_UNAVAILABLE");
  });

  it("names a refused delivery as the seam's unsupported delivery", () => {
    const error = harnessErrorFromApp({
      delivery: "turn",
      failure: { code: "DELIVERY_UNSUPPORTED", kind: "refused", message: "not between tool calls yet" },
      handle: "app:0b5e",
      operation: "message",
    });
    expect(error.code).toBe("DELIVERY_UNSUPPORTED");
    expect(error.message).toBe(
      'the app session harness cannot honour delivery "turn": not between tool calls yet; nothing was sent',
    );
  });

  it("names a session the app does not hold as not found", () => {
    const error = harnessErrorFromApp({
      failure: { code: "SESSION_NOT_FOUND", kind: "refused", message: "no app session" },
      handle: "app:0b5e",
      operation: "resolve",
    });
    expect(error.code).toBe("SESSION_NOT_FOUND");
  });
});

describe("appSessionHarnessOver", () => {
  it("lists only sessions a verb can still reach", async () => {
    const { transport } = scripted({
      answer: {
        kind: "sessions",
        sessions: [SNAPSHOT, { ...SNAPSHOT, handle: "app:dead", sessionId: "dead", state: "closed" }],
      },
    });
    const listed = unwrap(await appSessionHarnessOver({ transport }).list());
    expect(listed.map((session) => session.handle)).toEqual(["app:0b5e"]);
  });

  it("asks the app to message the session with the delivery the caller chose", async () => {
    const { asked, transport } = scripted({ answer: { interrupted: false, kind: "messaged", queued: true } });
    const sent = unwrap(
      await appSessionHarnessOver({ transport }).message({ delivery: "later", target: TARGET, text: "hi" }),
    );
    expect(asked).toEqual([{ delivery: "later", kind: "message", sessionId: "0b5e", text: "hi" }]);
    expect(sent.disposition).toBe("queued");
  });

  it("parks by closing, reporting whether the close had to force", async () => {
    const { asked, transport } = scripted({
      answer: { forced: true, kind: "closed", session: { ...SNAPSHOT, state: "closed" } },
    });
    const parked = unwrap(await appSessionHarnessOver({ transport }).park({ mode: "bounded", target: TARGET }));
    expect(asked).toEqual([{ kind: "close", sessionId: "0b5e" }]);
    expect(parked).toEqual({ forced: true, kind: "parked", session: TARGET.session });
  });

  it("carries the delivery a refused message asked for into the seam's error", async () => {
    const transport = failing({ failure: { code: "DELIVERY_UNSUPPORTED", kind: "refused", message: "running" } });
    const error = unwrapErr(
      await appSessionHarnessOver({ transport }).message({ delivery: "turn", target: TARGET, text: "hi" }),
    );
    expect(error.code).toBe("DELIVERY_UNSUPPORTED");
  });

  it("asks the app to interrupt the session's running turn", async () => {
    const { asked, transport } = scripted({ answer: { kind: "interrupted" } });
    const interrupted = await appSessionHarnessOver({ transport }).interrupt({ target: TARGET });
    expect(asked).toEqual([{ kind: "interrupt", sessionId: "0b5e" }]);
    expect(unwrap(interrupted)).toBe(undefined);
  });

  it("asks the app to press the session's card Stop, waiting past the stop's own close", async () => {
    const asked: { request: AppHarnessRequest; timeoutMs: number }[] = [];
    const transport: AppTransport = async ({ request, timeoutMs }) => {
      asked.push({ request, timeoutMs });
      return ok({ kind: "stop-pressed", session: { ...SNAPSHOT, state: "closed" } });
    };
    const pressed = await appSessionHarnessOver({ transport }).pressStop({ target: TARGET });
    expect(unwrap(pressed)).toBe(undefined);
    expect(asked).toEqual([{ request: { kind: "stop.press", sessionId: "0b5e" }, timeoutMs: 120_000 }]);
  });

  it("refuses a press the app answered with another kind, naming the operation", async () => {
    const { transport } = scripted({ answer: { kind: "closed", forced: false, session: SNAPSHOT } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).pressStop({ target: TARGET }));
    expect(error).toMatchObject({
      causeCode: "UNEXPECTED_ANSWER",
      code: "HARNESS_OPERATION_FAILED",
      message: "the desktop app answered stop.press with closed",
      operation: "press-stop",
    });
  });

  it("refuses an interrupt the app answered with another kind", async () => {
    const { transport } = scripted({ answer: { kind: "sessions", sessions: [] } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).interrupt({ target: TARGET }));
    expect(error.message).toBe("the desktop app answered interrupt with sessions");
  });

  it("resolves a handle to the session the app holds under it", async () => {
    const { asked, transport } = scripted({ answer: { kind: "resolved", session: SNAPSHOT } });
    const resolved = unwrap(await appSessionHarnessOver({ transport }).resolve({ handle: "app:0b5e" }));
    expect(asked).toEqual([{ handle: "app:0b5e", kind: "resolve" }]);
    expect(resolved).toEqual({ session: TARGET.session });
  });

  it("refuses a resolve the app answered with another kind", async () => {
    const { transport } = scripted({ answer: { kind: "aborted" } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).resolve({ handle: "app:0b5e" }));
    expect(error.message).toBe("the desktop app answered resolve with aborted");
  });

  it("closes a session, reporting whether the close had to force", async () => {
    const { asked, transport } = scripted({
      answer: { forced: false, kind: "closed", session: { ...SNAPSHOT, state: "closed" } },
    });
    const closed = unwrap(await appSessionHarnessOver({ transport }).close({ target: TARGET }));
    expect(asked).toEqual([{ kind: "close", sessionId: "0b5e" }]);
    expect(closed).toEqual({ forced: false, kind: "closed" });
  });

  it("refuses a park the app answered with another kind", async () => {
    const { transport } = scripted({ answer: { kind: "interrupted" } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).park({ mode: "bounded", target: TARGET }));
    expect(error.message).toBe("the desktop app answered close with interrupted");
  });

  it("names an app that is not serving as unavailable on any operation", async () => {
    const transport = failing({ failure: { causeCode: "ENOENT", kind: "unreachable", message: "open the app" } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).resolve({ handle: "app:0b5e" }));
    expect(error.code).toBe("HARNESS_UNAVAILABLE");
  });

  it("refuses an answer of the wrong kind rather than guessing", async () => {
    const { transport } = scripted({ answer: { kind: "interrupted" } });
    const error = unwrapErr(await appSessionHarnessOver({ transport }).list());
    expect(error.message).toBe("the desktop app answered list with interrupted");
  });
});

describe("readResponseLine", () => {
  const answered = JSON.stringify({
    outcome: "answered",
    protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
    requestId: "r1",
    response: { kind: "interrupted" },
  });

  it("reads the answer to its own request", () => {
    expect(unwrap(readResponseLine({ line: answered, requestId: "r1" }))).toEqual({ kind: "interrupted" });
  });

  it("refuses an answer to another request", () => {
    expect(unwrapErr(readResponseLine({ line: answered, requestId: "r2" })).message).toBe(
      "the desktop app answered a different request",
    );
  });

  it("carries a refusal's code", () => {
    const line = JSON.stringify({
      code: "SESSION_NOT_FOUND",
      message: "no app session",
      outcome: "refused",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r1",
    });
    expect(unwrapErr(readResponseLine({ line, requestId: "r1" }))).toEqual({
      code: "SESSION_NOT_FOUND",
      kind: "refused",
      message: "no app session",
    });
  });

  it("refuses a line that is not JSON", () => {
    expect(unwrapErr(readResponseLine({ line: "{", requestId: "r1" })).message).toBe(
      "the desktop app answered a line that is not JSON",
    );
  });
});
