import { describe, expect, it } from "vitest";
import { submitProofPathRefusal } from "../../../../../admit/pushProofPathGate.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";

import {
  advancedState,
  type SubmitPlan,
  type SubmitPush,
  submitOutcomeLines,
} from "../../../../../cli/commands/github/stackSubmitCore.js";
import { parseGithubStackSubmitArgs } from "../../../../../cli/commands/github/stackSubmitRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { PR_STATE_VERSION, type PrState, type PrStateEntry } from "../../../../../outbound/github/prStateCore.js";

const push = (over: Partial<SubmitPush> & { branch: string }): SubmitPush => ({
  expectedRemoteSha: `old-${over.branch}`,
  pullRequestNumber: 1,
  toSha: `new-${over.branch}`,
  ...over,
});

const entry = (over: Partial<PrStateEntry> & { number: number; headRef: string }): PrStateEntry => ({
  baseRef: "main",
  kind: "pull-request",
  localBranchSha: null,
  observedBaseSha: "base",
  preparation: { kind: "ready", preparedRef: `refs/staged/${over.headRef}`, preparedSha: `new-${over.headRef}` },
  remoteHeadSha: `old-${over.headRef}`,
  ...over,
});

const snapshot = ({ entries }: { entries: readonly PrStateEntry[] }): PrState => ({
  entries,
  header: {
    generationId: "gen-1",
    kind: "header",
    recordedAtIso: "2026-09-09T21:00:00.000Z",
    repo: "lachiejames/slopweaver",
    version: PR_STATE_VERSION,
  },
});

describe("parseGithubStackSubmitArgs", () => {
  it("defaults the remote to origin, and neither forces nor dry-runs", () => {
    const args = unwrap(parseGithubStackSubmitArgs({ argv: [] }));

    expect(args.remote).toBe("origin");
    expect(args.force).toBe(false);
    expect(args.dryRun).toBe(false);
  });

  it("reads every flag it accepts", () => {
    const args = unwrap(
      parseGithubStackSubmitArgs({
        argv: ["--force", "--dry-run", "--remote", "upstream", "--home", "/h", "--cwd", "/c"],
      }),
    );

    expect(args.force).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.remote).toBe("upstream");
    expect(args.home).toBe("/h");
    expect(args.cwd).toBe("/c");
  });

  it("refuses a flag it does not accept", () => {
    expect(
      githubVerbErrorLines({ error: unwrapErr(parseGithubStackSubmitArgs({ argv: ["--orphan-above", "1"] })) }),
    ).toEqual(["unknown flag: --orphan-above", "unexpected argument: 1"]);
  });
});

describe("submitOutcomeLines", () => {
  it("names every branch that landed when all of them did, and says nothing about state", () => {
    const plan: SubmitPlan = {
      pushes: [push({ branch: "one" }), push({ branch: "two", pullRequestNumber: 2 })],
      waived: [],
    };

    const lines = submitOutcomeLines({
      outcomes: [
        { kind: "pushed", push: plan.pushes[0]! },
        { kind: "pushed", push: plan.pushes[1]! },
      ],
      plan,
    });

    expect(lines).toEqual(["pushed one (PR #1) -> new-one", "pushed two (PR #2) -> new-two"]);
  });

  it("reports the pushed prefix, the failure and the untouched suffix as three separate groups", () => {
    const plan: SubmitPlan = {
      pushes: [
        push({ branch: "one" }),
        push({ branch: "two", pullRequestNumber: 2 }),
        push({ branch: "three", pullRequestNumber: 3 }),
      ],
      waived: [],
    };

    const lines = submitOutcomeLines({
      outcomes: [
        { kind: "pushed", push: plan.pushes[0]! },
        { kind: "failed", push: plan.pushes[1]!, reason: "the lease did not hold" },
      ],
      plan,
    });

    expect(lines[0]).toBe("pushed one (PR #1) -> new-one");
    expect(lines[1]).toBe("FAILED two (PR #2): the lease did not hold");
    expect(lines[2]).toBe("not attempted: three (PR #3)");
    expect(lines[3]).toContain("your local state is UNCHANGED");
  });
});

