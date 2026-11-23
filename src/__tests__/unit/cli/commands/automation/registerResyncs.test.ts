import { describe, expect, it } from "vitest";

import {
  parseRegisterResyncsArgs,
  registerResyncsLines,
  runRegisterResyncs,
} from "../../../../../cli/commands/automation/registerResyncs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/tmp/home";

/** A sink pair, so the verb's output is a value rather than something written to a terminal. */
const sink = (): { out: string[]; diagnostics: string[] } => ({ diagnostics: [], out: [] });

describe("parseRegisterResyncsArgs", () => {
  it("defaults to writing, into the caller's default home", () => {
    const parsed = unwrap(parseRegisterResyncsArgs({ defaultHome: HOME, rest: [] }));
    expect(parsed).toEqual({ dryRun: false, home: HOME, json: false });
  });

  it("reads every flag it advertises", () => {
    const parsed = unwrap(
      parseRegisterResyncsArgs({
        defaultHome: HOME,
        rest: ["--dry-run", "--json", "--home", "/elsewhere"],
      }),
    );
    expect(parsed).toEqual({ dryRun: true, home: "/elsewhere", json: true });
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    expect(unwrapErr(parseRegisterResyncsArgs({ defaultHome: HOME, rest: ["--nope"] }))).toEqual([
      "unknown flag: --nope",
    ]);
  });
});

describe("registerResyncsLines", () => {
  it("prints one line per row that is not already correct, and never one per unchanged row", () => {
    const lines = registerResyncsLines({
      dryRun: false,
      plan: {
        changes: [
          { action: "create", definition: null, reason: null, recipeId: "resync-atlas-a" },
          { action: "unchanged", definition: null, reason: null, recipeId: "resync-atlas-b" },
          { action: "unchanged", definition: null, reason: null, recipeId: "resync-atlas-c" },
        ],
      },
      problems: [],
    });
    expect(lines).toEqual([
      "resync-atlas-a · did create",
      "automation register-resyncs · 1 created · 0 updated · 2 unchanged · 0 retired · 0 conflict(s)",
    ]);
  });

  it("carries a conflict's own reason onto its line", () => {
    const lines = registerResyncsLines({
      dryRun: false,
      plan: {
        changes: [{ action: "conflict", definition: null, reason: "argv was hand-edited", recipeId: "resync-atlas-a" }],
      },
      problems: [],
    });
    expect(lines[0]).toBe("resync-atlas-a · did conflict · argv was hand-edited");
  });

  it("says `would` and marks the tally when nothing was written", () => {
    const lines = registerResyncsLines({
      dryRun: true,
      plan: { changes: [{ action: "create", definition: null, reason: null, recipeId: "resync-atlas-a" }] },
      problems: [],
    });
    expect(lines[0]).toBe("resync-atlas-a · would create");
    expect(lines[1]).toContain("DRY RUN, nothing written");
  });

  it("prints a roster problem beside the tally rather than instead of it", () => {
    const lines = registerResyncsLines({
      dryRun: true,
      plan: { changes: [] },
      problems: ["atlas vanta: carries a placeholder"],
    });
    expect(lines[0]).toBe("roster problem · atlas vanta: carries a placeholder");
    expect(lines[1]).toContain("0 created");
  });
});

describe("runRegisterResyncs", () => {
  it("prints its usage and writes nothing for --help", async () => {
    const { out, diagnostics } = sink();
    const code = await runRegisterResyncs({
      argv: ["node", "slopweaver", "recipe", "register-resyncs", "--help"],
      deps: { writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
    });
    expect(code).toBe(0);
    expect(out[0]).toContain("usage: slopweaver automation register-resyncs");
  });

  it("refuses an unknown flag with the usage exit code, touching no home", async () => {
    const { out, diagnostics } = sink();
    const code = await runRegisterResyncs({
      argv: ["node", "slopweaver", "recipe", "register-resyncs", "--nope"],
      deps: { writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
    });
    expect(code).toBe(2);
    expect(out).toEqual([]);
  });
});
