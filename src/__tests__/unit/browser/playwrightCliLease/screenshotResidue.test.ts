/*
 * The transport leaves no screenshot behind in its scratch directory: a PNG written for a page that settled off the
 * walk's own origins is removed.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureFrom } from "../../../../browser/playwrightCli.js";
import { clientStdout, NOTION_LEASE } from "./harness.js";

describe("the transport leaves no screenshot behind in its scratch directory", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "relay-scratch-"));
  });

  afterEach(() => {
    rmSync(scratch, { force: true, recursive: true });
  });

  /**
   * The snippet writes its PNG to a FILE because that is the only way Playwright hands one back, and the
   * capture reads the bytes into `screenshotPng`. Leaving the file behind is residue everywhere, and worse
   * than residue on a walk whose `scratchDir` IS its atlas directory: MEASURED on an HR
   * atlas, where pages ruled unphotographable were accumulating as PNGs inside the
   * published generation.
   *
   * This asserts the DELETION over a file that demonstrably existed first, which is the only shape of this
   * test that can fail. `captureFrom` is the exported half of the path and its off-lease branch removes the
   * same file the new `finally` does; the `finally` itself cannot be reached from a unit test, because
   * running it means running the real terminal client against the owner's Chrome. That gap is stated rather than
   * papered over.
   */
  it("removes the PNG when the client settled off the walk's own origins", () => {
    const screenshotPath = join(scratch, "planted.png");
    writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(existsSync(screenshotPath)).toBe(true);
    const captured = captureFrom({
      lease: NOTION_LEASE,
      observedAt: "2026-09-07T10:00:00.000Z",
      screenshotPath,
      stdout: clientStdout({
        accounting: {},
        finalUrl: "https://evil.test/elsewhere",
        responses: [],
        screenshotWritten: true,
      }),
      url: "https://app.notion.com/settings",
    });
    expect(captured.isErr()).toBe(true);
    expect(existsSync(screenshotPath)).toBe(false);
  });
});
