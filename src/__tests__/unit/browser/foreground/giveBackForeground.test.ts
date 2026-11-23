/*
 * Handing the screen back after an operation: saying a refused restore, restoring first and then raising the owner's
 * window over the agent's, and leaving the agent window alone when the owner was watching it.
 */
import { describe, expect, it } from "vitest";

import { giveBackForeground, sayIfRefused } from "../../../../browser/backgroundPlacement.js";
import {
  actOn,
  CHROME_BUNDLE_ID,
  type ForegroundSnapshot,
  wasWatchingAgentWindow,
} from "../../../../browser/foreground.js";
import {
  BUNDLE_OF,
  CHROME_IN_FRONT,
  CHROME_WINDOW,
  FRONT_ASN,
  raiseLine,
  recorder,
  SLACK_IN_FRONT,
  WINDOW_IDS,
} from "./harness.js";

/* A report that fails the test the moment anything is said: every restore it is passed to must succeed. */
const refuseToBeCalled: (line: string) => void = (line) => {
  throw new Error(`unexpected report: ${line}`);
};

describe("sayIfRefused", () => {
  it("says a restore macOS refused, and nothing for one it decided against", () => {
    const said: string[] = [];
    const report: (line: string) => void = (line) => {
      said.push(line);
    };
    sayIfRefused({
      outcome: actOn({
        action: { bundleId: "com.cmuxterm.app", kind: "activate-app" },
        run: recorder({ replies: {} }).run,
      }),
      report,
    });
    sayIfRefused({ outcome: { kind: "leave", why: "the close changed nothing about what is in front" }, report });
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("browser: an agent Chrome window may still be in front of yours");
  });
});

describe("giveBackForeground — restore first, then the owner's window back over the agent's", () => {
  const AGENT_IN_FRONT: Readonly<Record<string, string>> = { ...CHROME_IN_FRONT, [CHROME_WINDOW]: "2109125765\n" };
  const ACTIVATE_SLACK = "open -b com.tinyspeck.slackmacgap";
  const RAISE_OWNERS = raiseLine({ windowId: 2109125256 });
  const AGENT_ON_TOP = { [RAISE_OWNERS]: "", [WINDOW_IDS]: "2109125765, 2109125256\n" };

  it("gives the owner's app back BEFORE raising their window over the agent's, so the restore still sees it in front", () => {
    const rec = recorder({ replies: { ...AGENT_IN_FRONT, ...AGENT_ON_TOP, [ACTIVATE_SLACK]: "" } });
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    expect(giveBackForeground({ agentWindowId: 2109125765, before, report: refuseToBeCalled, run: rec.run })).toEqual({
      bundleId: "com.tinyspeck.slackmacgap",
      kind: "activate-app",
    });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, ACTIVATE_SLACK, WINDOW_IDS, RAISE_OWNERS]);
  });

  it("still raises the owner's window when they had already moved elsewhere and nothing was restored", () => {
    const rec = recorder({ replies: { ...SLACK_IN_FRONT, ...AGENT_ON_TOP } });
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    expect(giveBackForeground({ agentWindowId: 2109125765, before, report: refuseToBeCalled, run: rec.run }).kind).toBe(
      "leave",
    );
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, WINDOW_IDS, RAISE_OWNERS]);
  });

  it("raises nothing a second time when the restore already put the owner's window on top", () => {
    const rec = recorder({
      replies: { ...AGENT_IN_FRONT, [RAISE_OWNERS]: "", [WINDOW_IDS]: "2109125256, 2109125765\n" },
    });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    expect(giveBackForeground({ agentWindowId: 2109125765, before, report: refuseToBeCalled, run: rec.run }).kind).toBe(
      "raise-window",
    );
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW, RAISE_OWNERS, WINDOW_IDS]);
  });

  it("leaves the agent window where it is when the owner was watching it before the operation", () => {
    const rec = recorder({ replies: AGENT_IN_FRONT });
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125765 };
    expect(giveBackForeground({ agentWindowId: 2109125765, before, report: refuseToBeCalled, run: rec.run }).kind).toBe(
      "leave",
    );
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, CHROME_WINDOW]);
  });

  it("sends nothing when the agent window was never identified", () => {
    const rec = recorder({ replies: SLACK_IN_FRONT });
    expect(giveBackForeground({ agentWindowId: null, before: null, report: refuseToBeCalled, run: rec.run }).kind).toBe(
      "leave",
    );
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF]);
  });

  it("says a refused restore AND a refused raise on the walk lane, rather than swallowing either", () => {
    const rec = recorder({ replies: { ...AGENT_IN_FRONT, [WINDOW_IDS]: "2109125765, 2109125256\n" } });
    const said: string[] = [];
    const before: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 2109125256 };
    giveBackForeground({ agentWindowId: 2109125765, before, report: (line) => said.push(line), run: rec.run });
    expect(said).toEqual([
      `browser: an agent Chrome window may still be in front of yours — the restore command failed: no such command: ${RAISE_OWNERS}`,
      `browser: your Chrome window could not be raised over the agent's, so switching to Chrome may land on it — the restore command failed: no such command: ${RAISE_OWNERS}`,
    ]);
  });

  it("says nothing when no raise was attempted — Chrome would not list its windows", () => {
    const rec = recorder({ replies: { ...SLACK_IN_FRONT } });
    const said: string[] = [];
    const before: ForegroundSnapshot = { bundleId: "com.tinyspeck.slackmacgap", chromeWindowId: null };
    giveBackForeground({ agentWindowId: 2109125765, before, report: (line) => said.push(line), run: rec.run });
    expect(rec.ran()).toEqual([FRONT_ASN, BUNDLE_OF, WINDOW_IDS]);
    expect(said).toEqual([]);
  });
});

describe("wasWatchingAgentWindow", () => {
  it("is true only when Chrome's front window before WAS the agent's", () => {
    const watching: ForegroundSnapshot = { bundleId: CHROME_BUNDLE_ID, chromeWindowId: 42 };
    expect(wasWatchingAgentWindow({ agentWindowId: 42, before: watching })).toBe(true);
    expect(wasWatchingAgentWindow({ agentWindowId: 7, before: watching })).toBe(false);
    expect(wasWatchingAgentWindow({ agentWindowId: null, before: watching })).toBe(false);
    expect(wasWatchingAgentWindow({ agentWindowId: 42, before: null })).toBe(false);
  });

  it("is false when the front app before was not Chrome, whatever window id it carried", () => {
    expect(
      wasWatchingAgentWindow({ agentWindowId: 42, before: { bundleId: "com.apple.finder", chromeWindowId: 42 } }),
    ).toBe(false);
  });
});
