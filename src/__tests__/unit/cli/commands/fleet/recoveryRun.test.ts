/**
 * The `fleet health | configure | resume` verbs: flag handling and exit codes over an explicit throwaway home and an
 * in-memory fleet store. `health` and `configure` run through their bodies (`fleetHealth`, `fleetConfigure`), which take
 * the store port; the `run*` composition roots reach the real store, so a unit test never calls them except on the
 * usage paths that return before anything is opened. `resume` is exercised only on those usage paths.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fleetConfigure,
  fleetHealth,
  runFleetHealth,
  runFleetResume,
} from "../../../../../cli/commands/fleet/recoveryRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryFleetPort, memoryFleetStore, unavailableFleetPort } from "../../../../fleetStoreFixture.js";
import { memoryPlanRegisterPort } from "../../../../planRegisterFixture.js";
import { makeHome } from "./fleetKit.js";

let home = "";

beforeEach(() => {
  home = makeHome();
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The argv a verb receives: runtime, entry point, noun, verb, then its own arguments. */
function argvOf({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "fleet", verb, ...rest];
}

describe("fleetConfigure", () => {
  it("writes the capacity under the named home and reads back exactly that", async () => {
    const fleet = memoryFleetPort();
    const code = await fleetConfigure({
      argv: argvOf({ rest: ["--home", home, "--capacity", "7"], verb: "configure" }),
      fleet,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(await fleet.readConfig({ home }))).toEqual({ capacity: 7, schemaVersion: 1 });
  });

  it("overwrites an earlier capacity", async () => {
    const fleet = memoryFleetPort();
    await fleetConfigure({ argv: argvOf({ rest: ["--home", home, "--capacity", "7"], verb: "configure" }), fleet });
    const code = await fleetConfigure({
      argv: argvOf({ rest: ["--home", home, "--capacity", "12", "--json"], verb: "configure" }),
      fleet,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(await fleet.readConfig({ home })).capacity).toBe(12);
  });

  it("refuses a capacity outside 1 to 100 as a usage error and opens no store", async () => {
    const store = memoryFleetStore();
    const fleet = memoryFleetPort({ store });
    const codes = await Promise.all(
      ["0", "101", "2.5", "many"].map((capacity) =>
        fleetConfigure({ argv: argvOf({ rest: ["--home", home, "--capacity", capacity], verb: "configure" }), fleet }),
      ),
    );
    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(store.opened).toBe(0);
    expect(existsSync(join(home, "fleet", "config.json"))).toBe(false);
  });

  it("refuses a missing --capacity as a usage error and opens no store", async () => {
    const store = memoryFleetStore();
    const code = await fleetConfigure({
      argv: argvOf({ rest: ["--home", home], verb: "configure" }),
      fleet: memoryFleetPort({ store }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(store.opened).toBe(0);
  });

  it("refuses a positional argument as a usage error and opens no store", async () => {
    const store = memoryFleetStore();
    const code = await fleetConfigure({
      argv: argvOf({ rest: ["--home", home, "--capacity", "7", "extra"], verb: "configure" }),
      fleet: memoryFleetPort({ store }),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(store.opened).toBe(0);
  });

  it("prints usage and succeeds on --help without writing", async () => {
    const store = memoryFleetStore();
    const code = await fleetConfigure({
      argv: argvOf({ rest: ["--home", home, "--help"], verb: "configure" }),
      fleet: memoryFleetPort({ store }),
    });
    expect(code).toBe(EXIT_OK);
    expect(store.opened).toBe(0);
  });

  it("exits 1 with a typed refusal naming the store when it cannot be reached, never writing a file instead", async () => {
    const argv = argvOf({ rest: ["--home", home, "--capacity", "7"], verb: "configure" });
    const code = await fleetConfigure({ argv, fleet: unavailableFleetPort() });
    expect(code).toBe(EXIT_ERROR);
    // The verb prints this very message after `fleet configure: `.
    const refusal = unwrapErr(
      await unavailableFleetPort().writeConfig({ config: { capacity: 7, schemaVersion: 1 }, home }),
    );
    expect(refusal.code).toBe("STORE_UNAVAILABLE");
    expect(refusal.message).toContain("live in the store, and the store could not be opened");
    expect(existsSync(join(home, "fleet"))).toBe(false);
  });
});

describe("fleetHealth", () => {
  it("exits 1 when the legacy configuration file is present and malformed, the import refusing it through the typed error", async () => {
    mkdirSync(join(home, "fleet"), { recursive: true });
    writeFileSync(join(home, "fleet", "config.json"), "{ not json");
    const fleet = memoryFleetPort();
    const code = await fleetHealth({
      argv: argvOf({ rest: ["--home", home], verb: "health" }),
      fleet,
      port: memoryPlanRegisterPort(),
    });
    expect(code).toBe(EXIT_ERROR);
    const error = unwrapErr(await fleet.readConfig({ home }));
    expect(error.code).toBe("CONFIG_INVALID");
  });

  it("exits 1 with a typed refusal naming the store when it cannot be reached, never reading a file instead", async () => {
    // A perfectly good legacy file is under the home: an outage must not fall back to it.
    mkdirSync(join(home, "fleet"), { recursive: true });
    writeFileSync(join(home, "fleet", "config.json"), JSON.stringify({ capacity: 5, schemaVersion: 1 }));
    const code = await fleetHealth({
      argv: argvOf({ rest: ["--home", home], verb: "health" }),
      fleet: unavailableFleetPort(),
      port: memoryPlanRegisterPort(),
    });
    expect(code).toBe(EXIT_ERROR);
    const refusal = unwrapErr(await unavailableFleetPort().readConfig({ home }));
    expect(refusal.code).toBe("STORE_UNAVAILABLE");
    expect(refusal.message).toContain("live in the store, and the store could not be opened");
  });

  it("refuses an unknown flag as a usage error", async () => {
    const code = await fleetHealth({
      argv: argvOf({ rest: ["--home", home, "--bogus"], verb: "health" }),
      fleet: memoryFleetPort(),
      port: memoryPlanRegisterPort(),
    });
    expect(code).toBe(EXIT_USAGE);
  });

  it("prints usage and succeeds on --help", async () => {
    const code = await fleetHealth({
      argv: argvOf({ rest: ["--help"], verb: "health" }),
      fleet: memoryFleetPort(),
      port: memoryPlanRegisterPort(),
    });
    expect(code).toBe(EXIT_OK);
  });

  it("answers --help from its composition root too, which reaches no store before parsing", async () => {
    expect(await runFleetHealth(argvOf({ rest: ["--help"], verb: "health" }))).toBe(EXIT_OK);
  });
});

describe("runFleetResume usage paths", () => {
  it("refuses a --timeout-seconds that is not a whole number of at least 1", async () => {
    const codes = await Promise.all(
      ["0", "1.5", "soon"].map((value) =>
        runFleetResume(argvOf({ rest: ["--home", home, "--timeout-seconds", value], verb: "resume" })),
      ),
    );
    expect(codes).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
  });

  it("refuses a --reorient-seconds that is not a whole number of at least 1", async () => {
    const code = await runFleetResume(argvOf({ rest: ["--home", home, "--reorient-seconds", "-5"], verb: "resume" }));
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses a positional argument", async () => {
    const code = await runFleetResume(argvOf({ rest: ["--home", home, "now"], verb: "resume" }));
    expect(code).toBe(EXIT_USAGE);
  });

  it("prints usage and succeeds on --help without opening cmux or a journal", async () => {
    const code = await runFleetResume(argvOf({ rest: ["--home", home, "--help"], verb: "resume" }));
    expect(code).toBe(EXIT_OK);
    expect(existsSync(join(home, "fleet"))).toBe(false);
  });
});
