import { afterEach, describe, expect, it } from "vitest";

import { gateSpawnStore, spentPlanHatchOpen, unreadablePlanHatchOpen } from "../../../claude/spawnStore.js";
import { ALLOW_SPENT_PLAN_ENV, ALLOW_UNREADABLE_PLAN_ENV } from "../../../claude/spawnStoreRefusals.js";
import { JUDGEMENT_NOTE } from "../../../hatch/render.js";
import { unavailablePlanRegisterPort } from "../../planRegisterFixture.js";
import {
  cleanGateHome,
  countingDeps,
  foreignAliasDeps,
  makeGateHome,
  memoryGatePorts,
  offlineDeps,
  oneHealthyDeps,
  SHADOWED,
  SUBSCRIPTION,
  spentDeps,
  TWO_PLANS,
  writeAccounts,
} from "./spawnStoreFixtures.js";

afterEach(cleanGateHome);

/** The choice every spawn under {@link SHADOWED} records: the API key decides, no plan does. */
const API_KEY_CHOICE = {
  kind: "ambient",
  alternative: "unset ANTHROPIC_API_KEY to spend a plan login",
  reason: "ANTHROPIC_API_KEY outranks every credential store, so the session presents an API key and no plan decides",
  vendor: "claude",
} as const;

type GateInput = Parameters<typeof gateSpawnStore>[0];
type GateContext = Omit<GateInput["context"], "port" | "probesPort"> & Partial<ReturnType<typeof memoryGatePorts>>;

/** `gateSpawnStore` unforced, with no model, no pin and in-memory ports, unless `over` names one. */
function gate(over: { context: GateContext } & Partial<Omit<GateInput, "context">>): ReturnType<typeof gateSpawnStore> {
  return gateSpawnStore({
    force: false,
    model: undefined,
    pinnedStoreDir: undefined,
    ...over,
    context: { ...memoryGatePorts(), ...over.context },
  });
}

describe("spentPlanHatchOpen", () => {
  it("opens on the ambient variable even when the caller's own flag says no", () => {
    // THE DEFECT, as an assertion. MEASURED: `cmux spawn` passes its `--force` flag explicitly on
    // every run — `false` when the flag is absent — and while the variable was that parameter's DEFAULT, the
    // explicit `false` skipped the read entirely. So the refusal named an override that released nothing,
    // and the supervisor chain could seat no successor. A caller may only ever ADD to the hatch.
    expect(spentPlanHatchOpen({ env: "1", flag: false })).toBe(true);
  });

  it("opens on the caller's own flag with the variable unset", () => {
    expect(spentPlanHatchOpen({ env: undefined, flag: true })).toBe(true);
  });

  it("opens when both say so", () => {
    expect(spentPlanHatchOpen({ env: "1", flag: true })).toBe(true);
  });

  it("stays shut when neither does", () => {
    expect(spentPlanHatchOpen({ env: undefined, flag: false })).toBe(false);
  });

  it("stays shut on a value that is not the documented 1", () => {
    // The refusal tells the operator to set it to `1`, so `0` and `false` are what someone types when they
    // mean the opposite — reading any non-empty value as open would turn `=0` into an override.
    expect(spentPlanHatchOpen({ env: "0", flag: false })).toBe(false);
    expect(spentPlanHatchOpen({ env: "false", flag: false })).toBe(false);
    expect(spentPlanHatchOpen({ env: "", flag: false })).toBe(false);
  });

  it("is opened by the variable the refusal actually names", () => {
    expect(ALLOW_SPENT_PLAN_ENV).toBe("SLOPWEAVER_ALLOW_SPENT_PLAN");
  });
});

describe("unreadablePlanHatchOpen", () => {
  it("opens only on the documented `1`", () => {
    expect(unreadablePlanHatchOpen({ env: "1" })).toBe(true);
    expect(unreadablePlanHatchOpen({ env: undefined })).toBe(false);
    expect(unreadablePlanHatchOpen({ env: "0" })).toBe(false);
    expect(unreadablePlanHatchOpen({ env: "false" })).toBe(false);
    expect(unreadablePlanHatchOpen({ env: "" })).toBe(false);
  });

  it("is opened by a variable DISTINCT from the spent-plan one", () => {
    // Two different facts, so two different permissions. "This plan is spent" is a measurement; "no plan could
    // be read" is the absence of one, and folding them together is how a forced spawn would also have become a
    // permission to boot blind.
    expect(ALLOW_UNREADABLE_PLAN_ENV).toBe("SLOPWEAVER_ALLOW_UNREADABLE_PLAN");
    expect(ALLOW_UNREADABLE_PLAN_ENV).not.toBe(ALLOW_SPENT_PLAN_ENV);
  });
});

