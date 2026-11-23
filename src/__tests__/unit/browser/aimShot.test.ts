import { describe, expect, it } from "vitest";

import { BROWSER_ACTION_KINDS, isWriteCapableAction } from "../../../browser/action.js";
import {
  type AimMark,
  type AimShotPlan,
  type AimShotResult,
  actionTakesAimShot,
  aimShotLines,
  aimShotRef,
  aimShotSteps,
  FOCUS_TARGET_SOURCE,
  framingProblem,
  framingRefusalDetail,
  parseAimFocus,
  parseAimScroll,
  planAimShot,
  SCROLL_INTO_VIEW_SOURCE,
} from "../../../browser/aimShot.js";

const STEM = "/tmp/session/aim-2026-09-16T00-00-00.000Z";
const BEFORE = `${STEM}-before.png`;
const AIMED = `${STEM}-aimed.png`;
const PAGE = `${STEM}-page.png`;

const plan = ({
  ref,
  mark = "highlight",
  fullPage = false,
  stem = STEM,
}: {
  ref: string | null;
  mark?: AimMark;
  fullPage?: boolean;
  stem?: string;
}): AimShotPlan => planAimShot({ fullPage, mark, ref, stem });

const shot = ({
  ref,
  mark = "highlight",
  fullPage = false,
  scroll = null,
  focus = null,
}: {
  ref: string | null;
  mark?: AimMark;
  fullPage?: boolean;
  scroll?: AimShotResult["scroll"];
  focus?: AimShotResult["focus"];
}): AimShotResult => ({ focus, pictureUrls: [], plan: plan({ fullPage, mark, ref }), scroll });

const evalReply = ({ value }: { value: unknown }): string =>
  `### Ran Playwright code\nsome preamble\n### Result\n${JSON.stringify(value, null, 2)}\n`;

describe("which interactions are photographed before they run", () => {
  it("covers every write-capable kind and no other, so the boundary is action.ts's rather than a second one", () => {
    expect(BROWSER_ACTION_KINDS.length).toBeGreaterThan(0);
    const disagreeing = BROWSER_ACTION_KINDS.filter(
      (kind) => actionTakesAimShot({ kind }) !== isWriteCapableAction({ kind }),
    );
    expect(disagreeing).toEqual([]);
  });

  it("photographs a click", () => {
    expect(actionTakesAimShot({ kind: "click" })).toBe(true);
  });

  it("photographs a scroll, which names no element", () => {
    expect(actionTakesAimShot({ kind: "scroll" })).toBe(true);
  });

  it("photographs nothing for a reload, which replaces the document rather than acting on it", () => {
    expect(actionTakesAimShot({ kind: "reload" })).toBe(false);
  });

  it("photographs nothing for a dialog answer", () => {
    expect(actionTakesAimShot({ kind: "dialog-accept" })).toBe(false);
  });
});

describe("which element an interaction is aimed by", () => {
  it("shows --target on a click", () => {
    expect(aimShotRef({ expectFocus: undefined, kind: "click", target: "e42" })).toBe("e42");
  });

  it("shows --expect-focus on a type, because a keystroke names no element of its own", () => {
    expect(aimShotRef({ expectFocus: "f1e11", kind: "type", target: undefined })).toBe("f1e11");
  });

  it("shows --expect-focus on a press", () => {
    expect(aimShotRef({ expectFocus: "f1e11", kind: "press", target: undefined })).toBe("f1e11");
  });

  it("ignores a --target passed to a keystroke, which the client would not aim by either", () => {
    expect(aimShotRef({ expectFocus: "e9", kind: "type", target: "e42" })).toBe("e9");
  });

  it("shows the drag SOURCE, leaving the drop element to aim.ts's own ref check", () => {
    expect(aimShotRef({ expectFocus: undefined, kind: "drag", target: "e7" })).toBe("e7");
  });

  it("has nothing to show on a scroll", () => {
    expect(aimShotRef({ expectFocus: undefined, kind: "scroll", target: undefined })).toBe(null);
  });

  it("has nothing to show when a keystroke named no focus element", () => {
    expect(aimShotRef({ expectFocus: undefined, kind: "type", target: undefined })).toBe(null);
  });

  it("treats an empty --target as naming nothing rather than as an element called the empty string", () => {
    expect(aimShotRef({ expectFocus: undefined, kind: "click", target: "" })).toBe(null);
  });
});

