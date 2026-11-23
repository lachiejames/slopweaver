import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MICROSOFT365_KINDS } from "../../../../atlas/microsoft365/model.js";
import { MICROSOFT365_SPEC_PIN } from "../../../../atlas/microsoft365/specLock.js";
import { microsoft365SpecCachePath } from "../../../../atlas/microsoft365/specSource.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-m365-paths-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("the microsoft365 atlas's home paths", () => {
  it("declares a file for exactly the kinds the model does", () => {
    const paths = stateHomePaths({ home: scratchHome() }).atlas.microsoft365;
    expect(Object.keys(paths.kinds).toSorted()).toEqual([...MICROSOFT365_KINDS]);
  });

  it("hangs every file off the platform root, and archives beside its siblings", () => {
    const home = scratchHome();
    const paths = stateHomePaths({ home }).atlas.microsoft365;
    expect(paths.root).toBe(join(home, "atlas", "microsoft365"));
    expect(paths.manifest).toBe(join(home, "atlas", "microsoft365", "manifest.json"));
    expect(paths.kinds["users"]).toBe(join(home, "atlas", "microsoft365", "users.jsonl"));
    expect(paths.superseded).toBe(join(home, "atlas", "_superseded", "microsoft365"));
  });

  it("names the cached specification by the commit it came from", () => {
    const root = join(scratchHome(), "atlas", "microsoft365");
    expect(microsoft365SpecCachePath({ root })).toBe(
      join(root, "spec", `graph-v1.0-${MICROSOFT365_SPEC_PIN.commit}.yaml`),
    );
  });
});
