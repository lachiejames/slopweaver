import { describe, expect, it } from "vitest";

import type { BrowserAdmission } from "../../../../../browser/action.js";
import type { BrowserActionReceipt } from "../../../../../browser/actionExecutor.js";
import { renderAdmissionPosture } from "../../../../../cli/commands/browser/actionCore.js";
import { renderReceipt } from "../../../../../cli/commands/browser/actionReceipt.js";

const ADMISSION: BrowserAdmission = {
  kind: "click",
  pageRuleId: null,
  policy: "read-before-write",
  provider: "datadog",
  url: "https://app.datadoghq.com/rum/replay/sessions/abc",
  waivedBecause: null,
};

/** A plain click receipt that stayed on its page; each test overrides what it is about. */
function receipt({ over }: { over: Partial<BrowserActionReceipt> }): BrowserActionReceipt {
  return {
    actionId: "a1",
    admission: ADMISSION,
    afterTitle: null,
    afterUrl: ADMISSION.url,
    aimShot: null,
    beforeUrl: ADMISSION.url,
    download: null,
    downloadPath: null,
    fullscreenGuard: null,
    kind: "click",
    modalState: null,
    screenshotPath: "/s/after.png",
    snapshotPath: null,
    ...over,
  };
}

describe("renderReceipt", () => {
  it("prints the plain receipt unchanged when the guard has nothing to say, the fresh look named for an inline snapshot", () => {
    const expected = [
      `browser act: click done — ${ADMISSION.url}`,
      renderAdmissionPosture({ admission: ADMISSION }),
      "  after: /s/after.png — the viewport once it had run",
      "  elements now: `slopweaver browser read --session s-1` takes a fresh, citable look with an outline",
    ];
    expect(renderReceipt({ focusSkipped: null, receipt: receipt({ over: {} }), sessionId: "s-1" })).toEqual(expected);
    const quiet = receipt({
      over: { fullscreenGuard: { emergencyExits: 0, refusedRequests: 0, unreadableFrames: 0 } },
    });
    expect(renderReceipt({ focusSkipped: null, receipt: quiet, sessionId: "s-1" })).toEqual(expected);
  });

  it("says a refused full-screen request after the after-picture", () => {
    const refused = receipt({
      over: { fullscreenGuard: { emergencyExits: 0, refusedRequests: 1, unreadableFrames: 0 } },
    });
    expect(renderReceipt({ focusSkipped: null, receipt: refused, sessionId: "s-1" })).toEqual([
      `browser act: click done — ${ADMISSION.url}`,
      renderAdmissionPosture({ admission: ADMISSION }),
      "  after: /s/after.png — the viewport once it had run",
      "  elements now: `slopweaver browser read --session s-1` takes a fresh, citable look with an outline",
      "  full screen: the page asked for full screen; it was refused, so the browser stayed in the background (SLOPWEAVER_BROWSER_FOREGROUND=1 at browser open allows it)",
    ]);
  });

  it("keeps the page move, title, dialog and waiver lines around the full-screen one", () => {
    const moved = receipt({
      over: {
        admission: { ...ADMISSION, waivedBecause: "fixture" },
        afterTitle: "Replay",
        afterUrl: "https://app.datadoghq.com/rum/explorer",
        fullscreenGuard: { emergencyExits: 1, refusedRequests: 0, unreadableFrames: 0 },
        modalState: "[File chooser]",
        snapshotPath: "/s/page.yml",
      },
    });
    expect(renderReceipt({ focusSkipped: "  focus skipped", receipt: moved, sessionId: "s-1" })).toEqual([
      "browser act: click done — https://app.datadoghq.com/rum/explorer",
      `  the page moved: ${ADMISSION.url} -> https://app.datadoghq.com/rum/explorer`,
      "  title: Replay",
      renderAdmissionPosture({ admission: { ...ADMISSION, waivedBecause: "fixture" } }),
      "  focus skipped",
      "  after: /s/after.png — the viewport once it had run",
      "  elements now: /s/page.yml — never read it whole; `slopweaver browser read --session s-1` takes a fresh, citable look with an outline",
      "  the page is holding a dialog open: [File chooser]",
      "  full screen: the page ENTERED full screen and was taken back out of it; whether macOS had already switched your screen to it first is unknown",
      "  a page waiver allowed this: fixture",
    ]);
  });
});
