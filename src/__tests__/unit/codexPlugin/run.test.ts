import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CodexDestination } from "../../../codex/destinations.js";
import { CodexPluginSyncErrors } from "../../../codexPlugin/errors.js";
import { type PluginSyncDeps, pluginSyncOutcome } from "../../../codexPlugin/run.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type PlanRegisterError, PlanRegisterErrors } from "../../../plans/errors.js";
import {
  cacheOf,
  copyingAdd,
  disposeTemplate,
  type Fleet,
  fleetDeps,
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

type Destinations = Result<readonly CodexDestination[], PlanRegisterError>;

/** The core's seams over the fixture fleet, the register answering `destinations` and counting its reads. */
function coreDeps({
  destinations,
  reads = [],
  adds = [],
  mainCheckouts = [fleet.paths.checkout],
}: {
  destinations: Destinations;
  reads?: string[];
  adds?: string[];
  mainCheckouts?: readonly string[];
}): PluginSyncDeps {
  return {
    ambientCodexHome: fleet.ambient,
    log: join(fleet.paths.exportRoot, "sync.log"),
    mainCheckouts,
    paths: fleet.paths,
    readDestinations: () => {
      reads.push("read");
      return Promise.resolve(destinations);
    },
    sync: fleetDeps({ codexAdd: copyingAdd({ adds, userHome: fleet.paths.userHome }) }),
  };
}

const oneRegistered = (): Destinations => ok([{ alias: "codex-1", codexHome: fleet.registered }]);

describe("codex plugin-sync's core", () => {
  it("skips a checkout that may not publish before reading the plan register", async () => {
    const reads: string[] = [];
    const outcome = await pluginSyncOutcome({
      deps: coreDeps({ destinations: oneRegistered(), mainCheckouts: [join(fleet.root, "elsewhere")], reads }),
      mode: "decide",
    });
    expect([outcome.did, reads]).toEqual(["skipped", []]);
  });

  it("fails before touching any Codex home when the plan register cannot be read", async () => {
    const adds: string[] = [];
    const registerError = PlanRegisterErrors.registerUnreadable({ path: "/register.json" });
    const outcome = await pluginSyncOutcome({
      deps: coreDeps({ adds, destinations: err(registerError) }),
      mode: "foreground",
    });
    expect(outcome).toEqual({
      did: "failed",
      error: CodexPluginSyncErrors.destinationsUnreadable({ detail: registerError.message }),
    });
    expect([adds, existsSync(marketplacePath({ userHome: fleet.paths.userHome }))]).toEqual([[], false]);
  });

  it("installs a foreground run into every registered home and the ambient one, each once", async () => {
    const adds: string[] = [];
    const destinations = ok([
      { alias: "codex-1", codexHome: fleet.registered },
      { alias: "codex-2", codexHome: `${fleet.registered}/` },
      { alias: "codex-3", codexHome: fleet.ambient },
    ]);
    const outcome = await pluginSyncOutcome({ deps: coreDeps({ adds, destinations }), mode: "foreground" });
    expect([outcome.did, adds]).toEqual(["synced", [fleet.registered, fleet.ambient]]);
  });

  it("decides a stamped home behind HEAD is due and hands the fleet to the background run, writing nothing", async () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    stampInstall({ codexHome: fleet.registered, commit: "a".repeat(40) });
    const adds: string[] = [];

    const outcome = await pluginSyncOutcome({
      deps: coreDeps({ adds, destinations: oneRegistered() }),
      mode: "decide",
    });

    expect(outcome).toEqual({
      did: "backgrounded",
      log: join(fleet.paths.exportRoot, "sync.log"),
      why: "1 Codex home(s) behind HEAD",
    });
    expect([adds, existsSync(join(fleet.paths.exportRoot, "slopweaver"))]).toEqual([[], false]);
  });

  it("decides nothing is due when no home carries an install, naming each one", async () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });

    const outcome = await pluginSyncOutcome({ deps: coreDeps({ destinations: oneRegistered() }), mode: "decide" });

    const why = "not installed here — run `slopweaver codex plugin-sync`";
    expect(outcome).toEqual({
      did: "synced",
      homes: [
        { codexHome: fleet.registered, did: "untouched", why },
        { codexHome: fleet.ambient, did: "untouched", why },
      ],
    });
  });

  it("decides a missing registered home is that home's failure, without creating it", async () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    rmSync(fleet.registered, { recursive: true });

    const outcome = await pluginSyncOutcome({ deps: coreDeps({ destinations: oneRegistered() }), mode: "decide" });

    expect(outcome).toEqual({
      did: "synced",
      homes: [
        {
          codexHome: fleet.registered,
          did: "failed",
          error: CodexPluginSyncErrors.codexHomeMissing({ codexHome: fleet.registered }),
        },
        { codexHome: fleet.ambient, did: "untouched", why: "not installed here — run `slopweaver codex plugin-sync`" },
      ],
    });
    expect(existsSync(fleet.registered)).toBe(false);
  });

  it("decides with no marketplace that nothing is due, and writes no marketplace", async () => {
    const outcome = await pluginSyncOutcome({ deps: coreDeps({ destinations: oneRegistered() }), mode: "decide" });
    expect([outcome.did, existsSync(marketplacePath({ userHome: fleet.paths.userHome }))]).toEqual(["skipped", false]);
  });

  it("updates only the stamped home in the log mode", async () => {
    writeMarketplace({ raw: JSON.stringify(MARKETPLACE_WITH_SLOPWEAVER), userHome: fleet.paths.userHome });
    stampInstall({ codexHome: fleet.ambient, commit: "b".repeat(40) });
    const adds: string[] = [];

    const outcome = await pluginSyncOutcome({ deps: coreDeps({ adds, destinations: oneRegistered() }), mode: "log" });

    expect(outcome).toMatchObject({
      did: "synced",
      homes: [
        { codexHome: fleet.registered, did: "untouched" },
        { codexHome: fleet.ambient, did: "refreshed", installedPath: cacheOf({ codexHome: fleet.ambient }) },
      ],
    });
    expect(adds).toEqual([fleet.ambient]);
  });
});
