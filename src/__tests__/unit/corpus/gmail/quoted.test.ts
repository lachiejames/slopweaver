import { describe, expect, it } from "vitest";

import { stripQuotedTail } from "../../../../corpus/gmail/quoted.js";

describe("stripQuotedTail", () => {
  it("keeps a body with no tail untouched and reports nothing dropped", () => {
    const result = stripQuotedTail({ body: "Two lines.\nNo quoting here." });
    expect(result.text).toBe("Two lines.\nNo quoting here.");
    expect(result.droppedChars).toBe(0);
  });

  it("cuts at the first quoted line", () => {
    const body = "Sounds good.\n\n> the original question\n> across two lines";
    const result = stripQuotedTail({ body });
    expect(result.text).toBe("Sounds good.");
    expect(result.droppedChars).toBe(body.length - "Sounds good.".length);
  });

  it("cuts at the attribution line above a quote, not at the quote", () => {
    const result = stripQuotedTail({
      body: "Agreed.\n\nOn Tue, 12 Aug 2026 at 09:14, Someone <x@y.test> wrote:\n> earlier text",
    });
    expect(result.text).toBe("Agreed.");
  });

  it("does not cut on a sentence that merely starts with On", () => {
    const result = stripQuotedTail({ body: "On reflection the plan holds.\nShipping today." });
    expect(result.text).toBe("On reflection the plan holds.\nShipping today.");
    expect(result.droppedChars).toBe(0);
  });

  it("cuts at the RFC 3676 signature delimiter", () => {
    const result = stripQuotedTail({ body: "Ship it.\n\n-- \nJane\nStaff Engineer\n+61 400 000 000" });
    expect(result.text).toBe("Ship it.");
  });

  it("cuts at an included original message", () => {
    const result = stripQuotedTail({ body: "FYI.\n\n-----Original Message-----\nFrom: someone" });
    expect(result.text).toBe("FYI.");
  });

  it("cuts at a forwarded-message banner", () => {
    const result = stripQuotedTail({ body: "Passing on.\n\n---------- Forwarded message ---------\nFrom: a" });
    expect(result.text).toBe("Passing on.");
  });

  it("cuts at an Outlook inline header block confirmed by a Sent line", () => {
    const result = stripQuotedTail({
      body: "Noted.\n\nFrom: Someone\nSent: Tuesday, 12 August 2026 09:14\nTo: Me\nSubject: Re: thing",
    });
    expect(result.text).toBe("Noted.");
  });

  it("leaves a From line alone when no Sent or Date line confirms it", () => {
    const body = "From: the design review we agreed the shape.\nThat still stands.";
    const result = stripQuotedTail({ body });
    expect(result.text).toBe(body);
    expect(result.droppedChars).toBe(0);
  });

  it("keeps an entirely quoted body whole rather than storing nothing", () => {
    const body = "> every line\n> is quoted";
    const result = stripQuotedTail({ body });
    expect(result.text).toBe(body);
    expect(result.droppedChars).toBe(0);
  });

  it("keeps an empty body empty", () => {
    const result = stripQuotedTail({ body: "" });
    expect(result.text).toBe("");
    expect(result.droppedChars).toBe(0);
  });
});
