import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordVantaSyncChanges, voidVantaSyncChanges } from "../../../../atlas/vanta/changesRecord.js";
import { readUnreadVantaChanges, vantaChangeFilePath } from "../../../../atlas/vanta/changesStore.js";
import { emptyVantaKindFile, initialVantaManifest, type VantaKindFile } from "../../../../atlas/vanta/model.js";
import { readVantaAtlas, vantaAtlasPaths } from "../../../../atlas/vanta/store.js";
import { storedFilesFrom } from "../../../../atlas/vanta/storedFiles.js";
import { unwrap } from "../../../../lib/result.js";

const BEFORE = "2026-09-30T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

const controlFile = ({ name }: { name: string }): VantaKindFile => ({
  ...emptyVantaKindFile({ kind: "control", updatedAt: BEFORE }),
  entities: [
    {
      channels: {
        browser: null,
        "manage-api": {
          channel: "manage-api",
          detail: { id: "c1", name },
          firstSeenAt: BEFORE,
          lastSeenAt: BEFORE,
          source: null,
          state: "observed",
        },
      },
      financialDetail: null,
      id: "control:c1",
      kind: "control",
      providerId: "c1",
      sensitivity: null,
    },
  ],
});

describe("storedFilesFrom and recordVantaSyncChanges", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-changes-record-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Every kind of a never-published home, read the way a sync reads it. */
  const unpublished = (): ReturnType<typeof storedFilesFrom> =>
    storedFilesFrom({ at: AT, snapshotFiles: unwrap(readVantaAtlas({ paths: vantaAtlasPaths({ home }) })).files });

  it("defaults a never-published kind to an empty file stamped now, and keeps a published one", () => {
    const empty = unwrap(readVantaAtlas({ paths: vantaAtlasPaths({ home }) })).files;
    const stored = storedFilesFrom({ at: AT, snapshotFiles: { ...empty, control: controlFile({ name: "kept" }) } });
    expect(stored.policy).toEqual(emptyVantaKindFile({ kind: "policy", updatedAt: AT }));
    expect(stored.control).toEqual(controlFile({ name: "kept" }));
  });

  /** A manifest whose control kind last read successfully at BEFORE, so its next read is compared. */
  const readBefore = (): ReturnType<typeof initialVantaManifest> => {
    const manifest = initialVantaManifest({ updatedAt: BEFORE });
    return { ...manifest, kinds: { ...manifest.kinds, control: { ...manifest.kinds.control, lastSuccessAt: BEFORE } } };
  };

  /** One complete control read that published `controlFile({ name: "new" })`. */
  const newControlRead = [
    {
      complete: true,
      failedConditions: [],
      file: controlFile({ name: "new" }),
      kind: "control" as const,
      observedProviderIds: ["c1"],
      pendingWrites: [],
      reasons: [],
    },
  ];

  it("writes the change against what the store held, and names its path", () => {
    const changes = recordVantaSyncChanges({
      at: AT,
      credentialsConfigured: true,
      home,
      manifest: readBefore(),
      outcomes: [{ complete: true, kind: "control", reasons: [] }],
      results: newControlRead,
      storedFiles: { ...unpublished(), control: controlFile({ name: "old" }) },
    });
    expect(changes).toEqual({
      at: AT,
      outcome: "recorded",
      path: vantaChangeFilePath({ at: AT, home }),
      totals: { added: 0, baseline: 0, changed: 1, incomplete: 0, removed: 0 },
    });
    const [record] = unwrap(readUnreadVantaChanges({ home })).records;
    expect(record!.kinds[0]).toMatchObject({
      changedGroups: [{ examples: [{ fields: [{ after: '"new"', before: '"old"', field: "name" }] }] }],
      kind: "control",
    });
  });

  it("still compares a kind the sync published but called failed, carrying its reason as a note", () => {
    // The vendor companion-write failure: the file publishes, the sync's verdict is failed. Listed unread,
    // this window's changes would be lost, since the next sync compares against what this one published.
    recordVantaSyncChanges({
      at: AT,
      credentialsConfigured: true,
      home,
      manifest: readBefore(),
      outcomes: [{ complete: false, kind: "control", reasons: ["companion write failed"] }],
      results: newControlRead,
      storedFiles: { ...unpublished(), control: controlFile({ name: "old" }) },
    });
    const [record] = unwrap(readUnreadVantaChanges({ home })).records;
    expect(record!.kinds[0]).toMatchObject({
      changedGroups: [{ examples: [{ fields: [{ after: '"new"', before: '"old"', field: "name" }] }] }],
      kind: "control",
      notes: ["companion write failed"],
      read: "complete",
    });
  });

  it("records nothing when credentials are not configured", () => {
    const changes = recordVantaSyncChanges({
      at: AT,
      credentialsConfigured: false,
      home,
      manifest: initialVantaManifest({ updatedAt: BEFORE }),
      outcomes: [],
      results: [],
      storedFiles: unpublished(),
    });
    expect(changes).toEqual({
      outcome: "not-recorded",
      reason: "credentials are not configured, so this sync read no kind",
    });
    expect(unwrap(readUnreadVantaChanges({ home })).records).toEqual([]);
  });

  it("reports a write it could not make rather than throwing", () => {
    mkdirSync(join(home, "vanta"), { recursive: true });
    writeFileSync(join(home, "vanta", "changes"), "not a directory");
    const changes = recordVantaSyncChanges({
      at: AT,
      credentialsConfigured: true,
      home,
      manifest: initialVantaManifest({ updatedAt: BEFORE }),
      outcomes: [],
      results: [],
      storedFiles: unpublished(),
    });
    expect(changes.outcome).toBe("failed");
    expect(changes).toMatchObject({ reason: expect.stringContaining("this sync's changes are lost") });
  });

  it("voids a written record, for a sync whose publish then failed", () => {
    const changes = recordVantaSyncChanges({
      at: AT,
      credentialsConfigured: true,
      home,
      manifest: readBefore(),
      outcomes: [{ complete: true, kind: "control", reasons: [] }],
      results: newControlRead,
      storedFiles: { ...unpublished(), control: controlFile({ name: "old" }) },
    });
    expect(existsSync(vantaChangeFilePath({ at: AT, home }))).toBe(true);
    expect(voidVantaSyncChanges({ changes })).toEqual([]);
    expect(existsSync(vantaChangeFilePath({ at: AT, home }))).toBe(false);
  });

  it("has nothing to void when no record was written", () => {
    expect(voidVantaSyncChanges({ changes: { outcome: "not-recorded", reason: "no credentials" } })).toEqual([]);
  });

  it("names a record it could not remove, so a session deletes it rather than judging it", () => {
    // A non-empty DIRECTORY at the record's path: `rmSync` without `recursive` refuses it.
    const path = vantaChangeFilePath({ at: AT, home });
    mkdirSync(join(path, "inner"), { recursive: true });
    const lines = voidVantaSyncChanges({
      changes: {
        at: AT,
        outcome: "recorded",
        path,
        totals: { added: 0, baseline: 0, changed: 0, incomplete: 0, removed: 0 },
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`the atlas did not publish, but its change record ${path} could not be removed`);
  });
});
