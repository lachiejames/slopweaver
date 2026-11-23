/**
 * `commentBareRefRefused` — what `linear comment` threads into the bare-reference gate: each residue issue as
 * `<path>: <message>`, the dry-run flag that turns a refusal into a report, and the caller's own output sink.
 * The gate itself is proven in `../../bareRefDoor.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commentBareRefRefused } from "../../../../../cli/commands/linear/commentGates.js";

const ISSUE = { message: "SUP-1 could not be resolved", path: ["summary", 0] } as const;

describe("commentBareRefRefused", () => {
  let home: string;
  let lines: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slopweaver-comment-gates-"));
    lines = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const deps: Parameters<typeof commentBareRefRefused>[0]["deps"] = {
    env: (): string | undefined => undefined,
    out: (line) => {
      lines.push(line);
    },
  };

  it("passes a comment with no residue and prints nothing", () => {
    expect(commentBareRefRefused({ deps, dryRun: false, home, issues: [] })).toBe(false);
    expect(lines).toEqual([]);
  });

  it("refuses a live write on a residue, printing the issue under its path", () => {
    expect(commentBareRefRefused({ deps, dryRun: false, home, issues: [ISSUE] })).toBe(true);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("refused: summary.0: SUP-1 could not be resolved");
  });

  it("reports the same residue on a dry run, ending in a blank line", () => {
    expect(commentBareRefRefused({ deps, dryRun: true, home, issues: [ISSUE] })).toBe(true);
    expect(lines[0]).toContain("bare-reference gate: REFUSES this body:\n  - summary.0: SUP-1 could not be resolved");
    expect(lines[1]).toBe("");
  });
});
