/**
 * `runGithubStackAdoptRegistration` called directly, below the adopt verb's dispatch: the missing-token refusal
 * that touches nothing, and the native-first, local-second order of a confirmed registration.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type GithubStackAdoptRegistrationDeps,
  runGithubStackAdoptRegistration,
} from "../../../../../../cli/commands/github/stackAdoptRegistrationRun.js";
import { isRegisteredStackMember } from "../../../../../../outbound/github/stackLedger.js";
import { creatingApi, registerOnlyArgs, registrationDepsOf, unreachableApi } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("runGithubStackAdoptRegistration, called directly", () => {
  it("refuses with exit 1 before any Git read, provider build or home write when no token resolves", async () => {
    const home = tempHome();
    const observed = harness({ api: unreachableApi({}) });
    const deps: GithubStackAdoptRegistrationDeps = {
      ...registrationDepsOf({ deps: observed.deps }),
      makeApi: () => {
        throw new Error("no API may be built without a token");
      },
      token: () => undefined,
    };
    const code = await runGithubStackAdoptRegistration({ args: registerOnlyArgs({ home }), deps, home });
    expect(code).toBe(1);
    expect(observed.lines).toEqual([
      "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)",
    ]);
    expect(observed.reads).toEqual([]);
    expect(observed.calls).toEqual([]);
    expect(readdirSync(home, { recursive: true })).toEqual([]);
  });

  it("confirms the native membership first and enrols the child locally second, reading no replay fact", async () => {
    const home = tempHome();
    const calls: string[] = [];
    const observed = harness({ api: creatingApi({ calls }) });
    const code = await runGithubStackAdoptRegistration({
      args: registerOnlyArgs({ home }),
      deps: registrationDepsOf({ deps: observed.deps }),
      home,
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["createStack 10,100", "getStack 5"]);
    expect(observed.calls).toEqual(["ledger o/r#100 via adopt"]);
    expect(observed.reads).toEqual([
      "rev-parse --show-toplevel",
      "remote get-url origin",
      "ls-remote --symref origin HEAD",
      "rev-parse --show-toplevel",
      "remote get-url origin",
      "ls-remote --symref origin HEAD",
    ]);
    expect(observed.lines).toEqual([
      "would create native stack membership for entries [#10, #100], then enrol PR #100 locally after confirmation.",
      "native membership confirmed: stack #5; entries [#10, #100].",
      "This registers membership only: the branch is not rebased; stack sync still cannot replay a multi-commit " +
        "entry; pushing the parent may now refuse on carry with entries above it (--orphan-above is the " +
        "existing route).",
    ]);
    expect(isRegisteredStackMember({ home, number: 100, owner: "o", repo: "r" })).toBe(true);
  });
});
