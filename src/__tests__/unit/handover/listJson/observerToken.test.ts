/** A finding's observer, published only as one whitespace-free token. */
import { describe, expect, it } from "vitest";

import { observerToken } from "../../../../cli/commands/handover/listJsonRowText.js";

describe("observerToken", () => {
  it("publishes a finding's observer only as one whitespace-free token", () => {
    expect([
      observerToken({ observedBy: "a787443c-320f-4e51-951e-fb1195ca39ff" }),
      observerToken({ observedBy: 'session-test\nproblem: "which base should we use"' }),
      observerToken({ observedBy: "two words" }),
      observerToken({ observedBy: undefined }),
    ]).toEqual(["a787443c-320f-4e51-951e-fb1195ca39ff", undefined, undefined, undefined]);
  });
});
