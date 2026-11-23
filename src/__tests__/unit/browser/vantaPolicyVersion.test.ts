/**
 * The Vanta policy-version seam's two halves that need no browser: what the snippet's own JSON becomes, and
 * the digest bound on the upload arm.
 *
 * The upload arm STARTS A VERSION on a real compliance platform, so the refusal it gives a read-only
 * transport is the property worth proving, and it fires before the terminal client is ever run. Every test
 * here constructs the real shipped transport against paths that do not exist.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { type BrowserTransportError, BrowserTransportErrors } from "../../../browser/pageTransport.js";
import {
  createVantaPolicyVersionTransport,
  observationFrom,
  POLICY_PAGE_SETTLE_MS,
  uploadFrom,
} from "../../../browser/vantaPolicyVersion.js";

const SHOT = "/x/after.png";
const BEFORE_SHOT = "/x/before.png";

/** What the terminal client prints for one operation: an envelope whose `result` is the snippet's JSON. */
function printed(snippet: Record<string, unknown>): Result<string, BrowserTransportError> {
  return ok(JSON.stringify({ result: JSON.stringify(snippet) }));
}

/** One observation off a snippet report, for the fields a test is about. */
function observed(snippet: Record<string, unknown>): ReturnType<typeof observationFrom> {
  return observationFrom({ result: printed(snippet), screenshotPath: SHOT });
}

/** One upload outcome off a snippet report. */
function uploaded(snippet: Record<string, unknown>): ReturnType<typeof uploadFrom> {
  return uploadFrom({ beforeScreenshotPath: BEFORE_SHOT, result: printed(snippet), screenshotPath: SHOT });
}

describe("observationFrom describes the version menu the page actually rendered", () => {
  it("carries the page's title and settled address through", () => {
    const seen = unwrap(observed({ finalUrl: "https://app.vanta.com/policies/x", title: "Access Policy" }));
    expect({ finalUrl: seen.finalUrl, title: seen.title }).toEqual({
      finalUrl: "https://app.vanta.com/policies/x",
      title: "Access Policy",
    });
  });

  it("reports an empty string for a text field the snippet did not send", () => {
    const seen = unwrap(observed({}));
    expect({ finalUrl: seen.finalUrl, title: seen.title }).toEqual({ finalUrl: "", title: "" });
  });

  // The buttons come from two passes over the page — before the menu was opened and after — and a button
  // present in both is one button.
  it("merges the before and expanded button lists without repeating a button in both", () => {
    const seen = unwrap(observed({ beforeButtons: ["Actions", "Edit"], expandedButtons: ["Edit", "New version"] }));
    expect(seen.buttons).toEqual(["Actions", "Edit", "New version"]);
  });

  it("drops a non-string from either button list", () => {
    expect(unwrap(observed({ beforeButtons: ["Actions", 7], expandedButtons: null })).buttons).toEqual(["Actions"]);
  });

  it("merges the file inputs found after the click with those found in the expanded menu", () => {
    const seen = unwrap(
      observed({
        afterFileInputs: [{ accept: ".pdf", hidden: true, name: "upload" }],
        expandedFileInputs: [{ accept: "application/pdf", hidden: false, name: "file" }],
      }),
    );
    expect(seen.fileInputs).toEqual([
      { accept: ".pdf", hidden: true, name: "upload" },
      { accept: "application/pdf", hidden: false, name: "file" },
    ]);
  });

  it("reduces a file input to the three fields this transport carries, filling what the page omitted", () => {
    expect(unwrap(observed({ afterFileInputs: [{}] })).fileInputs).toEqual([{ accept: "", hidden: false, name: "" }]);
  });

  it("drops a file-input entry that is not a record", () => {
    expect(unwrap(observed({ afterFileInputs: ["input"] })).fileInputs).toEqual([]);
  });

  it("reports no file inputs when the snippet sent no list at all", () => {
    expect(unwrap(observed({ afterFileInputs: null, expandedFileInputs: null })).fileInputs).toEqual([]);
  });

  it("carries the menu items the snippet read after opening the menu", () => {
    expect(unwrap(observed({ afterMenuItems: ["New version", "Archive"] })).menuItems).toEqual([
      "New version",
      "Archive",
    ]);
  });

  it("names which control it managed to open, and null when it opened nothing", () => {
    expect(unwrap(observed({ opened: "Actions" })).opened).toBe("Actions");
    expect(unwrap(observed({})).opened).toBe(null);
  });

  it("carries the screenshot path only when the snippet says it wrote one", () => {
    expect(unwrap(observed({ screenshotWritten: true })).screenshotPath).toBe(SHOT);
    expect(unwrap(observed({ screenshotWritten: false })).screenshotPath).toBe(null);
  });
});

