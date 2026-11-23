/**
 * The coverage cells a JumpCloud console walk writes: `page` synced only when every DECLARED page was held,
 * `method` deferred only when the administrator session was lost part-way.
 */
import { describe, expect, it } from "vitest";

import { methodCoverageCell, pageCoverageCell } from "../../../../atlas/jumpcloud/browserCoverage.js";
import { JUMPCLOUD_CONSOLE_PAGES } from "../../../../atlas/jumpcloud/browserPages.js";
import type { JumpcloudPageObservation } from "../../../../atlas/jumpcloud/browserWalk.js";
import { emptyJumpcloudConsoleKindFile } from "../../../../atlas/jumpcloud/consoleModel.js";

const AT = "2026-09-25T00:00:00.000Z";

const STORED = emptyJumpcloudConsoleKindFile({ kind: "page", updatedAt: AT });

/** A reached, photographed observation of one declared page. */
function heldPage({ surface }: { surface: string }): JumpcloudPageObservation {
  return {
    artifacts: [
      {
        byteLength: 1,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: `${surface}.png`,
        sha256: "0".repeat(64),
      },
    ],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `https://console.jumpcloud.com/#/${surface}`,
    observedAt: AT,
    redirected: false,
    requestedUrl: `https://console.jumpcloud.com/#/${surface}`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface,
    title: "JumpCloud Admin Portal",
    unreachableBecause: null,
  };
}

const EVERY_PAGE_HELD = JUMPCLOUD_CONSOLE_PAGES.map((declared) => heldPage({ surface: declared.surface }));

describe("pageCoverageCell", () => {
  it("is synced when every declared page was reached and photographed", () => {
    const cell = pageCoverageCell({ at: AT, pages: EVERY_PAGE_HELD, stored: STORED });
    expect([cell.state, cell.reason]).toEqual([
      "synced",
      `${String(JUMPCLOUD_CONSOLE_PAGES.length)} of ${String(JUMPCLOUD_CONSOLE_PAGES.length)} declared page(s) reached, ${String(JUMPCLOUD_CONSOLE_PAGES.length)} of those also photographed`,
    ]);
  });

  it("is deferred, with the fraction, when one page has no picture", () => {
    const [first, ...rest] = EVERY_PAGE_HELD;
    const pages = [{ ...first!, artifacts: [], screenshotMissingBecause: "no picture" }, ...rest];
    const cell = pageCoverageCell({ at: AT, pages, stored: STORED });
    expect([cell.state, cell.reason]).toEqual([
      "deferred",
      `${String(JUMPCLOUD_CONSOLE_PAGES.length)} of ${String(JUMPCLOUD_CONSOLE_PAGES.length)} declared page(s) reached, ${String(JUMPCLOUD_CONSOLE_PAGES.length - 1)} of those also photographed`,
    ]);
  });
});

describe("methodCoverageCell", () => {
  it("is synced discovery on a walk that kept its session", () => {
    const cell = methodCoverageCell({
      at: AT,
      operationCount: 3,
      stored: STORED,
      walk: { pages: EVERY_PAGE_HELD, rootFound: true, sessionLost: false },
    });
    expect([cell.state, cell.role]).toEqual(["synced", "discovery"]);
  });

  it("is deferred, naming the sign-in step, when the session was lost", () => {
    const cell = methodCoverageCell({
      at: AT,
      operationCount: 3,
      stored: STORED,
      walk: { pages: EVERY_PAGE_HELD, rootFound: true, sessionLost: true },
    });
    expect([cell.state, cell.unblockedBy]).toEqual([
      "deferred",
      "sign in to the JumpCloud admin console in your own Chrome and run the walk again",
    ]);
  });
});
