/**
 * Unit: the Outlook mail delta links on disk. The asymmetry is the contract: a MISSING file is an empty map
 * (no folder was ever read whole), and a file that is there but unusable is an error, never an empty map,
 * because an empty map reads the whole mailbox again.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { OutlookMailSyncAnchorErrors } from "../../../../corpus/outlook/errors.js";
import {
  outlookMailSyncAnchorPath,
  readOutlookMailSyncAnchors,
  writeOutlookMailSyncAnchors,
} from "../../../../corpus/outlook/syncAnchor.js";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-outlook-anchor-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Put raw text where the anchors live. */
function plant({ dir, text }: { dir: string; text: string }): void {
  const path = outlookMailSyncAnchorPath({ home: dir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const ANCHOR = {
  deltaLink: "https://graph.microsoft.com/v1.0/fake-delta/folder-inbox",
  recordedAtIso: "2026-10-02T00:00:00.000Z",
  version: 1,
} as const;

describe("the Outlook mail sync anchors", () => {
  it("live beside the other watermarks", () => {
    expect(outlookMailSyncAnchorPath({ home: "/h" })).toBe("/h/corpus/watermarks/outlook-sync.json");
  });

  it("read as an empty map when no file was ever written", () => {
    expect(unwrap(readOutlookMailSyncAnchors({ home: home() }))).toStrictEqual({});
  });

  it("read back exactly what was written", () => {
    const dir = home();
    unwrap(writeOutlookMailSyncAnchors({ anchors: { "folder-inbox": ANCHOR }, home: dir }));
    expect(unwrap(readOutlookMailSyncAnchors({ home: dir }))).toStrictEqual({ "folder-inbox": ANCHOR });
  });

  it("refuse a file that is not JSON rather than reading it as empty", () => {
    const dir = home();
    plant({ dir, text: "{ torn" });
    const error = unwrapErr(readOutlookMailSyncAnchors({ home: dir }));
    expect(error.code).toBe("ANCHORS_NOT_JSON");
    expect(error.message).toContain("are not JSON");
  });

  it("refuse a file that is not an object keyed by folder id", () => {
    const dir = home();
    plant({ dir, text: "[]" });
    expect(unwrapErr(readOutlookMailSyncAnchors({ home: dir }))).toStrictEqual(
      OutlookMailSyncAnchorErrors.notKeyed({ path: outlookMailSyncAnchorPath({ home: dir }) }),
    );
  });

  it("refuse an entry that is not a version-1 anchor, naming its folder", () => {
    const dir = home();
    plant({ dir, text: JSON.stringify({ "folder-inbox": { ...ANCHOR, version: 2 } }) });
    expect(unwrapErr(readOutlookMailSyncAnchors({ home: dir }))).toStrictEqual(
      OutlookMailSyncAnchorErrors.anchorMalformed({
        folderId: "folder-inbox",
        path: outlookMailSyncAnchorPath({ home: dir }),
      }),
    );
  });
});
