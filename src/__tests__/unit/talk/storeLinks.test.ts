/**
 * A path under a credential store is found by `(dev, ino)` however the store is spelt, a hard link into one is
 * found by inode, and what is not inside one is left alone.
 */
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  besideStoreByIdentity,
  insideStoreByIdentity,
  lazyStoreLinkIndex,
  linkedIntoStore,
  storeLinkIndex,
} from "../../../talk/storeLinks.js";

let home = "";
let stores: readonly string[] = [];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "store-links-")));
  mkdirSync(join(home, "secrets", "nested"), { recursive: true });
  writeFileSync(join(home, "secrets", "nested", "token"), "not-a-real-token\n");
  writeFileSync(join(home, "plain.txt"), "plain\n");
  stores = [join(home, "secrets"), join(home, "absent-store")];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("insideStoreByIdentity", () => {
  it("finds a file under a store named by a spelling no string comparison would match", () => {
    symlinkSync(join(home, "secrets"), join(home, "another-spelling"));
    const aliased = [join(home, "another-spelling")];
    expect(insideStoreByIdentity({ real: join(home, "secrets", "nested", "token"), stores: aliased })).toBe(true);
    expect(insideStoreByIdentity({ real: join(home, "secrets"), stores: aliased })).toBe(true);
    expect(insideStoreByIdentity({ real: join(home, "plain.txt"), stores: aliased })).toBe(false);
  });

  it("refuses a path it cannot stat, and passes everything when no store exists", () => {
    expect(insideStoreByIdentity({ real: join(home, "gone", "x"), stores })).toBe(true);
    expect(insideStoreByIdentity({ real: join(home, "plain.txt"), stores: [join(home, "absent-store")] })).toBe(false);
  });
});

describe("besideStoreByIdentity", () => {
  it("finds a copy whose name extends a store's in the store's own directory, however that is spelt", () => {
    writeFileSync(join(home, "denylist.txt"), "x\n");
    writeFileSync(join(home, "denylist.txt.bak-1"), "x\n");
    mkdirSync(join(home, "secrets.old"));
    symlinkSync(home, join(home, "alias"));
    const fileStores = [join(home, "alias", "denylist.txt"), join(home, "alias", "secrets")];
    expect(besideStoreByIdentity({ real: join(home, "denylist.txt.bak-1"), stores: fileStores })).toBe(true);
    expect(besideStoreByIdentity({ real: join(home, "secrets.old"), stores: fileStores })).toBe(true);
  });

  it("finds a file anywhere inside a copied store directory, a Finder duplicate's name included", () => {
    mkdirSync(join(home, "secrets.old", "nested"), { recursive: true });
    mkdirSync(join(home, "secrets copy"));
    writeFileSync(join(home, "secrets.old", "nested", "token"), "x\n");
    writeFileSync(join(home, "secrets copy", "token"), "x\n");
    expect(besideStoreByIdentity({ real: join(home, "secrets.old", "nested", "token"), stores })).toBe(true);
    expect(besideStoreByIdentity({ real: join(home, "secrets copy", "token"), stores })).toBe(true);
    mkdirSync(join(home, "secrets2"));
    mkdirSync(join(home, "secrets(1)"));
    expect(besideStoreByIdentity({ real: join(home, "secrets2"), stores })).toBe(true);
    expect(besideStoreByIdentity({ real: join(home, "secrets(1)"), stores })).toBe(true);
    expect(besideStoreByIdentity({ real: join(home, "plain.txt"), stores })).toBe(false);
  });

  it("leaves a name that only shares a prefix with a store, and the store itself, to the other checks", () => {
    writeFileSync(join(home, "secretsanta.txt"), "x\n");
    expect(besideStoreByIdentity({ real: join(home, "secretsanta.txt"), stores })).toBe(false);
    expect(besideStoreByIdentity({ real: join(home, "secrets"), stores })).toBe(false);
  });
});

describe("linkedIntoStore", () => {
  it("finds a hard link to a file nested inside a store", () => {
    linkSync(join(home, "secrets", "nested", "token"), join(home, "innocent.txt"));
    const index = lazyStoreLinkIndex({ stores });
    expect(linkedIntoStore({ index, stat: lstatSync(join(home, "innocent.txt")) })).toBe(true);
  });

  it("leaves a file with one link, and a hard link between two ordinary files, alone", () => {
    const index = lazyStoreLinkIndex({ stores });
    expect(linkedIntoStore({ index, stat: lstatSync(join(home, "plain.txt")) })).toBe(false);
    linkSync(join(home, "plain.txt"), join(home, "plain-too.txt"));
    expect(linkedIntoStore({ index, stat: lstatSync(join(home, "plain-too.txt")) })).toBe(false);
  });

  it("walks the stores once however many entries ask, and indexes only files with a second link", () => {
    linkSync(join(home, "secrets", "nested", "token"), join(home, "innocent.txt"));
    const index = lazyStoreLinkIndex({ stores });
    expect(index()).toBe(index());
    expect(storeLinkIndex({ stores })).toEqual({ ids: index().ids, incomplete: false });
    expect(index().ids.size).toBe(1);
  });

  it("calls every hard-linked file a store's when a store directory cannot be read", () => {
    linkSync(join(home, "secrets", "nested", "token"), join(home, "innocent.txt"));
    chmodSync(join(home, "secrets", "nested"), 0o000);
    try {
      const index = lazyStoreLinkIndex({ stores });
      expect(index().incomplete).toBe(true);
      expect(linkedIntoStore({ index, stat: lstatSync(join(home, "innocent.txt")) })).toBe(true);
    } finally {
      chmodSync(join(home, "secrets", "nested"), 0o700);
    }
  });
});