describe("gateSpawnStore falls through ONLY on a genuinely absent install", () => {
  it("returns the caller's own pin untouched when there is no accounts file", async () => {
    const dir = makeGateHome();
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, unreadableHatchOpen: false },
      model: "fable",
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated).toStrictEqual({ basis: "unconfigured", storeDir: "/stores/plan-one" });
  });

  it("returns no override at all for an unpinned spawn when there is no accounts file", async () => {
    // Byte-identical to the boot line that predates routing: no store prefix, the ambient slot.
    const dir = makeGateHome();
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, unreadableHatchOpen: false },
    });
    // No store prefix still; the recorded choice says why no plan decided.
    expect(gated).toStrictEqual({
      basis: "unconfigured",
      choice: {
        kind: "ambient",
        alternative: "register a Claude plan, then --plan <alias>",
        reason: "no Claude plan is registered, so the ambient login stands and nothing was routed",
        vendor: "claude",
      },
    });
  });

  it("probes nothing when there is no accounts file", async () => {
    const dir = makeGateHome();
    let probes = 0;
    await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(probes).toBe(0);
  });
});

describe("gateSpawnStore REFUSES a configuration it cannot establish, for everyone", () => {
  it("refuses malformed configuration with the real reason, naming no store", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: "{ truncated" });
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, unreadableHatchOpen: false },
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain("not usable");
  });

  it("refuses when the plan register's store is unreachable, and probes nothing", async () => {
    // An outage is the one read where the register's contents are unknown, so neither the ambient slot nor a
    // routed plan is a safe boot: the spawn stops here, with the outage named.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    let probes = 0;
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        port: unavailablePlanRegisterPort(),
        unreadableHatchOpen: false,
      },
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain("ECONNREFUSED");
    expect(probes).toBe(0);
  });

  it("is NOT released by the unreadable-plan hatch and force together: every usage limit went unread", async () => {
    // The owner's ruling, option A: an unreadable register stops
    // every spawn, hatch or not. This case used to assert the hatch released the spawn onto the ambient credential.
    const dir = makeGateHome();
    writeAccounts({ dir, text: "[]" });
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, unreadableHatchOpen: true },
      force: true,
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.basis).toBe(undefined);
    expect(gated.refusal).toContain("no hatch and no --force crosses an unread usage limit");
    expect(gated.refusal).toContain("`slopweaver plans validate`");
  });

  it("refuses an unreachable register store with the hatch open and force set, and probes nothing", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    let probes = 0;
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        port: unavailablePlanRegisterPort(),
        unreadableHatchOpen: true,
      },
      force: true,
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe(undefined);
    expect(probes).toBe(0);
  });
});

describe("gateSpawnStore fails CLOSED when no gauge is readable", () => {
  it("refuses an unpinned spawn rather than letting it boot on an ambient credential", async () => {
    // The hole this closes: the old gate returned an empty result here, and
    // `cmux/spawn.ts` kept a plan with no store — so the session booted on the shared default keychain slot,
    // whose own token had been expired for four days while the fleet ran.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated.refusalKind).toBe("unreadable-plan");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toContain(JUDGEMENT_NOTE);
  });

  it("is NOT released by force, which is permission for a spent plan and not for no evidence", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      force: true,
    });
    expect(gated.refusalKind).toBe("unreadable-plan");
    expect(gated.storeDir).toBe(undefined);
  });

  it("names an EXPLICIT store in configured order when its own hatch is open", async () => {
    // Permission to proceed without gauge evidence is never permission to boot on an unnamed credential. That
    // was the escape in the old generic "strip any refusal when forced" tail.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: true,
      },
    });
    expect(gated).toStrictEqual({
      basis: "unreadable-override",
      choice: {
        alias: "plan-one",
        basis: "routed",
        kind: "named",
        alternative: "--plan <alias>",
        readings: [
          { alias: "plan-one", reading: "no gauge was readable", state: "chosen" },
          { alias: "plan-two", reading: "no gauge was readable", state: "unreadable" },
        ],
        reason:
          "first in configured order with no usage limit to stay under, booted unmeasured by the unreadable-plan hatch: no plan's gauge was readable",
        vendor: "claude",
      },
      storeDir: "/stores/plan-one",
    });
  });

  it("refuses a PINNED seat whose own gauge is unreadable, even when another plan reads fine", async () => {
    // The other readings say nothing about this store, and a pinned seat is not negotiable — so the honest
    // answer is the refusal, and its hatch returns this exact store rather than a different one.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: oneHealthyDeps({ healthy: "plan-two" }),
        home: dir,
        unreadableHatchOpen: false,
      },
      force: true,
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated.refusalKind).toBe("unreadable-plan");
    expect(gated.storeDir).toBe("/stores/plan-one");
  });

  it("boots a pinned seat on its OWN store when the unreadable hatch is open", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: oneHealthyDeps({ healthy: "plan-two" }),
        home: dir,
        unreadableHatchOpen: true,
      },
      pinnedStoreDir: "/stores/plan-one",
    });
    // The other plan's reading is kept beside the choice even though it did not decide it: every reading appears once.
    expect(gated).toStrictEqual({
      basis: "unreadable-override",
      choice: {
        alias: "plan-one",
        basis: "pinned",
        kind: "named",
        alternative: "--plan <alias>",
        readings: [
          { alias: "plan-one", reading: "no gauge was readable", state: "chosen" },
          {
            alias: "plan-two",
            observedAtIso: "2026-09-12T06:00:00.000Z",
            reading: "all-models week 30%, 5h 20%",
            state: "eligible",
          },
        ],
        reason: "the pinned seat, booted unmeasured by the unreadable-plan hatch: its own gauge was not readable",
        vendor: "claude",
      },
      storeDir: "/stores/plan-one",
    });
  });
});

