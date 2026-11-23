import { describe, expect, it } from "vitest";

import { pausedPlanLine, unpausedAccounts } from "../../../claude/config.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { applyPlanPause } from "../../../claude/pausePlan.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PAUSE = {
  kind: "pause",
  paused: { reason: "claude.ai subscription paused on a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" },
} as const;

const FIVE = [
  { alias: "plan-one", email: "one@example.invalid", pinned: null, storeDir: "/tmp/one" },
  { alias: "plan-two", email: "two@example.invalid", pinned: null, storeDir: "/tmp/two" },
  { alias: "plan-three", email: "three@example.invalid", pinned: null, storeDir: "/tmp/three" },
];

describe("applyPlanPause", () => {
  it("writes the reason and the date onto the named row and leaves the others byte-identical", () => {
    const applied = unwrap(applyPlanPause({ alias: "plan-one", change: PAUSE, value: FIVE }));
    expect(applied.rows).toStrictEqual([
      {
        alias: "plan-one",
        email: "one@example.invalid",
        paused: {
          reason: "claude.ai subscription paused on a bounced charge",
          sinceIso: "2026-09-21T11:00:00.000Z",
        },
        pinned: null,
        storeDir: "/tmp/one",
      },
      FIVE[1],
      FIVE[2],
    ]);
  });

  it("keeps every field this repository does not read, so a pause is not a re-enrollment", () => {
    const applied = unwrap(applyPlanPause({ alias: "plan-two", change: PAUSE, value: FIVE }));
    expect(applied.rows[1]!["email"]).toBe("two@example.invalid");
    expect(applied.rows[1]!["pinned"]).toBe(null);
    expect(applied.rows[1]!["storeDir"]).toBe("/tmp/two");
  });

  it("reports the standing date rather than the word already, when the plan is already paused", () => {
    const once = unwrap(applyPlanPause({ alias: "plan-one", change: PAUSE, value: FIVE }));
    const twice = unwrapErr(applyPlanPause({ alias: "plan-one", change: PAUSE, value: once.rows }));
    expect(twice.code).toBe("PLAN_ALREADY_PAUSED");
    expect(twice.message).toBe("`plan-one` has been paused since 2026-09-21T11:00:00.000Z; nothing changed");
  });

  it("refuses an alias no configured row carries", () => {
    const error = unwrapErr(applyPlanPause({ alias: "plan-nine", change: PAUSE, value: FIVE }));
    expect(error.code).toBe("UNKNOWN_ACCOUNT");
    expect(error.message).toBe("no configured Claude account is called `plan-nine`");
  });

  it("pauses down to the last live plan and past it, because one plan is a whole fleet", () => {
    const one = unwrap(applyPlanPause({ alias: "plan-one", change: PAUSE, value: FIVE }));
    const two = unwrap(applyPlanPause({ alias: "plan-two", change: PAUSE, value: one.rows }));
    const three = unwrap(applyPlanPause({ alias: "plan-three", change: PAUSE, value: two.rows }));
    expect(unpausedAccounts({ accounts: two.accounts }).map((account) => account.alias)).toStrictEqual(["plan-three"]);
    expect(unpausedAccounts({ accounts: three.accounts })).toStrictEqual([]);
  });

  it("refuses to pause the pinned plan, because the pin decides where pages publish", () => {
    const pinned = [{ ...FIVE[0], pinned: true }, FIVE[1], FIVE[2]];
    const error = unwrapErr(applyPlanPause({ alias: "plan-one", change: PAUSE, value: pinned }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(error.message).toBe(
      "the configured Claude accounts are not usable: the pinned plan `plan-one` is paused; the pin decides " +
        "where pages publish, so unpin before pausing it (`slopweaver plans unpin`)",
    );
  });

  it("refuses a decoded value that is not an array of rows", () => {
    const error = unwrapErr(applyPlanPause({ alias: "plan-one", change: PAUSE, value: undefined }));
    expect(error.code).toBe("ACCOUNT_CONFIG_INVALID");
    expect(error.message).toBe(
      "the configured Claude accounts are not usable: the account list is not an array of rows",
    );
  });
});

describe("applyPlanPause resume", () => {
  it("removes the key entirely rather than writing a false, so the absent case stays the normal one", () => {
    const paused = unwrap(applyPlanPause({ alias: "plan-one", change: PAUSE, value: FIVE }));
    const resumed = unwrap(applyPlanPause({ alias: "plan-one", change: { kind: "resume" }, value: paused.rows }));
    expect(Object.keys(resumed.rows[0]!).includes("paused")).toBe(false);
    expect(resumed.rows).toStrictEqual(FIVE);
  });

  it("refuses to resume a plan that was never taken out", () => {
    const error = unwrapErr(applyPlanPause({ alias: "plan-one", change: { kind: "resume" }, value: FIVE }));
    expect(error.code).toBe("PLAN_NOT_PAUSED");
    expect(error.message).toBe("`plan-one` is not paused, so there is nothing to resume");
  });
});

describe("unpausedAccounts", () => {
  const accounts: readonly ClaudeAccount[] = [
    { alias: "plan-one", paused: { reason: "a bounced charge", sinceIso: "2026-09-21T11:00:00.000Z" }, storeDir: "/a" },
    { alias: "plan-two", storeDir: "/b" },
    { alias: "plan-three", storeDir: "/c" },
  ];

  it("drops every paused plan and keeps configured order", () => {
    expect(unpausedAccounts({ accounts }).map((account) => account.alias)).toStrictEqual(["plan-two", "plan-three"]);
  });

  it("returns the whole list when nothing is paused", () => {
    expect(unpausedAccounts({ accounts: accounts.slice(1) }).length).toBe(2);
  });

  it("returns an empty list rather than throwing when every plan is paused", () => {
    expect(unpausedAccounts({ accounts: accounts.slice(0, 1) })).toStrictEqual([]);
  });
});

describe("pausedPlanLine", () => {
  it("names the reason, the date and the verb that undoes it", () => {
    const line = pausedPlanLine({
      account: {
        alias: "plan-one",
        paused: { reason: "a bounced Airwallex charge", sinceIso: "2026-09-21T11:00:00.000Z" },
        storeDir: "/a",
      },
    });
    expect(line).toBe(
      "plan-one is PAUSED since 2026-09-21T11:00:00.000Z — a bounced Airwallex charge. It is not probed " +
        "and not routed, but every fleet count still lists it as paused; `slopweaver claude resume plan-one` puts it back.",
    );
  });

  it("says nothing at all about a plan that is in the fleet", () => {
    expect(pausedPlanLine({ account: { alias: "plan-two", storeDir: "/b" } })).toBe(undefined);
  });
});
