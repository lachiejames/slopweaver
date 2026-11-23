import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assigneeMembershipRefusals,
  parseStateCatalog,
  readStateCatalog,
  type StateCatalog,
  stateCatalogPath,
  stateIdRefusals,
  writeStateCatalog,
} from "../../../../outbound/linear/stateCatalog.js";

const CATALOG: StateCatalog = {
  members: [{ displayName: "ada", id: "u-1" }],
  readAtIso: "2026-08-26T12:00:00.000Z",
  states: [
    { id: "s-todo", name: "Todo", type: "unstarted" },
    { id: "s-done", name: "Done", type: "completed" },
  ],
  teamId: "team-1",
  teamKey: "ENG",
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-state-catalog-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("writeStateCatalog / readStateCatalog", () => {
  it("round-trips a catalog through the ledger", () => {
    const home = tempHome();
    writeStateCatalog({ catalog: CATALOG, home });

    expect(readStateCatalog({ home, teamId: "team-1" })).toEqual(CATALOG);
  });

  it("REPLACES rather than merges, so a deleted state stops being writable", () => {
    const home = tempHome();
    writeStateCatalog({ catalog: CATALOG, home });
    writeStateCatalog({ catalog: { ...CATALOG, states: [{ id: "s-todo", name: "Todo", type: "unstarted" }] }, home });

    expect(readStateCatalog({ home, teamId: "team-1" })!.states).toEqual([
      { id: "s-todo", name: "Todo", type: "unstarted" },
    ]);
  });

  it("is undefined for a team nothing has read", () => {
    expect(readStateCatalog({ home: tempHome(), teamId: "team-1" })).toBe(undefined);
  });

  it("is undefined — not empty — when the file is unreadable, so the gate still fails closed", () => {
    const home = tempHome();
    writeStateCatalog({ catalog: CATALOG, home });
    writeFileSync(stateCatalogPath({ home, teamId: "team-1" }), "{not json");

    expect(readStateCatalog({ home, teamId: "team-1" })).toBe(undefined);
  });
});

describe("parseStateCatalog", () => {
  it("drops an entry with no id and keeps a state whose type is absent as the empty string", () => {
    const parsed = parseStateCatalog({
      raw: JSON.stringify({
        members: [{ displayName: "ada", id: "u-1" }, { displayName: "no id" }],
        readAtIso: "2026-08-26T12:00:00.000Z",
        states: [{ id: "s-1", name: "Todo" }, { name: "no id" }],
        teamId: "team-1",
        teamKey: "ENG",
      }),
    });

    expect(parsed!.states).toEqual([{ id: "s-1", name: "Todo", type: "" }]);
    expect(parsed!.members).toEqual([{ displayName: "ada", id: "u-1" }]);
  });

  it("is undefined when the record carries no teamId", () => {
    expect(parseStateCatalog({ raw: JSON.stringify({ readAtIso: "x", states: [] }) })).toBe(undefined);
  });
});

describe("stateIdRefusals", () => {
  it("allows a write that sets no state at all, catalog or not", () => {
    expect(stateIdRefusals({ catalog: undefined, stateId: undefined, teamId: "team-1", teamKey: undefined })).toEqual(
      [],
    );
  });

  it("allows an id the catalog carries", () => {
    expect(stateIdRefusals({ catalog: CATALOG, stateId: "s-done", teamId: "team-1", teamKey: "ENG" })).toEqual([]);
  });

  it("FAILS CLOSED with no catalog — 'we could not check' is not 'it is fine'", () => {
    const refusals = stateIdRefusals({
      catalog: undefined,
      stateId: "s-done",
      teamId: "team-1",
      teamKey: undefined,
    });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("nothing has read team team-1's workflow states");
    expect(refusals[0]!).toContain("slopweaver linear states --team <team-key>");
  });

  it("refuses an id the catalog has never seen, naming the command that would fix it", () => {
    const refusals = stateIdRefusals({ catalog: CATALOG, stateId: "s-mangled", teamId: "team-1", teamKey: "ENG" });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("s-mangled is not one of the 2 workflow states read from team ENG");
    expect(refusals[0]!).toContain("slopweaver linear states --team ENG");
  });

  it("refuses the mangled shape the corpus actually stores, which still parses as an id", () => {
    const mangled = "01d0a8c3-1c3e-4cc4-956b-[number]efe";
    const refusals = stateIdRefusals({ catalog: CATALOG, stateId: mangled, teamId: "team-1", teamKey: "ENG" });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain(mangled);
  });
});

describe("assigneeMembershipRefusals", () => {
  it("allows an assignee the catalog lists as a member", () => {
    expect(assigneeMembershipRefusals({ assigneeId: "u-1", catalog: CATALOG })).toEqual([]);
  });

  it("refuses an assignee the destination team cannot take", () => {
    const refusals = assigneeMembershipRefusals({ assigneeId: "u-9", catalog: CATALOG });

    expect(refusals.length).toBe(1);
    expect(refusals[0]!).toContain("assignee u-9 is not among the 1 members read from team ENG");
  });

  it("demands NOTHING when there is no catalog — the roster is a real source on its own", () => {
    expect(assigneeMembershipRefusals({ assigneeId: "u-9", catalog: undefined })).toEqual([]);
  });

  it("demands nothing when nobody is being assigned", () => {
    expect(assigneeMembershipRefusals({ assigneeId: undefined, catalog: CATALOG })).toEqual([]);
  });
});
