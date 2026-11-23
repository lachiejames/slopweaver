import { describe, expect, it } from "vitest";

import {
  type AimRequest,
  actionNeedsFocusAssertion,
  aimProblems,
  describeFocusedElement,
  FOCUS_PROBE_SOURCE,
  focusVerdict,
  isSnapshotRef,
  parseFocusProbe,
} from "../../../browser/aim.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const aim = (over: Partial<AimRequest> = {}): AimRequest => ({
  expectFocus: undefined,
  kind: "click",
  target: undefined,
  value: undefined,
  ...over,
});

/** One `eval` reply, as the client renders it: the result section, then the sections that follow it. */
const reply = ({ body }: { body: string }): string =>
  ["### Result", body, "### Ran Playwright code", "```js", "await page.evaluate(...);", "```"].join("\n");

const SEARCH_FIELD = {
  id: "search",
  label: "Search",
  placeholder: null,
  role: null,
  tag: "input",
  text: null,
  type: "text",
};
const COMPOSER = {
  id: null,
  label: "Message to #dev-alerts",
  placeholder: null,
  role: "textbox",
  tag: "div",
  text: null,
  type: null,
};

describe("the ref grammar", () => {
  it("accepts a plain ref, as the client's own matcher does", () => {
    expect(isSnapshotRef({ value: "e42" })).toBe(true);
  });

  it("accepts a frame-qualified ref", () => {
    expect(isSnapshotRef({ value: "f1e11" })).toBe(true);
  });

  it("refuses a CSS selector", () => {
    expect(isSnapshotRef({ value: "input.search" })).toBe(false);
  });

  it("refuses a selector that merely starts like a ref", () => {
    expect(isSnapshotRef({ value: "e42 > input" })).toBe(false);
  });

  it("refuses a bare element name", () => {
    expect(isSnapshotRef({ value: "input" })).toBe(false);
  });

  it("refuses an empty string", () => {
    expect(isSnapshotRef({ value: "" })).toBe(false);
  });
});

describe("which interactions must say where the cursor is", () => {
  it("names type", () => {
    expect(actionNeedsFocusAssertion({ kind: "type" })).toBe(true);
  });

  it("names press", () => {
    expect(actionNeedsFocusAssertion({ kind: "press" })).toBe(true);
  });

  it("leaves scroll out, because a wheel acts on what is under the pointer", () => {
    expect(actionNeedsFocusAssertion({ kind: "scroll" })).toBe(false);
  });

  it("leaves fill out, because it names its own element", () => {
    expect(actionNeedsFocusAssertion({ kind: "fill" })).toBe(false);
  });
});

describe("refusing a raw selector", () => {
  it("passes a click aimed by ref", () => {
    expect(unwrap(aimProblems({ allowSelector: false, request: aim({ target: "e42" }) }))).toBe(null);
  });

  it("refuses a click aimed by selector, naming the flag", () => {
    const failure = unwrapErr(aimProblems({ allowSelector: false, request: aim({ target: "#msg-composer" }) }));
    expect(failure.code).toBe("TARGET_NOT_A_REF");
  });

  it("carries the selector it refused, so a reader is not guessing", () => {
    const failure = unwrapErr(aimProblems({ allowSelector: false, request: aim({ target: "#msg-composer" }) }));
    expect(failure.message).toContain("#msg-composer");
  });

  it("names the escape hatch, as every policy refusal must", () => {
    const failure = unwrapErr(aimProblems({ allowSelector: false, request: aim({ target: "#msg-composer" }) }));
    expect(failure.message).toContain("SLOPWEAVER_ALLOW_BROWSER_RAW_SELECTOR=1");
  });

  it("checks a drag's drop element too, which rides --value", () => {
    const failure = unwrapErr(
      aimProblems({ allowSelector: false, request: aim({ kind: "drag", target: "e1", value: ".dropzone" }) }),
    );
    expect(failure.code).toBe("TARGET_NOT_A_REF");
  });

  it("leaves --value alone on everything else, where it is text rather than an element", () => {
    expect(
      unwrap(aimProblems({ allowSelector: false, request: aim({ kind: "fill", target: "e1", value: "hello there" }) })),
    ).toBe(null);
  });

  it("checks --expect-focus, which has to name an exact element or promise nothing", () => {
    const failure = unwrapErr(
      aimProblems({ allowSelector: false, request: aim({ expectFocus: "input[name=q]", kind: "type" }) }),
    );
    expect(failure.flag).toBe("--expect-focus");
  });

  it("lets a selector through once the hatch is open", () => {
    expect(unwrap(aimProblems({ allowSelector: true, request: aim({ target: "#msg-composer" }) }))).toBe(null);
  });
});

