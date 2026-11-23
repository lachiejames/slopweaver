/**
 * When the authored leg may rewrite `authored_absent`: only for a whole walk of the store's own home after a
 * clean write, and never for an absent set that outweighs the walk.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { absenceNotes, absenceOutweighsWalk } from "../../../../cli/commands/store/importAuthoredAbsence.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("absenceOutweighsWalk", () => {
  it("records the one deletion of a home whose only listed file vanished, judged against the walk's own count", () => {
    expect(absenceOutweighsWalk({ absent: 1, listed: 1 })).toBe(undefined);
  });
});

describe("absenceNotes", () => {
  it("says nothing on a dry run, which never touches authored_absent", async () => {
    const home = mkdtempSync(join(tmpdir(), "authored-absence-"));
    homes.push(home);

    const notes = await absenceNotes({
      client: undefined,
      home,
      listing: { directories: [], files: [join(home, "talk/a.json")], unclassified: [], unreadable: [] },
      refused: [],
      vanished: ["talk/a.json"],
    });

    expect(notes).toEqual([]);
  });
});
