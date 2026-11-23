/**
 * The session-harness error factory: each variant carries its code and the fields a caller branches on, and
 * the delivery refusal's message says what was refused, by which implementation, and that nothing was sent.
 */
import { describe, expect, it } from "vitest";

import { SessionHarnessErrors } from "../../../sessionHarness/errors.js";

describe("SessionHarnessErrors", () => {
  it("names the delivery, the implementation, the reason and that nothing was sent on a refusal", () => {
    const refused = SessionHarnessErrors.deliveryUnsupported({
      delivery: "later",
      implementation: "cmux",
      why: "a terminal cannot hold a line",
    });
    expect(refused).toEqual({
      code: "DELIVERY_UNSUPPORTED",
      delivery: "later",
      implementation: "cmux",
      message:
        'the cmux session harness cannot honour delivery "later": a terminal cannot hold a line; nothing was sent',
    });
  });

  it("keeps the handle and the caller's message on a session not found", () => {
    expect(SessionHarnessErrors.sessionNotFound({ handle: "workspace:9", message: "no workspace:9" })).toEqual({
      code: "SESSION_NOT_FOUND",
      handle: "workspace:9",
      message: "no workspace:9",
    });
  });

  it("distinguishes an unreachable harness from a failed operation, keeping the cause code on both", () => {
    const fields = { causeCode: "SOCKET_CLOSED", message: "socket closed", operation: "list" } as const;
    expect(SessionHarnessErrors.unavailable(fields)).toEqual({ ...fields, code: "HARNESS_UNAVAILABLE" });
    expect(SessionHarnessErrors.operationFailed(fields)).toEqual({ ...fields, code: "HARNESS_OPERATION_FAILED" });
  });
});
