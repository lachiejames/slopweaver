import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPolicyDiff } from "../../../../../cli/commands/policy/diffRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const dirs: string[] = [];

/** A throwaway directory, removed after each test; as a state home it holds no atlas. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "policy-diff-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The argv shape the CLI dispatches with: the noun at index 2, the verb at index 3. */
function argv(...rest: readonly string[]): readonly string[] {
  return ["node", "slopweaver", "policy", "diff", ...rest];
}

/** A record naming one document whose two sides are files beside it. */
function recordText(): string {
  return JSON.stringify({
    documents: [
      {
        after: { label: "Proposed", source: { path: "after.md" } },
        before: { label: "In Vanta", source: { path: "before.md" } },
        changes: [],
        controls: [],
        id: "network",
        marks: [],
        name: "Network",
        vantaEvidence: "network-diagram",
      },
    ],
    formatting: {},
    keyChanges: ["one", "two", "three"],
    lede: "lede",
    links: [],
    schemaVersion: 1,
    team: { ask: "ask", opener: "opener", title: "title" },
    title: "title",
    uploaded: false,
  });
}

describe("runPolicyDiff", () => {
  it("prints its usage for --help and exits 0", () => {
    expect(runPolicyDiff(argv("--help"))).toBe(EXIT_OK);
  });

  it("refuses a run naming no record or no out directory as a usage error", () => {
    const home = scratch();
    expect(runPolicyDiff(argv("--out", join(home, "out"), "--home", home))).toBe(EXIT_USAGE);
    expect(runPolicyDiff(argv("--record", join(home, "r.json"), "--home", home))).toBe(EXIT_USAGE);
  });

  it("exits 1 when the record cannot be read or is not a record", () => {
    const home = scratch();
    const out = join(home, "out");
    expect(runPolicyDiff(argv("--record", join(home, "missing.json"), "--out", out, "--home", home))).toBe(EXIT_ERROR);
    writeFileSync(join(home, "bad.json"), "{}");
    expect(runPolicyDiff(argv("--record", join(home, "bad.json"), "--out", out, "--home", home))).toBe(EXIT_ERROR);
  });

  it("exits 1 when a side is unreadable, and when the atlas is absent with both sides read", () => {
    const home = scratch();
    const out = join(home, "out");
    const record = join(home, "record.json");
    writeFileSync(record, recordText());
    expect(runPolicyDiff(argv("--record", record, "--out", out, "--home", home))).toBe(EXIT_ERROR);
    writeFileSync(join(home, "before.md"), "# Network\n");
    writeFileSync(join(home, "after.md"), "# Network\n");
    expect(runPolicyDiff(argv("--record", record, "--out", out, "--home", home))).toBe(EXIT_ERROR);
  });
});
