/**
 * `commandTimeoutFor`: which cap kills one client command. The attach names its own, above the client's own wait for
 * the extension, because a kill mid-connect strands "Failed to connect to MCP relay" on the owner's screen.
 */
import { describe, expect, it } from "vitest";

import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { ATTACH_TIMEOUT_MS } from "../../../browser/lookBudget.js";
import { CLIENT_COMMAND_TIMEOUT_MS, commandTimeoutFor, runClientCommand } from "../../../browser/terminalClient.js";
import { err } from "../../../lib/result.js";

/** `playwright-core`'s own wait for the extension to dial the relay (`extensionConnectionTimeout`). */
const PLAYWRIGHT_EXTENSION_CONNECT_MS = 30_000;

describe("commandTimeoutFor", () => {
  it("takes the cap the call names over the caller's per-command one", () => {
    expect(commandTimeoutFor({ deps: { commandTimeoutMs: 6_000 }, timeoutMs: ATTACH_TIMEOUT_MS })).toBe(40_000);
  });

  it("takes the caller's per-command cap when the call names none", () => {
    expect(commandTimeoutFor({ deps: { commandTimeoutMs: 6_000 }, timeoutMs: undefined })).toBe(6_000);
  });

  it("falls to the client's own minute when neither names one", () => {
    expect(commandTimeoutFor({ deps: {}, timeoutMs: undefined })).toBe(CLIENT_COMMAND_TIMEOUT_MS);
  });
});

describe("runClientCommand's holdForCommand", () => {
  it("refuses with the hold's own error and runs nothing when the hold is refused", () => {
    const lost = BrowserActionErrors.sessionLost({ sessionId: "5f2a1c30-0000-4000-8000-0000000000f1" });
    let asked = 0;

    const reply = runClientCommand({
      args: ["snapshot"],
      deps: {
        holdForCommand: () => {
          asked += 1;
          return err(lost);
        },
        chromePinPath: "/nowhere/pin",
        clientSession: "slopweaver-5f2a1c30",
        extensionToken: "FIXTURE-token",
        placement: "background",
        workspace: "/nowhere/client",
      },
    });

    expect(reply).toEqual(err(lost));
    expect(asked).toBe(1);
  });
});

describe("ATTACH_TIMEOUT_MS", () => {
  it("is the client's own wait for the extension plus 10 s for the daemon and Chrome to start", () => {
    expect(ATTACH_TIMEOUT_MS - PLAYWRIGHT_EXTENSION_CONNECT_MS).toBe(10_000);
  });
});
