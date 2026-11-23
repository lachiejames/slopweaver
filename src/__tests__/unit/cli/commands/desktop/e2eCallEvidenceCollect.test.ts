import { describe, expect, it } from "vitest";

import { err, ok } from "#lib/result.js";
import { firstUnread } from "../../../../../cli/commands/desktop/e2eCallEvidenceCollect.js";

describe("firstUnread", () => {
  it("names the first failed read in the order given, past a later one", () => {
    expect(
      firstUnread({
        reads: [ok([]), err({ message: "logs unreadable" }), ok("x"), err({ message: "store unreadable" })],
      }),
    ).toBe("logs unreadable");
  });

  it("is undefined when every read succeeded, or there were none", () => {
    expect([firstUnread({ reads: [ok([]), ok(1)] }), firstUnread({ reads: [] })]).toEqual([undefined, undefined]);
  });
});
