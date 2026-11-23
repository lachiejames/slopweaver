/**
 * `plans set-thresholds`' argv reader and `plans list`'s thresholds block — both pure. The reader refuses every
 * command-line mistake at once; the block marks each field `(set)` or `(default)` off the raw document.
 */
import { describe, expect, it } from "vitest";

import { thresholdChange, thresholdFlagFor } from "../../../../../cli/commands/plans/thresholdArgs.js";
import { thresholdListLines } from "../../../../../cli/commands/plans/thresholdLines.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { snapshotOf } from "./plansRunFixtures.js";

describe("thresholdFlagFor", () => {
  it("names each field by its kebab-case flag, per provider", () => {
    expect(thresholdFlagFor({ field: "routeAtPercent", provider: "claude" })).toBe("route-at-percent");
    expect(thresholdFlagFor({ field: "pauseAtPercent", provider: "codex" })).toBe("pause-at-percent");
  });
});

describe("thresholdChange", () => {
  it("reads a set and a repeated reset for one provider", () => {
    const change = thresholdChange({
      provider: "claude",
      rest: ["--reset", "alert-at-percent", "--reset", "drifting-spread-percent"],
      values: { "route-at-percent": "90" },
    });
    expect(unwrap(change)).toStrictEqual({
      provider: "claude",
      reset: ["alertAtPercent", "driftingSpreadPercent"],
      set: { routeAtPercent: 90 },
    });
  });

  it("refuses every command-line mistake at once, naming each", () => {
    const error = unwrapErr(
      thresholdChange({
        provider: "codex",
        rest: ["--reset", "pause-at-percent", "--reset", "route-at-percent"],
        values: { "alert-at-percent": "7.5", "pause-at-percent": "90", "route-at-percent": "90" },
      }),
    );
    expect(error.code).toBe("PLANS_THRESHOLDS_UNREADABLE");
    expect(error.problems).toStrictEqual([
      "--route-at-percent is not a codex threshold",
      "--alert-at-percent must be a whole number; got 7.5",
      "--pause-at-percent is both set and reset",
      "--reset route-at-percent names no codex threshold — one of alert-at-percent, pause-at-percent",
    ]);
  });

  it("refuses a command line that changes nothing", () => {
    const error = unwrapErr(thresholdChange({ provider: "claude", rest: [], values: {} }));
    expect(error.problems).toStrictEqual(["set at least one threshold, or --reset one"]);
  });
});

describe("thresholdListLines", () => {
  it("prints every field at its default when the register names none, minutes for the lead time", () => {
    expect(thresholdListLines({ providers: ["codex"], snapshot: snapshotOf({ plans: [] }) })).toStrictEqual([
      "codex thresholds:",
      "  alert-at-percent  75% (default)",
      "  pause-at-percent  99% (default)",
    ]);
  });

  it("marks a field the register names as set, and pads every flag to the longest", () => {
    const base = snapshotOf({ plans: [] });
    const snapshot = {
      ...base,
      document: { ...base.document, thresholds: { claude: { routeAtPercent: 90, spendOutBeforeResetMinutes: 120 } } },
    };
    expect(thresholdListLines({ providers: ["claude"], snapshot })).toStrictEqual([
      "claude thresholds:",
      "  alert-at-percent                75% (default)",
      "  acceptance-at-percent           90% (default)",
      "  route-at-percent                90% (set)",
      "  spend-out-at-percent            100% (default)",
      "  spend-out-before-reset-minutes  120 min (set)",
      "  balanced-spread-percent         10% (default)",
      "  drifting-spread-percent         15% (default)",
    ]);
  });
});
