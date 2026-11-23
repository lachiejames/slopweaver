/**
 * What the read seam answers before anything has been published, and after a reset.
 *
 * "This instance has no detection rules" and "nobody has read it" are different sentences, so an
 * unpublished store refuses and names the door, rather than projecting an empty atlas.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GOOGLE_SECOPS_ATLAS_KINDS } from "../../../../atlas/googleSecops/model.js";
import { readGoogleSecopsSnapshot } from "../../../../atlas/googleSecops/readAdapter.js";
import { GOOGLE_SECOPS_ATLAS_REGISTRATION } from "../../../../atlas/googleSecops/registration.js";
import { googleSecopsAtlasPaths } from "../../../../atlas/googleSecops/store.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-02T00:00:00.000Z";
const homes: string[] = [];

/** A throwaway state home this file owns and removes. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-google-secops-read-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("readGoogleSecopsSnapshot", () => {
  it("refuses an unpublished store and names the door that comes first", () => {
    const error = unwrapErr(readGoogleSecopsSnapshot({ home: scratchHome() }));
    expect(error.code).toBe("ATLAS_GENERATION_UNPUBLISHED");
    expect(error.message).toContain("slopweaver atlas google-secops connect");
  });
});

describe("the kit reset this registration declares", () => {
  it("refuses an install with no generation, naming the platform's own directory", async () => {
    const home = scratchHome();
    const reset = await GOOGLE_SECOPS_ATLAS_REGISTRATION.readReset!();
    expect(unwrapErr(reset({ at: AT, home }))).toStrictEqual([
      `no current google-secops atlas at ${googleSecopsAtlasPaths({ home }).directory} — nothing to reset`,
    ]);
    expect(googleSecopsAtlasPaths({ home }).directory).toBe(join(home, "atlas", "google-secops"));
  });

  it("declares one kind file per family the model names", () => {
    expect(Object.keys(googleSecopsAtlasPaths({ home: "/h" }).kinds).toSorted()).toStrictEqual([
      ...GOOGLE_SECOPS_ATLAS_KINDS,
    ]);
  });
});
