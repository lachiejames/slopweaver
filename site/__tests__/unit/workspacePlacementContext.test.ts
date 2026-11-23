/*
 * The context half of workspace placement: which view draws a placement, what each view counts, where a link
 * switches to, and the words a finding wears. Split from the `./workspacePlacement/` tests by describe block, when the
 * one default rule replaced "a finding is shown in both".
 */
import { describe, expect, it } from "vitest";

import { placementFoldKey } from "../../lib/registerPlacement";
import type { WorkspacePlacement } from "../../lib/workspacePlacement";
import {
  contextTally,
  contextToOpen,
  findingLabel,
  findingsLine,
  shownInContext,
} from "../../lib/workspacePlacementContext";

describe("the filter, the tally, the link and the finding's words", () => {
  const ACME: WorkspacePlacement = {
    by: [{ source: "stated", value: "team", workspace: "team" }],
    kind: "placed",
    workspace: "team",
  };
  const UNPLACED: WorkspacePlacement = { kind: "unplaced", why: "nothing names one" };
  const CONFLICT: WorkspacePlacement = {
    evidence: [
      { source: "stated", value: "self", workspace: "self" },
      { source: "repository", value: "acme/acme-admin", workspace: "team" },
    ],
    kind: "conflict",
  };

  it("shows a placed row in its own workspace only, and a finding in self alone", () => {
    expect(shownInContext({ context: "work", placement: ACME })).toBe(true);
    expect(shownInContext({ context: "slopweaver", placement: ACME })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: UNPLACED })).toBe(true);
    expect(shownInContext({ context: "work", placement: UNPLACED })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: CONFLICT })).toBe(true);
    expect(shownInContext({ context: "work", placement: CONFLICT })).toBe(false);
  });

  it("tallies here, other, unplaced and conflict — findings as part of self's here — and zeros for no rows", () => {
    const placements = [ACME, UNPLACED, CONFLICT, UNPLACED];
    expect(contextTally({ context: "slopweaver", placements })).toEqual({
      conflict: 1,
      here: 3,
      other: 1,
      unplaced: 2,
    });
    expect(contextTally({ context: "work", placements })).toEqual({ conflict: 0, here: 1, other: 3, unplaced: 0 });
    expect(contextTally({ context: "work", placements: [] })).toEqual({ conflict: 0, here: 0, other: 0, unplaced: 0 });
  });

  it("switches a deep link to the context that draws the row, a finding's being self", () => {
    expect(contextToOpen({ context: "slopweaver", placement: ACME })).toBe("work");
    expect(contextToOpen({ context: "work", placement: ACME })).toBeUndefined();
    expect(contextToOpen({ context: "work", placement: UNPLACED })).toBe("slopweaver");
    expect(contextToOpen({ context: "slopweaver", placement: CONFLICT })).toBeUndefined();
  });

  it("labels each finding with what it rests on and the default that placed it, and a placed row with nothing", () => {
    expect(findingLabel({ placement: UNPLACED })).toEqual({
      label: "placed by default: no workspace",
      title: "placed in self by default: no field names a workspace: nothing names one",
    });
    expect(findingLabel({ placement: CONFLICT })).toEqual({
      label: "placed by default: workspace conflict",
      title:
        "placed in self by default: its fields name both workspaces: stated self → self; repository acme/acme-admin → team",
    });
    expect(findingLabel({ placement: ACME })).toBeUndefined();
  });

  it("says the page's findings in one line, singular and plural", () => {
    expect(findingsLine({ conflict: 1, unplaced: 2 })).toBe(
      "2 rows name no workspace; 1 row has fields naming both workspaces (placed here by default, each a finding)",
    );
    expect(findingsLine({ conflict: 0, unplaced: 0 })).toBeUndefined();
  });
});

describe("placementFoldKey", () => {
  const placed = { by: [], kind: "placed", workspace: "team" } as const;
  const overruled = [{ source: "repository", value: "octo-self/slopweaver", workspace: "self" }] as const;

  it("keys a plain placement by its workspace and a finding by its kind", () => {
    expect(placementFoldKey({ placement: placed })).toBe("placed:team");
    expect(placementFoldKey({ placement: { kind: "unplaced", why: "nothing" } })).toBe(
      "unplaced · placed in self by default: no field names a workspace: nothing",
    );
  });

  it("keeps a placement stated over a conflict apart from a plain one in the same workspace", () => {
    const marked = placementFoldKey({ placement: { ...placed, overruled } });
    expect(marked).toBe("placed:team · stated team, overruling: repository octo-self/slopweaver → self");
    expect(marked === placementFoldKey({ placement: placed })).toBe(false);
  });
});
