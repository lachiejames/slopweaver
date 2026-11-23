import { describe, expect, it } from "vitest";

import type { StructureBronzeRow } from "../../../corpus/structures/types.js";
import {
  latestUsergroupRows,
  usergroupFromRow,
  usergroupHandleMap,
  usergroupsFromRows,
} from "../../../silver/slackUsergroups.js";

/** One structure row as `refresh` writes it from `usergroups.list`. */
function row({
  id,
  handle,
  name = "A Group",
  fetchedAtIso = "2026-09-01T00:00:00.000Z",
  raw = {},
  kind = "usergroup",
}: {
  id: string;
  handle?: string;
  name?: string;
  fetchedAtIso?: string;
  raw?: Record<string, unknown>;
  kind?: StructureBronzeRow["kind"];
}): StructureBronzeRow {
  return {
    attrs: {},
    fetchedAtIso,
    identity: { name, nativeId: id, ...(handle === undefined ? {} : { slug: handle }) },
    kind,
    provenance: ["slack.usergroups.list"],
    raw: { handle, id, name, ...raw },
    relations: [],
    source: "slack",
    sourceId: id,
    version: 1,
    warnings: [],
  };
}

describe("latestUsergroupRows", () => {
  it("keeps the NEWEST capture per id — the store appends rather than replaces", () => {
    const rows = [
      row({ fetchedAtIso: "2026-08-01T00:00:00.000Z", handle: "old-handle", id: "S1" }),
      row({ fetchedAtIso: "2026-09-01T00:00:00.000Z", handle: "new-handle", id: "S1" }),
    ];
    const latest = latestUsergroupRows({ rows });
    expect(latest.length).toBe(1);
    expect(latest[0]!.identity.slug).toBe("new-handle");
  });

  it("ignores every other structure kind", () => {
    expect(latestUsergroupRows({ rows: [row({ id: "C1", kind: "channel" })] })).toEqual([]);
  });

  it("answers nothing for an empty store", () => {
    expect(latestUsergroupRows({ rows: [] })).toEqual([]);
  });
});

describe("usergroupFromRow", () => {
  it("reads the handle off the identity slug and the members off the raw payload", () => {
    const group = usergroupFromRow({
      row: row({ handle: "insights-eng", id: "S1", name: "Insights Engineering", raw: { users: ["U2", "U1"] } }),
    });
    expect(group.id).toBe("S1");
    expect(group.handle).toBe("insights-eng");
    expect(group.name).toBe("Insights Engineering");
    expect(group.memberIds).toEqual(["U1", "U2"]);
    expect(group.deleted).toBe(false);
  });

  it("reads a non-zero date_delete as disabled — Slack disables rather than removes", () => {
    expect(usergroupFromRow({ row: row({ handle: "gone", id: "S2", raw: { date_delete: 1757000000 } }) }).deleted).toBe(
      true,
    );
  });

  it("reads date_delete 0 as live, which is what Slack sends for every group that is not disabled", () => {
    expect(usergroupFromRow({ row: row({ handle: "live", id: "S3", raw: { date_delete: 0 } }) }).deleted).toBe(false);
  });

  it("answers UNDEFINED for a capture that carried no handle — an absence, never an empty label", () => {
    expect(usergroupFromRow({ row: row({ id: "S4" }) }).handle).toBe(undefined);
  });

  it("answers no members for a capture whose raw payload has no users array", () => {
    expect(usergroupFromRow({ row: row({ handle: "h", id: "S5", raw: { users: "nope" } }) }).memberIds).toEqual([]);
  });
});

describe("usergroupsFromRows", () => {
  it("sorts by id, so two reads over one store answer identically", () => {
    const groups = usergroupsFromRows({
      rows: [row({ handle: "b", id: "S2" }), row({ handle: "a", id: "S1" })],
    });
    expect(groups.map((group) => group.id)).toEqual(["S1", "S2"]);
  });
});

describe("usergroupHandleMap", () => {
  it("maps each id to its handle", () => {
    const groups = usergroupsFromRows({ rows: [row({ handle: "insights-eng", id: "S1" })] });
    expect(usergroupHandleMap({ groups })).toEqual({ S1: "insights-eng" });
  });

  it("OMITS a group with no handle, so a caller falls back to the generic rather than rendering a bare @", () => {
    const groups = usergroupsFromRows({ rows: [row({ id: "S9" })] });
    expect(usergroupHandleMap({ groups })).toEqual({});
  });
});
