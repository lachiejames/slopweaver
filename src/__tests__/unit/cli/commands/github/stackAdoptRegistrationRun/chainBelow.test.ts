/**
 * `github stack adopt --register-only` reading what lies BELOW the parent, on the create path and the add path:
 * the create that would orphan a lower pull request, a parent based on the default branch, a chain already broken
 * when it planned, and a lower pull request that reopened or left the stack between the plan and the write.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackAdopt } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { isRegisteredStackMember } from "../../../../../../outbound/github/stackLedger.js";
import { childPr, nativeStack, PREFIX, parentPr, unreachableApi } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackAdopt --register-only", () => {
  it("refuses to call a create confirmed when a lower pull request reopened between the plan and the write", async () => {
    // Reproduced end to end. The bottom-first lookup answers "nothing
    // below the parent" because the lowest pull request is closed; another client reopens it after that read and before the
    // create. Nothing the old read-back looked at moved — the parent's base is still `main`, both memberships
    // match, the stack holds the right pair — so the run reported a repair that had made the tree worse.
    const home = tempHome();
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    const lower = parentPr({
      head: { label: "o:lower", ref: "lower", repoFullName: "o/r", sha: "c".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    let created = false;
    const api = unreachableApi({
      authenticatedUserId: () => okAsync(1),
      createStack: () => {
        created = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
      },
      // Before the write nothing is below the parent; after it, the reopened #1 is.
      findOpenPrByHead: ({ head }) => {
        if (head === "main") {
          return okAsync(created ? lower : undefined);
        }
        return okAsync(created ? parentPr({ stack: joined }) : parentPr());
      },
      getPr: ({ number }) => {
        if (number === 10) return okAsync(created ? parentPr({ stack: joined }) : parentPr());
        return okAsync(created ? childPr({ stack: { id: 5, number: 5, position: 2, size: 2 } }) : childPr());
      },
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.lines.join("\n")).toContain(
      "open PR #1 (lower) is based below parent PR #10 and is not in this stack, so registering the pair " +
        "above it left that lower relation needing a dissolve",
    );
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("reads the pull request below an unstacked parent, and refuses the create it would orphan", async () => {
    const calls: string[] = [];
    const heads: string[] = [];
    const grandparent = parentPr({
      head: { label: "o:grandparent-branch", ref: "grandparent-branch", repoFullName: "o/r", sha: "c".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    const api = unreachableApi({
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http" as const, message: "must not run", operation: "createStack" });
      },
      findOpenPrByHead: ({ head }) => {
        heads.push(head);
        return okAsync(head === "parent-branch" ? parentPr({ baseRef: "grandparent-branch" }) : grandparent);
      },
      getPr: () => okAsync(childPr()),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(heads).toEqual(["parent-branch", "grandparent-branch"]);
    expect(calls).toEqual([]);
    expect(observed.calls).toEqual([]);
    expect(observed.lines).toEqual([
      "refused: registering PR #100 onto PR #10 would form a FRESH stack, but #10 is itself based on open PR " +
        "#1 (grandparent-branch) and carries no stack — so this pair would leave that lower one needing a " +
        "dissolve rather than a registration. Register a chain from the bottom up: `slopweaver github stack " +
        "adopt --pr 10 --register-only` first, then re-run this",
    ]);
  });

  it("still looks below a parent based on the DEFAULT branch, because a PR's head can BE that branch", async () => {
    // `chainParentFor` pairs by head branch and does not exclude the
    // repository default, so "the parent targets main, therefore nothing is below it" was false. The lowest one heads
    // `main` here, which is exactly the shape the removed shortcut would have skipped.
    const heads: string[] = [];
    const calls: string[] = [];
    const onMain = parentPr({
      baseRef: "release",
      head: { label: "o:main", ref: "main", repoFullName: "o/r", sha: "d".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    const api = unreachableApi({
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http" as const, message: "must not run", operation: "createStack" });
      },
      findOpenPrByHead: ({ head }) => {
        heads.push(head);
        return okAsync(head === "parent-branch" ? parentPr() : onMain);
      },
      getPr: () => okAsync(childPr()),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(heads).toEqual(["parent-branch", "main"]);
    expect(calls).toEqual([]);
    expect(observed.lines[0]).toContain("#10 is itself based on open PR #1 (main) and carries no stack");
  });

  it("reads below the parent on the add path too, and confirms when that answer did not move", async () => {
    // The lookup used to be skipped for a stacked parent, and a review showed
    // what the saving cost: with no plan-time answer, an `add` could not tell a chain someone else broke mid-
    // write from one that was already broken. The heads below are that third read, spent by the preview, by
    // the replan inside the door, and once more by the read-back that compares the two.
    const heads: string[] = [];
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    let added = false;
    const api = unreachableApi({
      addToStack: () => {
        added = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
      },
      findOpenPrByHead: ({ head }) => {
        heads.push(head);
        return okAsync(parentPr({ baseRef: "grandparent-branch", stack: joined }));
      },
      getPr: ({ number }) =>
        okAsync(
          number === 10
            ? parentPr({ baseRef: "grandparent-branch", stack: joined })
            : childPr({ stack: added ? { id: 5, number: 5, position: 2, size: 2 } : undefined }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(heads).toEqual([
      "parent-branch",
      "grandparent-branch",
      "parent-branch",
      "grandparent-branch",
      "grandparent-branch",
    ]);
  });

  it("confirms an add whose chain below was ALREADY broken when it planned — that is not this verb's doing", async () => {
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    let added = false;
    // Open, unstacked, and sitting below the stack's bottom entry the whole time. The planner permits this
    // for an `add`, so refusing it AFTER a successful write would report a failure the write did not cause.
    const lower = parentPr({
      head: { label: "o:grandparent-branch", ref: "grandparent-branch", repoFullName: "o/r", sha: "c".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    const api = unreachableApi({
      addToStack: () => {
        added = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
      },
      findOpenPrByHead: ({ head }) =>
        okAsync(head === "parent-branch" ? parentPr({ baseRef: "grandparent-branch", stack: joined }) : lower),
      getPr: ({ number }) =>
        okAsync(
          number === 10
            ? parentPr({ baseRef: "grandparent-branch", stack: joined })
            : childPr({ stack: added ? { id: 5, number: 5, position: 2, size: 2 } : undefined }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", tempHome()],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(observed.lines[1]).toBe("native membership confirmed: stack #5; entries [#10, #100].");
  });

  it("refuses to call an add confirmed when the lower pull request was REMOVED from the stack mid-write", async () => {
    // The comparison was on the lower pull request's NUMBER alone, and
    // this race never changes it: the lower one stays open below the parent and simply stops being a stack member, taking the
    // relation from healthy to parent-unstacked while every number the read-back held stayed put.
    const home = tempHome();
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    let added = false;
    const lowerHead = {
      label: "o:grandparent-branch",
      ref: "grandparent-branch",
      repoFullName: "o/r",
      sha: "c".repeat(40),
    };
    const api = unreachableApi({
      addToStack: () => {
        added = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
      },
      findOpenPrByHead: ({ head }) => {
        if (head === "parent-branch") {
          return okAsync(parentPr({ baseRef: "grandparent-branch", stack: joined }));
        }
        const lower = parentPr({ head: lowerHead, htmlUrl: "https://example.invalid/pr/1", nodeId: "PR_1", number: 1 });
        return okAsync(added ? lower : { ...lower, stack: joined });
      },
      getPr: ({ number }) =>
        okAsync(
          number === 10
            ? parentPr({ baseRef: "grandparent-branch", stack: joined })
            : childPr({ stack: added ? { id: 5, number: 5, position: 2, size: 2 } : undefined }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.lines.join("\n")).toContain(
      "open PR #1 (grandparent-branch) is based below parent PR #10 and is not in this stack",
    );
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("refuses to call an add confirmed when a lower pull request reopened between the plan and the write", async () => {
    const home = tempHome();
    const joined = { id: 5, number: 5, position: 1, size: 2 } as const;
    let added = false;
    const lower = parentPr({
      head: { label: "o:grandparent-branch", ref: "grandparent-branch", repoFullName: "o/r", sha: "c".repeat(40) },
      htmlUrl: "https://example.invalid/pr/1",
      nodeId: "PR_1",
      number: 1,
    });
    const api = unreachableApi({
      addToStack: () => {
        added = true;
        return okAsync(nativeStack({ entries: [10, 100], number: 5 }));
      },
      // Nothing below the stack's bottom while planning; the reopened #1 is there by the read-back.
      findOpenPrByHead: ({ head }) => {
        if (head === "parent-branch") {
          return okAsync(parentPr({ baseRef: "grandparent-branch", stack: joined }));
        }
        return okAsync(added ? lower : undefined);
      },
      getPr: ({ number }) =>
        okAsync(
          number === 10
            ? parentPr({ baseRef: "grandparent-branch", stack: joined })
            : childPr({ stack: added ? { id: 5, number: 5, position: 2, size: 2 } : undefined }),
        ),
      getStack: () => okAsync(nativeStack({ entries: [10, 100], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.lines.join("\n")).toContain(
      "open PR #1 (grandparent-branch) is based below parent PR #10 and is not in this stack",
    );
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });
});
