/*
 * `proposal audience`: the audience-set event the register has always folded, now written by a verb.
 */
import { describe, expect, it } from "vitest";

import { runProposalAudience } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalAudience", () => {
  it("writes the audience-set event the register has always folded but nothing could write", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalAudience({
      argv: argv({ rest: ["a-slug", "--audience", "the engineering channel", "--home", home], verb: "audience" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.audience).toBe("the engineering channel");
  });
});
