import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ok, unwrap, unwrapErr } from "#lib/result.js";
import { writePushRootBinding } from "../../../../../admit/pushRootStore.js";
import type { RepointReadDeps } from "../../../../../checkouts/repointReaders.js";
import { parseRepointPlanArgs } from "../../../../../cli/commands/github/repointPlanCore.js";
import { runGithubRepointPlan } from "../../../../../cli/commands/github/repointPlanRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const ARGV_HEAD = ["node", "slopweaver", "github", "repoint-plan"];
const OLD = "/work/widgets";
const FRESH = "/work/widgets-fresh";
const ROOT = "a".repeat(40);
const REMOTES = "config --get-regexp ^remote\\..*\\.(url|pushurl)$";

describe("parseRepointPlanArgs", () => {
  it("parses the full invocation", () => {
    expect(
      unwrap(
        parseRepointPlanArgs({
          rest: ["--repo", "acme/widgets", "--archive-name", "widgets-archive", "--new-checkout", FRESH, "--json"],
        }),
      ),
    ).toEqual({
      archiveName: "widgets-archive",
      home: undefined,
      json: true,
      newCheckout: FRESH,
      repository: "acme/widgets",
    });
  });

  it("names both missing required flags", () => {
    expect(unwrapErr(parseRepointPlanArgs({ rest: [] })).lines.slice(0, 2)).toEqual([
      "--repo <owner/name> is required: the repository whose history is re-cut",
      "--archive-name <name> is required: the name the old history moves to, under the same owner",
    ]);
  });

  it("refuses a repository that is not owner/name", () => {
    expect(unwrapErr(parseRepointPlanArgs({ rest: ["--repo", "widgets", "--archive-name", "x"] })).lines[0]).toBe(
      "--repo widgets is not an owner/name repository",
    );
  });
});

describe("runGithubRepointPlan", () => {
  let home = "";
  let lines: string[] = [];
  const out = ({ line }: { line: string }): void => {
    lines.push(line);
  };
  /** One old checkout, a valid fresh clone and a recorded root; nothing else on the machine. */
  const read = (): RepointReadDeps => ({
    convertPlist: () => ok({}),
    listAuthoredFiles: () => ({ directories: [], files: [], unclassified: [], unreadable: [] }),
    listDirectory: () => ok(null),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    readBytesAsLatin1: () => undefined,
    readGit: ({ cwd, args }) => {
      const key = `${cwd} ${args.join(" ")}`;
      const answers: Record<string, string> = {
        [`${OLD} ${REMOTES}`]: "remote.origin.url git@github.com:acme/widgets.git",
        [`${OLD} rev-parse --show-toplevel`]: OLD,
        [`${OLD} worktree list --porcelain`]: `worktree ${OLD}\nHEAD ${"c".repeat(40)}\nbranch refs/heads/main\n`,
        [`${FRESH} rev-parse --show-toplevel`]: FRESH,
        [`${FRESH} --no-replace-objects rev-list --max-parents=0 HEAD`]: ROOT,
        [`${FRESH} ${REMOTES}`]: "remote.origin.url git@github.com:acme/widgets.git",
      };
      if (!(key in answers)) throw new Error(`fatal: ${key}`);
      return answers[key]!;
    },
    readText: ({ path }) =>
      ok(path === join(home, "profile.json") ? JSON.stringify({ mainCheckouts: [{ path: OLD }] }) : null),
    sizeOf: () => 1,
    userHome: "/users/fixture",
  });
  const run = ({ rest }: { rest: readonly string[] }) =>
    runGithubRepointPlan({ argv: [...ARGV_HEAD, ...rest, "--home", home], deps: { out, read: read() } });
  const ARGS = ["--repo", "acme/widgets", "--archive-name", "widgets-archive"];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "repoint-plan-run-"));
    lines = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("exits 3 and says INCOMPLETE without --new-checkout: the clone itself, and the profile entry waiting on it", () => {
    expect(run({ rest: ARGS })).toBe(EXIT_EXPECTED_EMPTY);
    expect(lines[1]).toBe("INCOMPLETE: 2 item(s) below keep this plan from being applied");
  });

  it("opens every report by saying nothing was changed", () => {
    run({ rest: ARGS });

    expect(lines[0]).toBe(
      "dry run — nothing was changed. acme/widgets keeps the fresh history; the old one moves to acme/widgets-archive.",
    );
  });

  it("prints the archive remote move", () => {
    run({ rest: ARGS });

    expect(lines).toContain(
      `  ${OLD}: remote.origin.url git@github.com:acme/widgets.git -> git@github.com:acme/widgets-archive.git`,
    );
  });

  it("stays incomplete while no push root is recorded, even with a valid clone", () => {
    expect(run({ rest: [...ARGS, "--new-checkout", FRESH] })).toBe(EXIT_EXPECTED_EMPTY);
    expect(lines.some((line) => line.includes("no push root is recorded"))).toBe(true);
  });

  it("writes nothing into the state home", () => {
    run({ rest: [...ARGS, "--new-checkout", FRESH, "--json"] });

    expect(readdirSync(home)).toEqual([]);
  });

  it("emits the typed plan under --json", () => {
    run({ rest: [...ARGS, "--json"] });
    const plan = JSON.parse(lines.join("\n")) as { schemaVersion: number; complete: boolean; oldCheckouts: string[] };

    expect([plan.schemaVersion, plan.complete, plan.oldCheckouts]).toEqual([1, false, [OLD]]);
  });

  it("exits usage on an archive name equal to the repository's own", () => {
    expect(run({ rest: ["--repo", "acme/widgets", "--archive-name", "widgets"] })).toBe(EXIT_USAGE);
  });

  it("exits 0 for a complete plan once the root is recorded", () => {
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-01-02T03:04:05.000Z", repository: "acme/widgets", rootSha: ROOT },
        home,
      }),
    );

    expect(run({ rest: [...ARGS, "--new-checkout", FRESH] })).toBe(EXIT_OK);
    expect(lines[1]).toBe("complete: every place below is planned");
  });
});
