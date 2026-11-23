import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexAuthStamp } from "../../../codex/signInAuthStamp.js";

describe("readCodexAuthStamp", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "sw-authstamp-"));
    homes.push(home);
    return home;
  }

  it("stamps an auth.json by size and times without reading what it says", () => {
    const home = freshHome();
    writeFileSync(join(home, "auth.json"), "0123456789");
    expect(readCodexAuthStamp({ codexHome: home })).toMatchObject({ kind: "present", size: 10 });
  });

  it("stamps a store with no auth.json as absent", () => {
    expect(readCodexAuthStamp({ codexHome: freshHome() })).toEqual({ kind: "absent" });
  });
});
