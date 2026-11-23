/**
 * The tick's BOOTS REFUSED backstop: the register subject on this tick's `claude-plan-unusable` pass leads the
 * chair's decisions, a register that reads says nothing, and a reading that cannot say is UNKNOWN, never silence.
 */
import { describe, expect, it } from "vitest";

import { bootsRefusedLines } from "../../../supervisor/digestBootsRefused.js";
import type { DigestReading } from "../../../supervisor/tickDigest.js";

const QUIET = {
  openPagesAgeMinutes: 10,
  priorHolds: { kind: "none" },
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: 5,
} as const;

/** The digest's lines over one `claude-plans` reading. */
function linesFor({ reading }: { reading: DigestReading | undefined }): readonly string[] {
  const readings = new Map<string, DigestReading>(reading === undefined ? [] : [["claude-plans", reading]]);
  return bootsRefusedLines({ inputs: { ...QUIET, readings } });
}

/** A `monitor check --json` document over these subjects. */
function passOver({ subjects }: { subjects: readonly unknown[] }): DigestReading {
  return {
    kind: "json",
    value: { actions: [], readings: [{ monitorId: "claude-plan-unusable", state: "firing", subjects }] },
  };
}

describe("bootsRefusedLines", () => {
  it("leads with BOOTS REFUSED when the register subject is on the pass", () => {
    const lines = linesFor({
      reading: passOver({
        subjects: [
          {
            claudeRegisterFault: "REGISTER_STORE_UNAVAILABLE",
            id: "plans register",
            key: "register-0123456789abcdef",
            label: "the store holding the plans register cannot be opened",
          },
        ],
      }),
    });

    expect(lines).toEqual([
      "BOOTS REFUSED — every new Claude seat refuses to boot: the store holding the plans register cannot be opened " +
        "(REGISTER_STORE_UNAVAILABLE, card key register-0123456789abcdef). Say in one line that no new sessions can " +
        "launch right now, then follow skills/supervisor/reference/boots-refused.md: seat ONE investigator under the " +
        "hatch only when the store is refused as stale, and never a blind `store push`.",
    ]);
  });

  it("says nothing when only a plan's own card fires", () => {
    expect(
      linesFor({ reading: passOver({ subjects: [{ id: "plan-two", key: "plan-two", label: "signed out" }] }) }),
    ).toEqual([]);
  });

  it("is UNKNOWN when the reading was not captured or carries no monitor reading", () => {
    expect(linesFor({ reading: undefined })).toEqual(["boots refused: UNKNOWN — claude-plans: not captured this tick"]);
    expect(linesFor({ reading: { kind: "json", value: { actions: [], readings: [] } } })).toEqual([
      "boots refused: UNKNOWN — the claude-plans pass returned no claude-plan-unusable reading",
    ]);
  });
});
