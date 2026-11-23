import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VantaChangeRecord } from "../../../../atlas/vanta/changes.js";
import { VantaChangesErrors } from "../../../../atlas/vanta/changesErrors.js";
import {
  markVantaChangesRead,
  readUnreadVantaChanges,
  vantaChangeFilePath,
  writeVantaChangeRecord,
} from "../../../../atlas/vanta/changesStore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";

const FIRST = "2026-10-01T00:00:00.000Z";
const SECOND = "2026-10-01T04:00:00.000Z";
const THIRD = "2026-10-01T08:00:00.000Z";

const record = ({ at }: { at: string }): VantaChangeRecord => ({
  at,
  kinds: [{ entities: 3, kind: "control", read: "baseline" }],
  version: 1,
});

describe("the Vanta change log", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vanta-changes-store-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads an empty log, with no cursor, as nothing unread", () => {
    expect(unwrap(readUnreadVantaChanges({ home }))).toEqual({ records: [], throughAt: null });
  });

  it("writes one file per sync, outside the atlas directory a publish replaces", () => {
    const path = unwrap(writeVantaChangeRecord({ home, record: record({ at: FIRST }) }));
    expect(path).toBe(join(home, "vanta", "changes", "2026-10-01T00-00-00.000Z.json"));
    expect(path).toBe(vantaChangeFilePath({ at: FIRST, home }));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(record({ at: FIRST }));
  });

  it("lists every record oldest first, then only those past the cursor once one is marked", () => {
    for (const at of [SECOND, FIRST, THIRD]) {
      unwrap(writeVantaChangeRecord({ home, record: record({ at }) }));
    }
    expect(unwrap(readUnreadVantaChanges({ home })).records.map((entry) => entry.at)).toEqual([FIRST, SECOND, THIRD]);

    expect(unwrap(markVantaChangesRead({ at: SECOND, home }))).toEqual({ previous: null, through: SECOND });
    expect(unwrap(readUnreadVantaChanges({ home }))).toEqual({ records: [record({ at: THIRD })], throughAt: SECOND });

    expect(unwrap(markVantaChangesRead({ at: THIRD, home }))).toEqual({ previous: SECOND, through: THIRD });
    expect(unwrap(readUnreadVantaChanges({ home })).records).toEqual([]);
  });

  it("refuses to mark an instant no record carries", () => {
    unwrap(writeVantaChangeRecord({ home, record: record({ at: FIRST }) }));
    expect(unwrapErr(markVantaChangesRead({ at: SECOND, home }))).toEqual(
      VantaChangesErrors.unknownChange({ at: SECOND }),
    );
  });

  it("refuses to move the cursor backwards", () => {
    unwrap(writeVantaChangeRecord({ home, record: record({ at: FIRST }) }));
    unwrap(writeVantaChangeRecord({ home, record: record({ at: SECOND }) }));
    unwrap(markVantaChangesRead({ at: SECOND, home }));
    expect(unwrapErr(markVantaChangesRead({ at: FIRST, home }))).toEqual(
      VantaChangesErrors.cursorBackwards({ at: FIRST, through: SECOND }),
    );
  });

  it("re-marking the cursor's own instant is accepted, so a repeated --mark-read is harmless", () => {
    unwrap(writeVantaChangeRecord({ home, record: record({ at: FIRST }) }));
    unwrap(markVantaChangesRead({ at: FIRST, home }));
    expect(unwrap(markVantaChangesRead({ at: FIRST, home }))).toEqual({ previous: FIRST, through: FIRST });
  });

  it("names a corrupt cursor rather than reading every record as unread", () => {
    unwrap(writeVantaChangeRecord({ home, record: record({ at: FIRST }) }));
    writeFileSync(stateHomePaths({ home }).vantaChangesCursorJson, "{not json");
    expect(unwrapErr(readUnreadVantaChanges({ home })).code).toBe("CURSOR_UNREADABLE");
  });

  it("names a change file that does not parse as a record", () => {
    mkdirSync(stateHomePaths({ home }).vantaChanges, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).vantaChanges, "bad.json"), '{"at":"nope"}');
    expect(unwrapErr(readUnreadVantaChanges({ home })).code).toBe("CHANGE_FILE_UNREADABLE");
  });

  it("names a change directory that is a file", () => {
    mkdirSync(join(home, "vanta"), { recursive: true });
    writeFileSync(stateHomePaths({ home }).vantaChanges, "not a directory");
    expect(unwrapErr(readUnreadVantaChanges({ home })).code).toBe("CHANGES_DIRECTORY_UNREADABLE");
    expect(unwrapErr(writeVantaChangeRecord({ home, record: record({ at: FIRST }) })).code).toBe(
      "CHANGE_FILE_UNWRITABLE",
    );
  });
});
