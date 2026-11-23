import { describe, expect, it } from "vitest";

import { staleMarksPath } from "../../../../../cli/commands/desktop/e2eStaleMarks.js";

describe("staleMarksPath", () => {
  it("puts a step's staleness marks beside its photograph, under the same name", () => {
    expect([
      staleMarksPath({ shot: "/proof/run/01-queue.png" }),
      staleMarksPath({ shot: "/proof/run/02-card" }),
    ]).toEqual(["/proof/run/01-queue.stale-marks.json", "/proof/run/02-card.stale-marks.json"]);
  });
});
