/**
 * Every registered atlas refuses an empty home, and no future one can opt out.
 *
 * This is the structural half of the fix: `registry.ts` wraps every `readSnapshot`, so the property is a
 * consequence of being registered rather than something each adapter has to remember. Five adapters had
 * already forgotten it — against a home holding nothing they answered `entities: []` and exited 0, which
 * reads as "this organisation holds none".
 *
 * The loop is over the registry rather than a list of names on purpose: a new atlas joins this test by
 * being registered, which is the only way to make "no future one can opt out" a test rather than a promise.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { unwrapErr } from "../../../lib/result.js";

const home = mkdtempSync(join(tmpdir(), "atlas-guard-"));

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("every registered atlas, read against a home holding nothing", () => {
  it.each(atlasPlatforms().map((platform) => [platform]))("%s refuses rather than answering zero", async (platform) => {
    const registration = findAtlasPlatform({ platform });
    expect(registration?.platform).toBe(platform);
    const snapshot = await registration!.readSnapshot({ home });
    expect(snapshot.isErr()).toBe(true);
  });

  it("says WHICH way it cannot answer, so a sweep can tell an unsynced atlas from a broken one", async () => {
    const snapshot = await findAtlasPlatform({ platform: "vanta" })!.readSnapshot({ home });
    expect(snapshot.isErr()).toBe(true);
    expect(unwrapErr(snapshot).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });
});
