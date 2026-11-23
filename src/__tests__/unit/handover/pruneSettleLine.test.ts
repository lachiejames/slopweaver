/**
 * The settle line a prune verdict offers is a shell paste, so a witness carrying `$` or a backtick must stay
 * inert — the defect `pruneSettleLine` exists to keep closed.
 */
import { describe, expect, it } from "vitest";

import { pruneSettleLine } from "../../../handover/pruneSettleLine.js";

describe("pruneSettleLine", () => {
  it("answers by default and leaves a simple witness unquoted", () => {
    expect(pruneSettleLine({ slug: "a-row", summary: "shipped" })).toBe(
      "slopweaver handover settle a-row --as answered --witness shipped",
    );
  });

  it("carries the settlement a verdict names", () => {
    expect(pruneSettleLine({ settlement: "filed", slug: "talk-a00000630000", summary: "the-cut-row" })).toBe(
      "slopweaver handover settle talk-a00000630000 --as filed --witness the-cut-row",
    );
  });

  it("single-quotes a witness whose $ and backtick a shell would expand", () => {
    expect(pruneSettleLine({ slug: "a-row", summary: "ran `yarn lint` for $HOME" })).toBe(
      "slopweaver handover settle a-row --as answered --witness 'ran `yarn lint` for $HOME'",
    );
  });
});
