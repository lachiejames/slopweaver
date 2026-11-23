/**
 * The pure half of qualifying an act's bare GitHub references: one field's rewrite, an act's prose with the
 * briefing's own check as the authority, and the context an act's own links supply.
 */
import { describe, expect, it } from "vitest";

import { buildAutonomyAction } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { actOwnContext, qualifyActProse, qualifyGithubRefs } from "../../../briefing/qualifyActRefs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const WIDGETS = { owner: "acme", repo: "widgets" };
const GADGETS = { owner: "acme", repo: "gadgets" };

/** One act with the prose under test. */
function act({ why, said }: { why: string; said?: string }): AutonomyActionRow {
  return unwrap(
    buildAutonomyAction({
      actionId: "finding-pr.watchpr-dies",
      bySession: "session-40",
      doneIso: "2026-11-02T10:23:48.664Z",
      kind: "open-internal-finding-pull-request",
      run: "watchpr-dies",
      said,
      steer: undefined,
      subject: "watchpr-dies",
      why,
      witness: "open a pull request on main: finding gate",
    }),
  );
}

describe("qualifyGithubRefs", () => {
  it("writes each bare reference the one named repository resolves as owner/repo#N, last first", () => {
    expect(
      qualifyGithubRefs({ context: { repos: [WIDGETS] }, text: "#12 and #13 both lagged; acme/widgets#14 did not" }),
    ).toEqual({
      rewrites: [
        { from: "#12", to: "acme/widgets#12" },
        { from: "#13", to: "acme/widgets#13" },
      ],
      text: "acme/widgets#12 and acme/widgets#13 both lagged; acme/widgets#14 did not",
    });
  });

  it("leaves a bare reference byte for byte when two repositories make it ambiguous", () => {
    expect(qualifyGithubRefs({ context: { repos: [WIDGETS, GADGETS] }, text: "see #12" })).toEqual({
      rewrites: [],
      text: "see #12",
    });
  });

  it("leaves prose with no reference untouched", () => {
    expect(qualifyGithubRefs({ context: { repos: [WIDGETS] }, text: "" })).toEqual({ rewrites: [], text: "" });
  });
});

describe("qualifyActProse", () => {
  it("qualifies why and said, naming each changed field's original", () => {
    const qualified = unwrap(
      qualifyActProse({ action: act({ said: "see #13", why: "#12 lagged" }), context: { repos: [WIDGETS] } }),
    );

    expect(qualified.action.why).toBe("acme/widgets#12 lagged");
    expect(qualified.action.said).toBe("see acme/widgets#13");
    expect(qualified.changed).toEqual([
      { field: "why", original: "#12 lagged" },
      { field: "said", original: "see #13" },
    ]);
  });

  it("reports no change for prose already whole", () => {
    const whole = act({ why: "acme/widgets#12 lagged" });

    expect(unwrap(qualifyActProse({ action: whole, context: { repos: [WIDGETS] } }))).toEqual({
      action: whole,
      changed: [],
    });
  });

  it("refuses BARE_REFERENCE naming the residue when the context cannot resolve it", () => {
    const refused = unwrapErr(
      qualifyActProse({ action: act({ why: "#12 lagged" }), context: { repos: [WIDGETS, GADGETS] } }),
    );

    expect(refused.code).toBe("BARE_REFERENCE");
    expect(refused.message).toContain("#12");
  });
});

describe("actOwnContext", () => {
  it("resolves a bare number against the one repository the act's own prose links", () => {
    const own = act({ why: "acme/widgets#2914 merged; #2913 lagged" });

    expect(qualifyGithubRefs({ context: actOwnContext({ action: own }), text: own.why }).text).toBe(
      "acme/widgets#2914 merged; acme/widgets#2913 lagged",
    );
  });

  it("names no repository for an act that links none, so nothing is guessed", () => {
    expect(actOwnContext({ action: act({ why: "#2913 lagged" }) }).repos).toEqual([]);
  });
});
