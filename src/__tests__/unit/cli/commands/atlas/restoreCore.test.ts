/**
 * What `atlas <platform> restore` accepts, and exactly what its two outputs say.
 *
 * Pure throughout — the flag decision and both renderings take values and return values, so the filesystem
 * half stays in `atlas/kit/archive.ts` where its own round-trip test exercises it.
 */
import { describe, expect, it } from "vitest";

import { AtlasCommandErrors } from "../../../../../cli/commands/atlas/errors.js";
import {
  atlasRestoreDoneLines,
  atlasRestoreListLines,
  atlasRestoreRequest,
  atlasRestoreUsage,
} from "../../../../../cli/commands/atlas/restoreCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/tmp/home";

function request({
  flags = [],
  values = {},
}: {
  flags?: readonly string[];
  values?: Readonly<Record<string, string>>;
}): ReturnType<typeof atlasRestoreRequest> {
  return atlasRestoreRequest({ home: HOME, parsed: { flags: new Set(flags), values } });
}

describe("atlasRestoreRequest", () => {
  it("lists when no archive is named, which is what a bare invocation does", () => {
    const parsed = unwrap(request({}));
    expect(parsed.mode).toBe("list");
    expect(parsed.home).toBe(HOME);
    expect(parsed.json).toBe(false);
  });

  it("takes the home the tail names over the ambient one", () => {
    expect(unwrap(request({ values: { home: "/elsewhere" } })).home).toBe("/elsewhere");
  });

  it("carries --json through to a listing", () => {
    expect(unwrap(request({ flags: ["json"] })).json).toBe(true);
  });

  it("installs the named archive when the confirmation is exact", () => {
    const parsed = unwrap(request({ values: { archive: "2026-09-10T12-22-29.229Z", confirm: "archive-current" } }));
    expect(parsed.mode).toBe("restore");
    expect(parsed.mode === "restore" ? parsed.archiveId : "").toBe("2026-09-10T12-22-29.229Z");
  });

  it("refuses to install without the confirmation, and says what the confirmation means", () => {
    const refused = request({ values: { archive: "2026-09-10T12-22-29.229Z" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)).toEqual(AtlasCommandErrors.restoreConfirmRequired());
    expect(unwrapErr(refused).message).toBe(
      "restore needs --confirm archive-current: it archives the generation that is live now and installs the named one in its place",
    );
  });

  it("refuses a confirmation that is nearly right, rather than accepting a prefix", () => {
    const refused = request({ values: { archive: "a", confirm: "archive" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused)).toEqual(
      AtlasCommandErrors.confirmMismatch({ confirm: "archive", expected: "archive-current" }),
    );
    expect(unwrapErr(refused).message).toBe('--confirm must be exactly "archive-current", not "archive"');
  });

  it("refuses a confirmation with no archive beside it, which would confirm nothing", () => {
    const refused = request({ values: { confirm: "archive-current" } });
    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("RESTORE_CONFIRM_WITHOUT_ARCHIVE");
    expect(unwrapErr(refused).message).toBe(
      "--confirm names an archive to install, so it needs --archive <archive-id> beside it",
    );
  });
});

describe("atlasRestoreListLines", () => {
  it("says how to create one when the atlas has archived nothing", () => {
    expect(atlasRestoreListLines({ archives: [], platform: "vanta" })).toEqual([
      "no archived vanta generation — `atlas vanta reset --confirm archive` is what creates one",
    ]);
  });

  it("renders one row per archive and the command that installs one", () => {
    const lines = atlasRestoreListLines({
      archives: [
        {
          archiveId: "2026-09-10T12-22-29.229Z",
          entityCount: 10823,
          path: "/home/atlas/_superseded/vanta/2026-09-10T12-22-29.229Z",
          schemaVersion: 6,
          updatedAt: "2026-09-10T11:04:02.693Z",
        },
      ],
      platform: "vanta",
    });
    expect(lines[0]).toBe("1 archived vanta generation(s), newest first:");
    expect(lines[1]).toBe("  2026-09-10T12-22-29.229Z  schema 6 · 10823 entities · 2026-09-10T11:04:02.693Z");
    expect(lines[3]).toBe(
      "restore one: slopweaver atlas vanta restore --archive <archive-id> --confirm archive-current",
    );
  });

  it("still lists an archive whose manifest could not be read, marked unreadable", () => {
    const lines = atlasRestoreListLines({
      archives: [
        {
          archiveId: "2026-09-01T00-00-00.000Z",
          entityCount: null,
          path: "/home/atlas/_superseded/vanta/2026-09-01T00-00-00.000Z",
          schemaVersion: null,
          updatedAt: null,
        },
      ],
      platform: "vanta",
    });
    expect(lines[1]).toBe("  2026-09-01T00-00-00.000Z  unreadable");
  });

  it("marks an archive unreadable when its header yielded a schema but no count or clock, never a zero count", () => {
    const lines = atlasRestoreListLines({
      archives: [
        {
          archiveId: "2026-09-02T00-00-00.000Z",
          entityCount: null,
          path: "/home/atlas/_superseded/vanta/2026-09-02T00-00-00.000Z",
          schemaVersion: 6,
          updatedAt: null,
        },
      ],
      platform: "vanta",
    });
    expect(lines[1]).toBe("  2026-09-02T00-00-00.000Z  unreadable");
  });
});

describe("atlasRestoreDoneLines", () => {
  it("names what was restored, where the displaced generation went, and how to undo it", () => {
    const lines = atlasRestoreDoneLines({
      archiveId: "2026-09-10T12-22-29.229Z",
      outcome: {
        archivedCurrentTo: "/home/atlas/_superseded/vanta/2026-09-11T00-00-00.000Z",
        restoredFrom: "/home/atlas/_superseded/vanta/2026-09-10T12-22-29.229Z",
        undoArchiveId: "2026-09-11T00-00-00.000Z",
      },
      platform: "vanta",
    });
    expect(lines[0]).toBe("vanta atlas restored from 2026-09-10T12-22-29.229Z — now the live generation");
    expect(lines[1]).toBe(
      "the generation that was live is archived at /home/atlas/_superseded/vanta/2026-09-11T00-00-00.000Z",
    );
    expect(lines[2]).toBe(
      "undo: slopweaver atlas vanta restore --archive 2026-09-11T00-00-00.000Z --confirm archive-current",
    );
  });

  it("offers no undo when nothing was displaced, rather than a command that names nothing", () => {
    const lines = atlasRestoreDoneLines({
      archiveId: "2026-09-10T12-22-29.229Z",
      outcome: {
        archivedCurrentTo: null,
        restoredFrom: "/home/atlas/_superseded/vanta/2026-09-10T12-22-29.229Z",
        undoArchiveId: null,
      },
      platform: "vanta",
    });
    expect(lines).toHaveLength(1);
  });
});

describe("atlasRestoreUsage", () => {
  it("names the platform it was asked about and both required flags", () => {
    const usage = atlasRestoreUsage({ platform: "cloudflare" });
    expect(usage).toContain("slopweaver atlas cloudflare restore");
    expect(usage).toContain("--confirm archive-current");
    expect(usage).toContain("the live generation is archived, never deleted");
  });
});
