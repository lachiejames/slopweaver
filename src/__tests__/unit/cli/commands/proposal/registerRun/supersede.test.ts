/*
 * `proposal supersede`: a superseded event naming its successor, and a proposal superseding itself refused with
 * its status left alone.
 */
import { describe, expect, it } from "vitest";

import { runProposalSupersede } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalSupersede", () => {
  it("appends a superseded event and sets status to superseded", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "an-old-proposal" });
    const h = harness();
    const code = runProposalSupersede({
      argv: argv({
        rest: ["an-old-proposal", "--by", "a-newer-one", "--why", "v2 shipped", "--home", home],
        verb: "supersede",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const entry = unwrap(loadRegisterEntry({ home, slug: "an-old-proposal" }))!;
    expect(entry.status).toBe("superseded");
    expect(entry.supersededBy).toBe("a-newer-one");
  });

  it("refuses a proposal superseding itself", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalSupersede({
      argv: argv({ rest: ["a-slug", "--by", "a-slug", "--why", "x", "--home", home], verb: "supersede" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.status).toBe("strawman");
  });
});
