/**
 * The LIST of destinations a backup writes to: one address per line in the remembered file, in order; a flag or
 * the environment replacing it with one for one run; a stable id per normalised root; and the ONE destination a
 * read takes, which is the first and never a later one in its place.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { BACKUP_DIRECTORY_ENV, BACKUP_DIRECTORY_SECRET } from "../../../store/backup/destination.js";
import {
  backupDestinations,
  backupReadDestination,
  destinationId,
  destinationListText,
  parseDestinationList,
  rememberedDestinations,
} from "../../../store/backup/destinationConfig.js";
import { DestinationListErrors } from "../../../store/backup/destinationListErrors.js";

const homes: string[] = [];

/**
 * A home whose remembered destination list holds the text given, or no file at all.
 *
 * @param list the file's contents, or `null` for no file
 * @returns the home's path
 */
function homeWith({ list }: { list: string | null }): string {
  const home = mkdtempSync(join(tmpdir(), "backup-destination-config-"));
  mkdirSync(join(home, "secrets"), { recursive: true });
  if (list !== null) {
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), list, { mode: 0o600 });
  }
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    chmodSync(join(home, "secrets"), 0o700);
    rmSync(home, { force: true, recursive: true });
  }
});

const PATH = "/h/secrets/store-backup-directory";

describe("destinationId", () => {
  it("is 16 hex of the root's sha256, and one folder spelled two ways is one id", () => {
    const fromPath = unwrap(parseDestinationList({ path: PATH, text: "/Volumes/SSD/backups\n" }))[0]!;
    const fromUrl = unwrap(parseDestinationList({ path: PATH, text: "file:///Volumes/SSD/backups/\n" }))[0]!;
    expect(fromPath.id).toBe(destinationId({ root: "/Volumes/SSD/backups" }));
    expect(fromPath.id).toMatch(/^[0-9a-f]{16}$/);
    expect(fromUrl.id).toBe(fromPath.id);
    expect(fromUrl.address).toBe("file:///Volumes/SSD/backups/");
    expect(destinationId({ root: "/Users/me/backups" })).not.toBe(fromPath.id);
  });
});

describe("parseDestinationList", () => {
  it("reads today's one-line file as a one-item list", () => {
    expect(unwrap(parseDestinationList({ path: PATH, text: "/remembered/dest\n" }))).toEqual([
      { address: "/remembered/dest", id: destinationId({ root: "/remembered/dest" }), root: "/remembered/dest" },
    ]);
  });

  it("keeps two lines in file order", () => {
    const roots = unwrap(parseDestinationList({ path: PATH, text: "/Users/me/backups\n/Volumes/SSD/backups\n" })).map(
      (destination) => destination.root,
    );
    expect(roots).toEqual(["/Users/me/backups", "/Volumes/SSD/backups"]);
  });

  it("reads a blank file as no destinations at all", () => {
    expect(unwrap(parseDestinationList({ path: PATH, text: "\n" }))).toEqual([]);
  });

  it("refuses a blank line between two addresses, naming its line", () => {
    const refused = unwrapErr(parseDestinationList({ path: PATH, text: "/a\n\n/b\n" }));
    expect(refused).toEqual(DestinationListErrors.blankLine({ line: 2, path: PATH }));
    expect(refused.message).toBe(`${PATH} line 2 is blank — the list is one address per line, with no gaps`);
  });

  it("refuses the same folder named twice, however it is spelled", () => {
    const refused = unwrapErr(parseDestinationList({ path: PATH, text: "/a/dest\nfile:///a/dest/\n" }));
    expect(refused).toEqual(DestinationListErrors.duplicate({ line: 2, path: PATH, root: "/a/dest" }));
    expect(refused.message).toBe(`${PATH} line 2 names /a/dest again — each destination is listed once`);
  });

  it("refuses a relative path and a remote scheme by the address's own refusal", () => {
    expect(unwrapErr(parseDestinationList({ path: PATH, text: "/a\nrelative/dest\n" })).code).toBe(
      "DESTINATION_NOT_ABSOLUTE",
    );
    expect(unwrapErr(parseDestinationList({ path: PATH, text: "s3://bucket/x\n" })).code).toBe(
      "DESTINATION_KIND_NOT_BUILT",
    );
  });

  it("round-trips through the text it is remembered as", () => {
    const text = "/Users/me/backups\nfile:///Volumes/SSD/backups\n";
    const destinations = unwrap(parseDestinationList({ path: PATH, text }));
    expect(destinationListText({ destinations })).toBe(text);
  });
});

