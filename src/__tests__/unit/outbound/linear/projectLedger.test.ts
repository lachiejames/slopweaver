/**
 * The project + milestone reservation/ownership ledgers. Genuine round-trips through a `mkdtempSync` temp
 * dir, same rationale `issueLedger.test.ts` states: the whole point is that state survives a process. The
 * milestone ledger is its own module, writing through this one's exclusive-create seam.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  confirmMilestone,
  listMilestoneIds,
  parseMilestoneRecord,
  readMilestoneRecord,
  reserveMilestone,
} from "../../../../outbound/linear/milestoneLedger.js";
import {
  confirmProject,
  listProjectIds,
  ownershipOfProject,
  parseProjectRecord,
  readProjectRecord,
  reserveProject,
} from "../../../../outbound/linear/projectLedger.js";
import { stateHomePaths } from "../../../../stateHome.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-linear-project-ledger-"));
  fixtureDirs.push(dir);
  return dir;
}

const ID = "752562e2-b5aa-5934-b0aa-03e0165a6196";
const NOW = "2026-08-16T10:00:00.000Z";

describe("reserveProject", () => {
  it("grants the first caller and refuses the second — the id cannot be claimed twice", () => {
    const dir = home();
    expect(reserveProject({ home: dir, id: ID, nowIso: NOW }).kind).toBe("fresh");

    const second = reserveProject({ home: dir, id: ID, nowIso: "2026-08-16T10:00:01.000Z" });
    expect(second.kind).toBe("taken");
  });

  it("records the reservation instant before any mutation is attempted", () => {
    const dir = home();
    reserveProject({ home: dir, id: ID, nowIso: NOW });

    expect(readProjectRecord({ home: dir, id: ID })!.reservedIso).toBe(NOW);
    expect(readProjectRecord({ home: dir, id: ID })!.confirmedIso).toBe(undefined);
  });
});

describe("ownershipOfProject — fails closed", () => {
  it("refuses a project with no record", () => {
    const result = ownershipOfProject({ home: home(), id: ID });

    expect(result.owned).toBe(false);
    expect(result.owned === false && result.reason).toContain("no record of creating project");
  });

  it("refuses a RESERVED but unconfirmed project", () => {
    const dir = home();
    reserveProject({ home: dir, id: ID, nowIso: NOW });
    const result = ownershipOfProject({ home: dir, id: ID });

    expect(result.owned).toBe(false);
    expect(result.owned === false && result.reason).toContain("never confirmed");
  });

  it("grants a confirmed project", () => {
    const dir = home();
    reserveProject({ home: dir, id: ID, nowIso: NOW });
    confirmProject({ home: dir, id: ID, name: "A project", nowIso: NOW, url: "https://linear.test/p" });
    const result = ownershipOfProject({ home: dir, id: ID });

    expect(result.owned).toBe(true);
    expect(result.owned === true && result.record.name).toBe("A project");
  });

  it("refuses when the record is corrupt rather than treating it as absent-but-fine", () => {
    const dir = home();
    reserveProject({ home: dir, id: ID, nowIso: NOW });
    writeFileSync(join(stateHomePaths({ home: dir }).ledgers, "linear-projects", `${ID}.json`), "{ not json");

    expect(ownershipOfProject({ home: dir, id: ID }).owned).toBe(false);
  });
});

describe("confirmProject", () => {
  it("preserves the original reservation instant while adding the confirmation", () => {
    const dir = home();
    reserveProject({ home: dir, id: ID, nowIso: NOW });
    confirmProject({
      home: dir,
      id: ID,
      name: "A project",
      nowIso: "2026-08-16T10:00:05.000Z",
      url: "https://linear.test/p",
    });
    const record = readProjectRecord({ home: dir, id: ID })!;

    expect(record.reservedIso).toBe(NOW);
    expect(record.confirmedIso).toBe("2026-08-16T10:00:05.000Z");
  });
});

describe("parseProjectRecord", () => {
  it("rejects a record missing its id", () => {
    expect(parseProjectRecord({ raw: JSON.stringify({ reservedIso: NOW }) })).toBe(undefined);
  });

  it("rejects unparseable text", () => {
    expect(parseProjectRecord({ raw: "{ not json" })).toBe(undefined);
  });

  it("keeps the optional fields off the object when absent", () => {
    const record = parseProjectRecord({ raw: JSON.stringify({ id: ID, reservedIso: NOW }) })!;

    expect(record.name).toBe(undefined);
    expect(record.url).toBe(undefined);
  });
});

describe("listProjectIds", () => {
  it("lists every reserved id, sorted", () => {
    const dir = home();
    reserveProject({ home: dir, id: "bbb", nowIso: NOW });
    reserveProject({ home: dir, id: "aaa", nowIso: NOW });

    expect(listProjectIds({ home: dir })).toEqual(["aaa", "bbb"]);
  });

  it("is empty rather than throwing when nothing has been reserved", () => {
    expect(listProjectIds({ home: home() })).toEqual([]);
  });
});

describe("reserveMilestone", () => {
  it("grants the first caller and refuses the second", () => {
    const dir = home();
    expect(reserveMilestone({ home: dir, id: ID, nowIso: NOW }).kind).toBe("fresh");

    const second = reserveMilestone({ home: dir, id: ID, nowIso: "2026-08-16T10:00:01.000Z" });
    expect(second.kind).toBe("taken");
  });
});

describe("confirmMilestone", () => {
  it("preserves the original reservation instant while adding the confirmation", () => {
    const dir = home();
    reserveMilestone({ home: dir, id: ID, nowIso: NOW });
    confirmMilestone({ home: dir, id: ID, name: "A milestone", nowIso: "2026-08-16T10:00:05.000Z" });
    const record = readMilestoneRecord({ home: dir, id: ID })!;

    expect(record.reservedIso).toBe(NOW);
    expect(record.confirmedIso).toBe("2026-08-16T10:00:05.000Z");
    expect(record.name).toBe("A milestone");
  });
});

describe("parseMilestoneRecord", () => {
  it("rejects a record missing its id", () => {
    expect(parseMilestoneRecord({ raw: JSON.stringify({ reservedIso: NOW }) })).toBe(undefined);
  });

  it("rejects unparseable text", () => {
    expect(parseMilestoneRecord({ raw: "{ not json" })).toBe(undefined);
  });
});

describe("listMilestoneIds", () => {
  it("lists every reserved id, sorted", () => {
    const dir = home();
    reserveMilestone({ home: dir, id: "bbb", nowIso: NOW });
    reserveMilestone({ home: dir, id: "aaa", nowIso: NOW });

    expect(listMilestoneIds({ home: dir })).toEqual(["aaa", "bbb"]);
  });

  it("is empty rather than throwing when nothing has been reserved", () => {
    expect(listMilestoneIds({ home: home() })).toEqual([]);
  });
});
