/**
 * `plans list`'s lane lines, driven through the real run function over injected seams: the lanes are judged from
 * the whole register whatever `--provider` narrows the table to, and a lapse that cannot be judged is named rather
 * than printed as a lane. The table itself is `./run.test.ts`'s; the judging is `plans/laneShape.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { runPlansVerb } from "../../../../../cli/commands/plans/run.js";
import { fresh, recordingDeps, row, snapshotOf } from "./plansRunFixtures.js";

describe("plans list — the lane lines", () => {
  it("judges the lanes from the whole register, and prints only the lane --provider asked for", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({
        read: snapshotOf({
          plans: [
            row(),
            row({ alias: "plan-two", storeDir: "/s/two" }),
            row({ alias: "codex-ambient", provider: "codex", storeDir: "/x/ambient" }),
          ],
        }),
        recording,
      }),
      rest: ["--provider", "claude"],
      verb: "list",
    });
    expect(recording.out.slice(-1)).toStrictEqual(["claude lane: fill — 2 standing (2 with no recorded lapse)"]);
  });

  it("names a lapse it cannot judge rather than printing a lane", async () => {
    const recording = fresh();
    await runPlansVerb({
      deps: recordingDeps({ read: snapshotOf({ plans: [row({ lapsesAtIso: "soon" })] }), recording }),
      rest: [],
      verb: "list",
    });
    expect(recording.out.slice(-1)).toStrictEqual([
      "plans lanes: not judged — the plan register could not be judged (claude plan plan-one's recorded lapse soon is not an ISO-8601 instant)",
    ]);
  });
});
