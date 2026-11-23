/**
 * `readRegistrationFacts`: the provider and Git reads a register-only run plans from, and the absence of any
 * write while it reads them.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { readRegistrationFacts } from "../../../../../../cli/commands/github/stackAdoptRegistrationReads.js";
import { childPr, creatingApi, parentPr, registerOnlyArgs } from "./fixtures.js";
import { harness, tempHome, useTempHomes } from "./harness.js";

useTempHomes();

describe("readRegistrationFacts", () => {
  it("reads the repository, the child, its parent and what lies below the parent, writing nothing", async () => {
    const calls: string[] = [];
    const api = creatingApi({ calls });
    const observed = harness({ api });
    const facts = await readRegistrationFacts({
      api,
      args: registerOnlyArgs({ home: tempHome() }),
      git: observed.deps.git,
    });
    expect(unwrap(facts)).toEqual({
      child: childPr(),
      defaultBranch: "main",
      grandparent: undefined,
      owner: "o",
      parent: parentPr(),
      repo: "r",
    });
    expect(observed.reads).toEqual([
      "rev-parse --show-toplevel",
      "remote get-url origin",
      "ls-remote --symref origin HEAD",
    ]);
    expect(observed.writes).toEqual([]);
    expect(calls).toEqual([]);
  });
});
