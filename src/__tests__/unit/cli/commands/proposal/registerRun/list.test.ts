/*
 * `proposal list`: an empty register exits OK printing nothing, every proposal sorted by slug, narrowing by
 * `--status`, and an unknown status refused rather than answered with a silently empty list.
 */
import { describe, expect, it } from "vitest";

import { runProposalList } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { appendRegisterEvent } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalList", () => {
  it("prints nothing and still exits OK when the register is empty", () => {
    const h = harness();
    const code = runProposalList({ argv: argv({ rest: ["--home", tempHome()], verb: "list" }), deps: h.deps });
    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual([]);
  });

  it("lists every registered proposal, sorted by slug", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "b-slug" });
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalList({ argv: argv({ rest: ["--home", home], verb: "list" }), deps: h.deps });
    expect(h.out).toEqual(["a-slug  (strawman)  A proposal", "b-slug  (strawman)  A proposal"]);
  });

  it("filters by --status", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    unwrap(
      appendRegisterEvent({
        event: { atIso: "2026-08-02T00:00:00.000Z", kind: "status-changed", status: "shared", why: "x" },
        home,
        slug: "a-slug",
      }),
    );
    seedRegistered({ home, slug: "b-slug" });
    const h = harness();
    runProposalList({ argv: argv({ rest: ["--status", "shared", "--home", home], verb: "list" }), deps: h.deps });
    expect(h.out).toEqual(["a-slug  (shared)  A proposal"]);
  });
});

describe("runProposalList --status validation", () => {
  it("refuses an unknown status rather than answering with a silently empty list", () => {
    const h = harness();
    const code = runProposalList({ argv: argv({ rest: ["--status", "stale"], verb: "list" }), deps: h.deps });
    expect(code).toBe(EXIT_USAGE);
    expect(h.err[0]).toContain('"stale" is not a register status');
  });
});
