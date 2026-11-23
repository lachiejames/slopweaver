import { describe, expect, it } from "vitest";
import { analyzeCoverage, EMPTY_SCOPE, type SourceFile } from "../../../admit/coverage.js";
import { SANCTIONED_SEAMS } from "../../../admit/sanctionedSeams.js";
import type { DoorEffect } from "../../../admit/types.js";
import type { CommandMeta } from "../../../cli/defineCommand.js";
import { lazy } from "../../../cli/manifest.js";
import type { NounGroups } from "../../../cli/router.js";

/** A complete CommandMeta fixture varying only the door-relevant fields. */
function metaWith({ effect, doorRouted = false }: { effect: DoorEffect; doorRouted?: boolean }): CommandMeta {
  return {
    createsWorkItem: false,
    diagnostic: false,
    doorRouted,
    dryParseSafe: false,
    effect,
    example: null,
    parseRejectIsIoFree: false,
    summary: "s",
    usage: "u",
  };
}

/** A registry with one fully-accounted verb (external-write + doorRouted). */
const routedGroups: NounGroups = {
  demo: {
    run: lazy({ load: () => Promise.resolve(() => 0), meta: metaWith({ doorRouted: true, effect: "external-write" }) }),
  },
};

const cleanFiles: readonly SourceFile[] = [
  { content: "writeFileSync(path, x)", path: "src/lib/jsonFile.ts" }, // sanctioned local-state
  { content: "const x = 1", path: "src/admit/door.ts" }, // no seam
];

describe("analyzeCoverage", () => {
  it("is ok when every seam is sanctioned and every verb accounts for its effect", () => {
    const report = analyzeCoverage({ files: cleanFiles, groups: routedGroups });
    expect(report.ok).toBe(true);
    expect(report.open).toEqual([]);
    expect(report.verbGaps).toEqual([]);
  });

  it("reports a direct write in an un-sanctioned file as an OPEN seam and fails", () => {
    const report = analyzeCoverage({
      files: [{ content: "writeFileSync(p, x)", path: "src/connectors/slack.ts" }],
      groups: routedGroups,
    });
    expect(report.ok).toBe(false);
    expect(report.open.map((s) => s.file)).toEqual(["src/connectors/slack.ts"]);
    expect(report.open[0]!.seam).toBe("writeFileSync");
  });

  it("classes a sanctioned file's seam by its declared class, not open", () => {
    const report = analyzeCoverage({
      files: [{ content: "spawn(cmd)", path: "src/codex/gitRun.ts" }],
      groups: routedGroups,
    });
    expect(report.seams[0]!.seamClass).toBe("read-only-tool");
    expect(report.open).toEqual([]);
  });

  it("fails when an external-write verb is not routed through the door", () => {
    const groups: NounGroups = {
      demo: { run: lazy({ load: () => Promise.resolve(() => 0), meta: metaWith({ effect: "external-write" }) }) },
    };
    const report = analyzeCoverage({ files: cleanFiles, groups });
    expect(report.verbGaps).toEqual([{ noun: "demo", reason: "external-write-not-routed", verb: "run" }]);
  });
});

describe("analyzeCoverage — a partial scan cannot claim completeness", () => {
  it("is NOT ok when a path could not be read, even with zero open seams and zero verb gaps", () => {
    // MEASURED before this guard: with `src/outbound/slack` unreadable the walker found 67 seams instead of
    // 81 and still printed "100% ... every seam accounted for", exit 0. Fourteen seams vanished and the
    // verdict did not move, because the percentage was computed over whatever the walker managed to read.
    const report = analyzeCoverage({ files: [], groups: {}, unreadable: ["src/outbound/slack"] });
    expect(report.ok).toBe(false);
    expect(report.unreadable).toEqual(["src/outbound/slack"]);
  });

  it("is ok when nothing was unreadable", () => {
    const report = analyzeCoverage({ files: [{ content: "", path: "src/a.ts" }], groups: {}, unreadable: [] });
    expect(report.ok).toBe(true);
    expect(report.unreadable).toEqual([]);
  });

  it("is NOT ok over an empty file set, which scanned nothing rather than found nothing", () => {
    const report = analyzeCoverage({ files: [], groups: {}, unreadable: [] });
    expect(report.ok).toBe(false);
    expect(report.unreadable).toEqual([EMPTY_SCOPE]);
  });
});

describe("SANCTIONED_SEAMS", () => {
  it("names at least one file, so every guard below is asserting over a non-empty catalogue", () => {
    expect(Object.keys(SANCTIONED_SEAMS).length).toBeGreaterThan(0);
  });

  it("gives every row a class the scan can act on, never the open class it exists to rule out", () => {
    const classes = new Set(Object.values(SANCTIONED_SEAMS));
    expect([...classes].toSorted()).toEqual(["dev-tooling", "door-internal", "local-state", "read-only-tool"]);
  });

  it("keys every row on a repo-relative path, so a lookup by scanned path can match", () => {
    expect(Object.keys(SANCTIONED_SEAMS).filter((path) => path.startsWith("/"))).toEqual([]);
  });

  it("sanctions the profiler as dev-tooling", () => {
    expect(SANCTIONED_SEAMS["src/cli/commands/dev/profile.ts"]).toBe("dev-tooling");
  });
});
