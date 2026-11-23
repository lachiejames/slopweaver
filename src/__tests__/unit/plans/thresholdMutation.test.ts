/**
 * `applyThresholdMutation` — a threshold change edits the RAW document, restores true absence on the last reset,
 * refuses a change that changes nothing, and re-validates the merged result so a bad ordering never publishes.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { applyPlanMutation } from "../../../plans/mutate.js";
import { parsePlanRegister } from "../../../plans/register.js";
import { applyThresholdMutation } from "../../../plans/thresholdMutation.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

const ROWS = [{ alias: "plan-one", provider: "claude", storeDir: "/c1" }];

const registered = ({ extra = {} }: { extra?: Readonly<Record<string, unknown>> } = {}): PlanRegisterSnapshot =>
  unwrap(parsePlanRegister({ value: { rows: ROWS, version: 1, ...extra } }));

describe("applyThresholdMutation", () => {
  it("writes only the fields set, and decodes the rest to their defaults", () => {
    const changed = unwrap(
      applyThresholdMutation({
        change: { provider: "claude", reset: [], set: { acceptanceAtPercent: 89, routeAtPercent: 94 } },
        snapshot: registered(),
      }),
    );
    expect(changed.document["thresholds"]).toStrictEqual({ claude: { acceptanceAtPercent: 89, routeAtPercent: 94 } });
    expect(changed.thresholds.claude.routeAt).toBe(0.94);
    expect(changed.thresholds.claude.acceptanceAt).toBe(0.89);
    expect(changed.thresholds.claude.alertAt).toBe(0.75);
    expect(changed.thresholds.codex).toStrictEqual({ alertAtPercent: 75, pauseAtPercent: 99 });
  });

  it("removes the whole key when the last field is reset, so the register names no thresholds again", () => {
    const changed = unwrap(
      applyThresholdMutation({
        change: { provider: "codex", reset: ["pauseAtPercent"], set: {} },
        snapshot: registered({ extra: { thresholds: { codex: { pauseAtPercent: 97 } } } }),
      }),
    );
    expect(Object.keys(changed.document).toSorted()).toStrictEqual(["rows", "version"]);
    expect(changed.thresholds.codex.pauseAtPercent).toBe(99);
  });

  it("drops an empty sibling object too, so the last real reset still leaves no thresholds key", () => {
    const changed = unwrap(
      applyThresholdMutation({
        change: { provider: "codex", reset: ["pauseAtPercent"], set: {} },
        snapshot: registered({ extra: { thresholds: { claude: {}, codex: { pauseAtPercent: 97 } } } }),
      }),
    );
    expect(Object.keys(changed.document).toSorted()).toStrictEqual(["rows", "version"]);
  });

  it("keeps the other provider's object and an unrelated top-level field through a change", () => {
    const changed = unwrap(
      applyThresholdMutation({
        change: { provider: "claude", reset: ["alertAtPercent"], set: {} },
        snapshot: registered({
          extra: { note: "kept", thresholds: { claude: { alertAtPercent: 70 }, codex: { alertAtPercent: 60 } } },
        }),
      }),
    );
    expect(changed.document["note"]).toBe("kept");
    expect(changed.document["thresholds"]).toStrictEqual({ codex: { alertAtPercent: 60 } });
  });

  it("refuses an ordering the gates cannot honour as REGISTER_INVALID, naming the rule", () => {
    const refused = unwrapErr(
      applyThresholdMutation({
        change: { provider: "claude", reset: [], set: { routeAtPercent: 89 } },
        snapshot: registered(),
      }),
    );
    expect(refused.code).toBe("REGISTER_INVALID");
    expect(refused.message).toContain("`thresholds.claude.acceptanceAtPercent` must sit below `routeAtPercent`");
  });

  it("refuses a value out of range as REGISTER_INVALID", () => {
    const refused = unwrapErr(
      applyThresholdMutation({
        change: { provider: "codex", reset: [], set: { pauseAtPercent: 101 } },
        snapshot: registered(),
      }),
    );
    expect(refused.code).toBe("REGISTER_INVALID");
    expect(refused.message).toContain("`thresholds.codex.pauseAtPercent` must be a whole percent from 1 through 100");
  });

  it("refuses setting the value already stored, which would only bump the revision", () => {
    const refused = unwrapErr(
      applyThresholdMutation({
        change: { provider: "codex", reset: [], set: { pauseAtPercent: 97 } },
        snapshot: registered({ extra: { thresholds: { codex: { pauseAtPercent: 97 } } } }),
      }),
    );
    expect(refused.code).toBe("MUTATION_CONFLICT");
    expect(refused.message).toContain("the register already sets codex pauseAtPercent to that value");
  });

  it("refuses resetting a field the register does not name, since it is already at its default", () => {
    const refused = unwrapErr(
      applyThresholdMutation({
        change: { provider: "claude", reset: ["routeAtPercent"], set: {} },
        snapshot: registered(),
      }),
    );
    expect(refused.code).toBe("MUTATION_CONFLICT");
    expect(refused.message).toContain("the register names no claude routeAtPercent");
  });

  it("refuses a change that sets and resets nothing", () => {
    const refused = unwrapErr(
      applyThresholdMutation({ change: { provider: "claude", reset: [], set: {} }, snapshot: registered() }),
    );
    expect(refused.code).toBe("MUTATION_CONFLICT");
  });

  it("is reached through applyPlanMutation without addressing a row", () => {
    const changed = unwrap(
      applyPlanMutation({
        mutation: { change: { provider: "codex", reset: [], set: { alertAtPercent: 70 } }, kind: "set-thresholds" },
        snapshot: registered(),
      }),
    );
    expect(changed.thresholds.codex.alertAtPercent).toBe(70);
    expect(changed.plans.map((plan) => plan.alias)).toStrictEqual(["plan-one"]);
  });
});
