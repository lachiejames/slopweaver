/**
 * The pre-spawn gate's PINNED arm (`src/claude/spawnStorePinned.ts`): a standing pin whose register cannot be read, a
 * store `--plan` named, and the force-releasable choice the arm hands up for `gateSpawnStore` to keep or drop.
 */
import { afterEach, describe, expect, it } from "vitest";

import { gateSpawnStore } from "../../../claude/spawnStore.js";
import { gatePinnedStore, unreadableAliases } from "../../../claude/spawnStorePinned.js";
import { unavailablePlanRegisterPort } from "../../planRegisterFixture.js";
import {
  cleanGateHome,
  countingDeps,
  makeGateHome,
  memoryGatePorts,
  offlineDeps,
  SUBSCRIPTION,
  spentDeps,
  TWO_PLANS,
  writeAccounts,
} from "./spawnStoreFixtures.js";

// No file-level `afterEach`: the cases below moved here verbatim out of `./spawnStore.test.ts`, and
// `test-enshittification` credits a moved case only when no hook stands beside it in any enclosing statement list
// (`src/devLint/testCaseRegistration.ts`). Their homes sit under this file's own `$TMPDIR` sandbox, which
// `setup-temp-root.ts` removes once the file ends; the hook lives in the one describe that did not move.

type PinnedInput = Parameters<typeof gateSpawnStore>[0];
type PinnedContext = Omit<PinnedInput["context"], "port" | "probesPort"> & Partial<ReturnType<typeof memoryGatePorts>>;

/** `gateSpawnStore` on a pinned store, unforced unless `force` says so, with no model and in-memory ports. */
function gate({
  context,
  force = false,
  pinnedStoreDir,
}: {
  context: PinnedContext;
  force?: boolean;
  pinnedStoreDir: string;
}): ReturnType<typeof gateSpawnStore> {
  return gateSpawnStore({
    context: { ...memoryGatePorts(), ...context },
    force,
    model: undefined,
    pinnedStoreDir,
  });
}

describe("unreadableAliases", () => {
  it("names each probed plan the sweep returned no reading for, in configured order", () => {
    const accounts = [{ alias: "plan-one" }, { alias: "plan-two" }, { alias: "plan-three" }];
    expect(unreadableAliases({ accounts, gauges: [{ alias: "plan-two" }] })).toStrictEqual(["plan-one", "plan-three"]);
  });

  it("names none when every probed plan read", () => {
    expect(unreadableAliases({ accounts: [{ alias: "plan-one" }], gauges: [{ alias: "plan-one" }] })).toStrictEqual([]);
  });
});

describe("gatePinnedStore hands a spent pin's release choice UP, and gateSpawnStore drops it unforced", () => {
  afterEach(cleanGateHome);

  it("carries the choice a force release would record on the spent-plan refusal", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const pinned = await gatePinnedStore({
      context: {
        ...memoryGatePorts(),
        ambient: SUBSCRIPTION,
        deps: spentDeps(),
        home: dir,
        unreadableHatchOpen: false,
      },
      home: dir,
      model: undefined,
      storeDir: "/stores/plan-one",
    });
    expect(pinned.refusalKind).toBe("spent-plan");
    expect(pinned.storeDir).toBe("/stores/plan-one");
    expect(pinned.choice).toMatchObject({ alias: "plan-one", basis: "pinned", kind: "named" });
  });

  it("records no choice once gateSpawnStore lets that refusal stand", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, deps: spentDeps(), home: dir, unreadableHatchOpen: false },
      pinnedStoreDir: "/stores/plan-one",
    });
    expect(gated.refusalKind).toBe("spent-plan");
    expect(gated.choice).toBe(undefined);
  });
});

describe("gateSpawnStore refuses a STANDING pin whose register cannot be read: its own usage limit went unread", () => {
  it("refuses the pin, carrying its store, with the hatch open and force set", async () => {
    // This asserted the pin booted as named, unmeasured, because "the register adds nothing" to a pinned seat. It
    // adds the pin's own usage limit, and the owner's ruling is that no seat boots past one nobody read.
    const dir = makeGateHome();
    writeAccounts({ dir, text: "[]" });
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, unreadableHatchOpen: true },
      force: true,
      pinnedStoreDir: "/stores/healthy",
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe("/stores/healthy");
    expect(gated.basis).toBe(undefined);
    expect(gated.refusal).toContain("no Claude spawn boots until the register reads again");
  });

  it("refuses a standing pin when the register's store is unreachable", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: { ambient: SUBSCRIPTION, home: dir, port: unavailablePlanRegisterPort(), unreadableHatchOpen: true },
      pinnedStoreDir: "/stores/healthy",
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe("/stores/healthy");
    expect(gated.refusal).toContain("ECONNREFUSED");
  });

  it("probes nothing for a pinned seat whose configuration could not be read", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: "{ truncated" });
    let probes = 0;
    await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: countingDeps({ onProbe: () => (probes += 1) }),
        home: dir,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/healthy",
    });
    expect(probes).toBe(0);
  });
});

describe("gateSpawnStore MEASURES a store `--plan` named, and never boots it unmeasured", () => {
  // The alias resolved before any worktree existed, and the register went unreadable
  // before the gate ran. A standing pin boots unmeasured there; a named plan is gated on its own gauge.
  it("refuses a named store when the register became unreadable after the alias resolved", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: "{ truncated" });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        home: dir,
        namedPin: true,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/plan-two",
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe("/stores/plan-two");
    expect(gated.refusal).toContain("could not be reread to check its usage limit and allowance");
  });

  it("refuses a named store the register no longer carries", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        namedPin: true,
        unreadableHatchOpen: false,
      },
      pinnedStoreDir: "/stores/plan-three",
    });
    expect(gated.refusalKind).toBe("unreadable-plan");
    expect(gated.storeDir).toBe("/stores/plan-three");
  });

  // The reread lost the row's usage limit and allowance, so the hatch booting the
  // store would cross a limit, or land on a monthly-spend plan, that nothing checked.
  it("still refuses that named store with the unreadable-plan hatch open, its usage limit unread", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: "{ truncated" });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        home: dir,
        namedPin: true,
        unreadableHatchOpen: true,
      },
      force: true,
      pinnedStoreDir: "/stores/plan-two",
    });
    expect(gated.refusalKind).toBe("configuration");
    expect(gated.storeDir).toBe("/stores/plan-two");
  });

  it("boots a named store the register no longer carries when the unreadable-plan hatch is open", async () => {
    const dir = makeGateHome();
    writeAccounts({ dir, text: TWO_PLANS });
    const gated = await gate({
      context: {
        ambient: SUBSCRIPTION,
        deps: offlineDeps(),
        home: dir,
        namedPin: true,
        unreadableHatchOpen: true,
      },
      pinnedStoreDir: "/stores/plan-three",
    });
    expect(gated).toStrictEqual({ basis: "unreadable-override", storeDir: "/stores/plan-three" });
  });
});
