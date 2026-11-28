/** The cmux control socket's wire format — pure encode/split/parse, no socket anywhere near it. */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import {
  classifyCallError,
  encodeRequest,
  parseReplyFrame,
  redactCapability,
  refusalError,
  socketRefusalOf,
  splitFrames,
} from "../../../cmux/socketFrames.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("encodeRequest", () => {
  it("writes one newline-terminated JSON object carrying id, method and params", () => {
    expect(encodeRequest({ id: "sw-1", method: "system.ping", params: {} })).toBe(
      '{"id":"sw-1","method":"system.ping","params":{}}\n',
    );
  });

  it("prefixes the capability token exactly as cmux's own CLI does, on the same line", () => {
    expect(encodeRequest({ capability: "v1.abc", id: "sw-2", method: "workspace.list", params: {} })).toBe(
      '_cmux_capability_v1 v1.abc {"id":"sw-2","method":"workspace.list","params":{}}\n',
    );
  });
});

describe("refusalError", () => {
  it("types cmux's cmuxOnly refusal, word for word, as access-denied, keeping its words in the message", () => {
    const error = refusalError({
      refusal: "Access denied - only processes started inside cmux can connect",
      socketPath: "/s.sock",
    });

    expect(error).toEqual({
      code: "SOCKET_UNAVAILABLE",
      message:
        "cmux control socket unavailable at /s.sock: cmux refused the connection: Access denied - only processes started inside cmux can connect",
      reason: "access-denied",
      socketPath: "/s.sock",
    });
  });

  it("types any other refusal as a transport failure, never access-denied", () => {
    const error = refusalError({ refusal: "Access denied for <capability>", socketPath: "/s.sock" });

    expect(error).toEqual({
      code: "SOCKET_UNAVAILABLE",
      message:
        "cmux control socket unavailable at /s.sock: cmux refused the connection: Access denied for <capability>",
      reason: "transport-unavailable",
      socketPath: "/s.sock",
    });
  });
});

describe("socketRefusalOf", () => {
  it("reads cmux's bare access-denied line, ERROR: stripped", () => {
    expect(
      socketRefusalOf({
        capability: undefined,
        line: "ERROR: Access denied - only processes started inside cmux can connect",
      }),
    ).toBe("Access denied - only processes started inside cmux can connect");
  });

  it("ignores a JSON reply frame, even one reporting a failure", () => {
    expect(
      socketRefusalOf({
        capability: undefined,
        line: '{"ok":false,"id":"sw-1","error":{"code":"x","message":"ERROR: nope"}}',
      }),
    ).toBeUndefined();
  });

  it("redacts the presented capability out of cmux's words — they become an error message", () => {
    const token = "v1.sentinel-capability-not-a-real-token";

    expect(socketRefusalOf({ capability: token, line: `ERROR: Access denied for ${token}, not ${token}` })).toBe(
      "Access denied for <capability>, not <capability>",
    );
  });
});

describe("redactCapability", () => {
  const token = "v1.sentinel-capability-not-a-real-token";

  it("keeps a token cmux echoed in a structured error out of the message a caller records", () => {
    const frame = `{"ok":false,"id":"sw-1","error":{"code":"denied","message":"rejected capability ${token}"}}`;
    const parsed = parseReplyFrame({
      line: redactCapability({ capability: token, text: frame }),
      method: "workspace.list",
    });

    expect(unwrapErr(parsed)).toEqual(
      CmuxErrors.callFailed({
        cmuxCode: "denied",
        message: "rejected capability <capability>",
        method: "workspace.list",
      }),
    );
  });

  it("catches a token written with JSON escapes, which the parse would otherwise rebuild", () => {
    const escaped = token.replace("s", "\\u0073");
    const frame = `{"ok":false,"id":"sw-1","error":{"code":"denied","message":"rejected ${escaped}"}}`;

    expect(frame).not.toContain(token);
    expect(redactCapability({ capability: token, text: frame })).toBe(
      '{"ok":false,"id":"sw-1","error":{"code":"denied","message":"rejected <capability>"}}',
    );
  });

  it("matches a frame that is not JSON as text", () => {
    expect(redactCapability({ capability: token, text: `ERROR: refused ${token}` })).toBe(
      "ERROR: refused <capability>",
    );
  });

  it("leaves a frame untouched when the connection presented no capability", () => {
    expect(redactCapability({ capability: undefined, text: `{"ok":true,"result":"${token}"}` })).toBe(
      `{"ok":true,"result":"${token}"}`,
    );
  });
});

