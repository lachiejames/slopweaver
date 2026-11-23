/**
 * The spawn-side base-freshness rules: which paths a doc names, what counts as an overlap, and when the
 * advisory becomes a refusal.
 */
import { describe, expect, it } from "vitest";

import {
  assessSpawnBase,
  docReferencedPaths,
  pathsOverlap,
  REQUIRE_CURRENT_BASE_FLAG,
  spawnBaseLines,
  spawnBaseRefusal,
} from "../../../cmux/baseFreshness.js";
import type { Probe } from "../../../handover/probe.js";

const PATH_PROBE: Probe = { kind: "path", path: "docs/main-checkouts.md" };
const PRESENT_PROBE: Probe = { file: "src/checkouts/freshness.ts", kind: "present", symbol: "installFreshness" };
const COMMAND_PROBE: Probe = { command: "yarn test:unit cmux/baseFreshness", kind: "command" };

describe("docReferencedPaths", () => {
  it("takes the path a `path:` probe names", () => {
    expect(docReferencedPaths({ docText: "", probes: [PATH_PROBE] })).toEqual(["docs/main-checkouts.md"]);
  });

  it("takes the file a `present:` probe names, not its symbol", () => {
    expect(docReferencedPaths({ docText: "", probes: [PRESENT_PROBE] })).toEqual(["src/checkouts/freshness.ts"]);
  });

  it("takes nothing from a `command:` probe", () => {
    expect(docReferencedPaths({ docText: "", probes: [COMMAND_PROBE] })).toEqual([]);
  });

  it("takes backtick-quoted repo-relative paths out of the prose", () => {
    const docText = "Read `src/cmux/spawn.ts` and `src/cmux/worktree.ts` before touching this.";
    expect(docReferencedPaths({ docText, probes: [] })).toEqual(["src/cmux/spawn.ts", "src/cmux/worktree.ts"]);
  });

  it("ignores a backticked token with no slash, an absolute path, a home path, a flag and a URL", () => {
    const docText = "`slopweaver` `/etc/hosts` `~/.slopweaver/profile.json` `--json` `https://example.com/x`";
    expect(docReferencedPaths({ docText, probes: [] })).toEqual([]);
  });

  it("ignores a backticked shell line, which contains whitespace", () => {
    expect(docReferencedPaths({ docText: "`yarn test:unit src/foo.ts`", probes: [] })).toEqual([]);
  });

  it("deduplicates a path named by both a probe and the prose, keeping first-seen order", () => {
    const docText = "see `docs/main-checkouts.md` and `src/checkouts/sync.ts`";
    expect(docReferencedPaths({ docText, probes: [PATH_PROBE] })).toEqual([
      "docs/main-checkouts.md",
      "src/checkouts/sync.ts",
    ]);
  });

  it("takes nothing from an empty doc with no probes", () => {
    expect(docReferencedPaths({ docText: "", probes: [] })).toEqual([]);
  });
});

describe("pathsOverlap", () => {
  it("matches an exact path", () => {
    expect(pathsOverlap({ changed: "src/a.ts", docPath: "src/a.ts" })).toBe(true);
  });

  it("matches a changed file under a directory the doc names", () => {
    expect(pathsOverlap({ changed: "src/cmux/spawn.ts", docPath: "src/cmux" })).toBe(true);
  });

  it("matches a doc file under a directory the change names", () => {
    expect(pathsOverlap({ changed: "src/cmux", docPath: "src/cmux/spawn.ts" })).toBe(true);
  });

  it("tolerates a trailing slash on the doc's path", () => {
    expect(pathsOverlap({ changed: "src/cmux/spawn.ts", docPath: "src/cmux/" })).toBe(true);
  });

  it("does not match a sibling whose name merely starts the same", () => {
    expect(pathsOverlap({ changed: "src/cmuxOther/spawn.ts", docPath: "src/cmux" })).toBe(false);
  });

  it("does not match two unrelated paths", () => {
    expect(pathsOverlap({ changed: "docs/a.md", docPath: "src/a.ts" })).toBe(false);
  });
});