describe("advancedState", () => {
  it("moves a pushed row's recorded remote head onto what was just sent", () => {
    const state = snapshot({ entries: [entry({ headRef: "one", number: 1 })] });

    const advanced = advancedState({ nowIso: "2026-09-09T22:00:00.000Z", pushed: [push({ branch: "one" })], state });

    expect(advanced.entries[0]!.remoteHeadSha).toBe("new-one");
    expect(advanced.entries[0]!.preparation).toEqual({ kind: "unchanged" });
    expect(advanced.header.recordedAtIso).toBe("2026-09-09T22:00:00.000Z");
  });

  it("leaves a row nothing pushed exactly as it was", () => {
    const state = snapshot({
      entries: [entry({ headRef: "one", number: 1 }), entry({ headRef: "untouched", number: 2 })],
    });

    const advanced = advancedState({ nowIso: "2026-09-09T22:00:00.000Z", pushed: [push({ branch: "one" })], state });

    expect(advanced.entries[1]).toEqual(state.entries[1]);
  });

  it("keeps the generation the snapshot was cut under, so a stale staged ref is still detectable", () => {
    const state = snapshot({ entries: [entry({ headRef: "one", number: 1 })] });

    const advanced = advancedState({ nowIso: "2026-09-09T22:00:00.000Z", pushed: [push({ branch: "one" })], state });

    expect(advanced.header.generationId).toBe("gen-1");
  });
});

describe("submitProofPathRefusal", () => {
  /** A reader answering `ls-tree` per commit from a fixed table; any other read, or an unknown commit, throws. */
  const treeReader =
    ({ trees }: { trees: Readonly<Record<string, readonly string[]>> }) =>
    ({ args }: { cwd: string; args: readonly string[] }): string => {
      const commit = args.at(-1)!.replace("^{commit}", "");
      const tree = trees[commit];
      if (!args.includes("ls-tree") || tree === undefined) {
        throw new Error(`unexpected git ${args.join(" ")}`);
      }
      return tree.map((path) => `${path}\0`).join("");
    };
  const plan: SubmitPlan = { pushes: [push({ branch: "a" }), push({ branch: "b", pullRequestNumber: 2 })], waived: [] };

  it("names every head that carries proof output and every file in it, in one run", () => {
    const lines = submitProofPathRefusal({
      env: {},
      plan,
      readGit: treeReader({
        trees: { "new-a": ["src/a.ts", "screenshots/a.png"], "new-b": ["src/b.ts", "proof/b.gif", "proof/b.tape"] },
      }),
      repoRoot: "/repo",
    });
    expect(lines.slice(0, 7)).toEqual([
      "nothing was sent:",
      "refused: a (PR #1) carries 1 proof file(s):",
      "  screenshots/a.png",
      "refused: b (PR #2) carries 2 proof file(s):",
      "  proof/b.gif",
      "  proof/b.tape",
      expect.stringContaining("blocked because the head carries proof output") as unknown as string,
    ]);
  });

  it("names the hatch once, however many heads carry proof output", () => {
    const lines = submitProofPathRefusal({
      env: {},
      plan,
      readGit: treeReader({ trees: { "new-a": ["proof/a.gif"], "new-b": ["proof/b.gif"] } }),
      repoRoot: "/repo",
    });
    expect(lines.filter((line) => line.includes("SLOPWEAVER_ALLOW_PROOF_PATH=1")).length).toBe(1);
  });

  it("sends once the hatch is open", () => {
    expect(
      submitProofPathRefusal({
        env: { SLOPWEAVER_ALLOW_PROOF_PATH: "1" },
        plan,
        readGit: treeReader({ trees: { "new-a": ["proof/a.gif"], "new-b": ["src/b.ts"] } }),
        repoRoot: "/repo",
      }),
    ).toEqual([]);
  });

  it("passes when every head is clean", () => {
    expect(
      submitProofPathRefusal({
        env: {},
        plan,
        readGit: treeReader({ trees: { "new-a": ["src/a.ts"], "new-b": ["src/b.ts"] } }),
        repoRoot: "/repo",
      }),
    ).toEqual([]);
  });

  it("refuses when a head's tree cannot be read", () => {
    const lines = submitProofPathRefusal({ env: {}, plan, readGit: treeReader({ trees: {} }), repoRoot: "/repo" });
    expect(lines[0]).toBe("refused: a (PR #1)");
    expect(lines[1]).toContain("could not list the tree of new-a to check it for proof output");
  });
});
