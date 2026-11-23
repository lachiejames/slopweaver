/**
 * `talk file` over a throwaway home with a `no-access` path the owner protected: refused as asked, refused through a
 * symlink, refused with the credential hatch open, absent from a listing — and a `read-only` one still read.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import { type LocalReadPolicy, listLocalDir, readLocalFile } from "../../../talk/localFile.js";

let home = "";
let policy: LocalReadPolicy;

/** A protected entry over a path under the throwaway home. */
function entry({ path, mode }: { path: string; mode: ProtectedPath["mode"] }): ProtectedPath {
  return { addedIso: "2026-01-01T00:00:00.000Z", mode, path, why: "a synthetic protection" };
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "talk-protected-")));
  mkdirSync(join(home, "private"), { recursive: true });
  mkdirSync(join(home, "kept"), { recursive: true });
  writeFileSync(join(home, "private", "diary.txt"), "not for the voice\n");
  writeFileSync(join(home, "kept", "notes.txt"), "readable\n");
  symlinkSync(join(home, "private", "diary.txt"), join(home, "link.txt"));
  policy = {
    denylist: [],
    homeDir: home,
    protectedPaths: [
      entry({ mode: "no-access", path: join(home, "private") }),
      entry({ mode: "read-only", path: join(home, "kept") }),
    ],
    refusalsLifted: false,
    stores: [],
  };
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("talk file over an owner-protected path", () => {
  it("refuses a no-access path as asked, naming the protected path", () => {
    const refused = unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/private/diary.txt" }));
    expect(refused.code).toBe("OWNER_PROTECTED");
    expect(refused.message).toContain(join(home, "private"));
  });

  it("refuses a no-access path that a symlink resolves into", () => {
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/link.txt" })).code).toBe("OWNER_PROTECTED");
  });

  it("refuses an absent file reached through a symlink into a no-access path, never saying it is absent", () => {
    symlinkSync(join(home, "private"), join(home, "door"));
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/door/absent.txt" })).code).toBe(
      "OWNER_PROTECTED",
    );
  });

  it("refuses a no-access path that does not exist, without saying whether it does", () => {
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/private/absent.txt" })).code).toBe(
      "OWNER_PROTECTED",
    );
  });

  it("keeps refusing with the credential hatch open", () => {
    const lifted = { ...policy, refusalsLifted: true };
    expect(unwrapErr(readLocalFile({ budget: 4096, from: 0, policy: lifted, raw: "~/private/diary.txt" })).code).toBe(
      "OWNER_PROTECTED",
    );
  });

  it("reads a read-only path", () => {
    const read = unwrap(readLocalFile({ budget: 4096, from: 0, policy, raw: "~/kept/notes.txt" }));
    expect(read.kind).toBe("text");
  });

  it("leaves a no-access child, and a symlink resolving into one, out of a listing and its total", () => {
    const lifted = { ...policy, refusalsLifted: true };
    const listing = unwrap(listLocalDir({ limit: 10, policy: lifted, raw: "~" }));
    expect(listing.entries.map((listed) => listed.name)).toEqual(["kept"]);
    expect(listing.total).toBe(1);
  });
});
