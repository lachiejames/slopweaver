/**
 * Which host the chair's successor boots on, off the plan register and the cadence's Fable route — and the one
 * spawn command that seats it (one plan of either provider runs all of Slopweaver).
 */
import { describe, expect, it } from "vitest";

import { CODEX_MODEL } from "../../../codex/profiles.js";
import { err, ok } from "../../../lib/result.js";
import { PlanRegisterErrors } from "../../../plans/errors.js";
import type { ChairCadenceRoute } from "../../../supervisor/chairCadence.js";
import {
  ambientClaudeSuccessor,
  ambientClaudeVerdict,
  chairSuccessorTarget,
  codexSeatVerdict,
  successorSpawnLine,
  targetOnHome,
} from "../../../supervisor/chairSuccessor.js";
import { CODEX_ONLY, derivedPlans, MIXED, ONE_CLAUDE, PAUSED, registeredPlans } from "../../chairSuccessorFixture.js";

const PICKS: ChairCadenceRoute = { alias: "plan-one", kind: "picks" };
const NONE: ChairCadenceRoute = { kind: "none" };
const UNMEASURED: ChairCadenceRoute = { kind: "unmeasured" };
const MONTHLY = { kind: "monthly-spend" } as const;

describe("chairSuccessorTarget", () => {
  it("seats nothing on a register that cannot be read, naming the register's own error", () => {
    const error = PlanRegisterErrors.registerUnreadable({ path: "/home/plans.json" });

    expect(chairSuccessorTarget({ register: err(error), route: PICKS })).toStrictEqual({
      kind: "none",
      why: `the plan register could not be read, so no successor can be seated: ${error.message}`,
    });
  });

  it("hands a one-Claude-plan chair back onto Claude while routing picks a plan", () => {
    expect(chairSuccessorTarget({ register: ok(ONE_CLAUDE), route: PICKS })).toStrictEqual({ kind: "claude" });
  });

  it("seats no Claude successor on an unmeasured route, which the spawn's own probe may refuse", () => {
    expect(chairSuccessorTarget({ register: ok(ONE_CLAUDE), route: UNMEASURED })).toStrictEqual({
      kind: "none",
      why:
        "this tick's Fable route is unmeasured, so no Claude plan is proven to take the spawn, which probes the gauge " +
        "this tick could not read, and no registered Codex plan takes autonomous work (0 registered; a paused or " +
        "monthly-spend one takes none)",
    });
  });

  it("seats no Claude successor on a route picking a plan the register has since paused", () => {
    const pausedPick = registeredPlans({
      rows: [
        { alias: "plan-one", paused: PAUSED, provider: "claude", storeDir: "/s/one" },
        { alias: "plan-two", provider: "claude", storeDir: "/s/two" },
      ],
    });

    expect(chairSuccessorTarget({ register: ok(pausedPick), route: PICKS })).toStrictEqual({
      kind: "none",
      why:
        "routing names no Claude plan that can take a Fable spawn, and no registered Codex plan takes autonomous " +
        "work (0 registered; a paused or monthly-spend one takes none)",
    });
  });

  it("routes an unmeasured Claude route onto a registered Codex plan", () => {
    expect(chairSuccessorTarget({ register: ok(MIXED), route: UNMEASURED })).toStrictEqual({ kind: "codex" });
  });

  it("hands a registered Codex-only install to Codex", () => {
    expect(chairSuccessorTarget({ register: ok(CODEX_ONLY), route: NONE })).toStrictEqual({ kind: "codex" });
  });

  it("routes a measured Fable wall onto Codex on a mixed install, and keeps Claude while it routes", () => {
    expect(chairSuccessorTarget({ register: ok(MIXED), route: NONE })).toStrictEqual({ kind: "codex" });
    expect(chairSuccessorTarget({ register: ok(MIXED), route: PICKS })).toStrictEqual({ kind: "claude" });
  });

  it("hands off to Codex when every Claude plan is paused", () => {
    const pausedClaude = registeredPlans({
      rows: [
        { alias: "plan-one", paused: PAUSED, provider: "claude", storeDir: "/s/one" },
        { alias: "codex-work", provider: "codex", storeDir: "/c/work" },
      ],
    });

    expect(chairSuccessorTarget({ register: ok(pausedClaude), route: PICKS })).toStrictEqual({ kind: "codex" });
  });

  it("boots an unadopted install with no Claude row on Claude, its derived register holding no Codex row", () => {
    expect(chairSuccessorTarget({ register: ok(derivedPlans({ claudeRows: [] })), route: NONE })).toStrictEqual({
      kind: "claude",
    });
  });

  it("seats nothing on an unadopted install whose Claude plans route no Fable spawn", () => {
    const derived = derivedPlans({ claudeRows: [{ alias: "plan-one", storeDir: "/s/one" }] });

    expect(chairSuccessorTarget({ register: ok(derived), route: NONE })).toStrictEqual({
      kind: "none",
      why: "routing names no Claude plan that can take a Fable spawn, and no Codex plan is registered (`slopweaver plans add --provider codex` registers one)",
    });
  });

  it("seats nothing on a one-Claude-plan install whose route is none, naming the missing Codex plan", () => {
    expect(chairSuccessorTarget({ register: ok(ONE_CLAUDE), route: NONE })).toStrictEqual({
      kind: "none",
      why: "routing names no Claude plan that can take a Fable spawn, and no registered Codex plan takes autonomous work (0 registered; a paused or monthly-spend one takes none)",
    });
  });

  it("never hands a Codex-only install to a monthly-spend row, which Codex routing always excludes", () => {
    const monthlyCodex = registeredPlans({
      rows: [{ alias: "codex-work", allowance: MONTHLY, provider: "codex", storeDir: "/c/work" }],
    });

    expect(chairSuccessorTarget({ register: ok(monthlyCodex), route: NONE })).toStrictEqual({
      kind: "none",
      why: "no registered plan takes autonomous work (0 Claude, 1 Codex, each paused or monthly-spend), so the fleet is stopped by its own register — `slopweaver plans resume` puts a paused one back",
    });
  });

  it("routes past a monthly-spend Claude plan onto a measurable Codex plan, even while the Fable route cannot say", () => {
    const monthlyClaude = registeredPlans({
      rows: [
        { alias: "plan-one", allowance: MONTHLY, provider: "claude", storeDir: "/s/one" },
        { alias: "codex-work", provider: "codex", storeDir: "/c/work" },
      ],
    });

    expect(chairSuccessorTarget({ register: ok(monthlyClaude), route: UNMEASURED })).toStrictEqual({
      kind: "codex",
    });
  });

  it("seats nothing when every registered plan is paused", () => {
    const allPaused = registeredPlans({
      rows: [
        { alias: "plan-one", paused: PAUSED, provider: "claude", storeDir: "/s/one" },
        { alias: "codex-work", paused: PAUSED, provider: "codex", storeDir: "/c/work" },
      ],
    });

    expect(chairSuccessorTarget({ register: ok(allPaused), route: PICKS })).toStrictEqual({
      kind: "none",
      why: "no registered plan takes autonomous work (1 Claude, 1 Codex, each paused or monthly-spend), so the fleet is stopped by its own register — `slopweaver plans resume` puts a paused one back",
    });
  });
});

