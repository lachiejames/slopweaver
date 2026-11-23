/**
 * Unit: `atlas make fill`'s exits before any request — a missing token is an expected-empty prerequisite, a
 * zone off the published set is a fault, and an unknown flag is a usage error. Each returns before a client
 * is built, so nothing here reaches the network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runMakeFillVerb } from "../../../../../../cli/commands/atlas/make/fillRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";

describe("runMakeFillVerb", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A home whose secrets directory holds exactly these files. */
  function homeWith({ files }: { files: Readonly<Record<string, string>> }): string {
    const home = mkdtempSync(join(tmpdir(), "make-fill-verb-"));
    homes.push(home);
    mkdirSync(join(home, "secrets"), { mode: 0o700 });
    for (const [name, value] of Object.entries(files)) {
      writeFileSync(join(home, "secrets", name), value, { mode: 0o600 });
    }
    return home;
  }

  /** The verb's argv against this home, with any extra flags. */
  function argv({ home, extra = [] }: { home: string; extra?: readonly string[] }): readonly string[] {
    return ["node", "slopweaver", "atlas", "make", "fill", "--home", home, ...extra];
  }

  it("exits expected-empty when no token is provisioned", async () => {
    expect(await runMakeFillVerb(argv({ home: homeWith({ files: {} }) }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("fails on a zone off the published set", async () => {
    const home = homeWith({ files: { "make-api-token": "tok", "make-zone": "make.example.org" } });
    expect(await runMakeFillVerb(argv({ home }))).toBe(EXIT_ERROR);
  });

  it("refuses an unknown flag as usage", async () => {
    expect(await runMakeFillVerb(argv({ extra: ["--write"], home: homeWith({ files: {} }) }))).toBe(EXIT_USAGE);
  });
});
