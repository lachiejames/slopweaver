/**
 * The ownership ledger. Filesystem use here is a genuine round-trip through a `mkdtempSync` temp dir, which
 * the testing rules allow: the whole point of the file is that state survives a process, and a fake would
 * assert the fake rather than the guarantee.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  confirmIssue,
  listIssueIds,
  ownershipOf,
  parseIssueRecord,
  readIssueRecord,
  reserveIssue,
} from "../../../../outbound/linear/issueLedger.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-linear-ledger-"));
  fixtureDirs.push(dir);
  return dir;
}

const ID = "752562e2-b5aa-5934-b0aa-03e0165a6196";
const NOW = "2026-08-01T10:00:00.000Z";

describe("reserveIssue", () => {
  it("grants the first caller and refuses the second — the id cannot be claimed twice", () => {
    const dir = home();
    expect(reserveIssue({ home: dir, id: ID, nowIso: NOW }).kind).toBe("fresh");

    const second = reserveIssue({ home: dir, id: ID, nowIso: "2026-08-01T10:00:01.000Z" });
    expect(second.kind).toBe("taken");
  });

  it("records the reservation instant before any mutation is attempted", () => {
    const dir = home();
    reserveIssue({ home: dir, id: ID, nowIso: NOW });

    expect(readIssueRecord({ home: dir, id: ID })!.reservedIso).toBe(NOW);
    expect(readIssueRecord({ home: dir, id: ID })!.confirmedIso).toBe(undefined);
  });
});

describe("ownershipOf — fails closed", () => {
  it("refuses an issue with no record, naming why the issue itself cannot prove authorship", () => {
    const result = ownershipOf({ home: home(), id: ID });

    expect(result.owned).toBe(false);
    expect(result.owned === false && result.reason).toContain("no record of creating issue");
  });

  it("refuses a RESERVED but unconfirmed issue, because its outcome was never established", () => {
    // This is the lost-response case. "We asked for it" is not "it exists", and editing on that basis is
    // exactly the situation the gate is for.
    const dir = home();
    reserveIssue({ home: dir, id: ID, nowIso: NOW });
    const result = ownershipOf({ home: dir, id: ID });

    expect(result.owned).toBe(false);
    expect(result.owned === false && result.reason).toContain("never confirmed");
  });

  it("grants a confirmed issue", () => {
    const dir = home();
    reserveIssue({ home: dir, id: ID, nowIso: NOW });
    confirmIssue({
      description: "body",
      home: dir,
      id: ID,
      identifier: "AAA-1",
      nowIso: NOW,
      updatedAt: "2026-08-01T10:00:02.000Z",
    });
    const result = ownershipOf({ home: dir, id: ID });

    expect(result.owned).toBe(true);
    expect(result.owned === true && result.record.identifier).toBe("AAA-1");
  });

  it("refuses when the record is corrupt rather than treating it as absent-but-fine", () => {
    const dir = home();
    reserveIssue({ home: dir, id: ID, nowIso: NOW });
    writeFileSync(join(stateHomePaths({ home: dir }).ledgers, "linear-issues", `${ID}.json`), "{ not json");

    expect(ownershipOf({ home: dir, id: ID }).owned).toBe(false);
  });
});

describe("confirmIssue", () => {
  it("preserves the original reservation instant while adding the confirmation", () => {
    const dir = home();
    reserveIssue({ home: dir, id: ID, nowIso: NOW });
    confirmIssue({
      description: "body",
      home: dir,
      id: ID,
      identifier: "AAA-1",
      nowIso: "2026-08-01T10:00:05.000Z",
      updatedAt: "2026-08-01T10:00:05.000Z",
    });
    const record = readIssueRecord({ home: dir, id: ID })!;

    expect(record.reservedIso).toBe(NOW);
    expect(record.confirmedIso).toBe("2026-08-01T10:00:05.000Z");
    expect(record.lastSeenUpdatedAt).toBe("2026-08-01T10:00:05.000Z");
  });
});

describe("parseIssueRecord", () => {
  it("rejects a record missing its id", () => {
    expect(parseIssueRecord({ raw: JSON.stringify({ reservedIso: NOW }) })).toBe(undefined);
  });

  it("rejects unparseable text", () => {
    expect(parseIssueRecord({ raw: "{ not json" })).toBe(undefined);
  });

  it("keeps the optional fields off the object when absent, not set to empty strings", () => {
    const record = parseIssueRecord({ raw: JSON.stringify({ id: ID, reservedIso: NOW }) })!;

    expect(record.identifier).toBe(undefined);
    expect(record.lastSeenUpdatedAt).toBe(undefined);
  });
});

describe("listIssueIds", () => {
  it("lists every reserved id, sorted", () => {
    const dir = home();
    reserveIssue({ home: dir, id: "bbb", nowIso: NOW });
    reserveIssue({ home: dir, id: "aaa", nowIso: NOW });

    expect(listIssueIds({ home: dir })).toEqual(["aaa", "bbb"]);
  });

  it("is empty rather than throwing when nothing has been reserved", () => {
    expect(listIssueIds({ home: home() })).toEqual([]);
  });
});
