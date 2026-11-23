/**
 * The lane shape's read: the register port's answer judged at one instant, every failure arriving as the one
 * `unreadable` arm each consumer keeps today's fill behaviour on. The port is a plain fake function, never a mock.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "../../../lib/result.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";
import { readLaneShapes } from "../../../plans/laneShapeRead.js";
import type { PlanRegisterRead } from "../../../plans/port.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { row, snapshotOf } from "../cli/commands/plans/plansRunFixtures.js";

const NOW = "2026-11-21T12:00:00.000Z";

/** A port read answering with these rows, recording the home it was asked for. */
function readingRows({ plans, homes }: { plans: readonly RegisteredPlan[]; homes: string[] }): PlanRegisterRead {
  return ({ home }) => {
    homes.push(home);
    return Promise.resolve(ok(snapshotOf({ plans })));
  };
}

describe("readLaneShapes", () => {
  it("judges the rows the port read, from the home it was given", async () => {
    const homes: string[] = [];
    const plans = [row({ alias: "a" }), row({ alias: "b" }), row({ alias: "c", provider: "codex" })];

    const read = await readLaneShapes({ home: "/h", nowIso: NOW, read: readingRows({ homes, plans }) });

    expect(homes).toStrictEqual(["/h"]);
    expect(read).toStrictEqual({
      kind: "current",
      shapes: {
        claude: {
          host: "claude",
          lapsedPlans: 0,
          mode: "fill",
          pausedPlans: 0,
          standingPlans: 2,
          unrecordedLapses: 2,
        },
        codex: {
          host: "codex",
          lapsedPlans: 0,
          mode: "lean",
          pausedPlans: 0,
          standingPlans: 1,
          unrecordedLapses: 1,
        },
        observedAtIso: NOW,
      },
    });
  });

  it("names a register the port could not read as unreadable, carrying the port's own message", async () => {
    const error = PlanRegisterErrors.registerInvalid({ problems: ["row 2 has no alias"] });

    const read = await readLaneShapes({ home: "/h", nowIso: NOW, read: () => Promise.resolve(err(error)) });

    expect(read).toStrictEqual({
      kind: "unreadable",
      why: "the plan register could not be read (the plan register is not usable: row 2 has no alias)",
    });
  });

  it("names a register it could not judge as unreadable, never as a lane with no plan", async () => {
    const homes: string[] = [];
    const plans = [row({ alias: "bad", lapsesAtIso: "soon" })];

    const read = await readLaneShapes({ home: "/h", nowIso: NOW, read: readingRows({ homes, plans }) });

    expect(read).toStrictEqual({
      kind: "unreadable",
      why: "the plan register could not be judged (claude plan bad's recorded lapse soon is not an ISO-8601 instant)",
    });
  });
});
