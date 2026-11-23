import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanLine } from "../../../devLint/baselineAgainstMain.js";
import {
  BaselineComparisonErrors,
  committedBaselineRefusal,
  compareAgainstBase,
} from "../../../devLint/baselineComparison.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SIZE = ".baselines/file-size-baseline.json";
/** A bump manifest main already holds. */
const LEGACY = `.baselines/bumps/${"0".repeat(64)}.json`;
/** A manifest the change commits beside it. */
const ADDED = `.baselines/bumps/${"1".repeat(64)}.json`;

describe("comparing two real commits", () => {
  let root = "";
  let base = "";
  let head = "";
  let kept = "";
  let added = "";
  let rewritten = "";
  let strayHead = "";
  let yamlHead = "";
  let emptyTreeHead = "";
  let directoryHead = "";
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  const mktree = ({ lines }: { lines: readonly string[] }): string =>
    gitInTemp({ args: ["mktree"], cwd: root, input: lines.map((line) => `${line}\n`).join("") });
  /** One tree's entries with the one named `name` swapped for a subtree, as `git mktree` reads them. */
  const swapEntry = ({ treeish, name, tree }: { treeish: string; name: string; tree: string }): string[] =>
    git("ls-tree", treeish)
      .split("\n")
      .map((line) => (line.endsWith(`\t${name}`) ? `040000 tree ${tree}\t${name}` : line));
  const put = ({ path, text }: { path: string; text: string }): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const loosenSize = (): void => {
    put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [{ codeLines: 319, path: "tools/gen.ts" }] }) });
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "baseline-cmp-"));
    git("init", "--initial-branch=main", ".");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [] }) });
    put({ path: LEGACY, text: "a record from before the move" });
    put({ path: "tools/gen.ts", text: "export {};\n" });
    put({ path: "src/devLint/baselineRegistry.ts", text: "export const RULES = 1;\n" });
    git("add", ".");
    git("commit", "-m", "base");
    base = git("rev-parse", "HEAD");
    loosenSize();
    git("add", ".");
    git("commit", "-m", "loosen, keeping the committed record");
    kept = git("rev-parse", "HEAD");
    put({ path: ADDED, text: "a manifest for a landing CLI that predates the home" });
    git("add", ".");
    git("commit", "-m", "a manifest committed beside main's");
    added = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", kept);
    put({ path: LEGACY, text: "a record from before the move, edited" });
    git("add", ".");
    git("commit", "-m", "main's record rewritten");
    rewritten = git("rev-parse", "HEAD");
    // An index cannot hold an empty tree, so this head is built from trees: main's record path names one.
    const emptyTree = mktree({ lines: [] });
    const bumps = mktree({ lines: [`040000 tree ${emptyTree}\t${LEGACY.split("/").at(-1)!}`] });
    const baselines = mktree({ lines: swapEntry({ name: "bumps", tree: bumps, treeish: `${base}:.baselines` }) });
    const rootTree = mktree({ lines: swapEntry({ name: ".baselines", tree: baselines, treeish: base }) });
    emptyTreeHead = git("commit-tree", rootTree, "-p", base, "-m", "main's record turned into an empty tree");
    git("checkout", "-q", "--detach", base);
    git("rm", "-q", LEGACY);
    put({ path: `${LEGACY}/inner.json`, text: "a file where main's record was" });
    git("add", ".");
    git("commit", "-m", "main's record turned into a directory");
    directoryHead = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", base);
    git("rm", "-q", LEGACY);
    loosenSize();
    put({ path: "src/other.ts", text: "export {};\n" });
    put({ path: "src/devLint/baselineRegistry.ts", text: "export const RULES = 0;\n" });
    put({ path: "src/codex/baselineBumpWitness.ts", text: "export {};\n" });
    git("add", ".");
    git("commit", "-m", "head");
    head = git("rev-parse", "HEAD");
    put({ path: ".baselines/mystery-baseline.json", text: "{}" });
    git("add", ".");
    git("commit", "-m", "stray");
    strayHead = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", head);
    put({ path: ".baselines/file-size-baseline.yaml", text: JSON.stringify({ exempt: [], offenders: [] }) });
    git("add", ".");
    git("commit", "-m", "a baseline under another extension");
    yamlHead = git("rev-parse", "HEAD");
    put({ path: SIZE, text: "uncommitted text is never read" });
  }, REAL_GIT_TIMEOUT_MS);

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it(
    "reads the loosenings and the touched paths from the commits, passing over a record main committed that the change deletes",
    () => {
      const compared = unwrap(compareAgainstBase({ base, head, root }));
      expect(compared.loosened).toEqual([
        { entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 },
        { entry: "policy", file: "src/devLint/baselineRegistry.ts", from: null, to: null },
      ]);
      expect([...compared.changedPaths].toSorted()).toEqual([
        LEGACY,
        SIZE,
        "src/codex/baselineBumpWitness.ts",
        "src/devLint/baselineRegistry.ts",
        "src/other.ts",
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "passes over a record main committed that the change leaves byte-identical",
    () => {
      expect(unwrap(compareAgainstBase({ base, head: kept, root })).loosened).toEqual([
        { entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 },
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "passes a manifest the change adds, which landing reads, and refuses one of main's it rewrites",
    () => {
      expect(unwrap(compareAgainstBase({ base, head: added, root })).changedPaths.has(ADDED)).toBe(true);
      expect(unwrapErr(compareAgainstBase({ base, head: rewritten, root }))).toEqual(
        BaselineComparisonErrors.rewrittenBumpManifest({ path: LEGACY }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses one of main's records turned into an empty tree, which a recursive listing drops like a deletion",
    () => {
      expect(git("ls-tree", "-r", "--name-only", emptyTreeHead, "--", ".baselines/bumps/")).toBe("");
      expect(unwrapErr(compareAgainstBase({ base, head: emptyTreeHead, root }))).toEqual(
        BaselineComparisonErrors.rewrittenBumpManifest({ path: LEGACY }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses one of main's records turned into a directory, whose files would otherwise read as added manifests",
    () => {
      expect(unwrapErr(compareAgainstBase({ base, head: directoryHead, root }))).toEqual(
        BaselineComparisonErrors.rewrittenBumpManifest({ path: LEGACY }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a committed baseline the registry does not name",
    () => {
      expect(unwrapErr(compareAgainstBase({ base, head: strayHead, root }))).toEqual(
        BaselineComparisonErrors.unregistered({ path: ".baselines/mystery-baseline.json" }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a baseline under another extension, so a gate repointed at it cannot read a file nothing judged",
    () => {
      expect(unwrapErr(compareAgainstBase({ base, head: yamlHead, root }))).toEqual(
        BaselineComparisonErrors.unregistered({ path: ".baselines/file-size-baseline.yaml" }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses a commit the checkout does not have",
    () => {
      expect(unwrapErr(compareAgainstBase({ base: "b".repeat(40), head, root }))).toEqual(
        BaselineComparisonErrors.commitUnreachable({ rev: "b".repeat(40) }),
      );
      expect(BaselineComparisonErrors.commitUnreachable({ rev: "abc" }).message).toBe(
        "commit abc is not in this checkout — fetch it (CI does, at depth 1)",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("committedBaselineRefusal", () => {
  const blobs = (...entries: readonly (readonly [string, string])[]): ReadonlyMap<string, string> => new Map(entries);

  it("passes over a record main holds that the change leaves byte-identical or deletes", () => {
    const main = blobs([SIZE, "s1"], [LEGACY, "r1"]);
    expect(committedBaselineRefusal({ base: main, head: blobs([SIZE, "s2"], [LEGACY, "r1"]) })).toBeUndefined();
    expect(committedBaselineRefusal({ base: main, head: blobs([SIZE, "s2"]) })).toBeUndefined();
  });

  it("passes a manifest the change adds, and refuses one of main's it rewrites", () => {
    const main = blobs([SIZE, "s1"], [LEGACY, "r1"]);
    expect(
      committedBaselineRefusal({ base: main, head: blobs([SIZE, "s1"], [LEGACY, "r1"], [ADDED, "r2"]) }),
    ).toBeUndefined();
    expect(committedBaselineRefusal({ base: main, head: blobs([SIZE, "s1"], [LEGACY, "r9"]) })).toEqual(
      BaselineComparisonErrors.rewrittenBumpManifest({ path: LEGACY }),
    );
  });

  it("refuses an unregistered file at either end, and passes registered ones", () => {
    const stray = ".baselines/mystery-baseline.json";
    expect(committedBaselineRefusal({ base: blobs([SIZE, "s"], [stray, "x"]), head: blobs([SIZE, "s"]) })).toEqual(
      BaselineComparisonErrors.unregistered({ path: stray }),
    );
    expect(committedBaselineRefusal({ base: blobs([SIZE, "s"]), head: blobs([SIZE, "s"], [stray, "x"]) })).toEqual(
      BaselineComparisonErrors.unregistered({ path: stray }),
    );
    expect(committedBaselineRefusal({ base: blobs([SIZE, "s"]), head: blobs([SIZE, "t"]) })).toBeUndefined();
  });

  it("says why a rewrite is refused and how to declare the rows again", () => {
    expect(BaselineComparisonErrors.rewrittenBumpManifest({ path: LEGACY }).message).toBe(
      `${LEGACY}: a bump manifest main holds is never rewritten, since its witness judged these bytes — ` +
        "restore it to main's bytes or delete it, and declare the rows again with `slopweaver dev baseline-bump`",
    );
  });
});

describe("cleanLine", () => {
  const BASE = "abcdef0123456789abcdef0123456789abcdef01";

  it("says nothing was loosened, against main's short commit", () => {
    expect(cleanLine({ base: BASE, count: 0 })).toBe(
      "baseline-against-main: clean (nothing loosened against abcdef012345)",
    );
  });

  it("names the landing obligation when something was", () => {
    expect(cleanLine({ base: BASE, count: 2 })).toBe(
      "baseline-against-main: clean (2 loosening(s) against abcdef012345; landing owes a store bump record and a " +
        "Codex witness for 2 loosening(s))",
    );
  });
});