describe("planning one aim shot's pictures", () => {
  it("names both viewport pictures from one stem, so the pair can never be two different actions' files", () => {
    expect(plan({ ref: "e42" })).toEqual({
      aimedPath: AIMED,
      beforePath: BEFORE,
      mark: "highlight",
      pagePath: null,
      ref: "e42",
    });
  });

  it("plans no aimed picture when there is no element to mark", () => {
    expect(plan({ ref: null })).toEqual({
      aimedPath: null,
      beforePath: BEFORE,
      mark: "highlight",
      pagePath: null,
      ref: null,
    });
  });

  it("plans a whole-page picture only when one was asked for", () => {
    expect(plan({ fullPage: true, ref: "e42" }).pagePath).toBe(PAGE);
  });

  it("carries the mark the caller chose", () => {
    expect(plan({ mark: "highlight-and-focus", ref: "e42" }).mark).toBe("highlight-and-focus");
  });
});

describe("the steps one aim shot becomes", () => {
  it("scrolls the target in, photographs the viewport, marks it, photographs it again, then tidies up", () => {
    expect(aimShotSteps({ plan: plan({ ref: "e42" }) })).toEqual([
      { args: ["eval", SCROLL_INTO_VIEW_SOURCE, "e42"], what: "scroll-into-view" },
      { args: ["screenshot", `--filename=${BEFORE}`], what: "before" },
      { args: ["highlight", "e42"], what: "highlight" },
      { args: ["screenshot", `--filename=${AIMED}`], what: "aimed" },
      { args: ["highlight", "--hide", "e42"], what: "hide" },
    ]);
  });

  it("puts the focus between the before picture and the highlight, so one picture holds both marks", () => {
    expect(aimShotSteps({ plan: plan({ mark: "highlight-and-focus", ref: "e42" }) })).toEqual([
      { args: ["eval", SCROLL_INTO_VIEW_SOURCE, "e42"], what: "scroll-into-view" },
      { args: ["screenshot", `--filename=${BEFORE}`], what: "before" },
      { args: ["eval", FOCUS_TARGET_SOURCE, "e42"], what: "focus" },
      { args: ["highlight", "e42"], what: "highlight" },
      { args: ["screenshot", `--filename=${AIMED}`], what: "aimed" },
      { args: ["highlight", "--hide", "e42"], what: "hide" },
    ]);
  });

  it("adds the whole-page picture before the hide when --full-page asked for one", () => {
    const steps = aimShotSteps({ plan: plan({ fullPage: true, ref: "e42" }) });
    expect(steps.map((step) => step.what)).toEqual([
      "scroll-into-view",
      "before",
      "highlight",
      "aimed",
      "page",
      "hide",
    ]);
    expect(steps[4]!.args).toEqual(["screenshot", "--full-page", `--filename=${PAGE}`]);
  });

  it("photographs the viewport and nothing else when there is no element to show", () => {
    expect(aimShotSteps({ plan: plan({ ref: null }) })).toEqual([
      { args: ["screenshot", `--filename=${BEFORE}`], what: "before" },
    ]);
  });

  it("takes no whole-page picture unless it was asked for, on either arm", () => {
    const asked = [...aimShotSteps({ plan: plan({ ref: "e42" }) }), ...aimShotSteps({ plan: plan({ ref: null }) })];
    expect(asked.filter((step) => step.args.includes("--full-page"))).toEqual([]);
  });

  it("puts the hide LAST, so the pictures exist before the overlay comes down", () => {
    const steps = aimShotSteps({ plan: plan({ fullPage: true, mark: "highlight-and-focus", ref: "e42" }) });
    expect(steps.at(-1)).toEqual({ args: ["highlight", "--hide", "e42"], what: "hide" });
  });

  it("puts every value in its own argv slot, so a path with a space cannot become two arguments", () => {
    const spaced = "/tmp/a folder/aim";
    const steps = aimShotSteps({ plan: plan({ ref: "e42", stem: spaced }) });
    expect(steps[1]!.args).toEqual(["screenshot", `--filename=${spaced}-before.png`]);
  });
});

