import { describe, expect, it } from "vitest";

import {
  buildVantaDraftEditPlan,
  checkEditableDraft,
  DRAFT_SAVE_CONTROL,
  editorIsAmbiguous,
  invertVantaDraftEditPlan,
  occurrencesOf,
  renderVantaDraftDiff,
  VantaDraftErrors,
  type VantaDraftSnapshot,
  vantaDraftEditDigest,
} from "../../../../atlas/vanta/policyDraft.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const snapshot = (over: Partial<VantaDraftSnapshot> = {}): VantaDraftSnapshot => ({
  controls: [DRAFT_SAVE_CONTROL, "Assign approver and submit"],
  finalUrl: "https://app.vanta.com/c/acme/policies/p-1/edit?language=EN",
  observedAtIso: "2026-09-12T03:40:00.000Z",
  regionCount: 1,
  regionTextLengths: [4000],
  text: "Alpha beta gamma.\nDelta epsilon zeta.\n",
  title: "Policy Editor: Alpha - Vanta",
  ...over,
});

describe("occurrencesOf", () => {
  it("counts every non-overlapping occurrence", () => {
    expect(occurrencesOf({ find: "ab", text: "abcabcab" })).toBe(3);
  });

  it("counts none when the run is absent", () => {
    expect(occurrencesOf({ find: "zz", text: "abcabcab" })).toBe(0);
  });

  it("counts none for an empty run rather than matching everywhere", () => {
    expect(occurrencesOf({ find: "", text: "abc" })).toBe(0);
  });

  it("does not double-count an overlapping run", () => {
    expect(occurrencesOf({ find: "aa", text: "aaaa" })).toBe(2);
  });
});

describe("editorIsAmbiguous", () => {
  // MEASURED on the live editor: editable regions beyond the draft's own, because the rich-text editor marks its
  // own blocks editable and the Vanta Agent's composer is editable too. "Exactly one region" was never the
  // right test; dominance is.
  it("accepts a single region", () => {
    expect(editorIsAmbiguous({ lengths: [4000] })).toBe(false);
  });

  it("accepts a container that dwarfs its own blocks", () => {
    expect(editorIsAmbiguous({ lengths: [4000, 300, 120, 40] })).toBe(false);
  });

  it("refuses two regions of comparable size", () => {
    expect(editorIsAmbiguous({ lengths: [4000, 3900] })).toBe(true);
  });

  it("refuses a page with no editable region at all", () => {
    expect(editorIsAmbiguous({ lengths: [] })).toBe(true);
  });

  it("refuses a page whose only editable region is empty", () => {
    expect(editorIsAmbiguous({ lengths: [0] })).toBe(true);
  });
});

describe("checkEditableDraft", () => {
  it("accepts a draft whose page shows the save control", () => {
    expect(unwrap(checkEditableDraft({ snapshot: snapshot() })).title).toBe("Policy Editor: Alpha - Vanta");
  });

  it("refuses an ambiguous editor and reports the lengths it saw", () => {
    const error = unwrapErr(
      checkEditableDraft({ snapshot: snapshot({ regionCount: 2, regionTextLengths: [900, 880] }) }),
    );
    expect(error.code).toBe("EDITOR_AMBIGUOUS");
    expect(error.message).toContain("900, 880");
  });

  it("refuses a page that does not show the draft's own save control", () => {
    const error = unwrapErr(checkEditableDraft({ snapshot: snapshot({ controls: ["Download"] }) }));
    expect(error.code).toBe("NOT_AN_EDITABLE_DRAFT");
  });
});

