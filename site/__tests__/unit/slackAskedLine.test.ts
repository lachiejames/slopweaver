/*
 * The Pull requests page's `slack` line carries the verb's reason in brackets, and drops it when the verb gave none.
 */
import { describe, expect, it } from "vitest";

import { slackAskedLine } from "../../lib/slackAskedLine";

describe("slackAskedLine", () => {
  it("carries the reason in brackets, verbatim, when the verb gave one", () => {
    expect(slackAskedLine({ asked: "yes", why: "asked in #dev-review" })).toBe("asked: yes (asked in #dev-review)");
    expect(slackAskedLine({ asked: "yes", why: " asked " })).toBe("asked: yes ( asked )");
  });

  it("stops at the answer when the reason is absent", () => {
    expect(slackAskedLine({ asked: "unknown", why: undefined })).toBe("asked: unknown");
  });

  it("stops at the answer when a bounded read reported an empty or blank reason", () => {
    expect(slackAskedLine({ asked: "no", why: "" })).toBe("asked: no");
    expect(slackAskedLine({ asked: "no", why: "  " })).toBe("asked: no");
  });
});
