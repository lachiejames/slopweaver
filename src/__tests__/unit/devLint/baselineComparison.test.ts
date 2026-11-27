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
import { lintDeclarationFor } from "../../../devLint/refusal/registry.js";
import { lintGateRefusal } from "../../../devLint/refusal/render.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SIZE = ".baselines/file-size-baseline.json";
/** A bump manifest main already holds. */
const LEGACY = `.baselines/bumps/${"0".repeat(64)}.json`;
/** A manifest a change commits beside it, which the gate refuses: records come only from the state home. */
const ADDED = `.baselines/bumps/${"1".repeat(64)}.json`;
/** Where a change moves main's record to, inside the same directory. */
const RENAMED = `.baselines/bumps/${"2".repeat(64)}.json`;
/**
 * A name holding U+FFFD, which is how git output decoded as UTF-8 reads a path whose bytes are not UTF-8 — the one
 * shape this filesystem can write, since it refuses a non-UTF-8 name outright.
 */
const UNDECODABLE = `.baselines/bumps/${String.fromCodePoint(0xfffd)}.json`;
/** Each bump-directory write's refusal, built by the factory the comparison calls. */
const addedAt = ({ path }: { path: string }) =>
  BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { kind: "added" } });
const rewrittenAt = ({ path }: { path: string }) =>
  BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { kind: "rewritten" } });

