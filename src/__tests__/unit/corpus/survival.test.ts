import { describe, expect, it } from "vitest";
import { buildCorpusManifest, type CorpusManifest } from "../../../corpus/manifest.js";
import { laneSurvival, renderSurvival, survivalClearsRebuild } from "../../../corpus/survival.js";
import type { CorpusRecord } from "../../../corpus/types.js";

/** The existence seam — a plain set of paths that exist. Not a mock; the real verb passes `existsSync` here. */
function existsIn({ paths }: { paths: readonly string[] }): (input: { path: string }) => boolean {
  const present = new Set(paths);
  return ({ path }) => present.has(path);
}

/** One record, defaulted. */
function record({ overrides = {} }: { overrides?: Partial<CorpusRecord> } = {}): CorpusRecord {
  return {
    container: "notes",
    kind: "document",
    refs: [],
    source: "self",
    sourceId: "s1",
    text: "t",
    tsIso: "2026-05-01T00:00:00.000Z",
    url: "/notes/a.md",
    ...overrides,
  };
}

/** A manifest over the given records, with only `paths` still on disk. */
function manifestOver({
  records,
  paths,
}: {
  records: readonly CorpusRecord[];
  paths: readonly string[];
}): CorpusManifest {
  return buildCorpusManifest({ exists: existsIn({ paths }), records });
}

describe("laneSurvival", () => {
  it("grades a lane LOSSY when an origin file is gone, and names how many", () => {
    const manifest = manifestOver({
      paths: ["/notes/a.md"],
      records: [
        record({ overrides: { sourceId: "a", url: "/notes/a.md" } }),
        record({ overrides: { sourceId: "b", url: "/notes/b.md" } }),
        record({ overrides: { sourceId: "c", url: "/notes/c.md" } }),
      ],
    });
    const lanes = laneSurvival({ manifest });
    expect(lanes.length).toBe(1);
    expect(lanes[0]!.source).toBe("self");
    expect(lanes[0]!.verdict).toBe("lossy");
    expect(lanes[0]!.present).toBe(1);
    expect(lanes[0]!.missing).toBe(2);
  });

  it("grades a lane INTACT only when every origin still exists", () => {
    const manifest = manifestOver({
      paths: ["/notes/a.md", "/notes/b.md"],
      records: [
        record({ overrides: { sourceId: "a", url: "/notes/a.md" } }),
        record({ overrides: { sourceId: "b", url: "/notes/b.md" } }),
      ],
    });
    expect(laneSurvival({ manifest })[0]!.verdict).toBe("intact");
  });

  it("grades a fetched lane NO-LOCAL-ORIGINS, which is not the same as intact", () => {
    const manifest = manifestOver({
      paths: [],
      records: [
        record({
          overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1", url: "https://x/1" },
        }),
      ],
    });
    const lanes = laneSurvival({ manifest });
    expect(lanes[0]!.verdict).toBe("no-local-origins");
    expect(lanes[0]!.present).toBe(0);
    expect(lanes[0]!.missing).toBe(0);
  });

  it("gives every source a row, sorted, so an absent lane is never an absent problem", () => {
    const manifest = manifestOver({
      paths: [],
      records: [
        record({ overrides: { sourceId: "a", url: "/notes/a.md" } }),
        record({ overrides: { source: "gold", sourceId: "g", url: "/gold/g.md" } }),
        record({
          overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1", url: "https://x/1" },
        }),
      ],
    });
    expect(laneSurvival({ manifest }).map((lane) => lane.source)).toEqual(["github", "gold", "self"]);
  });

  it("is an empty reading for an empty corpus", () => {
    expect(laneSurvival({ manifest: manifestOver({ paths: [], records: [] }) })).toEqual([]);
  });
});

describe("survivalClearsRebuild", () => {
  it("clears only an intact lane — a fetched lane is NOT cleared by a reading that looked at nothing", () => {
    const lossy = manifestOver({ paths: [], records: [record()] });
    const intact = manifestOver({ paths: ["/notes/a.md"], records: [record()] });
    const fetched = manifestOver({
      paths: [],
      records: [record({ overrides: { source: "github", url: "https://x/1" } })],
    });
    expect(survivalClearsRebuild({ lane: laneSurvival({ manifest: lossy })[0]! })).toBe(false);
    expect(survivalClearsRebuild({ lane: laneSurvival({ manifest: intact })[0]! })).toBe(true);
    expect(survivalClearsRebuild({ lane: laneSurvival({ manifest: fetched })[0]! })).toBe(false);
  });
});

describe("renderSurvival", () => {
  it("leads with the lossy lanes and counts them", () => {
    const manifest = manifestOver({
      paths: ["/notes/a.md"],
      records: [
        record({ overrides: { sourceId: "a", url: "/notes/a.md" } }),
        record({ overrides: { sourceId: "b", url: "/notes/b.md" } }),
        record({
          overrides: { container: "owner/repo", kind: "pr", source: "github", sourceId: "#1", url: "https://x/1" },
        }),
      ],
    });
    const lines = renderSurvival({ lanes: laneSurvival({ manifest }) });
    expect(lines[0]).toBe("origin survival: 1 lane(s) CANNOT be rebuilt by re-scanning");
    expect(lines[1]).toBe("  LOST  self: 1 of 2 origin file(s) are GONE — a re-scan cannot rebuild this lane");
    expect(lines[2]).toBe("  ----  github: no local origins — this reading says nothing about it");
  });

  it("says so plainly when nothing was lost", () => {
    const manifest = manifestOver({ paths: ["/notes/a.md"], records: [record()] });
    expect(renderSurvival({ lanes: laneSurvival({ manifest }) })).toEqual([
      "origin survival: no lane has lost an origin file",
      "  ok    self: all 1 origin file(s) still exist",
    ]);
  });

  it("names no path, because a real origin path is an absolute path under the owner's home", () => {
    const manifest = manifestOver({
      paths: [],
      records: [record({ overrides: { url: "/scan/root/private-notes/plan.md" } })],
    });
    const lines = renderSurvival({ lanes: laneSurvival({ manifest }) });
    expect(lines.some((line) => line.includes("private-notes"))).toBe(false);
    expect(lines.some((line) => line.includes("/scan/"))).toBe(false);
  });
});
