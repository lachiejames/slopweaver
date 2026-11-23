/**
 * Which kind files an import will read, against a temp home built to carry every exclusion the real estate
 * has.
 *
 * Filesystem only for a genuine round trip — a `mkdtempSync` home written and read back — which
 * `.claude/rules/testing.md` allows and a reachable shared service is what it bans. Every path is passed
 * explicitly through `--home`, so nothing here can touch the ambient one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { kindStatusRow, planAtlasImport, unmanifestedKindStatus } from "../../../../store/atlas/plan.js";

let home = "";

afterEach(() => {
  if (home !== "") {
    rmSync(home, { force: true, recursive: true });
    home = "";
  }
});

/** Build a home whose atlas tree carries the three exclusion cases the real estate has. */
function buildHome(): string {
  home = mkdtempSync(join(tmpdir(), "atlas-plan-"));
  const vanta = join(home, "atlas", "vanta");
  mkdirSync(vanta, { recursive: true });
  writeFileSync(join(vanta, "controls.jsonl"), '{"kind":"control"}\n');
  writeFileSync(join(vanta, "frameworks.jsonl"), '{"kind":"framework"}\n');
  // Excluded: a `_`-prefixed file is sync progress, not atlas content — a directory atlas's can run to hundreds of MB.
  writeFileSync(join(vanta, "_resume.jsonl"), '{"at":"now"}\n');
  // Excluded: not a kind file at all.
  writeFileSync(join(vanta, "notes.md"), "not a kind file\n");
  writeFileSync(
    join(vanta, "manifest.json"),
    JSON.stringify({
      kinds: {
        control: {
          digest: "abc123",
          entityCount: 12,
          lastAttempt: { at: "2026-09-19T17:40:04.640Z", outcome: "ok", reasons: [] },
          lastSuccessAt: "2026-09-19T17:40:04.640Z",
          permissionBlocked: null,
        },
      },
    }),
  );
  // Excluded: a directory under `atlas/` that no registration names. The real one is `apps-surface-map`.
  const stray = join(home, "atlas", "apps-surface-map");
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, "build.jsonl"), '{"kind":"whatever"}\n');
  return home;
}

describe("planAtlasImport", () => {
  it("plans a registered platform's kind files and excludes the `_`-prefixed one", () => {
    const plan = planAtlasImport({ home: buildHome() });
    const vanta = plan.find((entry) => entry.platform === "vanta")!;
    expect(vanta.files.map((file) => file.file)).toEqual(["controls.jsonl", "frameworks.jsonl"]);
  });

  it("excludes a directory under atlas/ that no registration names", () => {
    const plan = planAtlasImport({ home: buildHome() });
    expect(plan.filter((entry) => entry.platform === "apps-surface-map")).toEqual([]);
  });

  it("plans nothing for a registered platform with no generation on disk", () => {
    const plan = planAtlasImport({ home: buildHome() });
    expect(plan.filter((entry) => entry.platform === "linear")).toEqual([]);
  });

  it("narrows to one platform when asked, without stat-ing the others", () => {
    const plan = planAtlasImport({ home: buildHome(), only: "vanta" });
    expect(plan.length).toBe(1);
    expect(plan[0]!.platform).toBe("vanta");
  });

  it("answers an empty plan for a platform that has no directory", () => {
    expect(planAtlasImport({ home: buildHome(), only: "linear" })).toEqual([]);
  });

  it("reads the manifest cell for a kind it names", () => {
    const plan = planAtlasImport({ home: buildHome(), only: "vanta" });
    const cell = plan[0]!.manifest.get("control")!;
    expect(cell.digest).toBe("abc123");
    expect(cell.entityCount).toBe(12);
    expect(cell.lastAttemptOutcome).toBe("ok");
    expect(cell.lastSuccessAt!.toISOString()).toBe("2026-09-19T17:40:04.640Z");
  });

  it("has no cell for a kind the manifest does not name", () => {
    const plan = planAtlasImport({ home: buildHome(), only: "vanta" });
    expect(plan[0]!.manifest.get("framework")).toBe(undefined);
  });
});

describe("kindStatusRow", () => {
  const generationAt = new Date("2026-09-19T00:00:00.000Z");

  it("takes the manifest's entity count, which is what the PUBLICATION claims", () => {
    const row = kindStatusRow({
      cell: {
        digest: "abc123",
        entityCount: 12,
        lastAttemptAt: null,
        lastAttemptOutcome: null,
        lastAttemptReasons: [],
        lastSuccessAt: null,
        permissionBlocked: null,
      },
      generationAt,
      kind: "control",
      platform: "vanta",
      readEpoch: null,
      schemaVersion: 4,
    });
    expect(row.entityCount).toBe(12);
    expect(row.digest).toBe("abc123");
    expect(row.schemaVersion).toBe(4);
  });

  it("takes the observed count when no manifest cell names the kind", () => {
    const row = kindStatusRow({
      cell: unmanifestedKindStatus({ entityCount: 99 }),
      generationAt,
      kind: "framework",
      platform: "vanta",
      readEpoch: "epoch-7",
      schemaVersion: null,
    });
    expect(row.entityCount).toBe(99);
    expect(row.digest).toBe(null);
    expect(row.readEpoch).toBe("epoch-7");
    expect(row.lastAttemptReasons).toEqual([]);
  });
});
