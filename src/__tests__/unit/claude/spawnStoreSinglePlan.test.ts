/**
 * The pre-spawn gate on a ONE-plan install, and on one whose every plan is paused.
 *
 * Rotation does not need two plans, and a supervisor handing off to a new supervisor is fine on one plan. So a single registered plan routes every spawn — a supervisor's successor included — and "single" is
 * never an override: a spent or unreadable lone plan still refuses exactly as one of several does. Pausing every plan
 * — or the plan a pinned spawn names — is a deliberate stop, refused by name, probing nothing, and released by
 * neither `force` nor a hatch.
 */
import { afterEach, describe, expect, it } from "vitest";

import { gateSpawnStore } from "../../../claude/spawnStore.js";
import {
  cleanGateHome,
  countingDeps,
  makeGateHome,
  memoryGatePorts,
  offlineDeps,
  oneHealthyDeps,
  SUBSCRIPTION,
  spentDeps,
  writeAccounts,
} from "./spawnStoreFixtures.js";

afterEach(cleanGateHome);

const ONE_PLAN = JSON.stringify([{ alias: "plan-one", storeDir: "/stores/plan-one" }]);

const PAUSED = { reason: "the subscription lapsed", sinceIso: "2026-11-01T00:00:00.000Z" };

const EVERY_PLAN_PAUSED = JSON.stringify([
  { alias: "plan-one", paused: PAUSED, storeDir: "/stores/plan-one" },
  { alias: "plan-two", paused: PAUSED, storeDir: "/stores/plan-two" },
]);

/** The gate over `text`, with the probe seam, an optional pinned store and the two permissions a test varies. */
function gateOver({
  deps,
  force,
  model,
  pinnedStoreDir,
  text,
  unreadableHatchOpen,
}: {
  deps: NonNullable<Parameters<typeof gateSpawnStore>[0]["context"]["deps"]>;
  force: boolean;
  model?: string;
  pinnedStoreDir?: string;
  text: string;
  unreadableHatchOpen: boolean;
}): ReturnType<typeof gateSpawnStore> {
  const dir = makeGateHome();
  writeAccounts({ dir, text });
  return gateSpawnStore({
    context: { ambient: SUBSCRIPTION, deps, home: dir, ...memoryGatePorts(), unreadableHatchOpen },
    force,
    model,
    pinnedStoreDir,
  });
}

describe("gateSpawnStore on a one-plan install", () => {
  it("routes an unpinned spawn to the only plan and names its store", async () => {
    const gated = await gateOver({
      deps: oneHealthyDeps({ healthy: "plan-one" }),
      force: false,
      text: ONE_PLAN,
      unreadableHatchOpen: false,
    });
    expect([gated.basis, gated.storeDir, gated.refusal]).toStrictEqual(["routed", "/stores/plan-one", undefined]);
  });

  // The supervisor's successor is an unpinned Fable spawn, so this is the chair hand-off on one plan.
  it("routes a Fable spawn — a supervisor's successor — to the same, only plan", async () => {
    const gated = await gateOver({
      deps: oneHealthyDeps({ healthy: "plan-one" }),
      force: false,
      model: "fable",
      text: ONE_PLAN,
      unreadableHatchOpen: false,
    });
    expect([gated.basis, gated.storeDir]).toStrictEqual(["routed", "/stores/plan-one"]);
  });

  it("still refuses the lone plan when its gauge says SPENT — one plan is not an override", async () => {
    const gated = await gateOver({ deps: spentDeps(), force: false, text: ONE_PLAN, unreadableHatchOpen: false });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["spent-plan", "/stores/plan-one"]);
  });

  it("still refuses the lone plan when its gauge will not read", async () => {
    const gated = await gateOver({ deps: offlineDeps(), force: false, text: ONE_PLAN, unreadableHatchOpen: false });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["unreadable-plan", undefined]);
  });
});

