/** The `listen` verb module exports the run function the manifest loads. */
import { describe, expect, it } from "vitest";

import { listenCommand, runListen } from "../../../../../../cli/commands/listen/run.js";

describe("the listen verb module", () => {
  it("exports exactly the run function the manifest loads", () => {
    expect(listenCommand).toBe(runListen);
  });
});
