/**
 * The session-harness-lifecycle gate's criterion: a cmux client constructed, a cmux launch or a hand-written `spawned`
 * session row outside the seam. The negative cases matter as much as the positive ones — the seam's own tree, a `closed` append and an event
 * passed by name are all outside it, and there is no exemption marker.
 */
import { describe, expect, it } from "vitest";

import {
  isScannablePath,
  partitionAgainstDebt,
  scanSessionHarnessLifecycle,
} from "../../../devLint/sessionHarnessLifecycle.js";

/** The shape and line of every hit in `content`, scanned as if it lived at `path`. */
function hitsIn({ path = "src/cli/commands/example.ts", content }: { path?: string; content: string }): string[] {
  return scanSessionHarnessLifecycle({ content, path }).map((hit) => `${String(hit.line)}:${hit.shape}`);
}

describe("scanSessionHarnessLifecycle", () => {
  it("flags a direct cmux launch, through a member access too", () => {
    const content = [
      "const one = await spawnCmuxSession({ deps, plan });",
      "const two = await spawn.spawnCmuxSession({ deps, plan });",
      "const three = (spawnCmuxSession)({ deps, plan });",
    ].join("\n");
    expect(hitsIn({ content })).toEqual(["1:spawn-direct", "2:spawn-direct", "3:spawn-direct"]);
  });

  it("flags a spawned row appended inline, and nothing else appended", () => {
    const content = [
      'appendSessionEvent({ event: { kind: "spawned", sessionKey, tsIso }, home });',
      'appendSessionEvent({ event: { kind: "closed", sessionKey, tsIso }, home });',
      "appendSessionEvent({ event, home });",
      "appendSessionEvent({ event: { kind: `spawned` }, home });",
    ].join("\n");
    expect(hitsIn({ content })).toEqual(["1:spawned-append"]);
  });

  it("still parses a file whose callee is spelled with a unicode escape its raw text does not name", () => {
    const content = [
      "spawnCmuxSess\\u0069on({ deps, plan });",
      'appendSess\\u{69}onEvent({ event: { kind: "spawned" }, home });',
    ].join("\n");
    expect(content.includes("spawnCmuxSession")).toBe(false);
    expect(hitsIn({ content })).toEqual(["1:spawn-direct", "2:spawned-append"]);
  });

  it("flags every cmux client constructor called outside the seam", () => {
    const content = [
      "const client = realCmuxClient();",
      "await withCmuxClient({ body: async (c) => c.listWorkspaces() });",
      "const over = cmux.cmuxClientOver({ socket });",
    ].join("\n");
    expect(hitsIn({ content })).toEqual(["1:client-construct", "2:client-construct", "3:client-construct"]);
  });

  it("lets the defining file name its own constructors, and nothing else there", () => {
    const content = ["const client = realCmuxClient();", "await spawnCmuxSession({ deps, plan });"].join("\n");
    expect(hitsIn({ content, path: "src/cmux/client.ts" })).toEqual(["2:spawn-direct"]);
    expect(hitsIn({ content, path: "src/cmux/spawnDeps.ts" })).toEqual(["1:client-construct", "2:spawn-direct"]);
  });

  it("leaves the seam's own tree alone, a connection it opens included", () => {
    expect(hitsIn({ content: "const client = realCmuxClient();", path: "src/sessionHarness/cmuxHost.ts" })).toEqual([]);
  });

  it("leaves the seam's own tree alone", () => {
    const content = 'await spawnCmuxSession({ deps, plan }); appendSessionEvent({ event: { kind: "spawned" } });';
    expect(hitsIn({ content, path: "src/sessionHarness/cmuxLaunch.ts" })).toEqual([]);
  });

  it("does not read a declaration, an import or a type query as a launch", () => {
    const content = [
      "export async function spawnCmuxSession(): Promise<void> {}",
      "import { spawnCmuxSession } from './spawn.js';",
      "type Opener = typeof spawnCmuxSession;",
    ].join("\n");
    expect(hitsIn({ content })).toEqual([]);
  });

  it("flags the launch handed on as a value: an initializer, a property, a shorthand and an argument", () => {
    const content = [
      "const launch = spawnCmuxSession;",
      "const edges = { openSession: spawnCmuxSession };",
      "const short = { spawnCmuxSession };",
      "await withOpener(spawnCmuxSession);",
    ].join("\n");
    expect(hitsIn({ content })).toEqual(["1:spawn-direct", "2:spawn-direct", "3:spawn-direct", "4:spawn-direct"]);
  });
});

describe("partitionAgainstDebt", () => {
  const debt = [{ count: 1, movedBy: "a-row", path: "src/a.ts", shape: "spawn-direct" as const }];

  it("passes a recorded hit and refuses a second one beside it", () => {
    const one = { line: 3, path: "src/a.ts", shape: "spawn-direct" as const };
    const two = { line: 9, path: "src/a.ts", shape: "spawn-direct" as const };
    expect(partitionAgainstDebt({ debt, hits: [one] })).toEqual({ fresh: [], stale: [] });
    expect(partitionAgainstDebt({ debt, hits: [one, two] }).fresh).toEqual([one, two]);
  });

  it("refuses an unrecorded hit, and a recorded entry that stopped firing", () => {
    const elsewhere = { line: 1, path: "src/b.ts", shape: "spawned-append" as const };
    expect(partitionAgainstDebt({ debt, hits: [elsewhere] })).toEqual({
      fresh: [elsewhere],
      stale: ["src/a.ts (spawn-direct): records 1, fires 0"],
    });
  });
});

describe("isScannablePath", () => {
  it("scans product source and skips tests and the gate's own files", () => {
    expect(
      [
        "src/cli/commands/cmux/run.ts",
        "src/__tests__/unit/sessionHarness/cmuxLaunch.test.ts",
        "src/devLint/sessionHarnessLifecycle.ts",
      ].map((path) => isScannablePath({ path })),
    ).toEqual([true, false, false]);
  });
});
