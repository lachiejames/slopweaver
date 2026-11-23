/**
 * The `fleet status` verb's argument handling.
 *
 * `say` / `stop` / `up` / `reap` were tested here before the headless launcher they served was deleted
 * (AGENTS.md rule 2). `status` is the only verb left, and every case below is either a parse, a usage line, or
 * a refusal reached before the verb measures anything.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FLEET_FLAG_NAMES,
  type FleetVerb,
  fleetPaths,
  fleetUsage,
  parseFleetArgs,
} from "../../../../cli/commands/fleet/core.js";
import { runFleetStatus } from "../../../../cli/commands/fleet/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import type { ParsedFlags } from "../../../../cli/parseFlags.js";
import { unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Parse a verb's flags, throwing when the parse fails.
 *
 * A throwing helper rather than a ternary at each call site: the alternative reads as a conditional in the test
 * body and would let a case pass with a fabricated empty flag set if the parser ever started rejecting.
 */
function flags({ verb, rest }: { verb: FleetVerb; rest: readonly string[] }): ParsedFlags {
  const parsed = parseFleetArgs({ rest, verb });
  if (parsed.isErr()) {
    throw new Error(`expected a clean parse of ${verb} ${rest.join(" ")}, got: ${parsed.error.join("; ")}`);
  }
  return parsed.value;
}

/** Build an argv the router would hand a verb: `[node, cli, noun, verb, …rest]`. */
function argv({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "fleet", verb, ...rest];
}

/** A handover directory holding one doc, plus a home whose runs directory is empty. */
function board({ text }: { text: string }): { dir: string; home: string } {
  const dir = mkdtempSync(join(tmpdir(), "fleet-cli-docs-"));
  fixtureDirs.push(dir);
  writeFileSync(join(dir, "a-doc.md"), text, "utf8");
  const home = mkdtempSync(join(tmpdir(), "fleet-cli-home-"));
  fixtureDirs.push(home);
  return { dir, home };
}

/** A minimal doc with no run. */
const DOC = ["---", "slug: a-doc", "summary: a thing", "status: ready", "repo: /tmp/nowhere", "---", "", "body"].join(
  "\n",
);

describe("fleetUsage", () => {
  it("advertises the positional tail status takes", () => {
    expect(fleetUsage({ verb: "status" })).toContain("fleet status [<slug>…]");
  });

  it("renders a value flag with a placeholder and a switch without one", () => {
    const usage = fleetUsage({ verb: "status" });

    expect(usage).toContain("[--base <value>]");
    expect(usage).toContain("[--json]");
  });

  it("renders a verb with no positional tail from its own spec, sorted", () => {
    expect(fleetUsage({ verb: "health" })).toBe("usage: slopweaver fleet health [--home <value>] [--json]");
  });
});

describe("fleetPaths", () => {
  it("reads the docs from --dir when it is passed", () => {
    expect(fleetPaths({ parsed: flags({ rest: ["--dir", "/docs", "--home", "/h"], verb: "status" }) })).toEqual({
      handoverDir: "/docs",
      runsDir: stateHomePaths({ home: "/h" }).runs,
    });
  });

  it("reads the docs from the home's handover directory when --dir is absent", () => {
    expect(fleetPaths({ parsed: flags({ rest: ["--home", "/h"], verb: "status" }) })).toEqual({
      handoverDir: stateHomePaths({ home: "/h" }).handovers,
      runsDir: stateHomePaths({ home: "/h" }).runs,
    });
  });
});

describe("parseFleetArgs", () => {
  it("keeps the slug as a positional rather than rejecting it", () => {
    expect(flags({ rest: ["a-doc", "b-doc"], verb: "status" }).positionals).toEqual(["a-doc", "b-doc"]);
  });

  it("refuses a flag it does not know", () => {
    const parsed = parseFleetArgs({ rest: ["--not-a-real-flag"], verb: "status" });

    expect(unwrapErr(parsed)).toEqual(["unknown flag: --not-a-real-flag"]);
  });

  it("publishes the verb's flag names for the help-truth ratchet", () => {
    expect(FLEET_FLAG_NAMES["status"]).toEqual(["--base", "--dir", "--home", "--json"]);
  });
});

describe("fleet status", () => {
  it("prints usage on --help without measuring anything", async () => {
    expect(await runFleetStatus(argv({ rest: ["--help"], verb: "status" }))).toBe(EXIT_OK);
  });

  it("rejects an unknown flag before its act phase", async () => {
    expect(await runFleetStatus(argv({ rest: ["--nope"], verb: "status" }))).toBe(EXIT_USAGE);
  });

  it("refuses to be silent about a slug no doc claims", async () => {
    const { dir, home } = board({ text: DOC });

    expect(await runFleetStatus(argv({ rest: ["missing-doc", "--dir", dir, "--home", home], verb: "status" }))).toBe(
      EXIT_ERROR,
    );
  });

  it("reports a board with no live runs as nothing to report", async () => {
    const { dir, home } = board({ text: DOC });

    expect(await runFleetStatus(argv({ rest: ["--dir", dir, "--home", home], verb: "status" }))).toBe(EXIT_OK);
  });
});