describe("comparing two real commits", () => {
  let root = "";
  let base = "";
  let head = "";
  let kept = "";
  let added = "";
  let rewritten = "";
  let renamed = "";
  let undecodable = "";
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
    put({ path: ADDED, text: "a manifest a branch carries as its own declaration" });
    git("add", ".");
    git("commit", "-m", "a manifest committed beside main's");
    added = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", kept);
    put({ path: LEGACY, text: "a record from before the move, edited" });
    git("add", ".");
    git("commit", "-m", "main's record rewritten");
    rewritten = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", kept);
    git("mv", LEGACY, RENAMED);
    git("commit", "-m", "main's record moved inside the directory");
    renamed = git("rev-parse", "HEAD");
    git("checkout", "-q", "--detach", kept);
    put({ path: UNDECODABLE, text: "a name git output reads with U+FFFD" });
    git("add", ".");
    git("commit", "-m", "a bump-directory name that reads as U+FFFD");
    undecodable = git("rev-parse", "HEAD");
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
    "refuses a manifest the change adds, since no landing verb reads one, and one of main's it rewrites",
    () => {
      const refusal = unwrapErr(compareAgainstBase({ base, head: added, root }));
      expect(refusal.code).toBe("REWRITTEN_BUMP_MANIFEST");
      expect(refusal).toEqual(addedAt({ path: ADDED }));
      expect(unwrapErr(compareAgainstBase({ base, head: rewritten, root }))).toEqual(rewrittenAt({ path: LEGACY }));
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses one of main's records moved inside the directory as a rename at its new name",
    () => {
      expect(unwrapErr(compareAgainstBase({ base, head: renamed, root }))).toEqual(
        BaselineComparisonErrors.bumpDirectoryWrite({ path: RENAMED, write: { from: LEGACY, kind: "renamed" } }),
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses one of main's records turned into an empty tree, which a recursive listing drops like a deletion",
    () => {
      expect(git("ls-tree", "-r", "--name-only", emptyTreeHead, "--", ".baselines/bumps/")).toBe("");
      expect(unwrapErr(compareAgainstBase({ base, head: emptyTreeHead, root }))).toEqual(rewrittenAt({ path: LEGACY }));
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses one of main's records turned into a directory as that record rewritten, never as an added file",
    () => {
      expect(unwrapErr(compareAgainstBase({ base, head: directoryHead, root }))).toEqual(rewrittenAt({ path: LEGACY }));
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
    "refuses a path that reads as U+FFFD, since two names that do not decode could compare as one",
    () => {
      const refusal = unwrapErr(compareAgainstBase({ base, head: undecodable, root }));
      expect(refusal).toEqual(BaselineComparisonErrors.undecodablePath({ path: UNDECODABLE, rev: undecodable }));
      expect(refusal.message).toBe(
        `${undecodable}:${UNDECODABLE} names a file under .baselines/ whose path does not decode as UTF-8 (read as ` +
          "U+FFFD), so two different names could compare as one — rename it to a UTF-8 path",
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

  it("refuses a manifest the change adds under the gate's one code, and one of main's it rewrites", () => {
    const main = blobs([SIZE, "s1"], [LEGACY, "r1"]);
    const refusal = committedBaselineRefusal({ base: main, head: blobs([SIZE, "s1"], [LEGACY, "r1"], [ADDED, "r2"]) });
    expect(refusal!.code).toBe("REWRITTEN_BUMP_MANIFEST");
    expect(refusal).toEqual(addedAt({ path: ADDED }));
    expect(committedBaselineRefusal({ base: main, head: blobs([SIZE, "s1"], [LEGACY, "r9"]) })).toEqual(
      rewrittenAt({ path: LEGACY }),
    );
  });

  it("refuses an addition even when main holds no manifest at all, and names a rewrite first when both happen", () => {
    expect(committedBaselineRefusal({ base: blobs([SIZE, "s1"]), head: blobs([SIZE, "s1"], [ADDED, "r2"]) })).toEqual(
      addedAt({ path: ADDED }),
    );
    expect(
      committedBaselineRefusal({ base: blobs([LEGACY, "r1"]), head: blobs([ADDED, "r2"], [LEGACY, "r9"]) }),
    ).toEqual(rewrittenAt({ path: LEGACY }));
  });

  it("names a rename only when main's blob left its old name, and an addition when main still holds it there", () => {
    expect(committedBaselineRefusal({ base: blobs([LEGACY, "r1"]), head: blobs([RENAMED, "r1"]) })).toEqual(
      BaselineComparisonErrors.bumpDirectoryWrite({ path: RENAMED, write: { from: LEGACY, kind: "renamed" } }),
    );
    expect(
      committedBaselineRefusal({ base: blobs([LEGACY, "r1"]), head: blobs([LEGACY, "r1"], [RENAMED, "r1"]) }),
    ).toEqual(addedAt({ path: RENAMED }));
  });

  it("names main's record rewritten when a file sits under its path, the record having become a directory", () => {
    expect(
      committedBaselineRefusal({ base: blobs([LEGACY, "r1"]), head: blobs([`${LEGACY}/inner.json`, "r2"]) }),
    ).toEqual(rewrittenAt({ path: LEGACY }));
  });

  it("names main's record renamed, never rewritten, when it moves byte-identical to a path under its old name", () => {
    expect(
      committedBaselineRefusal({ base: blobs([LEGACY, "r1"]), head: blobs([`${LEGACY}/moved.json`, "r1"]) }),
    ).toEqual(
      BaselineComparisonErrors.bumpDirectoryWrite({
        path: `${LEGACY}/moved.json`,
        write: { from: LEGACY, kind: "renamed" },
      }),
    );
  });

  it("names two of main's records swapped as a rename, and a copy over one as a rewrite", () => {
    const base = blobs([LEGACY, "r1"], [ADDED, "r2"]);

    expect(committedBaselineRefusal({ base, head: blobs([LEGACY, "r2"], [ADDED, "r1"]) })).toEqual(
      BaselineComparisonErrors.bumpDirectoryWrite({ path: LEGACY, write: { from: ADDED, kind: "renamed" } }),
    );
    expect(committedBaselineRefusal({ base, head: blobs([LEGACY, "r2"], [ADDED, "r2"]) })).toEqual(
      BaselineComparisonErrors.bumpDirectoryWrite({ path: LEGACY, write: { kind: "rewritten" } }),
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
    expect(rewrittenAt({ path: LEGACY }).message).toBe(
      `${LEGACY}: a bump manifest main holds is never rewritten, since its witness judged these bytes — ` +
        "restore it to main's bytes or delete it, and declare the rows again with `slopweaver dev baseline-bump`",
    );
  });

  it("says an added file was added, never rewritten, and where the declaration belongs instead", () => {
    expect(addedAt({ path: ADDED }).message).toBe(
      `${ADDED}: added under .baselines/bumps/, where a file declares nothing, since no landing verb reads a bump ` +
        "record from the tree — delete it, and declare the rows with `slopweaver dev baseline-bump`, which records " +
        "them in the state home",
    );
  });

  it("says a renamed file was renamed, from where, and where the declaration belongs instead", () => {
    expect(
      BaselineComparisonErrors.bumpDirectoryWrite({ path: RENAMED, write: { from: LEGACY, kind: "renamed" } }).message,
    ).toBe(
      `${RENAMED}: renamed from ${LEGACY} under .baselines/bumps/, where a file at a new name declares nothing, ` +
        "since no landing verb reads a bump record from the tree — move it back or delete it, and declare the rows " +
        "with `slopweaver dev baseline-bump`, which records them in the state home",
    );
  });
});

describe("the gate's bump-directory refusal", () => {
  it("renders an added manifest as the gate's four-line refusal, naming the file and where a rise is declared", () => {
    const error = addedAt({ path: ADDED });
    const detail = error.message;
    const lines = lintGateRefusal({ declaration: lintDeclarationFor({ id: "baseline-against-main" }), detail }).split(
      "\n",
    );

    // `baselineAgainstMain.ts` renders this code, and only this one, as the four-line refusal.
    expect(error.code).toBe("REWRITTEN_BUMP_MANIFEST");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      "Passing dev lint is blocked because the `baseline-against-main` gate a file is added or renamed under " +
        ".baselines/bumps/, where no landing verb reads a declaration, or a bump manifest main holds there is " +
        `rewritten, so the bytes its Codex witness judged are no longer the bytes in the tree (${detail}).`,
    );
    expect(lines[1]).toBe(
      "Legitimate exceptions may include one of main's manifests left byte-identical or deleted by the change, " +
        "which the comparison passes over as history; a loosening of a ratchet baseline with no file under " +
        ".baselines/bumps/ touched, which this gate reports as a landing obligation rather than refuses.",
    );
    expect(lines[2]).toContain(
      "delete an added file, move a renamed one back or delete it, and restore a rewritten one to main's bytes or delete it",
    );
  });

  it("gives every bump-directory write the gate's code, and leaves every other failure its own", () => {
    expect(rewrittenAt({ path: LEGACY }).code).toBe("REWRITTEN_BUMP_MANIFEST");
    expect(
      BaselineComparisonErrors.bumpDirectoryWrite({ path: RENAMED, write: { from: LEGACY, kind: "renamed" } }).code,
    ).toBe("REWRITTEN_BUMP_MANIFEST");
    expect(BaselineComparisonErrors.unreadable({ path: SIZE }).code).toBe("UNREADABLE");
    expect(BaselineComparisonErrors.unregistered({ path: ".baselines/x.json" }).code).toBe("UNREGISTERED_BASELINE");
    expect(BaselineComparisonErrors.commitUnreachable({ rev: "abc" }).code).toBe("COMMIT_UNREACHABLE");
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