describe("gateSpawnStore when every configured plan is paused", () => {
  it("refuses as `paused`, naming the resume, and carrying no store", async () => {
    const gated = await gateOver({
      deps: offlineDeps(),
      force: false,
      text: EVERY_PLAN_PAUSED,
      unreadableHatchOpen: false,
    });
    expect(gated.refusalKind).toBe("paused");
    expect(gated.storeDir).toBe(undefined);
    expect(gated.refusal).toBe(
      "claude routing: every configured Claude plan is paused (plan-one, plan-two) — REFUSING. A pause is the " +
        "operator's own stop, so no `--force` and no escape hatch crosses it; to go on, resume one with " +
        "`slopweaver claude resume <alias>`.",
    );
  });

  it("probes nothing to learn it", async () => {
    let probes = 0;
    await gateOver({
      deps: countingDeps({ onProbe: () => (probes += 1) }),
      force: false,
      text: EVERY_PLAN_PAUSED,
      unreadableHatchOpen: false,
    });
    expect(probes).toBe(0);
  });

  it("is released by neither force nor the unreadable-plan hatch", async () => {
    const gated = await gateOver({
      deps: offlineDeps(),
      force: true,
      text: EVERY_PLAN_PAUSED,
      unreadableHatchOpen: true,
    });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["paused", undefined]);
  });
});

// `--plan` resolved a live store, then its plan was paused before the gate reread the register.
describe("gateSpawnStore when the plan a pinned spawn names is paused", () => {
  const PINNED_PAUSED = JSON.stringify([
    { alias: "plan-one", paused: PAUSED, storeDir: "/stores/plan-one" },
    { alias: "plan-two", storeDir: "/stores/plan-two" },
  ]);

  it("refuses as `paused`, naming that plan's resume, probing nothing", async () => {
    let probes = 0;
    const gated = await gateOver({
      deps: countingDeps({ onProbe: () => (probes += 1) }),
      force: false,
      pinnedStoreDir: "/stores/plan-one",
      text: PINNED_PAUSED,
      unreadableHatchOpen: false,
    });
    expect([gated.refusalKind, gated.storeDir, probes]).toStrictEqual(["paused", "/stores/plan-one", 0]);
    expect(gated.refusal).toBe(
      "claude routing: the pinned plan `plan-one` is paused — REFUSING. A pause is the operator's own stop, so no " +
        "`--force` and no escape hatch crosses it; to go on, resume it with `slopweaver claude resume plan-one`.",
    );
  });

  // Store identity is NFC-normalised, so a pin spelled in decomposed form is the same paused store.
  it("refuses a pin spelling the paused store in a canonically equivalent form", async () => {
    const gated = await gateOver({
      deps: offlineDeps(),
      force: true,
      pinnedStoreDir: "/stores/café",
      text: JSON.stringify([{ alias: "plan-one", paused: PAUSED, storeDir: "/stores/café" }]),
      unreadableHatchOpen: true,
    });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["paused", "/stores/café"]);
  });

  // Canonical store identity is not only about pauses. A pin spelling a LIVE monthly-spend plan's store
  // in an equivalent form is that plan, so it meets that plan's spend gate exactly as the exact spelling does —
  // where an exact-string match would have booted it unmeasured.
  it("gives a pin spelling a live monthly-spend store in an equivalent form that plan's spend gate", async () => {
    let probes = 0;
    const gated = await gateOver({
      deps: countingDeps({ onProbe: () => (probes += 1) }),
      force: true,
      pinnedStoreDir: "/stores/café",
      text: JSON.stringify([
        { alias: "plan-one", allowance: { kind: "monthly-spend" }, storeDir: "/stores/café" },
        { alias: "plan-two", storeDir: "/stores/plan-two" },
      ]),
      unreadableHatchOpen: true,
    });
    expect([gated.refusalKind, gated.storeDir, probes]).toStrictEqual(["not-measured", "/stores/café", 0]);
  });

  // The keychain service hashes to 8 hex, so these two DISTINCT paths are one credential
  // (both `Claude Code-credentials-363c5003`), and a standing pin on the other spelling is the paused plan.
  it("refuses a pin on a different path that derives the paused store's keychain service", async () => {
    const gated = await gateOver({
      deps: offlineDeps(),
      force: true,
      pinnedStoreDir: "/stores/collision-99732",
      text: JSON.stringify([{ alias: "plan-one", paused: PAUSED, storeDir: "/stores/collision-77665" }]),
      unreadableHatchOpen: true,
    });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["paused", "/stores/collision-99732"]);
  });

  // The Codex counterexample exactly: a lone plan, paused under a pin, with force AND the hatch open.
  it("is released by neither force nor the unreadable-plan hatch, on a lone plan too", async () => {
    const gated = await gateOver({
      deps: offlineDeps(),
      force: true,
      pinnedStoreDir: "/stores/plan-one",
      text: JSON.stringify([{ alias: "plan-one", paused: PAUSED, storeDir: "/stores/plan-one" }]),
      unreadableHatchOpen: true,
    });
    expect([gated.refusalKind, gated.storeDir]).toStrictEqual(["paused", "/stores/plan-one"]);
  });
});
