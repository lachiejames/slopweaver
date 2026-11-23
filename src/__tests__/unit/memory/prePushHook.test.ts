import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  firstAnsweringGate,
  gateBinaryCandidates,
  launcherAnswersGate,
  PRE_PUSH_MARKER,
  prePushInstallVerdict,
  prePushScript,
  readExistingHook,
  treeRootHoldingLauncher,
  writePrePushHook,
} from "../../../memory/prePushHook.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prepush-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("prePushScript", () => {
  it("carries the marker that makes a refresh safe", () => {
    expect(prePushScript({ binary: "/x/bin/slopweaver" })).toContain(PRE_PUSH_MARKER);
  });

  it("bakes the resolved path in as a quoted literal", () => {
    expect(prePushScript({ binary: "/x/bin/slopweaver" })).toContain('SLOPWEAVER="/x/bin/slopweaver"');
  });

  it("quotes a path containing a space rather than splitting it", () => {
    expect(prePushScript({ binary: "/x y/bin/slopweaver" })).toContain('SLOPWEAVER="/x y/bin/slopweaver"');
  });

  it("runs the gate, not the installer", () => {
    expect(prePushScript({ binary: "/x/bin/slopweaver" })).toContain('exec "$SLOPWEAVER" memory gate\n');
  });

  it("says out loud that it gates nothing about the push", () => {
    expect(prePushScript({ binary: "/x/bin/slopweaver" })).toContain("This gates NOTHING about what is being pushed");
  });
});

describe("prePushInstallVerdict", () => {
  it("installs when nothing is there", () => {
    expect(prePushInstallVerdict({ existing: null })).toEqual({ action: "install" });
  });

  it("refreshes its own hook", () => {
    expect(prePushInstallVerdict({ existing: prePushScript({ binary: "/old/bin/slopweaver" }) })).toEqual({
      action: "refresh",
    });
  });

  it("refuses a hook somebody else wrote, naming why", () => {
    expect(prePushInstallVerdict({ existing: "#!/bin/sh\nexec yarn lint\n" })).toEqual({
      action: "refuse",
      reason: expect.stringContaining("not this one"),
    });
  });

  it("refuses an empty file rather than treating it as absent", () => {
    expect(prePushInstallVerdict({ existing: "" }).action).toBe("refuse");
  });
});

describe("gateBinaryCandidates", () => {
  const base = { treeRoot: "/work/tree", userHome: "/home/x" };

  it("puts the mirror first, declared checkouts next and the running tree last", () => {
    expect(gateBinaryCandidates({ ...base, declaredCheckouts: ["/main/one", "/main/two"], env: {} })).toEqual([
      "/home/x/.claude/plugins/data/slopweaver/mirror/current/bin/slopweaver",
      "/main/one/bin/slopweaver",
      "/main/two/bin/slopweaver",
      "/work/tree/bin/slopweaver",
    ]);
  });

  it("honours PLUGIN_DATA over the default location", () => {
    expect(gateBinaryCandidates({ ...base, declaredCheckouts: [], env: { PLUGIN_DATA: "/pd" } })[0]).toBe(
      "/pd/mirror/current/bin/slopweaver",
    );
  });

  it("falls to CLAUDE_PLUGIN_DATA when PLUGIN_DATA is empty", () => {
    expect(
      gateBinaryCandidates({
        ...base,
        declaredCheckouts: [],
        env: { CLAUDE_PLUGIN_DATA: "/cpd", PLUGIN_DATA: "" },
      })[0],
    ).toBe("/cpd/mirror/current/bin/slopweaver");
  });

  it("still offers the running tree when no checkout is declared", () => {
    expect(gateBinaryCandidates({ ...base, declaredCheckouts: [], env: {} })).toEqual([
      "/home/x/.claude/plugins/data/slopweaver/mirror/current/bin/slopweaver",
      "/work/tree/bin/slopweaver",
    ]);
  });
});

describe("launcherAnswersGate", () => {
  it("is false for a path that is not there at all", () => {
    expect(launcherAnswersGate({ binary: join(tempDir(), "absent", "slopweaver") })).toBe(false);
  });
});

describe("firstAnsweringGate", () => {
  it("is null when no candidate exists", () => {
    const dir = tempDir();
    expect(firstAnsweringGate({ candidates: [join(dir, "a"), join(dir, "b")] })).toBe(null);
  });

  it("is null for an empty candidate list", () => {
    expect(firstAnsweringGate({ candidates: [] })).toBe(null);
  });
});

describe("treeRootHoldingLauncher", () => {
  it("is null when no ancestor holds a launcher", () => {
    expect(treeRootHoldingLauncher({ moduleUrl: `file://${join(tempDir(), "deep", "mod.ts")}` })).toBe(null);
  });

  it("finds this repository's own root from this module", () => {
    expect(treeRootHoldingLauncher({ moduleUrl: import.meta.url })!.length).toBeGreaterThan(0);
  });
});

describe("writePrePushHook", () => {
  it("writes a hook the reader can read back", () => {
    const path = join(tempDir(), "hooks", "pre-push");
    expect(unwrap(writePrePushHook({ binary: "/x/bin/slopweaver", path }))).toBe(undefined);
    expect(readExistingHook({ path })).toBe(prePushScript({ binary: "/x/bin/slopweaver" }));
  });

  it("reads null where nothing was written", () => {
    expect(readExistingHook({ path: join(tempDir(), "pre-push") })).toBe(null);
  });
});
