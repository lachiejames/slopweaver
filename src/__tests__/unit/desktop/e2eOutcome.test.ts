import { describe, expect, it } from "vitest";

import { type E2eObserved, judgeStep } from "../../../desktop/e2eOutcome.js";

const CLEAN: E2eObserved = {
  blocked: undefined,
  consoleErrors: [],
  errorOverlay: false,
  landed: true,
  notApplicable: undefined,
  pageErrors: [],
  serverErrors: [],
  stillLoading: [],
};

/** Two marks a page still drew at the cap, as the walk names them. */
const LOADING_MARKS = ['section [aria-busy="true"] in "Agents"', 'div .animate-pulse in "Your steers"'];

const EMPTY_QUEUE = "the Queue was empty: every register read and none holds a card, so there was no card to open";

/** A card step on a proven-empty Queue: it acted on nothing, so it never landed on a dialog. */
const NOT_APPLICABLE: E2eObserved = { ...CLEAN, landed: false, notApplicable: EMPTY_QUEUE };

describe("judgeStep", () => {
  it("passes a step that landed, settled and logged nothing", () => {
    expect(judgeStep({ landmark: "the heading", observed: CLEAN })).toEqual({ passed: true });
  });

  it("puts a page error ahead of a console error and a slow page", () => {
    const observed = {
      ...CLEAN,
      consoleErrors: ["/queue: x"],
      pageErrors: ["/queue: boom"],
      stillLoading: LOADING_MARKS,
    };
    expect(judgeStep({ landmark: "the heading", observed })).toEqual({
      detail: "/queue: boom",
      kind: "page-error",
      passed: false,
    });
  });

  it("names the first 5xx read", () => {
    const observed = { ...CLEAN, serverErrors: ["502 http://localhost:3000/api/a", "500 http://localhost:3000/api/b"] };
    expect(judgeStep({ landmark: "the heading", observed })).toEqual({
      detail: "502 http://localhost:3000/api/a",
      kind: "http-5xx",
      passed: false,
    });
  });

  it("fails Next's error overlay even when the landmark showed", () => {
    expect(judgeStep({ landmark: "the heading", observed: { ...CLEAN, errorOverlay: true } }).passed).toBe(false);
  });

  it("names the landmark that never appeared", () => {
    expect(judgeStep({ landmark: "the settings dialog", observed: { ...CLEAN, landed: false } })).toEqual({
      detail: "the settings dialog never appeared",
      kind: "missing-landmark",
      passed: false,
    });
  });

  it("fails a page still loading at the cap last, naming every mark it still drew", () => {
    expect(judgeStep({ landmark: "the heading", observed: { ...CLEAN, stillLoading: LOADING_MARKS } })).toEqual({
      detail:
        'still said it was loading at the cap: section [aria-busy="true"] in "Agents"; div .animate-pulse in "Your steers"',
      kind: "still-loading",
      passed: false,
    });
  });

  it("puts a blocked step ahead of everything it then saw", () => {
    const observed = { ...CLEAN, blocked: "the Queue showed no card to open", pageErrors: ["boom"] };
    expect(judgeStep({ landmark: "the card", observed })).toEqual({
      detail: "the Queue showed no card to open",
      kind: "blocked",
      passed: false,
    });
  });
});

describe("judgeStep — a step with nothing to act on", () => {
  it("calls a card step on a proven-empty Queue not applicable with its reason, never passed", () => {
    expect(judgeStep({ landmark: "the opened card's dialog", observed: NOT_APPLICABLE })).toEqual({
      detail: EMPTY_QUEUE,
      kind: "not-applicable",
      passed: false,
    });
  });

  it("never fails a not-applicable step for the dialog it did not open, nor for a page still loading", () => {
    const observed = { ...NOT_APPLICABLE, stillLoading: LOADING_MARKS };
    expect(judgeStep({ landmark: "the opened card's dialog", observed })).toEqual({
      detail: EMPTY_QUEUE,
      kind: "not-applicable",
      passed: false,
    });
  });

  it("puts a block ahead of not applicable", () => {
    const observed = { ...NOT_APPLICABLE, blocked: "the Queue showed no card to open" };
    expect(judgeStep({ landmark: "the card", observed })).toEqual({
      detail: "the Queue showed no card to open",
      kind: "blocked",
      passed: false,
    });
  });

  it("still fails every error seen while it looked, ahead of not applicable", () => {
    const kinds = [
      { ...NOT_APPLICABLE, pageErrors: ["/queue: boom"] },
      { ...NOT_APPLICABLE, consoleErrors: ["/queue: x"] },
      { ...NOT_APPLICABLE, serverErrors: ["500 http://localhost:3000/api/a"] },
      { ...NOT_APPLICABLE, errorOverlay: true },
    ].map((observed) => judgeStep({ landmark: "the card", observed }));
    expect(kinds).toEqual([
      { detail: "/queue: boom", kind: "page-error", passed: false },
      { detail: "/queue: x", kind: "console-error", passed: false },
      { detail: "500 http://localhost:3000/api/a", kind: "http-5xx", passed: false },
      { detail: "Next's error overlay is over the page", kind: "next-error-overlay", passed: false },
    ]);
  });
});