describe("ambientClaudeSuccessor", () => {
  it("is true only for a derived register carrying no Claude row", () => {
    expect(ambientClaudeSuccessor({ register: ok(derivedPlans({ claudeRows: [] })) })).toBe(true);
    expect(
      ambientClaudeSuccessor({
        register: ok(derivedPlans({ claudeRows: [{ alias: "plan-one", storeDir: "/s/one" }] })),
      }),
    ).toBe(false);
    expect(ambientClaudeSuccessor({ register: ok(CODEX_ONLY) })).toBe(false);
    expect(
      ambientClaudeSuccessor({ register: err(PlanRegisterErrors.registerUnreadable({ path: "/home/plans.json" })) }),
    ).toBe(false);
  });
});

describe("ambientClaudeVerdict", () => {
  it("keeps Claude when the spawn reads the Claude side unconfigured", () => {
    expect(ambientClaudeVerdict({ claudeSide: ok("unconfigured") })).toStrictEqual({ kind: "claude" });
  });

  it("names the refused ambient boot when an accounts file is present but configures nothing", () => {
    expect(ambientClaudeVerdict({ claudeSide: ok("configured") })).toStrictEqual({
      kind: "none",
      why:
        "nothing is adopted and no Claude plan is configured, yet a Claude accounts file is present, so " +
        "`cmux spawn --driver claude` would refuse rather than boot on the ambient credential — " +
        "`slopweaver plans adopt` registers a plan",
    });
  });

  it("names the read that failed", () => {
    expect(ambientClaudeVerdict({ claudeSide: err("accounts.json is not JSON") })).toStrictEqual({
      kind: "none",
      why: "the Claude side could not be read, so no successor can be seated: accounts.json is not JSON",
    });
  });
});

describe("codexSeatVerdict", () => {
  it("keeps Codex when the live seat would open", () => {
    expect(codexSeatVerdict({ seat: ok("codex-one") })).toStrictEqual({ kind: "codex" });
  });

  it("names the spawn's own refusal when the live seat would not open", () => {
    expect(codexSeatVerdict({ seat: err("refusing — codex-one is at its usage limit") })).toStrictEqual({
      kind: "none",
      why: "no Claude plan takes the successor, and `cmux spawn --driver codex` would not open its seat: refusing — codex-one is at its usage limit",
    });
  });
});

describe("successorSpawnLine", () => {
  it("names the driver explicitly for both hosts, and never a Claude tier for Codex", () => {
    expect(successorSpawnLine({ slug: "fresh-supervisor-handoff-9009", target: { kind: "claude" } })).toBe(
      "slopweaver cmux spawn fresh-supervisor-handoff-9009 --driver claude --model fable",
    );
    expect(successorSpawnLine({ slug: "fresh-supervisor-handoff-9009", target: { kind: "codex" } })).toBe(
      `slopweaver cmux spawn fresh-supervisor-handoff-9009 --driver codex --model ${CODEX_MODEL}`,
    );
  });

  it("appends the named home, quoted only where a shell needs it", () => {
    expect(successorSpawnLine({ slug: "h-9", target: { home: "/state/home", kind: "claude" } })).toBe(
      "slopweaver cmux spawn h-9 --driver claude --model fable --home /state/home",
    );
    expect(successorSpawnLine({ slug: "h-9", target: { home: "/state/my home", kind: "codex" } })).toBe(
      `slopweaver cmux spawn h-9 --driver codex --model ${CODEX_MODEL} --home '/state/my home'`,
    );
  });
});

describe("targetOnHome", () => {
  it("puts a named home on a seatable target, and leaves the ambient home and an unseatable target alone", () => {
    expect(targetOnHome({ spawnHome: "/state/home", target: { kind: "codex" } })).toStrictEqual({
      home: "/state/home",
      kind: "codex",
    });
    expect(targetOnHome({ spawnHome: undefined, target: { kind: "claude" } })).toStrictEqual({ kind: "claude" });
    expect(targetOnHome({ spawnHome: "/state/home", target: { kind: "none", why: "no plan" } })).toStrictEqual({
      kind: "none",
      why: "no plan",
    });
  });
});
