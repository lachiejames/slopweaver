/**
 * The CLI's copy of the app harness wire: every request and response kind it accepts, and the shapes it refuses.
 * `desktop/__tests__/unit/sessionControlProtocolMirror.test.ts` holds the two copies to one file byte for byte; this
 * exercises the copy the CLI actually runs.
 */
import { describe, expect, it } from "vitest";

import {
  APP_HARNESS_PROTOCOL_VERSION,
  appHarnessSocketPath,
  isAppHarnessRequestEnvelope,
  isAppHarnessResponseEnvelope,
  isAppSessionSnapshot,
} from "../../../sessionHarness/appProtocol.js";

const SNAPSHOT = {
  directory: "/work/acme",
  handle: "app:0b5e",
  ledgerKey: "abc-1",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: "0b5e",
  state: "idle",
  title: "abc-1",
  vendor: "codex",
};

/** A Claude launch on a plan's own store, by path only. */
const CLAUDE_SPEC = {
  claudeMdExcludes: ["/work/acme/AGENTS.md"],
  credential: { kind: "store", secureStorageDir: "/h/claude-two" },
  directory: "/work/acme",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "claude",
};

const SPEC = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
};

function requestOf({ request }: { request: unknown }): unknown {
  return { protocolVersion: APP_HARNESS_PROTOCOL_VERSION, request, requestId: "r1" };
}

function answerOf({ response }: { response: unknown }): unknown {
  return { outcome: "answered", protocolVersion: APP_HARNESS_PROTOCOL_VERSION, requestId: "r1", response };
}

describe("isAppHarnessRequestEnvelope", () => {
  it("accepts every request kind in its declared shape", () => {
    const requests = [
      { kind: "ping" },
      { kind: "list" },
      { kind: "launch.prepare", spec: SPEC },
      { kind: "launch.resume", sessionId: "0b5e", spec: SPEC },
      { kind: "launch.prepare", spec: { ...SPEC, ledgerHome: "/home/acme", model: "gpt-5.6-sol" } },
      { kind: "launch.prepare", spec: CLAUDE_SPEC },
      {
        kind: "launch.prepare",
        spec: {
          ...CLAUDE_SPEC,
          credential: { kind: "setup-token", secureStorageDir: "/h/claude-two", tokenFilePath: "/h/two.token" },
          effort: "high",
          model: "opus",
          pluginDir: "/work/acme",
        },
      },
      { kind: "launch.deliver", launchToken: "t", text: "hello" },
      { kind: "launch.abort", launchToken: "t" },
      { handle: "app:0b5e", kind: "resolve" },
      { delivery: "later", kind: "message", sessionId: "0b5e", text: "hello" },
      { kind: "interrupt", sessionId: "0b5e" },
      { kind: "close", sessionId: "0b5e" },
      { kind: "stop.press", sessionId: "0b5e" },
    ];
    expect(requests.map((request) => isAppHarnessRequestEnvelope(requestOf({ request })))).toEqual(
      requests.map(() => true),
    );
  });

  it("refuses a request missing a field its kind needs, or of no known kind", () => {
    const requests = [
      "ping",
      { kind: "launch.prepare", spec: { ...SPEC, model: 5 } },
      { kind: "launch.prepare", spec: { ...SPEC, judgedInstanceId: undefined } },
      { kind: "launch.prepare", spec: "codex" },
      { kind: "launch.prepare", spec: { ...SPEC, vendor: "gemini" } },
      { kind: "launch.prepare", spec: { ...CLAUDE_SPEC, codexHome: "/h/codex-one" } },
      { kind: "launch.prepare", spec: { ...SPEC, claudeMdExcludes: [] } },
      { kind: "launch.prepare", spec: { ...CLAUDE_SPEC, credential: { kind: "setup-token", secureStorageDir: "/h" } } },
      { kind: "launch.prepare", spec: { ...CLAUDE_SPEC, credential: { kind: "store", token: "x" } } },
      { kind: "launch.prepare", spec: { ...CLAUDE_SPEC, effort: "ludicrous" } },
      { kind: "launch.prepare", spec: { ...CLAUDE_SPEC, claudeMdExcludes: [7] } },
      { kind: "launch.resume", spec: SPEC },
      { kind: "launch.resume", sessionId: "", spec: SPEC },
      { kind: "launch.resume", sessionId: "0b5e", spec: "codex" },
      { kind: "launch.deliver", launchToken: "t" },
      { kind: "launch.abort" },
      { kind: "resolve" },
      { delivery: 1, kind: "message", sessionId: "0b5e", text: "hello" },
      { kind: "close" },
      { kind: "stop.press" },
      { kind: "stop.press", sessionId: 7 },
      { kind: "reboot" },
    ];
    expect(requests.map((request) => isAppHarnessRequestEnvelope(requestOf({ request })))).toEqual(
      requests.map(() => false),
    );
  });

  it("refuses an envelope that is not an object", () => {
    expect(isAppHarnessRequestEnvelope([requestOf({ request: { kind: "ping" } })])).toBe(false);
  });
});