describe("buildVantaDraftEditPlan", () => {
  it("resolves a unique substitution and computes the text it would produce", () => {
    const plan = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    expect(plan.expectedText).toBe("Alpha BETA gamma.\nDelta epsilon zeta.\n");
    expect(plan.kind).toBe("vanta-policy-draft-substitution-v1");
    expect(plan.url).toBe("https://app.vanta.com/c/acme/policies/p-1/edit?language=EN");
  });

  it("refuses an empty find rather than matching everywhere", () => {
    expect(unwrapErr(buildVantaDraftEditPlan({ find: "", replace: "x", snapshot: snapshot() })).code).toBe(
      "EMPTY_FIND",
    );
  });

  it("refuses a substitution that changes nothing", () => {
    expect(unwrapErr(buildVantaDraftEditPlan({ find: "beta", replace: "beta", snapshot: snapshot() })).code).toBe(
      "NO_CHANGE",
    );
  });

  it("refuses a find the draft does not contain", () => {
    expect(unwrapErr(buildVantaDraftEditPlan({ find: "omega", replace: "x", snapshot: snapshot() })).code).toBe(
      "FIND_ABSENT",
    );
  });

  it("refuses an ambiguous find and says how many times it occurs", () => {
    const error = unwrapErr(
      buildVantaDraftEditPlan({ find: "a", replace: "x", snapshot: snapshot({ text: "banana" }) }),
    );
    expect(error.code).toBe("FIND_AMBIGUOUS");
    expect(error.message).toContain("3 times");
  });

  it("replaces only the first and only match, leaving every other byte alone", () => {
    const plan = unwrap(
      buildVantaDraftEditPlan({
        find: "the 18 identifiers",
        replace: "the eighteen identifiers",
        snapshot: snapshot({ text: "even though all of the 18 identifiers were removed." }),
      }),
    );
    expect(plan.expectedText).toBe("even though all of the eighteen identifiers were removed.");
  });
});

describe("vantaDraftEditDigest", () => {
  it("is stable for the same substitution against the same draft", () => {
    const plan = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    expect(vantaDraftEditDigest({ plan })).toBe(vantaDraftEditDigest({ plan }));
  });

  it("changes when the replacement changes", () => {
    const one = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    const two = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "Beta", snapshot: snapshot() }));
    expect(vantaDraftEditDigest({ plan: one })).not.toBe(vantaDraftEditDigest({ plan: two }));
  });

  it("changes when the DRAFT moved, so an approval cannot be transplanted onto a changed document", () => {
    const one = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    const two = unwrap(
      buildVantaDraftEditPlan({
        find: "beta",
        replace: "BETA",
        snapshot: snapshot({ text: "Alpha beta gamma.\nDelta epsilon zeta. Eta.\n" }),
      }),
    );
    expect(vantaDraftEditDigest({ plan: one })).not.toBe(vantaDraftEditDigest({ plan: two }));
  });

  it("changes when the policy changes, so an approval cannot be transplanted onto another policy", () => {
    const one = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    const two = unwrap(
      buildVantaDraftEditPlan({
        find: "beta",
        replace: "BETA",
        snapshot: snapshot({ finalUrl: "https://app.vanta.com/c/acme/policies/p-2/edit?language=EN" }),
      }),
    );
    expect(vantaDraftEditDigest({ plan: one })).not.toBe(vantaDraftEditDigest({ plan: two }));
  });
});

describe("invertVantaDraftEditPlan", () => {
  it("round-trips to the original text", () => {
    const forward = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    const applied = snapshot({ text: forward.expectedText });
    const back = unwrap(invertVantaDraftEditPlan({ plan: forward, snapshot: applied }));
    expect(back.expectedText).toBe(snapshot().text);
  });

  it("refuses when the draft no longer holds what the first edit wrote", () => {
    const forward = unwrap(buildVantaDraftEditPlan({ find: "beta", replace: "BETA", snapshot: snapshot() }));
    expect(unwrapErr(invertVantaDraftEditPlan({ plan: forward, snapshot: snapshot() })).code).toBe("FIND_ABSENT");
  });
});

describe("renderVantaDraftDiff", () => {
  it("shows the one line that moved, before and after", () => {
    const plan = unwrap(buildVantaDraftEditPlan({ find: "epsilon", replace: "EPSILON", snapshot: snapshot() }));
    expect(renderVantaDraftDiff({ plan })).toStrictEqual(["- Delta epsilon zeta.", "+ Delta EPSILON zeta."]);
  });

  it("shows a change on the first line without borrowing the line before it", () => {
    const plan = unwrap(buildVantaDraftEditPlan({ find: "Alpha", replace: "ALPHA", snapshot: snapshot() }));
    expect(renderVantaDraftDiff({ plan })).toStrictEqual(["- Alpha beta gamma.", "+ ALPHA beta gamma."]);
  });
});

describe("VantaDraftErrors", () => {
  it("names the run it could not find", () => {
    expect(VantaDraftErrors.findAbsent({ find: "omega" }).message).toContain('"omega"');
  });

  it("carries the controls a non-draft page actually showed", () => {
    const error = VantaDraftErrors.notAnEditableDraft({ controls: ["Download", "Print"] });
    expect(error.code).toBe("NOT_AN_EDITABLE_DRAFT");
  });
});
