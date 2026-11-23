/*
 * The shared tail every seat-side `hand post` composer runs: a step no posting rule refuses comes back as its argv
 * and one pasteable line; a step a rule refuses never reaches a line at all.
 */
import { describe, expect, it } from "vitest";

import { checkedPostLine } from "../../../hand/checkedPost.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const DRAFT = {
  context: "work" as const,
  id: "mid-state-runner-outage-access",
  postedBy: "hand surface",
  postedIso: "1970-01-01T00:00:00.000Z",
  row: "runner-outage-access",
  unblocks: "board row runner-outage: every merge to main by now",
  url: "http://localhost:4321/queue?context=work#ask:runner-outage-access",
  what: "Ask Rosa for read on the runner settings, so the jobs can rerun",
  witness: "slopweaver hand done mid-state-runner-outage-access --did answered-on-queue",
};

describe("checkedPostLine", () => {
  it("returns the argv untouched and its shell-quoted line when every rule admits the step", () => {
    const argv = ["slopweaver", "hand", "post", "--what", "Ask Rosa for read on the runner settings"];
    expect(unwrap(checkedPostLine({ argv, draft: DRAFT }))).toEqual({
      argv,
      line: "slopweaver hand post --what 'Ask Rosa for read on the runner settings'",
    });
  });

  it("refuses a step that names the fleet as the actor, before any line is printed", () => {
    const refused = unwrapErr(
      checkedPostLine({ argv: ["slopweaver"], draft: { ...DRAFT, what: "The session will rerun the jobs" } }),
    );
    expect(refused.code).toBe("FLEET_CAN_DO_IT");
  });
});