describe("isAppHarnessResponseEnvelope", () => {
  it("accepts every response kind in its declared shape", () => {
    const responses = [
      { appPid: 42, kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { appPid: 42, codexPath: "/app/codex", kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { appPid: 42, codexPath: "/a/codex", instanceId: "i", kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { kind: "prepared", launchToken: "t", session: SNAPSHOT },
      { kind: "delivered", session: SNAPSHOT },
      { kind: "resolved", session: { ...SNAPSHOT, lastAgentText: "done", state: "running" } },
      { kind: "aborted" },
      { kind: "interrupted" },
      { kind: "sessions", sessions: [] },
      { interrupted: false, kind: "messaged", queued: true },
      { forced: false, kind: "closed", session: { ...SNAPSHOT, state: "closed" } },
      { kind: "stop-pressed", session: { ...SNAPSHOT, state: "closed" } },
    ];
    expect(responses.map((response) => isAppHarnessResponseEnvelope(answerOf({ response })))).toEqual(
      responses.map(() => true),
    );
  });

  it("refuses a response missing a field its kind needs, or of no known kind", () => {
    const responses = [
      [],
      { appPid: "42", kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { appPid: 42, codexPath: 7, kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { appPid: 42, instanceId: 7, kind: "pong", startedAtIso: "2026-11-09T01:00:00.000Z" },
      { kind: "prepared", session: SNAPSHOT },
      { kind: "delivered", session: { ...SNAPSHOT, handle: 7 } },
      { kind: "sessions", sessions: "none" },
      { interrupted: "no", kind: "messaged", queued: true },
      { forced: "yes", kind: "closed", session: SNAPSHOT },
      { kind: "stop-pressed" },
      { kind: "stop-pressed", session: { ...SNAPSHOT, handle: 7 } },
      { kind: "teapot" },
    ];
    expect(responses.map((response) => isAppHarnessResponseEnvelope(answerOf({ response })))).toEqual(
      responses.map(() => false),
    );
  });

  it("refuses a refusal with no message, and any envelope with no request id or another version", () => {
    const refused = {
      code: "LAUNCH_FAILED",
      message: "no",
      outcome: "refused",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r1",
    };
    expect(isAppHarnessResponseEnvelope(refused)).toBe(true);
    const { message: _dropped, ...silent } = refused;
    expect(isAppHarnessResponseEnvelope(silent)).toBe(false);
    expect(isAppHarnessResponseEnvelope({ ...refused, requestId: 1 })).toBe(false);
    expect(isAppHarnessResponseEnvelope({ ...refused, protocolVersion: 1 })).toBe(false);
    expect(isAppHarnessResponseEnvelope(null)).toBe(false);
  });
});

describe("the launch inspection", () => {
  it("accepts a request naming one session, and refuses one naming none", () => {
    const requests = [
      { kind: "launch.inspect", sessionId: "0b5e" },
      { kind: "launch.inspect" },
      { kind: "launch.inspect", sessionId: "" },
      { kind: "launch.inspect", sessionId: 7 },
    ];
    expect(requests.map((request) => isAppHarnessRequestEnvelope(requestOf({ request })))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it("accepts the recorded spec of either vendor, and refuses an answer with no session or no readable spec", () => {
    const responses = [
      { kind: "launch-spec", sessionId: "0b5e", spec: SPEC },
      { kind: "launch-spec", sessionId: "0b5e", spec: CLAUDE_SPEC },
      { kind: "launch-spec", spec: SPEC },
      { kind: "launch-spec", sessionId: "", spec: SPEC },
      { kind: "launch-spec", sessionId: "0b5e" },
      { kind: "launch-spec", sessionId: "0b5e", spec: { ...SPEC, codexHome: 3 } },
    ];
    expect(responses.map((response) => isAppHarnessResponseEnvelope(answerOf({ response })))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("the usage read", () => {
  const CODEX_TOKENS = {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 800,
    outputTokens: 50,
    reasoningOutputTokens: 30,
    totalTokens: 1050,
    uncachedInputTokens: 200,
    vendor: "codex",
  };
  const USAGE = {
    chargedModels: ["gpt-5.6-sol"],
    ledgerKey: "abc-1",
    missingTurns: 0,
    modelMismatch: false,
    partialTurns: 0,
    planPath: "/h/codex-one",
    rate: { kind: "reported", totalTokensPerHour: 12.5 },
    reportedTurns: 1,
    sessionId: "0b5e",
    state: "idle",
    title: "abc-1",
    turnOpen: false,
    vendor: "codex",
  };
  const FULL = {
    ...USAGE,
    askedModel: "gpt-5.6-sol",
    context: { atIso: "2026-11-09T01:00:00.000Z", sizeTokens: 272000, usedTokens: 41000 },
    lastTurn: {
      atIso: "2026-11-09T01:00:00.000Z",
      usage: { chargedModels: ["gpt-5.6-sol"], kind: "reported", scope: "comprehensive", tokens: CODEX_TOKENS },
    },
    readySinceIso: "2026-11-09T00:00:00.000Z",
    resolvedModel: "gpt-5.6-sol",
    total: CODEX_TOKENS,
  };
  function usageAnswer({ sessions }: { sessions: readonly unknown[] }): unknown {
    return answerOf({ response: { kind: "usage", report: { atIso: "2026-11-09T01:00:00.000Z", sessions } } });
  }

  it("accepts the request and a report of every rate and turn kind", () => {
    expect(isAppHarnessRequestEnvelope(requestOf({ request: { kind: "usage.read" } }))).toBe(true);
    const sessions = [
      USAGE,
      FULL,
      { ...USAGE, rate: { kind: "not-ready" } },
      { ...USAGE, lastTurn: { atIso: "t", usage: { kind: "not-reported" } } },
      { ...USAGE, lastTurn: { atIso: "t", usage: { kind: "unreadable", reason: "odd" } } },
    ];
    expect(isAppHarnessResponseEnvelope(usageAnswer({ sessions }))).toBe(true);
  });

  it("refuses a report whose counts, tokens or rate are not the declared shape", () => {
    const sessions = [
      { ...USAGE, missingTurns: -1 },
      { ...USAGE, reportedTurns: 1.5 },
      { ...USAGE, total: { ...CODEX_TOKENS, vendor: "gemini" } },
      { ...USAGE, total: { ...CODEX_TOKENS, inputTokens: 5 } },
      { ...USAGE, rate: { kind: "fast" } },
      { ...USAGE, modelMismatch: "no" },
      { ...USAGE, turnOpen: undefined },
      { ...USAGE, context: { atIso: "t", usedTokens: 1 } },
      { ...USAGE, lastTurn: { atIso: "t", usage: { kind: "reported" } } },
    ];
    expect(sessions.map((session) => isAppHarnessResponseEnvelope(usageAnswer({ sessions: [session] })))).toEqual(
      sessions.map(() => false),
    );
  });
});

describe("isAppSessionSnapshot", () => {
  it("accepts a snapshot with its optional text fields and refuses an unknown state", () => {
    expect(isAppSessionSnapshot({ ...SNAPSHOT, lastSubmittedAtIso: "x", lastSubmittedText: "hi" })).toBe(true);
    expect(isAppSessionSnapshot({ ...SNAPSHOT, state: "asleep" })).toBe(false);
    expect(isAppSessionSnapshot({ ...SNAPSHOT, lastSubmittedText: 3 })).toBe(false);
  });

  it("names the vendor, and refuses a snapshot with none or an unknown one", () => {
    const { vendor: _dropped, ...unnamed } = SNAPSHOT;
    expect(isAppSessionSnapshot({ ...SNAPSHOT, vendor: "claude" })).toBe(true);
    expect(isAppSessionSnapshot(unnamed)).toBe(false);
    expect(isAppSessionSnapshot({ ...SNAPSHOT, vendor: "gemini" })).toBe(false);
  });
});

describe("appHarnessSocketPath", () => {
  it("puts the version-3 socket in one owner directory per user, under the root it is given", () => {
    expect(APP_HARNESS_PROTOCOL_VERSION).toBe(3);
    expect(appHarnessSocketPath({ root: "/tmp", uid: 501 })).toEqual({
      directory: "/tmp/slopweaver-501",
      socket: "/tmp/slopweaver-501/session-harness-v3.sock",
    });
  });
});

describe("the origin claim", () => {
  const CLAIM = { appSessionId: "0b5e", kind: "session.origin", vendor: "claude", vendorSessionId: "a0000107" };

  it("accepts a claim with every field, and refuses one with a blank, missing or unknown one", () => {
    const { appSessionId: _unnamed, ...unnamed } = CLAIM;
    const requests = [
      CLAIM,
      { ...CLAIM, vendor: "codex" },
      unnamed,
      { ...CLAIM, vendorSessionId: "" },
      { ...CLAIM, vendorSessionId: 7 },
      { ...CLAIM, vendor: "claude-code" },
    ];
    expect(requests.map((request) => isAppHarnessRequestEnvelope(requestOf({ request })))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("accepts an answer carrying the matched snapshot, and refuses one carrying none", () => {
    const responses = [{ kind: "session-origin", session: SNAPSHOT }, { kind: "session-origin" }];
    expect(responses.map((response) => isAppHarnessResponseEnvelope(answerOf({ response })))).toEqual([true, false]);
  });
});
