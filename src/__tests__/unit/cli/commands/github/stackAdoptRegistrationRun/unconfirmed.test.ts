/**
 * `github stack adopt --register-only` when a registration cannot be confirmed: the native call failed, the
 * read-back shows the child still unstacked, the local enrolment threw after the membership landed, or the pull
 * request moved between planning and the door.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { runGithubStackAdopt } from "../../../../../../cli/commands/github/stackAdoptRun.js";
import { EXIT_ERROR } from "../../../../../../cli/exitCodes.js";
import { isRegisteredStackMember } from "../../../../../../outbound/github/stackLedger.js";
import { childPr, creatingApi, nativeStack, PREFIX, parentPr, unreachableApi } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackAdopt --register-only", () => {
  it("reports unconfirmed and writes no ledger entry when the native call itself failed", async () => {
    const home = tempHome();
    const api = unreachableApi({
      createStack: () => errAsync({ kind: "http" as const, message: "502 Bad Gateway", operation: "createStack" }),
      findOpenPrByHead: ({ head }) => okAsync(head === "main" ? undefined : parentPr()),
      getPr: () => okAsync(childPr()),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.calls).toEqual([]);
    expect(observed.lines).toContain(
      "unconfirmed: native registration was attempted but its outcome is unknown: 502 Bad Gateway. No local " +
        "enrolment was written. Re-run to inspect current membership.",
    );
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("reports unconfirmed when the read-back shows the child still unstacked", async () => {
    const home = tempHome();
    const api = unreachableApi({
      createStack: () => okAsync(nativeStack({ entries: [10], number: 5 })),
      findOpenPrByHead: ({ head }) => okAsync(head === "main" ? undefined : parentPr()),
      getPr: ({ number }) =>
        okAsync(number === 10 ? parentPr({ stack: { id: 5, number: 5, position: 1, size: 1 } }) : childPr()),
      getStack: () => okAsync(nativeStack({ entries: [10], number: 5 })),
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(observed.calls).toEqual([]);
    expect(observed.lines.join("\n")).toContain("child membership differs from the expected stack");
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(false);
  });

  it("reports the partial outcome when the membership landed and the local enrolment threw", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const observed = harness({ api: creatingApi({ calls }), ledgerThrows: true });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(calls).toEqual(["createStack 10,100", "getStack 5"]);
    expect(observed.lines).toEqual([
      "would create native stack membership for entries [#10, #100], then enrol PR #100 locally after confirmation.",
      "native membership confirmed: stack #5; entries [#10, #100].",
      "This registers membership only: the branch is not rebased; stack sync still cannot replay a multi-commit " +
        "entry; pushing the parent may now refuse on carry with entries above it (--orphan-above is the " +
        "existing route).",
      "native membership confirmed, local enrolment failed for PR #100: EACCES: the ledger directory is a file. " +
        "Re-run --register-only; matching membership needs no second native write.",
    ]);
  });

  it("refuses, sending nothing, when the base branch moved between planning and the door", async () => {
    const home = tempHome();
    const calls: string[] = [];
    let reads = 0;
    const api = unreachableApi({
      createStack: () => {
        calls.push("createStack");
        return errAsync({ kind: "http" as const, message: "must not run", operation: "createStack" });
      },
      findOpenPrByHead: ({ head }) => okAsync(head === "main" ? undefined : parentPr()),
      getPr: () => {
        reads += 1;
        return okAsync(reads === 1 ? childPr() : childPr({ authorId: 77 }));
      },
    });
    const observed = harness({ api });
    const code = await runGithubStackAdopt({
      argv: [...PREFIX, "--register-only", "--cwd", "/repo", "--home", home],
      deps: observed.deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(calls).toEqual([]);
    expect(observed.calls).toEqual([]);
    expect(observed.lines).toContain(
      "refused: the author changed from 1 to 77 before registration; nothing was sent. Re-run to work from the " +
        "current state",
    );
  });
});