describe("splitFrames", () => {
  it("returns whole frames and keeps the incomplete tail", () => {
    expect(splitFrames({ buffer: '{"a":1}\n{"b":2}\n{"c":' })).toEqual({
      frames: ['{"a":1}', '{"b":2}'],
      remainder: '{"c":',
    });
  });

  it("returns no frames at all for a chunk with no newline yet", () => {
    expect(splitFrames({ buffer: '{"a":' })).toEqual({ frames: [], remainder: '{"a":' });
  });

  it("drops blank lines rather than passing them on as frames", () => {
    expect(splitFrames({ buffer: '\n{"a":1}\n\n' })).toEqual({ frames: ['{"a":1}'], remainder: "" });
  });
});

describe("classifyCallError", () => {
  it("gives the settling-surface failure its own code rather than leaving it a message to match", () => {
    const error = classifyCallError({
      cmuxCode: "internal_error",
      message: "Failed to read terminal text",
      method: "surface.read_text",
    });

    expect(error.code).toBe("TERMINAL_TEXT_UNREADABLE");
  });

  it("is case-insensitive about cmux's own wording", () => {
    expect(
      classifyCallError({ cmuxCode: "internal_error", message: "failed to read terminal TEXT", method: "m" }).code,
    ).toBe("TERMINAL_TEXT_UNREADABLE");
  });

  it("classifies every other failure as a plain call failure carrying cmux's code", () => {
    const error = classifyCallError({
      cmuxCode: "not_found",
      message: "Workspace not found",
      method: "workspace.close",
    });

    expect(error.code).toBe("CALL_FAILED");
    expect(error.message).toContain("not_found");
    expect(error.message).toContain("Workspace not found");
  });
});

describe("parseReplyFrame on cmux's rate limit", () => {
  it("decodes the measured frame into RATE_LIMITED carrying cmux's own hint", () => {
    const line =
      '{"ok":false,"id":"sw-10","error":{"data":{"retry_after_ms":92},"code":"rate_limited","message":"Polling rate limited for this connection"}}';

    expect(unwrapErr(parseReplyFrame({ line, method: "surface.read_text" }))).toEqual(
      CmuxErrors.rateLimited({
        message: "Polling rate limited for this connection",
        method: "surface.read_text",
        retryAfterMs: 92,
      }),
    );
  });

  it("keeps no hint it cannot trust: missing, negative, fractional or not a number", () => {
    const dataShapes = [
      "",
      ',"data":{}',
      ',"data":{"retry_after_ms":-1}',
      ',"data":{"retry_after_ms":9.5}',
      ',"data":{"retry_after_ms":"92"}',
      ',"data":7',
    ];

    const hints = dataShapes.map((data) => {
      const line = `{"ok":false,"id":"sw-1","error":{"code":"rate_limited","message":"m"${data}}}`;
      const error = unwrapErr(parseReplyFrame({ line, method: "surface.read_text" }));
      return error.code === "RATE_LIMITED" ? error.retryAfterMs : "not rate limited";
    });

    expect(hints).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("leaves any other cmux code a plain call failure, hint or not", () => {
    const line = '{"ok":false,"id":"sw-1","error":{"code":"not_found","message":"gone","data":{"retry_after_ms":92}}}';

    expect(unwrapErr(parseReplyFrame({ line, method: "workspace.close" }))).toEqual(
      CmuxErrors.callFailed({ cmuxCode: "not_found", message: "gone", method: "workspace.close" }),
    );
  });
});

describe("parseReplyFrame", () => {
  it("returns the result value of a successful reply", () => {
    expect(
      unwrap(parseReplyFrame({ line: '{"ok":true,"id":"sw-1","result":{"pong":true}}', method: "system.ping" })),
    ).toEqual({ pong: true });
  });

  it("maps an error reply to the typed failure", () => {
    const parsed = parseReplyFrame({
      line: '{"ok":false,"id":"a","error":{"code":"method_not_found","message":"Unknown method"}}',
      method: "no.such",
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("CALL_FAILED");
  });

  it("refuses a frame that is not JSON", () => {
    const parsed = parseReplyFrame({ line: "not json", method: "m" });

    expect(unwrapErr(parsed).code).toBe("MALFORMED_REPLY");
  });

  it("refuses a success frame carrying no result field", () => {
    const parsed = parseReplyFrame({ line: '{"ok":true,"id":"a"}', method: "m" });

    expect(unwrapErr(parsed).code).toBe("MALFORMED_REPLY");
  });

  it("still reports a failure when cmux sends no error object at all", () => {
    const parsed = parseReplyFrame({ line: '{"ok":false,"id":"a"}', method: "m" });

    expect(unwrapErr(parsed).code).toBe("CALL_FAILED");
    expect(unwrapErr(parsed).message).toContain("unknown");
  });
});