describe("the two constant sources stay constants", () => {
  it("takes no interpolation, so no caller data can ever become part of either", () => {
    const holed = [SCROLL_INTO_VIEW_SOURCE, FOCUS_TARGET_SOURCE].filter((source) => source.includes("${"));
    expect(holed).toEqual([]);
  });

  it("scrolls instantly, so a page with smooth scrolling is not photographed mid-slide", () => {
    expect(SCROLL_INTO_VIEW_SOURCE).toContain('behavior: "instant"');
  });

  it("focuses without scrolling, so the aimed picture frames the same viewport the before one did", () => {
    expect(FOCUS_TARGET_SOURCE).toContain("preventScroll: true");
  });
});

describe("reading what the page said while the pictures were taken", () => {
  it("reads the whole position off a scroll reply", () => {
    const stdout = evalReply({
      value: { documentHeight: 10419, fromY: 0, inView: true, toY: 2611, viewportHeight: 900 },
    });
    expect(parseAimScroll({ stdout })).toEqual({
      documentHeight: 10419,
      fromY: 0,
      inView: true,
      toY: 2611,
      viewportHeight: 900,
    });
  });

  it("answers null rather than a made-up position when the reply carries no Result section", () => {
    expect(parseAimScroll({ stdout: "### Ran Playwright code\nnothing else\n" })).toBe(null);
  });

  it("answers null when a field is the wrong type, rather than coercing it", () => {
    const stdout = evalReply({
      value: { documentHeight: 10419, fromY: 0, inView: "yes", toY: 2611, viewportHeight: 900 },
    });
    expect(parseAimScroll({ stdout })).toBe(null);
  });

  it("reads a focus reply", () => {
    expect(parseAimFocus({ stdout: evalReply({ value: { focusable: true, focused: true } }) })).toEqual({
      focusable: true,
      focused: true,
    });
  });

  it("reads a focus reply that says the page would not take it", () => {
    expect(parseAimFocus({ stdout: evalReply({ value: { focusable: true, focused: false } }) })).toEqual({
      focusable: true,
      focused: false,
    });
  });

  it("answers null on an unreadable focus reply", () => {
    expect(parseAimFocus({ stdout: evalReply({ value: { focused: true } }) })).toBe(null);
  });
});

