/**
 * The register's `thresholds` decoder: absence decodes to the defaults, a present value is held strictly, and the
 * orderings the gates rely on refuse the whole register.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { parsePlanRegister } from "../../../plans/register.js";
import {
  claudeThresholdFieldsOf,
  DEFAULT_THRESHOLD_FIELDS,
  DEFAULT_THRESHOLDS,
  decodePlanThresholds,
  thresholdFieldsSet,
  thresholdProblems,
} from "../../../plans/thresholds.js";

describe("decodePlanThresholds", () => {
  it("decodes a register naming no thresholds to the defaults the gates were fixed at", () => {
    const decoded = decodePlanThresholds({ document: { rows: [], version: 1 } });
    expect(decoded).toStrictEqual(DEFAULT_THRESHOLDS);
    expect(decoded.claude.routeAt).toBe(0.95);
    expect(decoded.claude.spendOutBeforeResetMs).toBe(300 * 60_000);
    expect(decoded.codex.pauseAtPercent).toBe(99);
  });

  it("merges present fields over the defaults, one provider at a time", () => {
    const decoded = decodePlanThresholds({
      document: { thresholds: { claude: { spendOutBeforeResetMinutes: 120 }, codex: { pauseAtPercent: 95 } } },
    });
    expect(decoded.claude.spendOutBeforeResetMs).toBe(120 * 60_000);
    expect(decoded.claude.alertAt).toBe(0.75);
    expect(decoded.codex).toStrictEqual({ alertAtPercent: 75, pauseAtPercent: 95 });
  });

  it("round-trips Claude's fractions back to the whole percents the owner set", () => {
    expect(claudeThresholdFieldsOf({ thresholds: DEFAULT_THRESHOLDS.claude })).toStrictEqual(
      DEFAULT_THRESHOLD_FIELDS.claude,
    );
  });
});

describe("thresholdProblems", () => {
  it("finds nothing wrong with an absent key", () => {
    expect(thresholdProblems({ document: { rows: [] } })).toStrictEqual([]);
  });

  it("refuses a non-object, an unknown provider, an unknown field and an out-of-range value, naming each", () => {
    expect(thresholdProblems({ document: { thresholds: 5 } })).toStrictEqual([
      "`thresholds`, when present, must be an object keyed by provider",
    ]);
    expect(
      thresholdProblems({
        document: {
          thresholds: { claude: { routeAtPercent: 95.5, typo: 1 }, gemini: {}, codex: { pauseAtPercent: 0 } },
        },
      }),
    ).toStrictEqual([
      "`thresholds.claude.routeAtPercent` must be a whole percent from 1 through 100",
      "`thresholds.claude.typo` is not a threshold this build reads — known: alertAtPercent, acceptanceAtPercent, " +
        "routeAtPercent, spendOutAtPercent, spendOutBeforeResetMinutes, balancedSpreadPercent, driftingSpreadPercent",
      "`thresholds.gemini` names no provider this build serves — `claude` or `codex`",
      "`thresholds.codex.pauseAtPercent` must be a whole percent from 1 through 100",
    ]);
  });

  it("bounds the lead time by a week of minutes, not by 100", () => {
    expect(
      thresholdProblems({ document: { thresholds: { claude: { spendOutBeforeResetMinutes: 10_080 } } } }),
    ).toStrictEqual([]);
    expect(
      thresholdProblems({ document: { thresholds: { claude: { spendOutBeforeResetMinutes: 10_081 } } } }),
    ).toStrictEqual([
      "`thresholds.claude.spendOutBeforeResetMinutes` must be a whole number of minutes from 1 through 10080",
    ]);
  });

  it("refuses every ordering the gates cannot honour, judged after the merge with the defaults", () => {
    expect(
      thresholdProblems({
        document: {
          thresholds: {
            claude: { alertAtPercent: 90, balancedSpreadPercent: 15, routeAtPercent: 100, spendOutAtPercent: 99 },
            codex: { alertAtPercent: 99 },
          },
        },
      }),
    ).toStrictEqual([
      "`thresholds.claude.alertAtPercent` must sit below `acceptanceAtPercent`",
      "`thresholds.claude.routeAtPercent` must not exceed `spendOutAtPercent`",
      "`thresholds.claude.balancedSpreadPercent` must sit below `driftingSpreadPercent`",
      "`thresholds.codex.alertAtPercent` must sit below `pauseAtPercent`",
    ]);
  });

  it("allows the routing bar to equal the spend-out bar, the boundary a lift may close to", () => {
    expect(
      thresholdProblems({ document: { thresholds: { claude: { routeAtPercent: 100, spendOutAtPercent: 100 } } } }),
    ).toStrictEqual([]);
  });
});

describe("the register carrying thresholds", () => {
  it("refuses the whole register on a bad threshold, so no gate reads a widened bar", () => {
    const refused = unwrapErr(
      parsePlanRegister({ value: { rows: [], thresholds: { codex: { pauseAtPercent: "99" } }, version: 1 } }),
    );
    expect(refused.code).toBe("REGISTER_INVALID");
    expect(refused.message).toContain("`thresholds.codex.pauseAtPercent` must be a whole percent from 1 through 100");
  });

  it("decodes onto the snapshot and keeps the raw document unexpanded", () => {
    const snapshot = unwrap(
      parsePlanRegister({ value: { rows: [], thresholds: { claude: { routeAtPercent: 94 } }, version: 1 } }),
    );
    expect(snapshot.thresholds.claude.routeAt).toBe(0.94);
    expect(snapshot.document["thresholds"]).toStrictEqual({ claude: { routeAtPercent: 94 } });
    expect(thresholdFieldsSet({ document: snapshot.document, provider: "claude" })).toStrictEqual(["routeAtPercent"]);
    expect(thresholdFieldsSet({ document: snapshot.document, provider: "codex" })).toStrictEqual([]);
  });
});