describe("gateSpawnStore does not refuse on gauges when an API KEY outranks every store", () => {
  it("allows an unpinned spawn with no readable gauge and no store override", async () => {
    // Refusing would be a regression with a usable credential in hand.
    // `ANTHROPIC_API_KEY` and its siblings resolve AHEAD of the saved claude.ai login a store holds (measured
    // against Claude Code v2.1.261), so under one of them every configured plan could be signed out and the
    // spawn would still work. There is no store to name, because no store decides anything.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SHADOWED,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated).toStrictEqual({ basis: "api-key", choice: API_KEY_CHOICE });
  });

  it("allows a PINNED seat on its own store with no readable gauge", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SHADOWED,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated).toStrictEqual({ basis: "api-key", choice: API_KEY_CHOICE, storeDir: "/stores/plan-one" });
  });

  it("still refuses a gauge-less fleet when NOTHING shadows the stores", async () => {
    // The witness that the arm above is the API key's and not a blanket loosening: the same inputs with a plain
    // subscription environment refuse exactly as before.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated.refusalKind).toBe("unreadable-plan");
  });

  it("allows a spawn onto a plan whose gauge says SPENT, because the session will not spend that plan", async () => {
    // This test used to assert the refusal, on the reasoning that a gauge which was READ is a measurement and an
    // ambient credential does not make it untrue. The reasoning was corrected rather than the
    // fact: the measurement is true and irrelevant, because under an API key the session spends a Console
    // organisation per token and never touches that plan's week at all.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SHADOWED,
        deps: spentDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated).toStrictEqual({ basis: "api-key", choice: API_KEY_CHOICE });
  });

  it("allows a spawn with a BROKEN accounts file, and probes nothing at all", async () => {
    // The API-key check sits ahead of reading the configuration for exactly this: with
    // an emptied accounts file the old gate allowed a working API-key spawn, and refusing it would have been a
    // regression with a usable credential in hand. Neither hatch released it.
    const dir = makeGateHome();
    writeAccounts({ dir, text: "[]" });
    let probes = 0;
    const gated = await gate({
      context: {
        ambient: SHADOWED,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated).toStrictEqual({ basis: "api-key", choice: API_KEY_CHOICE });
    expect(probes).toBe(0);
  });
});

describe("gateSpawnStore MEASURES a store `--plan` named on its own live gauge", () => {
  it("gates a named store the register still carries on its own live gauge", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: oneHealthyDeps({ healthy: "plan-two" }),
        home: dir,
        namedPin: true,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/plan-two",
    });
    // `--plan` named it, so the choice is `requested`, and plan-one, which the sweep could not read, still appears.
    expect(gated).toStrictEqual({
      basis: "pinned",
      choice: {
        alias: "plan-two",
        basis: "requested",
        kind: "named",
        alternative: "--plan <alias> names another plan; omit --plan to route on live gauges",
        readings: [
          {
            alias: "plan-two",
            observedAtIso: "2026-09-12T06:00:00.000Z",
            reading: "all-models week 30%, 5h 20%",
            state: "chosen",
          },
          { alias: "plan-one", reading: "no gauge was readable", state: "unreadable" },
        ],
        reason: "--plan named it; its own gauge allows it",
        vendor: "claude",
      },
      storeDir: "/stores/plan-two",
    });
  });
});

describe("gateSpawnStore always hands back an EXPLICIT store when it allows a spawn", () => {
  it("refuses rather than returning storelessly when the routed plan has no configured store", async () => {
    // Unreachable through `probePlan`, which stamps each reading with the alias it was
    // asked for — and still a refusal, because "an allowed spawn always carries an explicit store" has to hold
    // structurally rather than by the grace of one upstream function.
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: foreignAliasDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      force: true,
    });
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.refusal).toContain("is not one of the configured plans");
  });

  it("routes to the readable plan and names its store", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: oneHealthyDeps({ healthy: "plan-two" }),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated.storeDir).toBe("/stores/plan-two");
    expect(gated.basis).toBe("routed");
    expect(gated.refusal).toBe(undefined);
  });

  it("uses an unconfigured pin as named and says it was not measured, rather than falling to the ambient slot", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/somewhere-else",
    });
    expect(gated).toStrictEqual({ basis: "pinned", storeDir: "/stores/somewhere-else" });
  });

  it("releases a SPENT-plan refusal onto a named store when force is set", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: spentDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      force: true,
    });
    expect(gated.refusal).toBe(undefined);
    expect(gated.storeDir).toBe("/stores/plan-one");
  });

  it("refuses a spent fleet when force is not set, and still names the store a release would use", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: spentDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
    });
    expect(gated.refusalKind).toBe("spent-plan");
    expect(gated.storeDir).toBe("/stores/plan-one");
  });
});
