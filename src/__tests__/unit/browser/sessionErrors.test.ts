/**
 * The session-lifecycle arms live in their own file and are spread into `BrowserActionErrors`, so the one
 * constructor every caller and fixture builds through still reaches each of them, unchanged.
 */
import { describe, expect, it } from "vitest";

import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { SessionErrors } from "../../../browser/sessionErrors.js";

const SESSION_ID = "5f2a1c30-0000-4000-8000-0000000000f1";

describe("SessionErrors", () => {
  it("is reached through BrowserActionErrors, factory for factory", () => {
    expect(BrowserActionErrors.sessionBusy).toBe(SessionErrors.sessionBusy);
    expect(BrowserActionErrors.sessionIdle).toBe(SessionErrors.sessionIdle);
    expect(BrowserActionErrors.sessionLost).toBe(SessionErrors.sessionLost);
    expect(BrowserActionErrors.sessionRecordUnwritable).toBe(SessionErrors.sessionRecordUnwritable);
  });

  it("names the lock's holder in a busy refusal and says to retry once", () => {
    const busy = SessionErrors.sessionBusy({ detail: "held by pid 4242", sessionId: SESSION_ID });
    expect(busy.code).toBe("SESSION_BUSY");
    expect(busy.detail).toBe("held by pid 4242");
    expect(busy.message).toContain("Retry once");
    expect(busy.message).toContain("(held by pid 4242)");
  });
});