describe("observationFrom tells a channel failure from a page failure", () => {
  it("passes a transport failure straight through", () => {
    const failure = BrowserTransportErrors.sessionLost({ reason: "the relay stopped answering" });
    const seen = observationFrom({ result: err(failure), screenshotPath: SHOT });
    expect(unwrapErr(seen).code).toBe("SESSION_LOST");
  });

  it("reports unparseable output as no transport rather than a missing page", () => {
    const seen = observationFrom({ result: ok("not json"), screenshotPath: SHOT });
    expect(unwrapErr(seen).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("reads a snippet-reported failure as that page's navigation failing", () => {
    expect(unwrapErr(observed({ failure: "the policy page never painted" })).code).toBe("NAVIGATION_FAILED");
  });
});

describe("uploadFrom reports how far a renewal got", () => {
  it("reports a draft started and a PDF attached", () => {
    const done = unwrap(uploaded({ attached: true, stage: "attached", wrote: true }));
    expect({ attached: done.attached, stage: done.stage, wrote: done.wrote }).toEqual({
      attached: true,
      stage: "attached",
      wrote: true,
    });
  });

  it("reports a snippet refusal as an outcome rather than a transport failure", () => {
    expect(unwrap(uploaded({ refused: "the New version control was not there" })).refused).toBe(
      "the New version control was not there",
    );
  });

  it("reports nothing written alongside that refusal", () => {
    const refused = unwrap(uploaded({ refused: "no control" }));
    expect({ attached: refused.attached, wrote: refused.wrote }).toEqual({ attached: false, wrote: false });
  });

  it("carries the controls the snippet could see, which is what a refusal is diagnosed from", () => {
    expect(unwrap(uploaded({ controls: ["Actions", 7, "Edit"] })).controls).toEqual(["Actions", "Edit"]);
  });

  // The BEFORE shot is carried unconditionally: a pair is what makes a renewal reviewable at all.
  it("always carries the before shot, even when the snippet wrote no after shot", () => {
    const done = unwrap(uploaded({ screenshotWritten: false }));
    expect({ after: done.screenshotPath, before: done.beforeScreenshotPath }).toEqual({
      after: null,
      before: BEFORE_SHOT,
    });
  });

  it("carries the after shot when the snippet says it wrote one", () => {
    expect(unwrap(uploaded({ screenshotWritten: true })).screenshotPath).toBe(SHOT);
  });

  // The renewal may or may not have started, so the message has to say to go and look.
  it("tells the reader to read the policy page before running it again when the answer was unparseable", () => {
    const lost = uploadFrom({ beforeScreenshotPath: BEFORE_SHOT, result: ok("not json"), screenshotPath: SHOT });
    expect(unwrapErr(lost).message).toContain("read the policy page before running it again");
  });

  it("passes a transport failure straight through", () => {
    const failure = BrowserTransportErrors.unavailable({ reason: "no relay" });
    const lost = uploadFrom({ beforeScreenshotPath: BEFORE_SHOT, result: err(failure), screenshotPath: SHOT });
    expect(unwrapErr(lost).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("reads a snippet-reported failure as that page's navigation failing", () => {
    expect(unwrapErr(uploaded({ failure: "the policy page never painted" })).code).toBe("NAVIGATION_FAILED");
  });
});

describe("the upload arm is bound to the approval the door admitted", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-version-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const deps = () => ({
    chromePinPath: join(home, "no-such-pin"),
    extensionToken: "not-a-real-token",
    home,
    // A zero bound: one attempt, never a sleep.
    leaseWait: { clock: { nowMs: () => 0, sleep: () => Promise.resolve() }, emit: () => {}, timeoutSeconds: 0 },
    nowIso: () => "2026-09-14T00:00:00.000Z",
    origins: ["https://app.vanta.com"],
    platform: "vanta",
    scratchDir: home,
  });

  it("refuses every upload on a read-only transport, without running the client at all", () => {
    const transport = createVantaPolicyVersionTransport({
      approvedDigest: null,
      deps: deps(),
      url: "https://app.vanta.com/policies/x",
    });
    const started = transport.upload({ pdfPath: null });
    transport.release();
    expect(unwrapErr(started).code).toBe("TRANSPORT_UNAVAILABLE");
  });

  it("says nothing was clicked, which is the fact a caller acts on", () => {
    const transport = createVantaPolicyVersionTransport({
      approvedDigest: null,
      deps: deps(),
      url: "https://app.vanta.com/policies/x",
    });
    const started = transport.upload({ pdfPath: "/x/policy.pdf" });
    transport.release();
    expect(unwrapErr(started).message).toContain("nothing was clicked");
  });

  it("refuses the same way whether or not a PDF was named, because the refusal is about the arm", () => {
    const transport = createVantaPolicyVersionTransport({
      approvedDigest: null,
      deps: deps(),
      url: "https://app.vanta.com/policies/x",
    });
    const withPdf = transport.upload({ pdfPath: "/x/policy.pdf" });
    const withoutPdf = transport.upload({ pdfPath: null });
    transport.release();
    expect(unwrapErr(withPdf).message).toBe(unwrapErr(withoutPdf).message);
  });

  it("gives the policy page six seconds to paint its version menu", () => {
    expect(POLICY_PAGE_SETTLE_MS).toBe(6_000);
  });
});
