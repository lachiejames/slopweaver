/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { type BrowserActionError, BrowserActionErrors } from "../../../browser/actionErrors.js";
import { TAB_ACTIVATION_ARGS } from "../../../browser/keepForeground.js";
import type { TerminalClientDeps, TerminalReply } from "../../../browser/terminalClient.js";
import { type CaptureSeams, captureScreenshot, isUnrenderedCapture } from "../../../browser/viewportCapture.js";
import { err, ok, type Result, unwrapErr } from "../../../lib/result.js";

/** The client's own words at the original incident, as `### Error` printed them. */
const INCIDENT_TIMEOUT = [
  "### Error",
  "TimeoutError: Timeout 5000ms exceeded.",
  "Call log:",
  "  - taking page screenshot",
  "  - waiting for fonts to load...",
  "  - fonts loaded",
].join("\n");

const SHOT = ["screenshot", "--filename=/s/look.png"];

const DEPS: TerminalClientDeps = {
  chromePinPath: "/pin",
  clientSession: "slopweaver-test",
  extensionToken: "token",
  placement: "background",
  workspace: "/s",
};

const REPLY: TerminalReply = {
  modalState: null,
  pageTitle: "Cost Report Viewer | Datadog",
  pageUrl: "https://ap1.datadoghq.com/cost/analyze/reports/r",
  snapshotPath: null,
  snapshotYaml: null,
  stdout: "### Result\n- [Screenshot of viewport](look.png)",
};

/**
 * A fake session: each screenshot answers the next reply in `replies`, and every command and activation is
 * written to `log` in the order it ran.
 */
function fakeSession({
  replies,
  activation = ok(null),
  log,
}: {
  replies: Result<TerminalReply, BrowserActionError>[];
  activation?: Result<null, BrowserActionError>;
  log: string[];
}): CaptureSeams {
  return {
    activate: () => {
      log.push("ACTIVATE");
      return activation;
    },
    client: ({ args }) => {
      log.push(args.join(" "));
      return replies.shift()!;
    },
  };
}

describe("isUnrenderedCapture", () => {
  it("names the incident's screenshot timeout", () => {
    expect(isUnrenderedCapture({ error: BrowserActionErrors.clientFailed({ detail: INCIDENT_TIMEOUT }) })).toBe(true);
  });

  it("does not name a click that timed out waiting for its element", () => {
    const click = "TimeoutError: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('aria-ref=f1e242')";
    expect(isUnrenderedCapture({ error: BrowserActionErrors.clientFailed({ detail: click }) })).toBe(false);
  });

  it("does not name a screenshot that failed for another reason", () => {
    const denied = "Error: EACCES: permission denied, open '/s/look.png'\nCall log:\n  - taking page screenshot";
    expect(isUnrenderedCapture({ error: BrowserActionErrors.clientFailed({ detail: denied }) })).toBe(false);
  });

  it("does not name a failure that is not the client's", () => {
    expect(isUnrenderedCapture({ error: BrowserActionErrors.sessionIdle({ sessionId: "s" }) })).toBe(false);
  });
});

describe("captureScreenshot", () => {
  it("photographs a tab that renders with one command and never activates it", () => {
    const log: string[] = [];
    const taken = captureScreenshot({ args: SHOT, deps: DEPS, seams: fakeSession({ log, replies: [ok(REPLY)] }) });
    expect(taken.isOk()).toBe(true);
    expect(log).toEqual(["screenshot --filename=/s/look.png"]);
  });

  it("activates the session's tab and photographs it again after the incident's timeout", () => {
    const log: string[] = [];
    const seams = fakeSession({
      log,
      replies: [err(BrowserActionErrors.clientFailed({ detail: INCIDENT_TIMEOUT })), ok(REPLY)],
    });
    const taken = captureScreenshot({ args: SHOT, deps: DEPS, seams });
    expect(taken.isOk()).toBe(true);
    expect(log).toEqual(["screenshot --filename=/s/look.png", "ACTIVATE", "screenshot --filename=/s/look.png"]);
  });

  it("tries only once more, and returns the second failure when the activated tab still will not draw", () => {
    const log: string[] = [];
    const second = BrowserActionErrors.clientFailed({ detail: INCIDENT_TIMEOUT.replace("5000ms", "5001ms") });
    const seams = fakeSession({
      log,
      replies: [err(BrowserActionErrors.clientFailed({ detail: INCIDENT_TIMEOUT })), err(second)],
    });
    const taken = captureScreenshot({ args: SHOT, deps: DEPS, seams });
    expect(taken.isErr()).toBe(true);
    expect(unwrapErr(taken)).toEqual(second);
    expect(log).toHaveLength(3);
  });

  it("returns any other failure untouched, without raising a window for it", () => {
    const log: string[] = [];
    const denied = BrowserActionErrors.clientFailed({ detail: "Error: EACCES: permission denied" });
    const taken = captureScreenshot({ args: SHOT, deps: DEPS, seams: fakeSession({ log, replies: [err(denied)] }) });
    expect(unwrapErr(taken)).toEqual(denied);
    expect(log).toEqual(["screenshot --filename=/s/look.png"]);
  });

  it("says the capture timed out AND why the tab could not be activated, and does not photograph again", () => {
    const log: string[] = [];
    const seams = fakeSession({
      activation: err(BrowserActionErrors.clientFailed({ detail: "the relay went away" })),
      log,
      replies: [err(BrowserActionErrors.clientFailed({ detail: INCIDENT_TIMEOUT }))],
    });
    const failure = unwrapErr(captureScreenshot({ args: SHOT, deps: DEPS, seams }));
    expect(failure.code).toBe("CLIENT_FAILED");
    expect(failure.message).toContain("Timeout 5000ms exceeded");
    expect(failure.message).toContain(
      "could not be activated to try again: the browser client refused or failed: the relay went away",
    );
    expect(log).toEqual(["screenshot --filename=/s/look.png", "ACTIVATE"]);
  });
});

describe("the activation it sends", () => {
  it("is one fixed run-code bringing the session's own page to the front", () => {
    expect(TAB_ACTIVATION_ARGS).toEqual(["run-code", "async (page) => { await page.bringToFront(); }"]);
  });
});
