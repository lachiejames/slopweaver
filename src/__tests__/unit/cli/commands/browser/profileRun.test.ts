import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readRecordedProfile } from "../../../../../browser/recordedProfile.js";
import { runBrowser } from "../../../../../cli/commands/browser/profileRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryRecordedProfilePort } from "../../../../recordedProfileFixture.js";
import { memorySingletonStore } from "../../../../singletonRegisterFixture.js";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-browser-run-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "cli", "browser", ...tail];

describe("runBrowser", () => {
  it("prints its usage and succeeds when asked for help", async () => {
    expect(await runBrowser(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("prints its usage and succeeds when given no sub-verb at all", async () => {
    expect(await runBrowser(argv({ tail: [] }))).toBe(EXIT_OK);
  });

  it("refuses a sub-verb it does not have", async () => {
    expect(await runBrowser(argv({ tail: ["launch"] }))).toBe(EXIT_USAGE);
  });

  it("refuses `cookies` with no origin", async () => {
    expect(await runBrowser(argv({ tail: ["cookies"] }))).toBe(EXIT_USAGE);
  });
});

/**
 * The recorded choice, round-tripped through the port the verb reads and records with, over an in-memory store
 * keyed by the home the caller named. The store's own import and compare-and-set cases are in
 * `../../../browser/recordedProfile.test.ts`.
 */
describe("the recorded profile round-trips through the home the caller named", () => {
  it("reads back exactly what was recorded, and writes no file into the home", async () => {
    const home = scratchHome();
    const profiles = memoryRecordedProfilePort();
    const recorded = unwrap(await profiles.record({ directory: "Default", expectedRevision: null, home }));
    expect(recorded.directory).toBe("Default");
    expect(recorded.revision).toBe(1);
    expect(unwrap(await readRecordedProfile({ home, profiles }))).toBe("Default");
    expect(existsSync(join(home, "browser.json"))).toBe(false);
  });

  it("refuses when nothing has been recorded, naming the verb that records one", async () => {
    const result = await readRecordedProfile({ home: scratchHome(), profiles: memoryRecordedProfilePort() });
    expect(unwrapErr(result).code).toBe("PROFILE_UNSET");
    expect(unwrapErr(result).message).toContain("browser profile --list");
  });

  it("refuses a retired file that holds no profile directory rather than importing an empty one", async () => {
    const home = scratchHome();
    writeFileSync(join(home, "browser.json"), JSON.stringify({ profileDirectory: "   " }), "utf8");
    const store = memorySingletonStore();
    const result = await readRecordedProfile({ home, profiles: memoryRecordedProfilePort({ store }) });
    expect(unwrapErr(result).code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(unwrapErr(result).message).toContain("profileDirectory is not a non-empty string");
    expect(store.rows.size).toBe(0);
  });

  it("names the retired file when it holds something that is not JSON, and imports nothing", async () => {
    const home = scratchHome();
    const path = join(home, "browser.json");
    writeFileSync(path, "not json", "utf8");
    const store = memorySingletonStore();
    const result = await readRecordedProfile({ home, profiles: memoryRecordedProfilePort({ store }) });
    expect(unwrapErr(result).code).toBe("PROFILE_REGISTER_MALFORMED");
    expect(unwrapErr(result).message).toContain(path);
    expect(store.rows.size).toBe(0);
  });
});
