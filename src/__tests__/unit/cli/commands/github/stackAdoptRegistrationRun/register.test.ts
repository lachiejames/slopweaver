/**
 * `github stack adopt --register-only` registering a membership through its PUBLIC entrypoint: a fresh create, an
 * add to the parent's stack, a membership already equal, a dry run, and the replay-read witness firing on
 * ordinary adopt.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackAdopt } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { isRegisteredStackMember } from "../../../../../../outbound/github/stackLedger.js";
import { childPr, creatingApi, nativeStack, PREFIX, parentPr, unreachableApi } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackAdopt --register-only", () => {
  it("registers an eight-commit drifted chain without reading one replay fact", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const observed = harness({ api: creatingApi({ calls }) });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(observed.reads).toEqual([
      "rev-parse --show-toplevel",
      "remote get-url origin",
      "ls-remote --symref origin HEAD",
      "rev-parse --show-toplevel",
      "remote get-url origin",
      "ls-remote --symref origin HEAD",
    ]);
    expect(observed.writes).toEqual([]);
    expect(calls).toEqual(["createStack 10,100", "getStack 5"]);
    expect(observed.calls).toEqual(["ledger o/r#100 via adopt"]);
    expect(observed.lines).toEqual([
      "would create native stack membership for entries [#10, #100], then enrol PR #100 locally after confirmation.",
      "native membership confirmed: stack #5; entries [#10, #100].",
      "This registers membership only: the branch is not rebased; stack sync still cannot replay a multi-commit " +
        "entry; pushing the parent may now refuse on carry with entries above it (--orphan-above is the " +
        "existing route).",
    ]);
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(true);
  });

  it("proves the replay-read witness can fire: ordinary adopt reaches the reads this mode refuses", async () => {
    const observed = harness({ api: unreachableApi({ getPr: () => okAsync(childPr()) }) });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.reads.some((read) => read.startsWith("symbolic-ref"))).toBe(true);
    expect(observed.lines.join("\n")).toContain("replay-only Git read reached in register-only mode: symbolic-ref");
  });

  it("writes nothing at all on a dry run — no native call, no lock, no door record, no ledger", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const observed = harness({ api: creatingApi({ calls }) });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--dry-run", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(observed.calls).toEqual([]);
    expect(observed.lines).toEqual([
      "would create native stack membership for entries [#10, #100], then enrol PR #100 locally after confirmation.",
      "dry run: no native write, no local enrolment, no operation lock, no door record.",
    ]);
    expect(observed.door.records()).toEqual([]);
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("adds to the parent's existing stack when only the parent is registered", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const joined = { id: 16958, number: 16958, position: 1, size: 2 } as const;
    let added = false;
    const api = unreachableApi({
      addToStack: ({ pullRequests, stackNumber }) => {
        calls.push(`addToStack ${String(stackNumber)} ${pullRequests.join(",")}`);
        added = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 16958 }));
      },
      findOpenPrByHead: () => okAsync(parentPr({ stack: joined })),
      getPr: ({ number }) =>
        okAsync(
          number === 10
            ? parentPr({ stack: joined })
            : childPr({ stack: added ? { id: 16958, number: 16958, position: 2, size: 2 } : undefined }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 16958 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["addToStack 16958 100"]);
    expect(observed.lines[1]).toBe("native membership confirmed: stack #16958; entries [#10, #100].");
  });

  it("performs no second native write when the membership is already equal", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    const api = unreachableApi({
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http" as const, message: "must not run", operation: "createStack" });
      },
      findOpenPrByHead: () => okAsync(parentPr({ stack: joined })),
      getPr: ({ number }) =>
        okAsync(
          number === 10 ? parentPr({ stack: joined }) : childPr({ stack: { id: 5, number: 5, position: 2, size: 2 } }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual([]);
    expect(observed.calls).toEqual(["ledger o/r#100 via adopt"]);
  });

  it("registers the LOWER pair of the chain its own orphan refusal prescribed, rather than no-op-ing", async () => {
    // The orphan refusal told the operator to run --register-only on
    // the parent first, and that invocation returned "no registration" because the parent's base was named
    // `main` — so the upper pair refused forever and the repair did nothing. Here the lowest pull request HEADS `main`, and
    // adopting the parent onto it is the repair actually working.
    const home = tempHome();
    const calls: string[] = [];
    const onMain = parentPr({
      baseRef: "release",
      head: { label: "o:main", ref: "main", repoFullName: "o/r", sha: "d".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    const joined = { id: 9, number: 9, position: 1, size: 2 } as const;
    let created = false;
    const api = unreachableApi({
      createStack: ({ pullRequests }) => {
        calls.push(`createStack ${pullRequests.join(",")}`);
        created = true;
        return okAsync(nativeStack({ entries: [1, 10], number: 9 }));
      },
      findOpenPrByHead: ({ head }) => okAsync(head === "main" ? onMain : undefined),
      getPr: ({ number }) => {
        if (number === 1) return okAsync(created ? parentPr({ ...onMain, stack: joined }) : onMain);
        return okAsync(parentPr({ stack: created ? { id: 9, number: 9, position: 2, size: 2 } : undefined }));
      },
      getStack: () => okAsync(nativeStack({ entries: [1, 10], number: 9 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [
        "node",
        "slopweaver",
        "github",
        "stack",
        "adopt",
        "--pr",
        "10",
        "--register-only",
        "--cwd",
        "/repo",
        "--home",
        home,
      ],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(calls).toEqual(["createStack 1,10"]);
    expect(observed.lines[1]).toBe("native membership confirmed: stack #9; entries [#1, #10].");
  });
});