describe("reading the page's answer about the cursor", () => {
  it("reads a match", () => {
    const probe = unwrap(
      parseFocusProbe({
        kind: "type",
        stdout: reply({ body: JSON.stringify({ active: SEARCH_FIELD, expected: SEARCH_FIELD, matches: true }) }),
      }),
    );
    expect(probe.matches).toBe(true);
  });

  it("reads which element actually holds it when they differ", () => {
    const probe = unwrap(
      parseFocusProbe({
        kind: "type",
        stdout: reply({ body: JSON.stringify({ active: COMPOSER, expected: SEARCH_FIELD, matches: false }) }),
      }),
    );
    expect(probe.active!.label).toBe("Message to #dev-alerts");
  });

  it("reads a pretty-printed result, which is the shape the client actually writes", () => {
    const probe = unwrap(
      parseFocusProbe({
        kind: "type",
        stdout: reply({ body: JSON.stringify({ active: null, expected: SEARCH_FIELD, matches: false }, null, 2) }),
      }),
    );
    expect(probe.active).toBe(null);
  });

  it("refuses a reply with no result section at all", () => {
    const failure = unwrapErr(parseFocusProbe({ kind: "type", stdout: "### Page\n- Page URL: https://app.slack.com" }));
    expect(failure.code).toBe("FOCUS_NOT_ASSERTED");
  });

  it("refuses a result section that is not JSON", () => {
    const failure = unwrapErr(parseFocusProbe({ kind: "type", stdout: reply({ body: "undefined" }) }));
    expect(failure.code).toBe("FOCUS_NOT_ASSERTED");
  });

  it("refuses a result that carries no verdict, rather than reading one in", () => {
    const failure = unwrapErr(
      parseFocusProbe({ kind: "type", stdout: reply({ body: JSON.stringify({ active: null }) }) }),
    );
    expect(failure.because).toBe("probe-unreadable");
  });
});

describe("the keystroke verdict", () => {
  it("lets a keystroke out when the cursor is in the element it named", () => {
    expect(
      unwrap(
        focusVerdict({
          allowBlind: false,
          expectFocus: "e42",
          kind: "type",
          probe: { active: SEARCH_FIELD, expected: SEARCH_FIELD, matches: true },
        }),
      ),
    ).toBe(null);
  });

  it("refuses one that named no element", () => {
    const failure = unwrapErr(focusVerdict({ allowBlind: false, expectFocus: undefined, kind: "type", probe: null }));
    expect(failure.because).toBe("no-expect-focus");
  });

  it("refuses a press that named no element, so Enter cannot post by accident", () => {
    const failure = unwrapErr(focusVerdict({ allowBlind: false, expectFocus: undefined, kind: "press", probe: null }));
    expect(failure.because).toBe("no-expect-focus");
  });

  it("refuses when the cursor is somewhere else — the stale-cursor mechanism", () => {
    const failure = unwrapErr(
      focusVerdict({
        allowBlind: false,
        expectFocus: "e42",
        kind: "type",
        probe: { active: COMPOSER, expected: SEARCH_FIELD, matches: false },
      }),
    );
    expect(failure.because).toBe("focus-elsewhere");
  });

  it("names what actually holds the cursor, so the correction is obvious", () => {
    const failure = unwrapErr(
      focusVerdict({
        allowBlind: false,
        expectFocus: "e42",
        kind: "type",
        probe: { active: COMPOSER, expected: SEARCH_FIELD, matches: false },
      }),
    );
    expect(failure.focused).toContain('aria-label="Message to #dev-alerts"');
  });

  it("refuses when no probe was taken, rather than assuming the claim", () => {
    const failure = unwrapErr(focusVerdict({ allowBlind: false, expectFocus: "e42", kind: "type", probe: null }));
    expect(failure.because).toBe("probe-unreadable");
  });

  it("names the escape hatch on the refusal", () => {
    const failure = unwrapErr(focusVerdict({ allowBlind: false, expectFocus: undefined, kind: "type", probe: null }));
    expect(failure.message).toContain("SLOPWEAVER_ALLOW_BLIND_KEYSTROKE=1");
  });

  it("leaves a click alone, which names the element it acts on", () => {
    expect(unwrap(focusVerdict({ allowBlind: false, expectFocus: undefined, kind: "click", probe: null }))).toBe(null);
  });

  it("lets a blind keystroke out once the hatch is open, for a page-level Escape", () => {
    expect(unwrap(focusVerdict({ allowBlind: true, expectFocus: undefined, kind: "press", probe: null }))).toBe(null);
  });
});

describe("describing what holds the cursor", () => {
  it("says so plainly when nothing does", () => {
    expect(describeFocusedElement({ element: null })).toBe("nothing at all (no element holds the cursor)");
  });

  it("builds a phrase a reader recognises out of what the page gave it", () => {
    expect(describeFocusedElement({ element: SEARCH_FIELD })).toBe('<input> type=text aria-label="Search" #search');
  });

  it("says so when the page described the element with nothing at all", () => {
    expect(
      describeFocusedElement({
        element: { id: null, label: null, placeholder: null, role: null, tag: null, text: null, type: null },
      }),
    ).toBe("an element the page describes with nothing at all");
  });
});

describe("the probe function itself", () => {
  it("asks about the element the client resolves, never about a selector spliced into source", () => {
    expect(FOCUS_PROBE_SOURCE.startsWith("(expected) =>")).toBe(true);
  });

  it("walks open shadow roots, so a component field is not reported unfocused", () => {
    expect(FOCUS_PROBE_SOURCE).toContain("shadowRoot.activeElement");
  });

  it("truncates every string it returns, so a page cannot make the reply data-sized", () => {
    expect(FOCUS_PROBE_SOURCE).toContain("slice(0, 120)");
  });
});
