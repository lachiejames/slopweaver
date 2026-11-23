/**
 * Bringing a pre-`.jsonl` generation back, and refusing to guess at a document that is not one.
 *
 * The planning half is pure over an injected existence predicate; the round-trip half writes into a
 * `mkdtempSync` directory and reads the bytes back, which is the fixture case `testing.md` allows.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { digestOfKindFile } from "../../../../atlas/atlasFile.js";
import { atlasSidecarErrorLines } from "../../../../atlas/kit/sidecarErrors.js";
import {
  planSingleFileRepair,
  repairSingleFileGeneration,
  splitSingleFileDocument,
} from "../../../../atlas/kit/singleFileRepair.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway atlas directory for one test.
 *
 * @returns the platform root and its `_superseded` slot
 */
function scratchAtlas(): { root: string; superseded: string } {
  const home = mkdtempSync(join(tmpdir(), "atlas-repair-"));
  created.push(home);
  const root = join(home, "atlas", "workos");
  const superseded = join(home, "atlas", "_superseded", "workos");
  mkdirSync(root, { recursive: true });
  return { root, superseded };
}

describe("planSingleFileRepair", () => {
  it("plans a kind whose current file is absent and whose legacy file is there", () => {
    const planned = planSingleFileRepair({
      exists: ({ path }) => path.endsWith(".json"),
      kinds: { user: "/a/users.jsonl" },
    });
    expect(planned).toEqual([{ kind: "user", singleFilePath: "/a/users.json", path: "/a/users.jsonl" }]);
  });

  it("plans nothing for a kind already in the current layout, even when the legacy file is still there", () => {
    expect(planSingleFileRepair({ exists: () => true, kinds: { user: "/a/users.jsonl" } })).toEqual([]);
  });

  it("plans nothing for a kind with no file of either kind", () => {
    expect(planSingleFileRepair({ exists: () => false, kinds: { user: "/a/users.jsonl" } })).toEqual([]);
  });

  it("orders the plan by kind, so two runs over one atlas produce the same archive", () => {
    const planned = planSingleFileRepair({
      exists: ({ path }) => path.endsWith(".json"),
      kinds: { user: "/a/users.jsonl", connection: "/a/connections.jsonl" },
    });
    expect(planned.map((entry) => entry.kind)).toEqual(["connection", "user"]);
  });
});

describe("splitSingleFileDocument", () => {
  it("empties the entities out of the envelope and hands both back", () => {
    const split = unwrap(
      splitSingleFileDocument({ document: { entities: [{ id: "a" }], gaps: [], schemaVersion: 1 } }),
    );
    expect(split.entities).toEqual([{ id: "a" }]);
    expect(split.envelope).toEqual({ entities: [], gaps: [], schemaVersion: 1 });
  });

  it("refuses a document with no entities array rather than inventing an empty one", () => {
    expect(
      atlasSidecarErrorLines({ error: unwrapErr(splitSingleFileDocument({ document: { schemaVersion: 1 } })) })[0],
    ).toContain("no `entities` array");
  });

  it("refuses a document that is not an object at all", () => {
    expect(atlasSidecarErrorLines({ error: unwrapErr(splitSingleFileDocument({ document: [1, 2] })) })[0]).toContain(
      "not a JSON object",
    );
  });
});

