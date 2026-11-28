/*
 * `landedProofOf` — carrying a stored C3 form's explainer, its two proof slots and its checks, never a grade (a
 * description publishes none), and telling an absent form from one that no longer decodes.
 */
import { describe, expect, it } from "vitest";

import { landedProofOf } from "../../../../fleet/landed.js";
import { FEATURE_BODY, FIX_BODY, formOf, QUOTE_BODY } from "../../outbound/github/fixtures.js";

describe("landedProofOf", () => {
  it("carries the explainer, both screenshots and every check, with no grade", () => {
    const proof = landedProofOf({ form: { form: formOf({ body: FIX_BODY }), kind: "decoded" } });
    expect(proof).toEqual({
      after: {
        evidence: "On this branch, start refuses and names the setting. [image: store start refusing on this branch]",
        where: "a screenshot the agent ran",
      },
      before: {
        evidence:
          "On main, start goes through with the store open to the network. [image: store start going through on main]",
        where: "a screenshot the agent ran",
      },
      claims: [
        { claim: "The moved check's own tests were not touched, and still pass.", detail: "", verdict: "proven" },
      ],
      kind: "recorded",
      problem: "The local store was left open to the network. This makes start refuse in that case.",
    });
  });

  it("reads a reason slot as no screenshot, and a not-checked item as a gap", () => {
    const proof = landedProofOf({ form: { form: formOf({ body: FEATURE_BODY }), kind: "decoded" } });
    expect(proof).toEqual({
      after: {
        evidence: "Straight after a sign-in, the expiry is saved 7 days out. [image: saved expiry seven days out]",
        where: "a screenshot the agent ran",
      },
      before: { evidence: "Not captured yet: the 7-day expiry has to pass first.", where: "no screenshot" },
      claims: [
        { claim: "A garbled expiry is refused, not ignored.", detail: "", verdict: "proven" },
        { claim: "A sign-in saved before still reads.", detail: "", verdict: "proven" },
        {
          claim: "The 48-hour warning on a real sign-in",
          detail: "Tests cover it, and a third capture on day 5 adds little.",
          verdict: "gap",
        },
      ],
      kind: "recorded",
      problem:
        "The provider expires sign-ins after 7 days for an app in testing mode. This saves the expiry and warns 48 hours before.",
    });
  });

  it("reads a quote slot as what it proves and its source, never the quoted output itself", () => {
    const proof = landedProofOf({ form: { form: formOf({ body: QUOTE_BODY }), kind: "decoded" } });
    expect(proof).toEqual({
      after: {
        evidence: "On this branch, the same check prints every job green. widgets checks --all",
        where: "output the owner quoted",
      },
      before: {
        evidence: "On main, the build job fails because one required job did not succeed. the build job's log",
        where: "output the agent quoted",
      },
      claims: [
        { claim: "The moved check's own tests were not touched, and still pass.", detail: "", verdict: "proven" },
      ],
      kind: "recorded",
      problem: "The local store was left open to the network. This makes start refuse in that case.",
    });
  });

  it("tells an absent form from one that no longer decodes", () => {
    expect(landedProofOf({ form: { kind: "absent" } }).kind).toBe("unrecorded");
    expect(landedProofOf({ form: { kind: "undecodable", why: "bad at checks.0" } })).toEqual({
      kind: "unrecorded",
      why: "the stored description no longer reads: bad at checks.0",
    });
  });
});
