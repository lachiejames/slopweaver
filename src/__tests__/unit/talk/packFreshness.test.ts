import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storedPackRefresh } from "../../../cli/commands/talk/packFreshness.js";

describe("storedPackRefresh", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pack-fresh-"));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("rebuilds when no pack has been written", () => {
    expect(storedPackRefresh({ olderThanMinutes: 30, path: join(dir, "pack.json") })).toEqual({
      due: true,
      why: "no pack has been written",
    });
  });

  it("rebuilds, without reading it, when something other than a regular file sits at the path", () => {
    const path = join(dir, "pack.json");
    mkdirSync(path);
    expect(storedPackRefresh({ olderThanMinutes: 30, path })).toEqual({
      due: true,
      why: `${path} is not a regular file`,
    });
  });

  it("rebuilds a stored file that is not JSON, naming why", () => {
    const path = join(dir, "pack.json");
    writeFileSync(path, "{");
    const refresh = storedPackRefresh({ olderThanMinutes: 30, path });
    expect(refresh.due).toBe(true);
    expect((refresh as { why: string }).why).toContain("is not JSON");
  });
});
