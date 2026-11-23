import { describe, expect, it } from "vitest";

import { legStop } from "../../../../../cli/commands/desktop/e2eCallLegPlan.js";

// The read after a scenario runs whatever its cleanup did, so a failed cleanup never hides a
// call of the owner's that overlapped it, and only a cleanup that failed keeps the lock.
describe("legStop", () => {
  it("says both a failed cleanup and an overlap, and keeps the lock", () => {
    expect(legStop({ fatal: "cleanup failed", overlap: "1 call(s) overlapped" })).toEqual({
      message: "cleanup failed; and 1 call(s) overlapped",
      release: false,
    });
  });

  it("keeps the lock on a failed cleanup alone", () => {
    expect(legStop({ fatal: "cleanup failed", overlap: undefined })).toEqual({
      message: "cleanup failed",
      release: false,
    });
  });

  it("frees the lock on an overlap alone", () => {
    expect(legStop({ fatal: undefined, overlap: "1 call(s) overlapped" })).toEqual({
      message: "1 call(s) overlapped",
      release: true,
    });
  });

  it("runs the next scenario when neither stopped it", () => {
    expect(legStop({ fatal: undefined, overlap: undefined })).toBeUndefined();
  });
});
