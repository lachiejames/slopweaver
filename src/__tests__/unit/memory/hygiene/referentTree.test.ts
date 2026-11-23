/**
 * CHECK 4's RESOLVER — the effectful half, against a real repository in a throwaway directory.
 *
 * The pure half (`referents.ts`) is tested beside this one over an injected resolver. What only a real tree can
 * prove is the three answers this module derives from `git` and the verb table, and one property that is a
 * safety direction rather than a behaviour: **a resolver that cannot look must not report an absence**. A `git`
 * that is not there, or a root that is not a repository, answers `resolves` for a flag — a false clean costs a
 * missed proposal, and a false finding costs the owner's attention, which is the more expensive of the two.
 *
 * Every git invocation goes through `gitInTemp`, the one sanctioned door (`src/__tests__/tempGitRepo.ts`): it
 * strips `GIT_*` from the environment and asserts the target is under the OS temp directory, so a mistyped path
 * throws rather than reaching the real checkout.
 *
 * Everything in the fixtures is invented. This is a public repository, and a fixture is the easiest place for a
 * private string to arrive unnoticed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Referent, ReferentVerdict } from "../../../../memory/hygiene/referents.js";
import { treeReferentResolver } from "../../../../memory/hygiene/referentTree.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

describe("treeReferentResolver", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  let repo = "";

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "hyg-tree-"));
    mkdirSync(join(repo, "src", "pelican"), { recursive: true });
    writeFileSync(join(repo, "src", "pelican", "batching.ts"), "export const FLAG = '--pelican-window';\n", "utf8");
    writeFileSync(join(repo, "README.md"), "# invented fixture\n", "utf8");
    gitInTemp({ args: ["init", "--initial-branch", "main"], cwd: repo });
    gitInTemp({ args: ["config", "user.email", "fixture@example.invalid"], cwd: repo });
    gitInTemp({ args: ["config", "user.name", "Fixture"], cwd: repo });
    gitInTemp({ args: ["add", "-A"], cwd: repo });
    gitInTemp({ args: ["commit", "-m", "fixture"], cwd: repo });
  });

  afterAll(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  /** One referent's verdict against the fixture repository, or against every root in `roots`. */
  function verdictOf({
    kind,
    text,
    root = repo,
    roots = [root],
  }: {
    kind: Referent["kind"];
    text: string;
    root?: string;
    roots?: readonly string[];
  }): string {
    const referent: Referent = { kind, line: 1, text };
    return treeReferentResolver({ repos: roots })({ referent });
  }

  it("resolves a skill by its SKILL.md, and calls a skill directory without one gone — never moved", () => {
    mkdirSync(join(repo, "skills", "pelican-sweep"), { recursive: true });
    writeFileSync(join(repo, "skills", "pelican-sweep", "SKILL.md"), "# invented\n", "utf8");
    mkdirSync(join(repo, "skills", "hollow", "reference"), { recursive: true });
    expect(verdictOf({ kind: "skill", text: "skills/pelican-sweep" })).toBe("resolves");
    expect(verdictOf({ kind: "skill", text: "skills/hollow" })).toBe("gone");
    expect(verdictOf({ kind: "skill", text: "skills/quokka-audit" })).toBe("gone");
  });

  it("resolves a referent ANY root holds, and calls it gone only when none does", () => {
    const sibling = mkdtempSync(join(tmpdir(), "hyg-sibling-"));
    mkdirSync(join(sibling, "apps"), { recursive: true });
    writeFileSync(join(sibling, "apps", "held.ts"), "export {};\n", "utf8");
    expect(verdictOf({ kind: "path", text: "apps/held.ts" })).toBe("gone");
    expect(verdictOf({ kind: "path", roots: [repo, sibling], text: "apps/held.ts" })).toBe("resolves");
    expect(verdictOf({ kind: "path", roots: [repo, sibling], text: "src/pelican/batching.ts" })).toBe("resolves");
    expect(verdictOf({ kind: "path", roots: [repo, sibling], text: "apps/absent.ts" })).toBe("gone");
    rmSync(sibling, { force: true, recursive: true });
  });

  it("resolves a path that is there, and calls a path that is nowhere gone", () => {
    expect(verdictOf({ kind: "path", text: "src/pelican/batching.ts" })).toBe("resolves");
    expect(verdictOf({ kind: "path", text: "src/pelican/absent.ts" })).toBe("gone");
  });

  it("calls a path MOVED when a file of that basename stands somewhere else", () => {
    // The distinction the whole check exists for: `src/quokka/batching.ts` is not there, but `batching.ts` is,
    // so the memory's claim may well still hold and only its path is stale. Reporting that as `gone` would ask
    // the owner to delete a memory whose fact is fine.
    expect(verdictOf({ kind: "path", text: "src/quokka/batching.ts" })).toBe("moved");
  });

  it("resolves a flag the tracked tree carries, and calls one nothing carries gone", () => {
    expect(verdictOf({ kind: "flag", text: "--pelican-window" })).toBe("resolves");
    expect(verdictOf({ kind: "flag", text: "--quokka-window" })).toBe("gone");
  });

  it("searches for a flag LITERALLY, so a regex metacharacter is never read as a pattern", () => {
    // `-F` is what makes this true: as a regex, `--pelican-w.ndow` would match the flag that is really there.
    expect(verdictOf({ kind: "flag", text: "--pelican-w.ndow" })).toBe("gone");
  });

  it("resolves a verb that is on the surface, and calls one that is not gone", () => {
    expect(verdictOf({ kind: "verb", text: "memory hygiene" })).toBe("resolves");
    expect(verdictOf({ kind: "verb", text: "memory incinerate" })).toBe("gone");
    expect(verdictOf({ kind: "verb", text: "pelican hygiene" })).toBe("gone");
  });

  it("calls a verb with no verb word gone rather than resolving its noun", () => {
    expect(verdictOf({ kind: "verb", text: "memory" })).toBe("gone");
  });

  it("answers a verb from the TABLE, so a repository it cannot read changes nothing", () => {
    const outside = mkdtempSync(join(tmpdir(), "hyg-not-a-repo-"));
    expect(verdictOf({ kind: "verb", root: outside, text: "memory hygiene" })).toBe("resolves");
    rmSync(outside, { force: true, recursive: true });
  });

  it("resolves a flag it CANNOT look for, rather than reporting an absence it never observed", () => {
    // The safety direction, and the one case a naive implementation gets backwards: outside a repository
    // `git grep` fails, and treating that failure as "not found" would propose dropping every memory that
    // names a flag. A false clean costs one missed proposal; a false finding costs the owner's attention.
    const outside = mkdtempSync(join(tmpdir(), "hyg-not-a-repo-"));
    writeFileSync(join(outside, "notes.txt"), "nothing tracked here\n", "utf8");
    expect(verdictOf({ kind: "flag", root: outside, text: "--quokka-window" })).toBe("resolves");
    rmSync(outside, { force: true, recursive: true });
  });

  it("calls a path outside a repository GONE, because `existsSync` needs no git to answer", () => {
    const outside = mkdtempSync(join(tmpdir(), "hyg-not-a-repo-"));
    expect(verdictOf({ kind: "path", root: outside, text: "src/pelican/batching.ts" })).toBe("gone");
    rmSync(outside, { force: true, recursive: true });
  });

  it("answers every kind with a verdict the pure half knows how to read", () => {
    const known = new Set<string>(["resolves", "moved", "gone"] satisfies readonly ReferentVerdict[]);
    expect(known.size).toBeGreaterThan(0);
    const answers = [
      verdictOf({ kind: "path", text: "README.md" }),
      verdictOf({ kind: "flag", text: "--pelican-window" }),
      verdictOf({ kind: "verb", text: "memory sweep" }),
    ];
    expect(answers.filter((answer) => !known.has(answer))).toEqual([]);
    expect(answers).toEqual(["resolves", "resolves", "resolves"]);
  });
});