describe("repairSingleFileGeneration", () => {
  it("rewrites the legacy document, restamps the manifest digest and archives what it replaced", () => {
    const { root, superseded } = scratchAtlas();
    const legacy = { entities: [{ id: "u1" }, { id: "u2" }], gaps: [], schemaVersion: 1 };
    writeFileSync(join(root, "users.json"), JSON.stringify(legacy), "utf8");
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({
        kinds: {
          user: { digest: "stale", entityCount: 99, lastAttempt: null, lastSuccessAt: "2026-09-05T00:00:00.000Z" },
        },
        platform: "workos",
        schemaVersion: 1,
        updatedAt: "2026-09-05T00:00:00.000Z",
      }),
      "utf8",
    );

    const repaired = unwrap(
      repairSingleFileGeneration({
        nowIso: "2026-09-06T10:00:00.000Z",
        paths: { kinds: { user: join(root, "users.jsonl") }, manifest: join(root, "manifest.json"), superseded },
      }),
    );

    expect(repaired.map((entry) => entry.kind)).toEqual(["user"]);
    expect(repaired[0]!.entityCount).toBe(2);

    const lines = readFileSync(join(root, "users.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ entities: [], gaps: [], schemaVersion: 1 });
    expect(JSON.parse(lines[1]!)).toEqual({ id: "u1" });

    const manifest: unknown = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const expected = digestOfKindFile({
      entities: legacy.entities,
      envelope: { entities: [], gaps: [], schemaVersion: 1 },
    });
    expect(JSON.stringify(manifest)).toContain(expected);
    expect(JSON.stringify(manifest)).not.toContain("stale");

    const archived: unknown = JSON.parse(
      readFileSync(join(superseded, "legacy-json-2026-09-06T10-00-00.000Z", "users.json"), "utf8"),
    );
    expect(archived).toEqual(legacy);
  });

  it("repairs nothing and reports nothing when the generation is already in the current layout", () => {
    const { root, superseded } = scratchAtlas();
    writeFileSync(join(root, "users.jsonl"), '{"entities":[],"schemaVersion":1}\n', "utf8");
    const repaired = unwrap(
      repairSingleFileGeneration({
        nowIso: "2026-09-06T10:00:00.000Z",
        paths: { kinds: { user: join(root, "users.jsonl") }, manifest: join(root, "manifest.json"), superseded },
      }),
    );
    expect(repaired).toEqual([]);
  });

  it("refuses a dangling legacy link before rewriting any other kind", () => {
    const { root, superseded } = scratchAtlas();
    writeFileSync(join(root, "groups.json"), '{"entities":[{"id":"g1"}],"schemaVersion":1}', "utf8");
    symlinkSync(join(root, "gone.json"), join(root, "users.json"));
    const cell = { digest: "stale", entityCount: 1, lastAttempt: null, lastSuccessAt: "2026-09-05T00:00:00.000Z" };
    const manifest = JSON.stringify({ kinds: { group: cell, user: cell }, platform: "workos", schemaVersion: 1 });
    writeFileSync(join(root, "manifest.json"), manifest, "utf8");
    const repaired = repairSingleFileGeneration({
      nowIso: "2026-09-06T10:00:00.000Z",
      paths: {
        kinds: { group: join(root, "groups.jsonl"), user: join(root, "users.jsonl") },
        manifest: join(root, "manifest.json"),
        superseded,
      },
    });
    expect(unwrapErr(repaired).code).toBe("UPSTREAM_FAILED");
    expect(atlasSidecarErrorLines({ error: unwrapErr(repaired) })[0]).toContain(
      `cannot read ${join(root, "users.json")}: ENOENT`,
    );
    expect(existsSync(join(root, "groups.jsonl"))).toBe(false);
    expect(existsSync(join(root, "groups.json"))).toBe(true);
    expect(readFileSync(join(root, "manifest.json"), "utf8")).toBe(manifest);
  });

  it("refuses when a legacy document is present and its manifest cell is not", () => {
    const { root, superseded } = scratchAtlas();
    writeFileSync(join(root, "users.json"), '{"entities":[],"schemaVersion":1}', "utf8");
    writeFileSync(join(root, "manifest.json"), '{"kinds":{},"platform":"workos"}', "utf8");
    const repaired = repairSingleFileGeneration({
      nowIso: "2026-09-06T10:00:00.000Z",
      paths: { kinds: { user: join(root, "users.jsonl") }, manifest: join(root, "manifest.json"), superseded },
    });
    expect(repaired.isErr()).toBe(true);
    expect(atlasSidecarErrorLines({ error: unwrapErr(repaired) })[0]).toContain("no cell for user");
    expect(existsSync(join(root, "users.jsonl"))).toBe(false);
    expect(existsSync(join(root, "users.json"))).toBe(true);
  });

  it("refuses a legacy document or a manifest that is not JSON by its path, writing nothing", () => {
    const { root, superseded } = scratchAtlas();
    const paths = {
      kinds: { group: join(root, "groups.jsonl"), user: join(root, "users.jsonl") },
      manifest: join(root, "manifest.json"),
      superseded,
    };
    writeFileSync(join(root, "groups.json"), '{"entities":[{"id":"g1"}],"schemaVersion":1}', "utf8");
    writeFileSync(join(root, "users.json"), "{", "utf8");
    writeFileSync(join(root, "manifest.json"), "{", "utf8");
    const legacy = unwrapErr(repairSingleFileGeneration({ nowIso: "2026-09-06T10:00:00.000Z", paths }));
    expect(legacy.code).toBe("REPAIR_INPUT_NOT_JSON");
    expect(legacy.message).toContain(`${join(root, "users.json")} is not valid JSON (`);
    expect(legacy.message).toContain("— the repair wrote nothing; restore that file");
    rmSync(join(root, "users.json"));
    const manifest = unwrapErr(repairSingleFileGeneration({ nowIso: "2026-09-06T10:00:00.000Z", paths }));
    expect(manifest.code).toBe("REPAIR_INPUT_NOT_JSON");
    expect(manifest.message).toContain(`${join(root, "manifest.json")} is not valid JSON (`);
    expect(existsSync(join(root, "groups.jsonl"))).toBe(false);
    expect(existsSync(join(root, "groups.json"))).toBe(true);
  });

  it("refuses a dangling manifest link before rewriting or archiving any kind", () => {
    const { root, superseded } = scratchAtlas();
    writeFileSync(join(root, "groups.json"), '{"entities":[{"id":"g1"}],"schemaVersion":1}', "utf8");
    symlinkSync(join(root, "gone-manifest.json"), join(root, "manifest.json"));
    const repaired = repairSingleFileGeneration({
      nowIso: "2026-09-06T10:00:00.000Z",
      paths: { kinds: { group: join(root, "groups.jsonl") }, manifest: join(root, "manifest.json"), superseded },
    });
    expect(unwrapErr(repaired).code).toBe("UPSTREAM_FAILED");
    expect(atlasSidecarErrorLines({ error: unwrapErr(repaired) })[0]).toContain(
      `cannot read ${join(root, "manifest.json")}: ENOENT`,
    );
    expect(existsSync(join(root, "groups.jsonl"))).toBe(false);
    expect(existsSync(join(root, "groups.json"))).toBe(true);
    expect(existsSync(superseded)).toBe(false);
  });
});
