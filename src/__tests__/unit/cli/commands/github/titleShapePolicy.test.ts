/**
 * `loadTitleShapePolicy` over a state home this test owns: the install's `github.titleShapes` read out of
 * `profile.json`, this build's own repository derived beside it, and a corrupt profile refusing the write.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadTitleShapePolicy } from "../../../../../cli/commands/github/titleShapePolicy.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { resolveSelfRepository } from "../../../../../organisation/read.js";

const minted: string[] = [];

/** A fresh state home, holding `profile` as its `profile.json` when one is given. */
function homeWith({ profile }: { profile: string | undefined }): string {
  const dir = mkdtempSync(join(tmpdir(), "title-policy-"));
  minted.push(dir);
  if (profile !== undefined) {
    writeFileSync(join(dir, "profile.json"), profile);
  }
  return dir;
}

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const PROFILE = { displayName: "", gitNamespace: "", id: "me", schemaVersion: 1, sources: [] };

describe("loadTitleShapePolicy", () => {
  it("holds each repository the profile names to its shape, beside this build's own repository", () => {
    const profile = JSON.stringify({ ...PROFILE, github: { titleShapes: { "acme/acme-admin": "ticketed" } } });
    const home = homeWith({ profile });
    expect(unwrap(loadTitleShapePolicy({ home }))).toStrictEqual({
      repositoryShapes: { "acme/acme-admin": "ticketed" },
      selfRepository: unwrap(resolveSelfRepository({ home })),
    });
  });

  it("judges only this build's own titles in a home with no profile at all", () => {
    const home = homeWith({ profile: undefined });
    expect(unwrap(loadTitleShapePolicy({ home })).repositoryShapes).toStrictEqual({});
  });

  it("refuses with the profile's own code when profile.json is there but corrupt, rather than judging nothing", () => {
    const refusal = unwrapErr(loadTitleShapePolicy({ home: homeWith({ profile: "{ not json" }) }));
    expect(refusal.code).toBe("PROFILE_UNREADABLE");
    expect(refusal.message).toContain("is there but cannot be trusted (not JSON: ");
  });
});
