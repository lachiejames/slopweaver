import { describe, expect, it } from "vitest";

import type { PageObservation } from "../../../../../browser/interactionSession.js";
import type { BrowserActOptions } from "../../../../../cli/commands/browser/actionCore.js";
import { aimMarkFor } from "../../../../../cli/commands/browser/actionRun.js";

/** The JumpCloud console, which the register refuses every write on at the host level. */
const REFUSED_URL = "https://console.jumpcloud.com/#/users";

function options({ focus }: { focus: boolean }): BrowserActOptions {
  return {
    downloadDir: undefined,
    expectFocus: undefined,
    expectName: undefined,
    focus,
    fullPage: false,
    json: false,
    kind: "click",
    observationId: "obs-1",
    out: undefined,
    sessionId: "s-1",
    target: "e7",
    value: undefined,
  };
}

const OBSERVATION: PageObservation = {
  id: "obs-1",
  observedAtIso: "2026-09-16T00:00:00.000Z",
  screenshotPath: null,
  snapshotPath: "/s/snapshot.yml",
  title: "Users",
  url: REFUSED_URL,
};

const WAIVER = { expiresAtIso: "2026-09-16T01:00:00.000Z", reason: "owner asked", url: REFUSED_URL };

describe("aimMarkFor", () => {
  it("withholds a requested focus on a page registered refuse-every-write, marks a plain highlight instead and says why", () => {
    expect(aimMarkFor({ observation: OBSERVATION, options: options({ focus: true }), waiver: undefined })).toEqual({
      mark: "highlight",
      skipped:
        "  --focus was not taken: JumpCloud is registered refuse-every-write, and a focus fires the page's own " +
        "focus and blur handlers. The target is highlighted instead",
    });
  });

  it("takes the requested focus on the same page, without a warning, when a waiver names it", () => {
    expect(aimMarkFor({ observation: OBSERVATION, options: options({ focus: true }), waiver: WAIVER })).toEqual({
      mark: "highlight-and-focus",
      skipped: null,
    });
  });

  it("highlights without a warning when no focus was requested", () => {
    expect(aimMarkFor({ observation: OBSERVATION, options: options({ focus: false }), waiver: undefined })).toEqual({
      mark: "highlight",
      skipped: null,
    });
  });

  it("highlights without a warning when no read is cited, even with a focus requested and a waiver held", () => {
    expect(aimMarkFor({ observation: null, options: options({ focus: true }), waiver: WAIVER })).toEqual({
      mark: "highlight",
      skipped: null,
    });
  });
});
