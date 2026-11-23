/*
 * `proposal decide`: a decided event stamped at now or at an explicit `--date`, `--decider` required, and
 * `--outcome` — a rejection kept whole, an outcome that is neither refused, an unreadable `--date` refused, and
 * `--json` honoured.
 */
import { describe, expect, it } from "vitest";

import { runProposalDecide } from "../../../../../../cli/commands/proposal/registerRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { loadRegisterEntry } from "../../../../../../outbound/proposal/register/store.js";
import { argv, harness, NOW, seedRegistered, tempHome, useRegisterHomes } from "./harness.js";

useRegisterHomes();

describe("runProposalDecide", () => {
  it("appends a decided event and sets status to decided", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalDecide({
      argv: argv({
        rest: ["a-slug", "--decision", "ship it", "--decider", "the owner", "--why", "aligned", "--home", home],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!;
    expect(entry.status).toBe("decided");
    expect(entry.decision!.text).toBe("ship it");
    expect(entry.decision!.decidedIso).toBe(NOW.toISOString());
  });

  it("uses an explicit --date over now when given", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalDecide({
      argv: argv({
        rest: [
          "a-slug",
          "--decision",
          "ship it",
          "--decider",
          "the owner",
          "--why",
          "aligned",
          "--date",
          "2026-07-01T00:00:00.000Z",
          "--home",
          home,
        ],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!.decision!.decidedIso).toBe("2026-07-01T00:00:00.000Z");
  });

  it("refuses without --decider", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalDecide({
      argv: argv({ rest: ["a-slug", "--decision", "x", "--why", "y", "--home", home], verb: "decide" }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
  });
});

describe("runProposalDecide --outcome", () => {
  it("a rejection sets status to rejected and keeps the whole decision record", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    const code = runProposalDecide({
      argv: argv({
        rest: [
          "a-slug",
          "--decision",
          "not this quarter",
          "--decider",
          "the team",
          "--outcome",
          "rejected",
          "--why",
          "no capacity",
          "--home",
          home,
        ],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(h.out).toEqual(["a-slug → rejected: not this quarter"]);
    const entry = unwrap(loadRegisterEntry({ home, slug: "a-slug" }))!;
    expect(entry.status).toBe("rejected");
    expect(entry.decision!.outcome).toBe("rejected");
  });

  it("refuses an outcome that is neither approved nor rejected", () => {
    const h = harness();
    const code = runProposalDecide({
      argv: argv({
        rest: ["a-slug", "--decision", "d", "--decider", "o", "--outcome", "maybe", "--why", "w"],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.err).toEqual(['"maybe" is not a decision outcome — it is approved or rejected']);
  });

  it("refuses a --date that is not a readable ISO timestamp", () => {
    const h = harness();
    const code = runProposalDecide({
      argv: argv({
        rest: ["a-slug", "--decision", "d", "--decider", "o", "--why", "w", "--date", "last tuesday"],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(h.err).toEqual(['--date "last tuesday" is not a readable ISO-8601 timestamp']);
  });

  it("honours --json rather than printing a sentence the help never promised", () => {
    const home = tempHome();
    seedRegistered({ home, slug: "a-slug" });
    const h = harness();
    runProposalDecide({
      argv: argv({
        rest: ["a-slug", "--decision", "ship it", "--decider", "the owner", "--why", "w", "--json", "--home", home],
        verb: "decide",
      }),
      deps: h.deps,
    });
    expect(JSON.parse(h.out[0]!)).toEqual({
      decidedIso: "2026-08-22T02:00:00.000Z",
      decider: "the owner",
      decision: "ship it",
      outcome: "approved",
      slug: "a-slug",
    });
  });
});
