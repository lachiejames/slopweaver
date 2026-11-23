/**
 * The machine's load-slot admission, as every heavy verb reaches it.
 *
 * The mechanism itself is covered in `lib/loadSlots.test.ts`; what is asserted here is the CLI-level
 * contract on top of it — an admitted caller is told nothing, a refused one gets every refusal line and
 * the error exit rather than a partial answer.
 */
import { describe, expect, it } from "vitest";
import { admitLoadSlot, loadSlotRefusal } from "../../../cli/admitLoadSlot.js";
import { EXIT_ERROR } from "../../../cli/exitCodes.js";
import { admittingSlotGuard, refusingSlotGuard } from "../../loadSlotFixture.js";

describe("admitLoadSlot", () => {
  it("admits silently when the machine has a slot free", () => {
    const errs: string[] = [];
    const verdict = admitLoadSlot({
      guard: admittingSlotGuard,
      logger: { error: ({ msg }) => errs.push(msg) },
    });
    expect(verdict).toEqual({ admitted: true });
    expect(errs).toEqual([]);
  });

  it("prints every refusal line and returns the error exit when the machine is full", () => {
    const errs: string[] = [];
    const verdict = admitLoadSlot({
      guard: refusingSlotGuard({ pid: 4242 }),
      logger: { error: ({ msg }) => errs.push(msg) },
    });
    expect(verdict).toEqual({ code: EXIT_ERROR });
    expect(errs).toHaveLength(4);
    expect(errs[0]).toContain("pid 4242");
    expect(errs[1]).toContain("retry");
  });
});

describe("loadSlotRefusal", () => {
  it("is undefined once this process holds a slot", () => {
    expect(loadSlotRefusal({ guard: admittingSlotGuard })).toBeUndefined();
  });

  it("returns the same lines admitLoadSlot prints, for a caller that renders rather than logs", () => {
    const errs: string[] = [];
    admitLoadSlot({ guard: refusingSlotGuard({ pid: 77 }), logger: { error: ({ msg }) => errs.push(msg) } });
    expect(loadSlotRefusal({ guard: refusingSlotGuard({ pid: 77 }) })).toEqual(errs);
  });
});
