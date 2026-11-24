import { describe, expect, it } from "vitest";

import { e2eContextOf } from "../../../desktop/e2eContextFlag.js";
import { e2eContextQueuePath, e2eDrawnContextSelector, isE2eWorkContext } from "../../../desktop/e2eWorkContext.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("e2eContextOf", () => {
  it("reads either context, and leaves the instance as it opens when not asked", () => {
    expect([
      unwrap(e2eContextOf({ text: "work" })),
      unwrap(e2eContextOf({ text: "slopweaver" })),
      unwrap(e2eContextOf({ text: undefined })),
    ]).toEqual(["work", "slopweaver", undefined]);
  });

  it("refuses a context the console does not have, naming the two it has", () => {
    expect(unwrapErr(e2eContextOf({ text: "acme" }))).toEqual({
      code: "CONTEXT_UNKNOWN",
      message: '--context must be one of work, slopweaver, not "acme"',
      text: "acme",
    });
  });
});

describe("the context's address and drawn selector", () => {
  it("puts the Queue's address and the drawn attribute in the context asked for", () => {
    expect([
      e2eContextQueuePath({ context: "slopweaver" }),
      e2eDrawnContextSelector({ context: "work" }),
      isE2eWorkContext("work"),
      isE2eWorkContext("Work"),
    ]).toEqual(["/queue?context=slopweaver", '[data-context="work"]', true, false]);
  });
});
