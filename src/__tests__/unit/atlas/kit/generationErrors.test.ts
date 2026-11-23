/**
 * The generation store's typed failures: every factory renders the exact text the `readonly string[]` it
 * replaced carried, and {@link atlasGenerationErrorLines} gives a list variant one line per problem, in order.
 */
import { describe, expect, it } from "vitest";

import { AtlasGenerationErrors, atlasGenerationErrorLines } from "../../../../atlas/kit/generationErrors.js";

describe("AtlasGenerationErrors", () => {
  it("says the atlas holds no archive at all when the requested one is unknown and none exist", () => {
    const error = AtlasGenerationErrors.archiveUnknown({
      archiveId: "2026-01-01T00-00-00.000Z",
      known: [],
      superseded: "/home/atlas/_superseded/workos",
    });
    expect(error.code).toBe("ARCHIVE_UNKNOWN");
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "no archive 2026-01-01T00-00-00.000Z under /home/atlas/_superseded/workos",
      "this atlas has archived no generation — nothing was moved",
    ]);
  });

  it("names every archive the atlas does hold when the requested one is unknown", () => {
    const error = AtlasGenerationErrors.archiveUnknown({
      archiveId: "2026-03-03T00-00-00.000Z",
      known: ["2026-02-02T00-00-00.000Z", "2026-01-01T00-00-00.000Z"],
      superseded: "/s",
    });
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "no archive 2026-03-03T00-00-00.000Z under /s",
      "archives this atlas holds: 2026-02-02T00-00-00.000Z, 2026-01-01T00-00-00.000Z",
    ]);
  });

  it("closes a failed reset publish by saying the archive was restored", () => {
    const error = AtlasGenerationErrors.resetPublishFailed({ published: ["publish refused"], restoreFailure: null });
    expect(error.code).toBe("RESET_PUBLISH_FAILED");
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "publish refused",
      "the archived generation was restored; nothing was reset",
    ]);
  });

  it("closes a failed reset publish with the restore's own failure when the archive could not go back", () => {
    const restoreFailure = AtlasGenerationErrors.restoreRenameFailed({
      archive: "/s/2026-01-01T00-00-00.000Z",
      cause: new Error("EXDEV"),
    });
    const error = AtlasGenerationErrors.resetPublishFailed({ published: ["publish refused"], restoreFailure });
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "publish refused",
      "the archived generation is at /s/2026-01-01T00-00-00.000Z and could not be restored: EXDEV",
    ]);
  });

  it("names both versions and carries the supersede advice as its own line", () => {
    const error = AtlasGenerationErrors.foreignSchemaVersion({
      advice: "run a newer build",
      found: 6,
      path: "/a/manifest.json",
      writes: 4,
    });
    expect(error.code).toBe("FOREIGN_SCHEMA_VERSION");
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "/a/manifest.json declares schema version 6, and this build writes version 4",
      "run a newer build",
    ]);
  });

  it("prints at most eight schema issues, each indented under its path", () => {
    const issues = Array.from({ length: 9 }, (_, index) => ({ message: `bad ${String(index)}`, path: ["k", index] }));
    const error = AtlasGenerationErrors.schemaUnsatisfied({ issues, path: "/a/x.jsonl", platform: "workos" });
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "/a/x.jsonl does not satisfy the workos atlas schema",
      "  k.0: bad 0",
      "  k.1: bad 1",
      "  k.2: bad 2",
      "  k.3: bad 3",
      "  k.4: bad 4",
      "  k.5: bad 5",
      "  k.6: bad 6",
      "  k.7: bad 7",
    ]);
  });

  it("prints the no-current-generation refusal as one line", () => {
    const error = AtlasGenerationErrors.noCurrentGeneration({ directory: "/h/atlas/workos", platform: "workos" });
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "no current workos atlas at /h/atlas/workos — nothing to reset",
    ]);
  });

  it("follows an install failure with the rollback's own lines", () => {
    const error = AtlasGenerationErrors.archiveInstallFailed({
      archiveId: "2026-01-01T00-00-00.000Z",
      cause: new Error("ENOSPC"),
      rollback: ["the generation that was live has been put back; nothing was restored"],
    });
    expect(error.code).toBe("ARCHIVE_INSTALL_FAILED");
    expect(atlasGenerationErrorLines({ error })).toEqual([
      "could not install 2026-01-01T00-00-00.000Z: ENOSPC",
      "the generation that was live has been put back; nothing was restored",
    ]);
  });
});
