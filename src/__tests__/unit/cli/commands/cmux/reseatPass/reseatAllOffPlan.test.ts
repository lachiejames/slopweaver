/** `cmux reseat --all` over a fake client: a seat booted off every plan is relaunched whatever its screen shows. */
import { describe, expect, it } from "vitest";

import { reseatAll } from "../../../../../../cli/commands/cmux/reseatPass.js";
import { CHAIR_ID, OFF_PLAN, SEAT_ID, workspace } from "./fixtures.js";
import { world } from "./harness.js";

describe("reseatAll on a seat booted off every plan", () => {
  it("relaunches a seat whose screen looks idle when its session booted on no configured plan", async () => {
    const journal: string[] = [];
    const { client, deps } = world({
      boots: new Map([[CHAIR_ID, { kind: "off-plan", why: OFF_PLAN }]]),
      journal,
      screens: new Map([
        ["ws-seat", "> "],
        ["ws-chair", "> "],
      ]),
    });

    const outcomes = await reseatAll({
      deps: { ...deps, client },
      workspaces: [workspace({ id: "ws-seat", ref: "workspace:4" }), workspace({ id: "ws-chair", ref: "workspace:1" })],
    });

    // The chair's boot is read twice: once by the scan, and again under its reseat lock before its wall can plan.
    expect(journal.map((entry) => entry.split(":")[0])).toEqual([
      `boot ${SEAT_ID}`,
      `boot ${CHAIR_ID}`,
      `boot ${CHAIR_ID}`,
      "route ws-chair",
      "stop 75277",
      "send ws-chair",
    ]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["reseated"]);
  });
});
