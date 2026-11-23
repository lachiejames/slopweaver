import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { parsePushRootArgs, rootCommitProblem } from "../../../../../cli/commands/github/pushRootCore.js";
import { type PushRootDeps, runGithubPushRoot } from "../../../../../cli/commands/github/pushRootRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const ROOT = "a".repeat(40);
const CHILD = "b".repeat(40);
const ARGV_HEAD = ["node", "slopweaver", "github", "push-root"];

describe("parsePushRootArgs", () => {
  it("parses a record invocation", () => {
    expect(
      unwrap(parsePushRootArgs({ rest: ["record", "--repo", "acme/widgets", "--root", ROOT, "--dry-run"] })),
    ).toEqual({
      cwd: undefined,
      dryRun: true,
      home: undefined,
      json: false,
      kind: "record",
      repository: "acme/widgets",
      rootSha: ROOT,
    });
  });

  it("names both missing required flags at once", () => {
    const { lines } = unwrapErr(parsePushRootArgs({ rest: ["record"] }));

    expect(lines.slice(0, 2)).toEqual([
      "--repo <owner/name> is required: the repository whose history was re-cut",
      "--root <sha> is required: the full sha of the fresh history's one root commit",
    ]);
  });

  it("refuses an abbreviated root", () => {
    expect(
      unwrapErr(parsePushRootArgs({ rest: ["record", "--repo", "acme/widgets", "--root", "abc123"] })).lines[0],
    ).toBe("--root abc123 is not a full 40-character lower-case sha");
  });

  it("refuses a missing sub-command", () => {
    expect(unwrapErr(parsePushRootArgs({ rest: [] })).lines[0]).toBe("unknown sub-command (none): pass record or list");
  });

  it("refuses record's --dry-run on list", () => {
    expect(unwrapErr(parsePushRootArgs({ rest: ["list", "--dry-run"] })).lines[0]).toBe("unknown flag: --dry-run");
  });
});

describe("rootCommitProblem", () => {
  it("accepts a commit that prints only itself", () => {
    expect(rootCommitProblem({ parentsLine: `${ROOT}\n`, rootSha: ROOT })).toBe(undefined);
  });

  it("refuses a commit with a parent", () => {
    expect(rootCommitProblem({ parentsLine: `${CHILD} ${ROOT}`, rootSha: CHILD })).toBe(
      `${CHILD} has 1 parent(s), so it is not a root; pass the fresh history's first commit`,
    );
  });

  it("refuses a sha git could not resolve", () => {
    expect(rootCommitProblem({ parentsLine: undefined, rootSha: ROOT })).toContain("is not a commit in this checkout");
  });
});

describe("runGithubPushRoot", () => {
  let home = "";
  let lines: string[] = [];
  const deps: PushRootDeps = {
    cwd: "/work/fresh",
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    out: ({ line }) => {
      lines.push(line);
    },
    readGit: ({ args }) => {
      const target = String(args[4]);
      if (target === `${ROOT}^{commit}`) return ROOT;
      if (target === `${CHILD}^{commit}`) return `${CHILD} ${ROOT}`;
      throw new Error("fatal: bad revision");
    },
  };
  const run = (...rest: string[]) => runGithubPushRoot({ argv: [...ARGV_HEAD, ...rest, "--home", home], deps });
  const register = () => join(home, "push-roots.json");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "push-root-run-"));
    lines = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes nothing under --dry-run", () => {
    expect(run("record", "--repo", "acme/widgets", "--root", ROOT, "--dry-run")).toBe(EXIT_OK);
    expect(lines).toEqual([
      `dry run: would bind: acme/widgets accepts only ${ROOT} (recorded 2026-01-02T03:04:05.000Z)`,
    ]);
    expect(existsSync(register())).toBe(false);
  });

  it("binds a parentless root and lists it", () => {
    expect(run("record", "--repo", "acme/widgets", "--root", ROOT)).toBe(EXIT_OK);
    lines = [];

    expect(run("list")).toBe(EXIT_OK);
    expect(lines).toEqual([`acme/widgets accepts only ${ROOT} (recorded 2026-01-02T03:04:05.000Z)`]);
  });

  it("says already bound, and changes nothing, for the same root again", () => {
    run("record", "--repo", "acme/widgets", "--root", ROOT);
    const before = readFileSync(register(), "utf8");
    lines = [];

    expect(run("record", "--repo", "Acme/Widgets", "--root", ROOT, "--json")).toBe(EXIT_OK);
    expect(JSON.parse(lines[0]!)).toMatchObject({ changed: false });
    expect(readFileSync(register(), "utf8")).toBe(before);
  });

  it("refuses a root that has a parent, writing nothing", () => {
    expect(run("record", "--repo", "acme/widgets", "--root", CHILD)).toBe(EXIT_ERROR);
    expect(lines[0]).toContain("so it is not a root");
    expect(existsSync(register())).toBe(false);
  });

  it("refuses a sha the checkout does not hold", () => {
    expect(run("record", "--repo", "acme/widgets", "--root", "c".repeat(40))).toBe(EXIT_ERROR);
  });

  it("lists an absent register as guarding nothing", () => {
    expect(run("list", "--json")).toBe(EXIT_OK);
    expect(JSON.parse(lines[0]!)).toEqual({ bindings: [], registerPresent: false });
  });

  it("exits usage on a bad invocation", () => {
    expect(run("bind")).toBe(EXIT_USAGE);
  });
});
