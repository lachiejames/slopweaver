/**
 * The guard behind the owner's ruling: a merge below gold leaves gold OWED, and the tracking
 * of that debt must never delay the merge. The register is therefore WRITE-ONLY from the landing lane's
 * point of view — a session appends to it after it lands, and nothing that decides whether a pull request
 * may merge is allowed to read it.
 *
 * Prose cannot hold that. The natural next change to `mergeGuard.ts` is "refuse while this repository owes
 * gold", which reads like diligence and is exactly the failure mode: it turns a memory aid into a gate and
 * costs the throughput the ruling was protecting. So the landing lane's own sources are scanned for any
 * import of this register, and the check fails on the import rather than on the eventual refusal.
 *
 * It is a TRIPWIRE, not a fence (AGENTS.md rule 3's phrasing): a landing module reaching the ledger through
 * a re-export, a dynamic import built from a string, or a helper in a third directory is invisible to it. A
 * hit confirms the mistake; a clean run means only that the obvious shape is absent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// This test lives under `src/__tests__/unit/goldDebt/`; the tree it scans is three levels up.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Every directory whose modules decide, prepare or perform a landing. A module here is on the path between
 * "this pull request is ready" and "it is merged", which is precisely where a read of the register would
 * become a delay.
 */
const LANDING_LANE: readonly string[] = [
  join("outbound", "github"),
  join("cli", "commands", "github"),
  join("cli", "commands", "checkout"),
];

/** Every non-test `.ts` under one directory. */
function sourceFiles({ dir }: { dir: string }): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles({ dir: full }));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every landing-lane source that names the gold-debt register, repo-relative from `src/`. */
function lanesReachingTheRegister(): readonly string[] {
  return LANDING_LANE.flatMap((lane) =>
    sourceFiles({ dir: join(srcRoot, lane) })
      .filter((file) => /goldDebt\//u.test(readFileSync(file, "utf8")))
      .map((file) => relative(srcRoot, file)),
  );
}

describe("the gold-debt register is not a merge blocker", () => {
  it("scans a landing lane that actually has sources in it, so an empty sweep cannot pass vacuously", () => {
    const scanned = LANDING_LANE.flatMap((lane) => sourceFiles({ dir: join(srcRoot, lane) }));
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("finds no landing-lane module importing the register", () => {
    expect(lanesReachingTheRegister()).toEqual([]);
  });

  it("would see an import if one were there — the scan matches this file's own reference to the path", () => {
    const own = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(/goldDebt\//u.test(own)).toBe(true);
  });
});
