/**
 * The directory bronze: the projection from Google's user payload, and the snapshot file round trip.
 *
 * The projection is exercised over the field set `directory.users.list` actually returns (the atlas's
 * `directory-users` kind lists the names; the values here are synthetic), and the store over a temp home
 * the test owns — never the ambient one.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { projectDirectoryUser } from "../../../../corpus/directory/project.js";
import {
  googleDirectoryFile,
  parseDirectoryRow,
  readGoogleDirectory,
  writeGoogleDirectory,
} from "../../../../corpus/directory/store.js";

const AT = "2026-09-14T00:00:00.000Z";

/** One user as Google returns it, with the fields the projection reads and one it does not. */
const googleUser = {
  aliases: ["Ada.L@Example.invalid"],
  archived: false,
  creationTime: "2024-01-02T03:04:05.000Z",
  id: "100000000000000000001",
  isAdmin: true,
  lastLoginTime: "2026-09-13T01:02:03.000Z",
  name: { familyName: "Lovelace", fullName: "Ada Lovelace", givenName: "Ada" },
  orgUnitPath: "/Engineering",
  organizations: [{ primary: true, title: "Analyst" }],
  primaryEmail: "Ada@Example.invalid",
  suspended: false,
  ipWhitelisted: false,
};

describe("projectDirectoryUser", () => {
  it("projects the curated fields and normalises the address and every alias", () => {
    const projected = projectDirectoryUser({ fetchedAtIso: AT, user: googleUser });
    expect("row" in projected).toBe(true);
    const row = "row" in projected ? projected.row : null;
    expect(row!.googleId).toBe("100000000000000000001");
    expect(row!.primaryEmail).toBe("Ada@Example.invalid");
    expect(row!.emailNormalised).toBe("ada@example.invalid");
    expect(row!.aliases).toStrictEqual(["ada.l@example.invalid"]);
    expect(row!.fullName).toBe("Ada Lovelace");
    expect(row!.givenName).toBe("Ada");
    expect(row!.familyName).toBe("Lovelace");
    expect(row!.title).toBe("Analyst");
    expect(row!.orgUnitPath).toBe("/Engineering");
    expect(row!.isAdmin).toBe(true);
    expect(row!.suspended).toBe(false);
    expect(row!.archived).toBe(false);
    expect(row!.fetchedAtIso).toBe(AT);
  });

  it("keeps the whole payload as raw, so a field it does not know is retained rather than lost", () => {
    const projected = projectDirectoryUser({ fetchedAtIso: AT, user: googleUser });
    const raw = "row" in projected ? projected.row.raw : null;
    expect((raw as { ipWhitelisted: boolean }).ipWhitelisted).toBe(false);
  });

  it("skips a user with no id, naming why", () => {
    expect(projectDirectoryUser({ fetchedAtIso: AT, user: { primaryEmail: "x@example.invalid" } })).toStrictEqual({
      skipped: "no id",
    });
  });

  it("skips a user with no primary email, because the person key would be empty", () => {
    expect(projectDirectoryUser({ fetchedAtIso: AT, user: { id: "7" } })).toStrictEqual({
      skipped: "user 7 has no primaryEmail",
    });
  });

  it("names a user by their address when Google holds no name at all", () => {
    const projected = projectDirectoryUser({ fetchedAtIso: AT, user: { id: "7", primaryEmail: "x@example.invalid" } });
    expect("row" in projected ? projected.row.fullName : "").toBe("x@example.invalid");
  });
});

describe("the snapshot file", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("round-trips every row, and a second write REPLACES rather than appends", () => {
    home = mkdtempSync(join(tmpdir(), "sw-directory-"));
    const projected = projectDirectoryUser({ fetchedAtIso: AT, user: googleUser });
    const row = "row" in projected ? projected.row : null;
    expect(
      writeGoogleDirectory({
        home,
        rows: [row!, { ...row!, googleId: "2", primaryEmail: "b@example.invalid" }],
      }).isOk(),
    ).toBe(true);
    expect(readGoogleDirectory({ home }).rows.length).toBe(2);
    expect(writeGoogleDirectory({ home, rows: [row!] }).isOk()).toBe(true);
    const read = readGoogleDirectory({ home });
    expect(read.warnings).toStrictEqual([]);
    expect(read.rows).toStrictEqual([row!]);
    expect(googleDirectoryFile({ home })).toBe(join(home, "corpus", "directory", "google-admin.jsonl"));
  });

  it("reads an absent file as empty rather than throwing", () => {
    home = mkdtempSync(join(tmpdir(), "sw-directory-"));
    expect(readGoogleDirectory({ home })).toStrictEqual({ rows: [], warnings: [] });
  });

  it("rejects a line that is not a version-1 row, naming the line", () => {
    expect(parseDirectoryRow({ line: '{"version":2}' })).toStrictEqual({ error: "not a version-1 directory row" });
    expect("error" in parseDirectoryRow({ line: "not json" })).toBe(true);
  });
});
