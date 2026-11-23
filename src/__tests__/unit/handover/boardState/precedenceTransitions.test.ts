/*
 * `composeBoardModels` precedence across a finished run — the move to DONE once its probes land, and how a
 * `notDoneReason` weighs against landed probes before and after a run. It moved here when `boardState.test.ts` was
 * split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { compose, doc, journal, NOW, probe } from "./harness.js";

describe("composeBoardModels — precedence", () => {
  describe("the finished → merged transition needs no authored edit", () => {
    it("moves straight to DONE once probes land after a finished run, satisfying a dependant on the same read", () => {
      const finishedDisposition = journal({
        events: [
          { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
          { atIso: NOW, kind: "finished", residue: [] },
        ],
      });
      const prerequisite = doc({ slug: "a", status: "ready" });
      const dependant = doc({ blockedBy: ["a"], slug: "b", status: "ready" });

      const stillAwaiting = compose({
        journals: new Map([["a", finishedDisposition]]),
        probeStates: new Map([["/h/a.md", probe({ computed: "partial" })]]),
        roots: [prerequisite, dependant],
      });
      expect(stillAwaiting[0]?.section).toBe("AWAITING SHIP");
      expect(stillAwaiting[1]?.section).toBe("NOT YET");

      const nowLanded = compose({
        journals: new Map([["a", finishedDisposition]]),
        probeStates: new Map([["/h/a.md", probe({ computed: "landed" })]]),
        roots: [prerequisite, dependant],
      });
      expect(nowLanded[0]?.section).toBe("DONE");
      expect(nowLanded[1]?.section).toBe("RUN NOW");
    });
  });

  describe("notDoneReason precedence — both directions", () => {
    it("keeps a never-started multi-slice doc with landed slice-one probes and notDoneReason startable, not LOOKS SHIPPED", () => {
      const models = compose({
        probeStates: new Map([["/h/a.md", probe({ computed: "landed" })]]),
        roots: [doc({ notDoneReason: "only slice one is probed", slug: "a", status: "ready" })],
      });
      expect(models[0]?.section).toBe("RUN NOW");
      expect(models[0]?.satisfiesDependency).toBe(false);
    });

    it("confirms DONE for a finished run with landed probes even with a stale pre-run notDoneReason", () => {
      const models = compose({
        journals: new Map([
          [
            "a",
            journal({
              events: [
                { atIso: NOW, branch: "a", docHash: "h", kind: "started" },
                { atIso: NOW, kind: "finished", residue: [] },
              ],
            }),
          ],
        ]),
        probeStates: new Map([["/h/a.md", probe({ computed: "landed" })]]),
        roots: [doc({ notDoneReason: "stale — written before the run happened", slug: "a", status: "ready" })],
      });
      expect(models[0]?.section).toBe("DONE");
      expect(models[0]?.satisfiesDependency).toBe(true);
    });
  });
});
