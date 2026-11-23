import { describe, expect, it } from "vitest";

import { BrowserActionErrors } from "../../../browser/actionErrors.js";
import { FOCUS_TARGET_SOURCE, planAimShot, SCROLL_INTO_VIEW_SOURCE } from "../../../browser/aimShot.js";
import { type AimShotSeams, photographTheAim } from "../../../browser/aimShotRun.js";
import type { TerminalClientDeps, TerminalReply } from "../../../browser/terminalClient.js";
import { err, ok } from "../../../lib/result.js";

const DEPS: TerminalClientDeps = {
  chromePinPath: "/pin",
  clientSession: "slopweaver-test",
  extensionToken: "token",
  placement: "background",
  workspace: "/s",
};

const LIVE_URL = "https://example.invalid/settings";
const MOVED_URL = "https://example.invalid/elsewhere";

const SCROLL = { documentHeight: 4000, fromY: 0, inView: true, toY: 900, viewportHeight: 800 };
const FOCUS = { focusable: true, focused: true };

/** One reply shaped the way the client prints an `eval`'s value. */
function evalReply({ value }: { value: unknown }): TerminalReply {
  return {
    modalState: null,
    pageTitle: "Settings",
    pageUrl: LIVE_URL,
    snapshotPath: null,
    snapshotYaml: null,
    stdout: `### Ran Playwright code\nsome preamble\n### Result\n${JSON.stringify(value, null, 2)}\n`,
  };
}

const PLAIN_REPLY: TerminalReply = {
  modalState: null,
  pageTitle: "Settings",
  pageUrl: LIVE_URL,
  snapshotPath: null,
  snapshotYaml: null,
  stdout: "### Result\ndone",
};

/** A refusal the fake answers for whichever call matches `failOn`. */
const FAILURE = BrowserActionErrors.clientFailed({ detail: "the tab went away" });

/**
 * A fake browser whose two seams write to ONE log, so the order across both is asserted as a single list.
 *
 * @param log every call, as `<seam> <args joined by a space>`
 * @param failOn the exact joined args of the one call that fails, or `null` for none
 * @param movedOn the plain call whose reply, and every plain reply after it, names `MOVED_URL` instead
 * @returns the seams
 */
function fakeBrowser({
  log,
  failOn,
  movedOn = null,
}: {
  log: string[];
  failOn: string | null;
  movedOn?: string | null;
}): AimShotSeams {
  let moved = false;
  const answer = ({ args }: { args: readonly string[] }) => {
    if (args.join(" ") === failOn) {
      return err(FAILURE);
    }
    if (args[1] === SCROLL_INTO_VIEW_SOURCE) {
      return ok(evalReply({ value: SCROLL }));
    }
    if (args[1] === FOCUS_TARGET_SOURCE) {
      return ok(evalReply({ value: FOCUS }));
    }
    moved = moved || args.join(" ") === movedOn;
    return ok(moved ? { ...PLAIN_REPLY, pageUrl: MOVED_URL } : PLAIN_REPLY);
  };
  const client: AimShotSeams["client"] = (request) => {
    log.push(`client ${request.args.join(" ")}`);
    return answer({ args: request.args });
  };
  const capture: AimShotSeams["capture"] = (request) => {
    log.push(`capture ${request.args.join(" ")}`);
    return answer({ args: request.args });
  };
  return { capture, client };
}

const PLAN = planAimShot({ fullPage: false, mark: "highlight-and-focus", ref: "e12", stem: "/s/shot" });

describe("photographTheAim", () => {
  it("runs a highlight-and-focus shot in plan order and returns the parsed scroll and focus", () => {
    const log: string[] = [];

    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: () => true,
      plan: PLAN,
      seams: fakeBrowser({ failOn: null, log }),
    });

    expect(log).toEqual([
      `client eval ${SCROLL_INTO_VIEW_SOURCE} e12`,
      "capture screenshot --filename=/s/shot-before.png",
      `client eval ${FOCUS_TARGET_SOURCE} e12`,
      "client highlight e12",
      "capture screenshot --filename=/s/shot-aimed.png",
      "client highlight --hide e12",
    ]);
    expect(result).toEqual(ok({ focus: FOCUS, pictureUrls: [LIVE_URL, LIVE_URL], plan: PLAN, scroll: SCROLL }));
  });

  it("asks only about the page the scroll reply named, skips the focus step when refused, runs the other steps in order and returns no focus", () => {
    const log: string[] = [];
    const asked: string[] = [];

    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: (url) => {
        asked.push(url);
        return false;
      },
      plan: PLAN,
      seams: fakeBrowser({ failOn: null, log }),
    });

    expect(asked).toEqual([LIVE_URL]);
    expect(log).toEqual([
      `client eval ${SCROLL_INTO_VIEW_SOURCE} e12`,
      "capture screenshot --filename=/s/shot-before.png",
      "client highlight e12",
      "capture screenshot --filename=/s/shot-aimed.png",
      "client highlight --hide e12",
    ]);
    expect(result).toEqual(ok({ focus: null, pictureUrls: [LIVE_URL, LIVE_URL], plan: PLAN, scroll: SCROLL }));
  });

  it("runs every step in plan order through a failed aimed picture, still attempts the hide, and returns the capture's own error", () => {
    const log: string[] = [];

    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: () => true,
      plan: PLAN,
      seams: fakeBrowser({ failOn: "screenshot --filename=/s/shot-aimed.png", log }),
    });

    expect(log).toEqual([
      `client eval ${SCROLL_INTO_VIEW_SOURCE} e12`,
      "capture screenshot --filename=/s/shot-before.png",
      `client eval ${FOCUS_TARGET_SOURCE} e12`,
      "client highlight e12",
      "capture screenshot --filename=/s/shot-aimed.png",
      "client highlight --hide e12",
    ]);
    expect(result).toEqual(err(FAILURE));
  });

  it("runs every step in plan order and still succeeds with what it saw when the closing hide fails", () => {
    const log: string[] = [];

    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: () => true,
      plan: PLAN,
      seams: fakeBrowser({ failOn: "highlight --hide e12", log }),
    });

    expect(log).toEqual([
      `client eval ${SCROLL_INTO_VIEW_SOURCE} e12`,
      "capture screenshot --filename=/s/shot-before.png",
      `client eval ${FOCUS_TARGET_SOURCE} e12`,
      "client highlight e12",
      "capture screenshot --filename=/s/shot-aimed.png",
      "client highlight --hide e12",
    ]);
    expect(result).toEqual(ok({ focus: FOCUS, pictureUrls: [LIVE_URL, LIVE_URL], plan: PLAN, scroll: SCROLL }));
  });

  it("never lets the closing hide re-attribute pictures already taken when the page moves after them", () => {
    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: () => true,
      plan: PLAN,
      seams: fakeBrowser({ failOn: null, log: [], movedOn: "highlight --hide e12" }),
    });

    expect(result).toEqual(ok({ focus: FOCUS, pictureUrls: [LIVE_URL, LIVE_URL], plan: PLAN, scroll: SCROLL }));
  });

  it("names both pages when the page moves between the before and the aimed picture", () => {
    const result = photographTheAim({
      deps: DEPS,
      mayFocusOn: () => true,
      plan: PLAN,
      seams: fakeBrowser({ failOn: null, log: [], movedOn: "screenshot --filename=/s/shot-aimed.png" }),
    });

    expect(result).toEqual(ok({ focus: FOCUS, pictureUrls: [LIVE_URL, MOVED_URL], plan: PLAN, scroll: SCROLL }));
  });
});