describe("rememberedDestinations", () => {
  it("reads an absent file as an empty list", () => {
    expect(unwrap(rememberedDestinations({ home: homeWith({ list: null }) }))).toEqual([]);
  });

  it("refuses a file that is there and cannot be read, rather than calling it empty", () => {
    const home = homeWith({ list: "/a\n" });
    chmodSync(join(home, "secrets"), 0o000);
    const refused = unwrapErr(rememberedDestinations({ home }));
    expect(refused.code).toBe("DESTINATION_LIST_UNREADABLE");
    expect(refused.message).toContain(`could not read the backup destination list ${join(home, "secrets")}`);
  });
});

describe("backupDestinations", () => {
  it("lets the flag replace the environment and the list with one destination", () => {
    const home = homeWith({ list: "/a\n/b\n" });
    const selection = unwrap(
      backupDestinations({ env: { [BACKUP_DIRECTORY_ENV]: "/env/dest" }, home, override: "/flag/dest" }),
    );
    expect(selection.origin).toBe("flag");
    expect(selection.destinations.map((destination) => destination.root)).toEqual(["/flag/dest"]);
  });

  it("lets the environment replace the list with one destination when no flag is passed", () => {
    const home = homeWith({ list: "/a\n/b\n" });
    const selection = unwrap(
      backupDestinations({ env: { [BACKUP_DIRECTORY_ENV]: " /env/dest " }, home, override: null }),
    );
    expect(selection.origin).toBe("environment");
    expect(selection.destinations.map((destination) => destination.root)).toEqual(["/env/dest"]);
  });

  it("reads the whole remembered list, in order, with neither", () => {
    const selection = unwrap(backupDestinations({ env: {}, home: homeWith({ list: "/a\n/b\n" }), override: null }));
    expect(selection.origin).toBe("remembered");
    expect(selection.destinations.map((destination) => destination.root)).toEqual(["/a", "/b"]);
  });

  it("refuses when nothing selected one, naming every place one can be put", () => {
    const refused = unwrapErr(backupDestinations({ env: {}, home: homeWith({ list: null }), override: null }));
    expect(refused.code).toBe("DESTINATION_UNSELECTED");
    expect(refused.message).toContain("--destination <address>");
    expect(refused.message).toContain(BACKUP_DIRECTORY_ENV);
    expect(refused.message).toContain(`secrets/${BACKUP_DIRECTORY_SECRET}`);
    expect(refused.message).toContain("slopweaver store backup --set-destination <address>");
  });

  it("refuses a relative path from the flag and from the list alike", () => {
    const home = homeWith({ list: "relative/dest\n" });
    expect(unwrapErr(backupDestinations({ env: {}, home, override: "dest" })).code).toBe("DESTINATION_NOT_ABSOLUTE");
    expect(unwrapErr(backupDestinations({ env: {}, home, override: null })).message).toBe(
      '"relative/dest" is not an absolute path — a backup destination never depends on the working directory',
    );
  });

  it("normalises an absolute path it accepts", () => {
    const selection = unwrap(
      backupDestinations({ env: {}, home: homeWith({ list: null }), override: "/a/b/../dest/" }),
    );
    expect(selection.destinations[0]!.root).toBe("/a/dest");
  });
});

describe("backupReadDestination", () => {
  it("reads the first destination on the list, and only the first", () => {
    const read = unwrap(
      backupReadDestination({ env: {}, home: homeWith({ list: "/absent/ssd\n/a\n" }), override: null }),
    );
    expect(read.destination.root).toBe("/absent/ssd");
    expect(read.origin).toBe("remembered");
  });

  it("reads the flag's destination when one is named", () => {
    const read = unwrap(backupReadDestination({ env: {}, home: homeWith({ list: "/a\n/b\n" }), override: "/b" }));
    expect(read.destination.root).toBe("/b");
    expect(read.origin).toBe("flag");
  });
});
