/*
 * A sync run panel's chip and lead: a known state chips as itself, a failed one leads with the fixed sentence, and a
 * state the panel has no words for is never printed above the fold.
 */
import { describe, expect, it } from "vitest";

import { syncRunLeadOf } from "../../lib/syncRunLead";

describe("syncRunLeadOf", () => {
  it("chips a known state as itself, leads a failed run with the fixed sentence and any other with the verb's own", () => {
    expect([
      syncRunLeadOf({ errors: ["GET /x: 503"], state: "failed", why: "failed: GET /x: 503" }),
      syncRunLeadOf({ errors: [], state: "finished", why: "Finished, with 12 new rows." }),
    ]).toEqual([
      { chip: "failed", lead: "This run failed.", raw: undefined },
      { chip: "finished", lead: "Finished, with 12 new rows.", raw: undefined },
    ]);
  });

  it("never prints a state it has no words for, or the sentence beside it: both fold under a plain lead", () => {
    const why = "SyntaxError: Unexpected token '<' in JSON at position 0";

    expect(syncRunLeadOf({ errors: [], state: "failed-provider-auth", why })).toEqual({
      chip: "unknown",
      lead: "In a state this page does not know yet.",
      raw: `Its recorded state: failed-provider-auth\n${why}`,
    });
  });
});