describe("assessSpawnBase", () => {
  it("reports no overlap when the upstream changed nothing the doc names", () => {
    const assessment = assessSpawnBase({
      behind: 3,
      changedPaths: ["README.md"],
      docPaths: ["src/checkouts/freshness.ts"],
    });
    expect(assessment.behind).toBe(3);
    expect(assessment.overlapping).toEqual([]);
    expect(assessment.docPathCount).toBe(1);
  });

  it("reports the overlapping paths when the upstream touched what the doc names", () => {
    const assessment = assessSpawnBase({
      behind: 2,
      changedPaths: ["src/cmux/spawn.ts", "README.md", "src/cmux/plan.ts"],
      docPaths: ["src/cmux"],
    });
    expect(assessment.overlapping).toEqual(["src/cmux/spawn.ts", "src/cmux/plan.ts"]);
  });

  it("deduplicates a path that overlaps two different doc paths", () => {
    const assessment = assessSpawnBase({
      behind: 1,
      changedPaths: ["src/cmux/spawn.ts"],
      docPaths: ["src/cmux", "src/cmux/spawn.ts"],
    });
    expect(assessment.overlapping).toEqual(["src/cmux/spawn.ts"]);
  });

  it("reports an empty overlap when the doc names no paths at all", () => {
    const assessment = assessSpawnBase({ behind: 5, changedPaths: ["src/a.ts"], docPaths: [] });
    expect(assessment.overlapping).toEqual([]);
    expect(assessment.docPathCount).toBe(0);
  });

  it("carries a zero behind count through unchanged", () => {
    expect(assessSpawnBase({ behind: 0, changedPaths: [], docPaths: ["src/a.ts"] }).behind).toBe(0);
  });
});

describe("spawnBaseLines", () => {
  it("says the base is current in one line when nothing is behind", () => {
    const assessment = assessSpawnBase({ behind: 0, changedPaths: [], docPaths: ["src/a.ts"] });
    expect(spawnBaseLines({ assessment, branch: "main", requireCurrentBase: false, upstream: "origin/main" })).toEqual([
      "base: main is current with origin/main",
    ]);
  });

  it("calls harmless drift harmless, naming how many doc paths it checked", () => {
    const assessment = assessSpawnBase({ behind: 4, changedPaths: ["README.md"], docPaths: ["src/a.ts"] });
    const lines = spawnBaseLines({ assessment, branch: "main", requireCurrentBase: false, upstream: "origin/main" });
    expect(lines[0]).toBe("base: main is 4 commit(s) behind origin/main");
    expect(lines[1]).toBe(
      "  none of the 1 path(s) this doc names changed upstream — drift looks harmless, forking anyway",
    );
  });

  it("lists every overlapping path and names the flag that would refuse", () => {
    const assessment = assessSpawnBase({
      behind: 2,
      changedPaths: ["src/a.ts", "src/b.ts"],
      docPaths: ["src/a.ts", "src/b.ts"],
    });
    const lines = spawnBaseLines({ assessment, branch: "main", requireCurrentBase: false, upstream: "origin/main" });
    expect(lines[1]).toBe("  and it changed 2 path(s) this doc names:");
    expect(lines[2]).toBe("    src/a.ts");
    expect(lines[3]).toBe("    src/b.ts");
    expect(lines[4]).toContain(REQUIRE_CURRENT_BASE_FLAG);
  });

  it("does not offer a flag the caller already passed", () => {
    const assessment = assessSpawnBase({ behind: 2, changedPaths: ["src/a.ts"], docPaths: ["src/a.ts"] });
    const lines = spawnBaseLines({ assessment, branch: "main", requireCurrentBase: true, upstream: "origin/main" });
    expect(lines[3]).toBe('  this is the "your change depends on the latest base" case — pull the main checkout first');
  });
});

describe("spawnBaseRefusal", () => {
  it("never refuses without the flag, however far behind", () => {
    const assessment = assessSpawnBase({ behind: 99, changedPaths: ["src/a.ts"], docPaths: ["src/a.ts"] });
    expect(spawnBaseRefusal({ assessment, requireCurrentBase: false })).toBeUndefined();
  });

  it("never refuses a current base even with the flag", () => {
    const assessment = assessSpawnBase({ behind: 0, changedPaths: [], docPaths: ["src/a.ts"] });
    expect(spawnBaseRefusal({ assessment, requireCurrentBase: true })).toBeUndefined();
  });

  it("refuses on drift with no overlap, because the caller asked for a current base", () => {
    const assessment = assessSpawnBase({ behind: 1, changedPaths: ["README.md"], docPaths: ["src/a.ts"] });
    expect(spawnBaseRefusal({ assessment, requireCurrentBase: true })).toBe(
      `${REQUIRE_CURRENT_BASE_FLAG} was passed and the base is 1 commit(s) behind — pull the main checkout, then retry`,
    );
  });

  it("names the overlapping count in the refusal when there is one", () => {
    const assessment = assessSpawnBase({ behind: 2, changedPaths: ["src/a.ts"], docPaths: ["src/a.ts"] });
    expect(spawnBaseRefusal({ assessment, requireCurrentBase: true })).toBe(
      `${REQUIRE_CURRENT_BASE_FLAG} was passed and the base is 2 commit(s) behind (including 1 path(s) this doc names) — pull the main checkout, then retry`,
    );
  });
});
