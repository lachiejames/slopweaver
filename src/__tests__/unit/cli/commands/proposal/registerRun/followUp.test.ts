/*
 * `proposal follow-up`: a follow-up-added event carrying its ref and label, and an unregistered slug exiting
 * EXPECTED_EMPTY.
 */
import { describe, expect, it } from "vitest";

import { runProposalFollowUp } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalFollowUp", () => {
  it("appends a follow-up-added event", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalFollowUp({
      argv: argv({
        rest: ["a-slug", "--ref", "a-handover-doc", "--label", "the fix", "--home", home],
        verb: "follow-up",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.followUps).toEqual([
      { label: "the fix", ref: "a-handover-doc" },
    ]);
  });

  it("refuses with EXPECTED_EMPTY for an unregistered slug, and appends nothing", () => {
    const home = tempHome();
    const h = harness();
    const code = runProposalFollowUp({
      argv: argv({ rest: ["nope", "--ref", "x", "--home", home], verb: "follow-up" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
  });
});
