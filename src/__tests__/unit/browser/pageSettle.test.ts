import { describe, expect, it } from "vitest";

import {
  PAGE_PULSE_INTERVAL_MS,
  PAGE_PULSE_SOURCE,
  PAGE_SETTLE_BUDGET_MS,
  type PagePulse,
  parsePagePulse,
  pulsesAgree,
} from "../../../browser/pageSettle.js";

const pulse = (over: Partial<PagePulse> = {}): PagePulse => ({
  elementCount: 1840,
  ready: "complete",
  textLength: 6231,
  title: "APM Home | Datadog",
  ...over,
});

const evalReply = ({ value }: { value: unknown }): string =>
  `### Ran Playwright code\n### Result\n${JSON.stringify(value, null, 2)}\n`;

describe("asking a page whether it has finished drawing", () => {
  it("takes no element, so the client evaluates it against the page itself", () => {
    expect(PAGE_PULSE_SOURCE.startsWith("() =>")).toBe(true);
  });

  it("carries no interpolation, so no caller data can become part of it", () => {
    expect(PAGE_PULSE_SOURCE.includes("${")).toBe(false);
  });

  it("reads all four fields off a reply", () => {
    const stdout = evalReply({
      value: { elementCount: 1840, ready: "complete", textLength: 6231, title: "APM Home | Datadog" },
    });
    expect(parsePagePulse({ stdout })).toEqual({
      elementCount: 1840,
      ready: "complete",
      textLength: 6231,
      title: "APM Home | Datadog",
    });
  });

  it("reads a page that has not drawn yet, rather than treating it as unreadable", () => {
    const stdout = evalReply({ value: { elementCount: 12, ready: "loading", textLength: 0, title: "" } });
    expect(parsePagePulse({ stdout })).toEqual({ elementCount: 12, ready: "loading", textLength: 0, title: "" });
  });

  it("answers null when the reply carries no Result section", () => {
    expect(parsePagePulse({ stdout: "### Ran Playwright code\n" })).toBe(null);
  });

  it("answers null when a count is a string, rather than coercing it", () => {
    const stdout = evalReply({ value: { elementCount: "1840", ready: "complete", textLength: 1, title: "x" } });
    expect(parsePagePulse({ stdout })).toBe(null);
  });

  it("answers null when a field is missing", () => {
    expect(parsePagePulse({ stdout: evalReply({ value: { ready: "complete", title: "x" } }) })).toBe(null);
  });
});

describe("when two readings say the page may be photographed", () => {
  it("settles when the document is complete, titled, and its element count held still", () => {
    expect(pulsesAgree({ earlier: pulse(), later: pulse() })).toBe(true);
  });

  it("does not settle while the document is still loading", () => {
    expect(pulsesAgree({ earlier: pulse({ ready: "loading" }), later: pulse({ ready: "loading" }) })).toBe(false);
  });

  it("does not settle on the blank single-page application this exists for — complete, but untitled", () => {
    const blank = pulse({ elementCount: 12, textLength: 0, title: "" });
    expect(pulsesAgree({ earlier: blank, later: blank })).toBe(false);
  });

  it("does not settle while the element count is still moving", () => {
    expect(pulsesAgree({ earlier: pulse({ elementCount: 900 }), later: pulse({ elementCount: 1840 }) })).toBe(false);
  });

  it("settles even though the TEXT changed, so a live timestamp cannot hold a page open forever", () => {
    expect(pulsesAgree({ earlier: pulse({ textLength: 6231 }), later: pulse({ textLength: 6244 }) })).toBe(true);
  });

  it("judges readiness and the title on the LATER reading, which is the page as it is now", () => {
    expect(pulsesAgree({ earlier: pulse({ ready: "loading", title: "" }), later: pulse() })).toBe(true);
  });
});

describe("the budget", () => {
  it("is bounded well under the client's own command timeout, so a page that never settles costs a pause", () => {
    expect(PAGE_SETTLE_BUDGET_MS).toBe(6000);
    expect(PAGE_SETTLE_BUDGET_MS).toBeLessThan(60_000);
  });

  it("asks often enough that a page settling early is not waited on for the whole budget", () => {
    expect(PAGE_PULSE_INTERVAL_MS).toBe(250);
    expect(PAGE_SETTLE_BUDGET_MS / PAGE_PULSE_INTERVAL_MS).toBeGreaterThan(4);
  });
});
