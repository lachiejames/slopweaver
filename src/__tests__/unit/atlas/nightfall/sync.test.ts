/**
 * The compiled generation, built in memory and published to a throwaway home.
 *
 * `buildNightfallGeneration` is pure, so most of this needs no filesystem at all. The one test that writes
 * does so to a `mkdtempSync` directory it removes, and passes `home` explicitly — the ambient-home guard in
 * `.claude/rules/testing.md` is the reason both halves of that sentence matter.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NIGHTFALL_ATLAS_KINDS } from "../../../../atlas/nightfall/model.js";
import { readNightfallSnapshot } from "../../../../atlas/nightfall/readAdapter.js";
import { buildNightfallGeneration, syncNightfallAtlas } from "../../../../atlas/nightfall/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-nightfall-sync-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("buildNightfallGeneration", () => {
  it("publishes the 56 operations and 18 record shapes across every kind", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const entities = NIGHTFALL_ATLAS_KINDS.reduce((total, kind) => total + generation.files[kind].entities.length, 0);
    expect(entities).toBe(74);
  });

  it("files each operation under the kind it reaches, so a violation read comes back with the violation shape", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const violation = generation.files.violation;
    expect(violation.entities.filter((entity) => entity.family === "operation").length).toBe(5);
    expect(violation.entities.filter((entity) => entity.family === "record-shape").length).toBe(1);
    expect(violation.entities.some((entity) => entity.family === "record")).toBe(false);
  });

  it("leaves the console's landing kind empty and gives it the console gaps", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    expect(generation.files.page.entities).toStrictEqual([]);
    expect(generation.files.page.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "no-api-credential",
      "no-console-session",
      "undocumented-console-surface",
    ]);
  });

  it("raises the unresolvable-reference gap on exactly the four kinds whose records carry one", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const raised = NIGHTFALL_ATLAS_KINDS.filter((kind) =>
      generation.files[kind].gaps.some((gap) => gap.condition === "unresolvable-reference"),
    );
    expect([...raised].toSorted()).toStrictEqual(["exfiltration-event", "finding", "posture-event", "violation"]);
  });

  it("says annotations cannot be enumerated at all, which no credential would fix", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const gap = generation.files.annotation.gaps.find((candidate) => candidate.condition === "unenumerable-kind")!;
    expect(gap.fields).toStrictEqual(["dlp-get-annotations-by-annotation-id"]);
    expect(gap.reason).toContain("A credential does not close this");
  });

  it("grades the compiled channel synced and both live channels not-configured, each with its own remedy", () => {
    const generation = unwrap(buildNightfallGeneration({ at: AT }));
    const cells = generation.files["mcp-server"].coverage;
    expect(cells.map((cell) => `${cell.channel}:${cell.state}`)).toStrictEqual([
      "published-api:synced",
      "workflow-api:not-configured",
      "console:not-configured",
    ]);
    expect(cells[1]!.unblockedBy).toContain("slopweaver secrets set nightfall-api-key");
    expect(cells[2]!.unblockedBy).toContain("sign in to app.nightfall.ai");
  });

  it("builds byte-identical documents for the same instant", () => {
    const first = unwrap(buildNightfallGeneration({ at: AT }));
    const second = unwrap(buildNightfallGeneration({ at: AT }));
    expect(JSON.stringify(second.files)).toBe(JSON.stringify(first.files));
  });
});

describe("syncNightfallAtlas", () => {
  it("publishes a generation the read adapter can read back", () => {
    const home = scratchHome();
    const report = unwrap(syncNightfallAtlas({ at: AT, home }));
    expect(report.entitiesByKind.length).toBe(19);
    expect(report.gaps).toBe(26);

    const snapshot = unwrap(readNightfallSnapshot({ home }));
    expect(snapshot.generation.platform).toBe("nightfall");
    expect(snapshot.generation.updatedAt).toBe(AT);
    expect(snapshot.generation.missing).toStrictEqual([]);
    expect(snapshot.generation.mismatched).toStrictEqual([]);
    const violation = snapshot.kinds.find((kind) => kind.kind === "violation")!;
    expect(violation.entities.length).toBe(6);
    expect(violation.publishedCount).toBe(6);
  });

  it("writes the manifest last, after every kind file it names", () => {
    const home = scratchHome();
    const report = unwrap(syncNightfallAtlas({ at: AT, home }));
    expect(report.written.at(-1)).toBe(join(home, "atlas", "nightfall", "manifest.json"));
    expect(report.written.length).toBe(20);
  });

  it("stores no value from this organisation — every published detail is a name the vendor declared", () => {
    const home = scratchHome();
    unwrap(syncNightfallAtlas({ at: AT, home }));
    const raw = readFileSync(join(home, "atlas", "nightfall", "violation.jsonl"), "utf8");
    expect(raw).toContain('"schemaName":"Violation"');
    expect(raw).toContain("api.nightfall.ai/dlp/v1");
    expect(raw).not.toContain("Bearer");
  });
});
