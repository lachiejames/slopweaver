import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { lintChecks } from "../../../devLint/devLint.js";
import { unregisteredEntries } from "../../../devLint/gateRegistration.js";

describe("unregisteredEntries", () => {
  it("reports a gate the lint plan never runs", () => {
    // MEASURED before this gate existed: adding `src/devLint/orphan.entry.ts` and registering it nowhere
    // left the unit suite green, knip silent, ESLint clean and every other gate passing. An unrun gate
    // reports nothing at all, forever.
    const unregistered = unregisteredEntries({
      entryPaths: ["src/devLint/orphan.entry.ts", "src/devLint/wired.entry.ts"],
      plannedArgs: ["src/devLint/wired.entry.ts"],
    });
    expect(unregistered).toEqual(["src/devLint/orphan.entry.ts"]);
  });

  it("accepts a plan that runs every entry point", () => {
    const unregistered = unregisteredEntries({
      entryPaths: ["src/devLint/a.entry.ts"],
      plannedArgs: ["--summary-only", "src/devLint/a.entry.ts"],
    });
    expect(unregistered).toEqual([]);
  });

  it("matches on the entry PATH the runner spawns, not a display name", () => {
    // Comparing gate labels would compare two hand-written strings to each other — the same "two lists
    // agreeing with one another" mistake that let an unregistered entry through in the first place.
    const unregistered = unregisteredEntries({
      entryPaths: ["src/devLint/a.entry.ts"],
      plannedArgs: ["a"],
    });
    expect(unregistered).toEqual(["src/devLint/a.entry.ts"]);
  });

  it("finds nothing when there are no entry points at all", () => {
    expect(unregisteredEntries({ entryPaths: [], plannedArgs: [] })).toEqual([]);
  });
});

describe("the real lint plan", () => {
  it("runs every gate entry point that exists on disk", () => {
    // Compared against the FILESYSTEM, not against itself. The first version asserted only
    // `entries.length > 0`, which a review pass killed in one line: delete `gate-registration` from the plan
    // and twelve other entries keep the array non-empty, so the test passes while the gate it is named after
    // stops running. A test that cannot fail for the reason in its own title is the defect this file exists
    // to catch, one level up.
    const here = dirname(fileURLToPath(import.meta.url));
    const devLintDir = join(here, "..", "..", "..", "devLint");
    const onDisk = readdirSync(devLintDir)
      .filter((name) => name.endsWith(".entry.ts"))
      .map((name) => `src/devLint/${name}`)
      .toSorted();
    const plannedArgs = lintChecks({ cwd: "/repo" }).flatMap((check) => [...check.args]);

    expect(unregisteredEntries({ entryPaths: onDisk, plannedArgs })).toEqual([]);
    expect(onDisk.length > 0).toBe(true);
  });
});
