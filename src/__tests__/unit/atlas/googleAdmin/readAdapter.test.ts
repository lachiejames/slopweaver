/**
 * What the read seam answers before anything has been published, and after a reset.
 *
 * "This Workspace has no admin roles" and "nobody ran the sync" are different sentences, and on a platform
 * whose whole subject is who can administer what, the first one is the more dangerous thing to say by
 * accident. So an unpublished store refuses and names the command, rather than projecting an empty atlas.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readGoogleAdminSnapshot } from "../../../../atlas/googleAdmin/readAdapter.js";
import { resetGoogleAdminAtlas } from "../../../../atlas/googleAdmin/reset.js";
import { googleAdminAtlasPaths } from "../../../../atlas/googleAdmin/store.js";
import { syncGoogleAdminAtlas } from "../../../../atlas/googleAdmin/sync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-google-admin-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readGoogleAdminSnapshot", () => {
  it("refuses an unpublished store and names the command that fills it", () => {
    const result = readGoogleAdminSnapshot({ home: scratchHome() });
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe("ATLAS_GENERATION_UNPUBLISHED");
    expect(error.message).toContain("slopweaver atlas google-admin sync");
  });

  it("carries the descriptor's own unfilled surface into the snapshot a reader gets", () => {
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    expect(snapshot.descriptor.surfaces.filter((surface) => surface.status === "declared-unfilled").length).toBe(1);
    expect(snapshot.kinds.length).toBe(83);
  });

  it("reads a kind no permission ever blocked as unblocked, not as an unknown block", () => {
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    expect(snapshot.kinds.length).toBe(83);
    expect(snapshot.kinds.filter((kind) => kind.permissionBlocked !== null)).toEqual([]);
  });

  it("says the console is unwalked on THIS install even though the build's surface is filled", () => {
    // The descriptor's `status` is static and says this build has a working walk lane. Whether one has RUN
    // here is the per-kind cell's job, and conflating the two is how an atlas claims another install's work.
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    const page = snapshot.kinds.find((kind) => kind.kind === "page")!;
    const console = page.coverage.find((cell) => cell.surface === "admin-console")!;
    expect(console.state).toBe("not-configured");
    expect(page.gaps.map((gap) => gap.condition)).toContain("no-console-session");
  });

  it("projects one observation per channel that looked, so a compiled entity carries exactly one", () => {
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    const users = snapshot.kinds.find((kind) => kind.kind === "directory-users")!;
    const list = users.entities.find((entity) => entity.providerId === "admin.directory_v1:directory.users.list")!;
    expect(list.observations.map((observation) => observation.surface)).toStrictEqual(["discovery"]);
  });

  it("comes back empty-but-published after a reset, with the prior generation archived rather than deleted", () => {
    const home = scratchHome();
    unwrap(syncGoogleAdminAtlas({ at: AT, home }));
    const outcome = unwrap(resetGoogleAdminAtlas({ at: AT, paths: googleAdminAtlasPaths({ home }) }));
    expect(outcome.archivedTo).toContain(join("atlas", "_superseded", "google-admin"));

    const snapshot = unwrap(readGoogleAdminSnapshot({ home }));
    expect(snapshot.kinds.every((kind) => kind.entities.length === 0)).toBe(true);
    expect(snapshot.generation.missing).toStrictEqual([]);
  });
});
