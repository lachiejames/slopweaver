import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decidedOutcome,
  type FleetSyncPlan,
  fleetSyncDue,
  planFleetSync,
  publishableCheckout,
} from "../../../codexPlugin/fleetPlan.js";
import { unwrap } from "../../../lib/result.js";
import { gitInTemp } from "../../tempGitRepo.js";
import {
  disposeTemplate,
  type Fleet,
  homesOf,
  loopInstallPath,
  MARKETPLACE_WITH_SLOPWEAVER,
  makeFleet,
  marketplacePath,
  stampInstall,
  writeMarketplace,
} from "./fleetFixture.js";

let fleet: Fleet;

beforeEach(() => {
  fleet = makeFleet();
});

afterEach(() => {
  rmSync(fleet.root, { force: true, recursive: true });
});

afterAll(disposeTemplate);

/** Plan the fixture fleet in the hook's scope, throwing on a skip — every caller expects a plan. */
function hookPlan(): FleetSyncPlan {
  const plan = unwrap(
    planFleetSync({
      homes: homesOf({ fleet }),
      mainCheckouts: [fleet.paths.checkout],
      paths: fleet.paths,
      scope: "update-installed",
    }),
  );
  if ("skip" in plan) {
    throw new Error(`expected a plan, got a skip: ${plan.skip}`);
  }
  return plan;
}

describe("publishableCheckout", () => {
  it("publishes a declared main checkout's HEAD", () => {
    expect(unwrap(publishableCheckout({ mainCheckouts: [fleet.paths.checkout], paths: fleet.paths }))).toEqual({
      head: fleet.head,
    });
  });

  it("skips a main checkout sitting on a branch other than origin's default", () => {
    gitInTemp({ args: ["checkout", "-qb", "feature"], cwd: fleet.paths.checkout });
    expect(unwrap(publishableCheckout({ mainCheckouts: [fleet.paths.checkout], paths: fleet.paths }))).toEqual({
      skip: `${fleet.paths.checkout} is on feature, not main, and only the default branch publishes`,
    });
  });

  it("skips a checkout whose origin/HEAD is unset, naming the command that sets it", () => {
    gitInTemp({ args: ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], cwd: fleet.paths.checkout });
    expect(unwrap(publishableCheckout({ mainCheckouts: [fleet.paths.checkout], paths: fleet.paths }))).toEqual({
      skip: `${fleet.paths.checkout} has no origin/HEAD, so its default branch is unknown — run \`git remote set-head origin --auto\``,
    });
  });

  it("skips a declared main checkout carrying no slopweaver Codex manifest", () => {
    rmSync(join(fleet.paths.checkout, ".codex-plugin"), { recursive: true });
    expect(unwrap(publishableCheckout({ mainCheckouts: [fleet.paths.checkout], paths: fleet.paths }))).toEqual({
      skip: `${fleet.paths.checkout} carries no slopweaver Codex manifest`,
    });
  });
});

describe("planFleetSync", () => {
  it("plans a foreground first install into every home without writing the marketplace or the export", () => {
    const plan = unwrap(
      planFleetSync({
        homes: homesOf({ fleet }),
        mainCheckouts: [fleet.paths.checkout],
        paths: fleet.paths,
        scope: "install-every-home",
      }),
    );
    expect(plan).toMatchObject({
      head: fleet.head,
      homes: [{ action: "refresh" }, { action: "refresh" }],
    });
    expect([
      existsSync(marketplacePath({ userHome: fleet.paths.userHome })),
      existsSync(join(fleet.paths.exportRoot, "slopweaver")),
    ]).toEqual([false, false]);
  });

  it("plans the hook's scope to refresh only a stamped home, and is then due", () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    stampInstall({ codexHome: fleet.ambient, commit: "d".repeat(40) });
    const plan = hookPlan();
    expect(plan).toMatchObject({ homes: [{ action: "untouched" }, { action: "refresh" }] });
    expect(fleetSyncDue({ plan })).toBe(true);
  });

  it("leaves a home whose stamp cannot be looked up untouched in the hook's scope, as for no stamp", () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    loopInstallPath({ codexHome: fleet.registered });
    stampInstall({ codexHome: fleet.ambient, commit: "d".repeat(40) });

    expect(hookPlan().homes[0]).toEqual({
      action: "untouched",
      home: { codexHome: fleet.registered, registered: true },
      why: "not installed here — run `slopweaver codex plugin-sync`",
    });
  });

  it("plans a foreground install over a home whose stamp cannot be looked up, as for no stamp", () => {
    loopInstallPath({ codexHome: fleet.registered });
    const plan = unwrap(
      planFleetSync({
        homes: homesOf({ fleet }),
        mainCheckouts: [fleet.paths.checkout],
        paths: fleet.paths,
        scope: "install-every-home",
      }),
    );

    expect(plan).toMatchObject({ homes: [{ action: "refresh" }, { action: "refresh" }] });
  });
});

describe("decidedOutcome", () => {
  it("renders each decision as its home's outcome, a missing registered home as its failure", () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    rmSync(fleet.registered, { recursive: true });
    const plan = hookPlan();

    expect(fleetSyncDue({ plan })).toBe(false);
    expect(decidedOutcome({ plan })).toMatchObject({
      did: "synced",
      homes: [
        { codexHome: fleet.registered, did: "failed", error: { code: "CODEX_HOME_MISSING" } },
        { codexHome: fleet.ambient, did: "untouched", why: "not installed here — run `slopweaver codex plugin-sync`" },
      ],
    });
  });
});
