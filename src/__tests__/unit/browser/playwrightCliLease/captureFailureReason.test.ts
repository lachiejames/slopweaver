/*
 * A capture that failed says why, and one that was never asked for does not: the browser's own reason is carried, a
 * claimed write with no file names the read, and a working capture hands back its bytes.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { unwrap } from "../../../../lib/result.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("a capture that failed says why, and one that was never asked for does not", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "relay-shot-"));
  });

  afterEach(() => {
    rmSync(scratch, { force: true, recursive: true });
  });

  const capturedWith = ({ snippet, screenshotPath }: { snippet: Record<string, unknown>; screenshotPath: string }) =>
    captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
        finalUrl: "https://app.notion.com/settings",
        links: [],
        linksError: null,
        responses: [],
        statusCode: 200,
        title: "Settings",
        ...snippet,
      }),
      url: "https://app.notion.com/settings",
    });

  it("carries the browser's own reason when the capture failed", () => {
    // The original defect exactly: Chrome never answers `Page.captureScreenshot` for an inactive tab, and
    // the old shape discarded the timeout, so every walking atlas recorded an unexplained gap instead.
    const captured = capturedWith({
      screenshotPath: join(scratch, "never-written.png"),
      snippet: {
        screenshotError: "TimeoutError: page.screenshot: Timeout 8000ms exceeded.",
        screenshotWritten: false,
      },
    });
    expect(captured.isOk()).toBe(true);
    expect(unwrap(captured).screenshotPng).toBe(null);
    expect(unwrap(captured).screenshotBlockedBecause).toBe("TimeoutError: page.screenshot: Timeout 8000ms exceeded.");
  });

  it("blames nothing when the page was never asked to be photographed", () => {
    const captured = capturedWith({
      screenshotPath: join(scratch, "never-written.png"),
      snippet: { screenshotError: null, screenshotWritten: false },
    });
    expect(captured.isOk()).toBe(true);
    expect(unwrap(captured).screenshotPng).toBe(null);
    expect(unwrap(captured).screenshotBlockedBecause).toBe(null);
  });

  it("names the read when the browser claimed a write and the file is not there", () => {
    const captured = capturedWith({
      screenshotPath: join(scratch, "claimed-but-absent.png"),
      snippet: { screenshotError: null, screenshotWritten: true },
    });
    expect(captured.isOk()).toBe(true);
    expect(unwrap(captured).screenshotPng).toBe(null);
    expect(unwrap(captured).screenshotBlockedBecause).toBe(
      "the browser reported writing a screenshot and the file it named could not be read",
    );
  });

  it("hands back the bytes and no reason when the capture worked", () => {
    const screenshotPath = join(scratch, "written.png");
    writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const captured = capturedWith({
      screenshotPath,
      snippet: { screenshotError: null, screenshotWritten: true },
    });
    expect(captured.isOk()).toBe(true);
    expect(unwrap(captured).screenshotBlockedBecause).toBe(null);
    expect([...unwrap(captured).screenshotPng!]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
