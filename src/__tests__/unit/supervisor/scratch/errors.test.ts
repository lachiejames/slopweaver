/**
 * The scratch verbs' file failure names the path and what was thrown, including a thrown value that is not an
 * Error, which carries no message of its own.
 */
import { describe, expect, it } from "vitest";

import { ScratchErrors } from "../../../../supervisor/scratch/errors.js";

describe("ScratchErrors.fileFailed", () => {
  it("names the path and the thrown error's message", () => {
    expect(ScratchErrors.fileFailed({ cause: new Error("EACCES"), path: "/s/run.json" }).message).toBe(
      "/s/run.json: EACCES",
    );
  });

  it("says a thrown non-Error carried no message", () => {
    expect(ScratchErrors.fileFailed({ cause: 7, path: "/s/run.json" }).message).toBe(
      "/s/run.json: it threw a value that is not an Error",
    );
  });
});
