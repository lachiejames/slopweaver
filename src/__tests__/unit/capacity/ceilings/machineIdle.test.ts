/*
 * The machine ceiling's idle half: idle headroom beside the load's, the larger of the two winning, idle unread
 * counting as zero, and a hold keeping the machine at zero however idle it reads.
 */
import { describe, expect, it } from "vitest";

import { buildCeilingsReading, type Ceiling, type MachineCeilingInput } from "../../../../capacity/ceilings.js";
import { machine, NOW, plans } from "../ceilingsFixtures.js";

describe("buildCeilingsReading", () => {
  describe("the machine ceiling's idle half", () => {
    const machineCeiling = ({ input }: { input: MachineCeilingInput }): Ceiling =>
      buildCeilingsReading({ machine: input, observedAtIso: NOW, plans: plans() }).ceilings.find(
        (ceiling) => ceiling.kind === "machine",
      )!;

    it("is open with headroom 0.5 for a load over its hold at 60% idle, un-held — idle clears what the load would zero", () => {
      const ceiling = machineCeiling({ input: machine({ idlePct: 60, load1: 46.5, loadHold: 45 }) });
      expect(ceiling.status).toBe("open");
      expect(ceiling.headroom).toBe(0.5);
    });

    it("takes the load's headroom when it is the larger of the two", () => {
      const ceiling = machineCeiling({ input: machine({ idlePct: 20, load1: 9, loadHold: 45 }) });
      expect(ceiling.headroom).toBe(0.8);
    });

    it("reaches full headroom at 100% idle, however much of its hold the load has used", () => {
      const ceiling = machineCeiling({ input: machine({ idlePct: 100, load1: 22.5, loadHold: 45 }) });
      expect(ceiling.headroom).toBe(1);
    });

    it("gives the idle term zero when idle is unread, leaving the load's headroom alone", () => {
      const ceiling = machineCeiling({ input: machine({ idlePct: null, load1: 22.5, loadHold: 45 }) });
      expect(ceiling.headroom).toBe(0.5);
    });

    it("is held at zero for a load over its hold under the 20% floor, which the report holds on cpu", () => {
      const ceiling = machineCeiling({
        input: machine({ hold: true, holdSubjects: ["cpu"], idlePct: 5, load1: 46.5, loadHold: 45 }),
      });
      expect([ceiling.status, ceiling.headroom]).toEqual(["held", 0]);
    });

    it("stays open above zero at the exact edge, load at its hold and idle at the floor, which the report clears", () => {
      const ceiling = machineCeiling({ input: machine({ idlePct: 20, load1: 45, loadHold: 45 }) });
      expect([ceiling.status, ceiling.headroom]).toEqual(["open", 0.0001]);
    });

    it("keeps a held machine at headroom 0 and held, however idle it reads", () => {
      const ceiling = machineCeiling({
        input: machine({ hold: true, holdSubjects: ["memory"], idlePct: 90, load1: 1, loadHold: 45 }),
      });
      expect(ceiling.status).toBe("held");
      expect(ceiling.headroom).toBe(0);
    });
  });
});