describe("what the lines say about the pictures", () => {
  it("leads with the before picture, which is the viewport as it stands", () => {
    const lines = aimShotLines({ result: shot({ ref: "e42" }) });
    expect(lines[0]).toBe(`  before: ${BEFORE} — the viewport with e42 scrolled into it, unmarked`);
  });

  it("follows with the aimed picture, which is the same viewport with the element marked", () => {
    const lines = aimShotLines({ result: shot({ ref: "e42" }) });
    expect(lines[1]).toBe(`  aimed: ${AIMED} — the same viewport, e42 highlighted`);
  });

  it("says where in the document that viewport is, which a viewport picture cannot say for itself", () => {
    const lines = aimShotLines({
      result: shot({
        ref: "e42",
        scroll: { documentHeight: 10419, fromY: 0, inView: true, toY: 2611, viewportHeight: 900 },
      }),
    });
    expect(lines[2]).toBe("  framed at: y 2611 of 10419, viewport 900 tall (was y 0)");
  });

  it("warns when the target did not wholly fit the viewport, rather than leaving the reader to spot it", () => {
    const lines = aimShotLines({
      result: shot({
        ref: "e42",
        scroll: { documentHeight: 10419, fromY: 0, inView: false, toY: 2611, viewportHeight: 200 },
      }),
    });
    expect(lines[3]).toBe(
      "  the target's box is still not wholly inside the viewport — read the picture before acting",
    );
  });

  it("says the focus took, when the page said it did", () => {
    const lines = aimShotLines({
      result: shot({ focus: { focusable: true, focused: true }, mark: "highlight-and-focus", ref: "e42" }),
    });
    expect(lines[1]).toBe(
      `  aimed: ${AIMED} — the same viewport, e42 highlighted and holding the cursor, as a human about to click it would leave it`,
    );
  });

  it("says the page gives the element no focus method rather than implying a ring that is not there", () => {
    const lines = aimShotLines({
      result: shot({ focus: { focusable: false, focused: false }, mark: "highlight-and-focus", ref: "e42" }),
    });
    expect(lines[1]).toContain("the page gives this element no focus method, so there is no focus ring to see");
  });

  it("says a focus that was asked for and not taken was not taken", () => {
    const lines = aimShotLines({
      result: shot({ focus: { focusable: true, focused: false }, mark: "highlight-and-focus", ref: "e42" }),
    });
    expect(lines[1]).toContain("focus was asked for and the page did not take it");
  });

  it("says an unreadable focus answer is unknown rather than reporting either outcome", () => {
    const lines = aimShotLines({ result: shot({ mark: "highlight-and-focus", ref: "e42" }) });
    expect(lines[1]).toContain("could not be read, so whether it holds the cursor is unknown");
  });

  it("names the whole-page picture when one was taken", () => {
    const lines = aimShotLines({ result: shot({ fullPage: true, ref: "e42" }) });
    expect(lines.at(-1)).toBe(`  whole page: ${PAGE} — every pixel of the scrollable page, because --full-page asked`);
  });

  it("says outright that nothing was marked when the kind names no element", () => {
    const lines = aimShotLines({ result: shot({ ref: null }) });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("this kind names no element, so nothing is marked");
  });

  it("never claims the aim was verified, confirmed or correct", () => {
    const lines = [
      ...aimShotLines({ result: shot({ ref: "e42" }) }),
      ...aimShotLines({
        result: shot({ focus: { focusable: true, focused: true }, mark: "highlight-and-focus", ref: "e42" }),
      }),
      ...aimShotLines({ result: shot({ ref: null }) }),
    ];
    const claiming = lines.filter((line) => /verified|confirmed|correct|the right element/u.test(line));
    expect(claiming).toEqual([]);
  });
});

describe("refusing an interaction whose pictures do not show its target", () => {
  const framed = { documentHeight: 10419, fromY: 0, inView: true, toY: 2611, viewportHeight: 900 };
  const unframed = { ...framed, inView: false };

  it("lets a shot through when the page said the target ended up wholly in the viewport", () => {
    expect(framingProblem({ result: shot({ ref: "e42", scroll: framed }) })).toBe(null);
  });

  it("refuses when the page said the target is not wholly in the viewport", () => {
    expect(framingProblem({ result: shot({ ref: "e42", scroll: unframed }) })).toBe("not-in-viewport");
  });

  it("refuses when the page never said where the target ended up", () => {
    expect(framingProblem({ result: shot({ ref: "e42", scroll: null }) })).toBe("framing-unreadable");
  });

  it("never refuses a kind that names no element, because there is nothing to frame", () => {
    expect(framingProblem({ result: shot({ ref: null, scroll: null }) })).toBe(null);
  });

  it("never refuses over a focus the page declined — the highlight is still on the picture", () => {
    const declined = shot({
      focus: { focusable: false, focused: false },
      mark: "highlight-and-focus",
      ref: "e42",
      scroll: framed,
    });
    expect(framingProblem({ result: declined })).toBe(null);
  });

  it("says where the page put the window, so the reader can judge rather than guess", () => {
    expect(framingRefusalDetail({ because: "not-in-viewport", ref: "e42", scroll: unframed })).toBe(
      "e42 was scrolled for and did not end up wholly inside the viewport — the page put the window at " +
        "y 2611 of 10419, 900 tall — so the picture taken to show what is about to be touched does not contain it",
    );
  });

  it("says nothing was established when the page did not answer at all", () => {
    expect(framingRefusalDetail({ because: "framing-unreadable", ref: "e42", scroll: null })).toContain(
      "did not say where e42 ended up",
    );
  });

  it("falls to the unreadable wording when a caller pairs not-in-viewport with no position", () => {
    expect(framingRefusalDetail({ because: "not-in-viewport", ref: "e42", scroll: null })).toContain(
      "did not say where e42 ended up",
    );
  });
});
