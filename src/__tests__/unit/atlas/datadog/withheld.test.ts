import { describe, expect, it } from "vitest";

import {
  summariseDatadogWithholding,
  withholdingIsTruncated,
  withholdingSentence,
} from "../../../../atlas/datadog/withheld.js";

describe("summariseDatadogWithholding", () => {
  it("counts positions and names the distinct fields, sorted", () => {
    const withholding = summariseDatadogWithholding({
      dropped: [
        { pointer: "/a/password", reason: "secret-material" },
        { pointer: "/b/clientSecret", reason: "secret-material" },
        { pointer: "/c/password", reason: "secret-material" },
      ],
    });

    expect(withholding.secretPositions).toBe(3);
    expect(withholding.secretFields).toStrictEqual(["clientSecret", "password"]);
  });

  // Conflating the two would make the secret list look longer than it is and hide what it protects.
  it("keeps ephemeral handles apart from secret material", () => {
    const withholding = summariseDatadogWithholding({
      dropped: [
        { pointer: "/meta/nextPageToken", reason: "ephemeral-token" },
        { pointer: "/a/password", reason: "secret-material" },
      ],
    });

    expect(withholding.ephemeralPositions).toBe(1);
    expect(withholding.secretPositions).toBe(1);
    expect(withholding.secretFields).toStrictEqual(["password"]);
  });

  // A depth-limit pointer is a DEFECT handle rather than a disclosure, which is why it is kept whole while
  // a secret drop keeps only its field name.
  it("keeps a truncation pointer whole, because the position is what makes it findable again", () => {
    const withholding = summariseDatadogWithholding({
      dropped: [{ pointer: "/deep/nest/here", reason: "depth-limit" }],
    });

    expect(withholding.truncatedAt).toStrictEqual(["/deep/nest/here"]);
  });

  it("answers with zeroes and empty lists when nothing was removed", () => {
    expect(summariseDatadogWithholding({ dropped: [] })).toStrictEqual({
      ephemeralPositions: 0,
      secretFields: [],
      secretPositions: 0,
      truncatedAt: [],
    });
  });
});

describe("withholdingIsTruncated", () => {
  it("is true only when the walk gave up on a document", () => {
    const truncated = summariseDatadogWithholding({ dropped: [{ pointer: "/x", reason: "depth-limit" }] });
    const withheld = summariseDatadogWithholding({ dropped: [{ pointer: "/x", reason: "secret-material" }] });

    expect(withholdingIsTruncated({ withholding: truncated })).toBe(true);
    expect(withholdingIsTruncated({ withholding: withheld })).toBe(false);
  });
});

describe("withholdingSentence", () => {
  it("says what was withheld and names the fields, so a reader learns the atlas does not hold them", () => {
    const withholding = summariseDatadogWithholding({
      dropped: [{ pointer: "/a/secretAccessKey", reason: "secret-material" }],
    });

    expect(withholdingSentence({ withholding })).toBe(
      "withheld 1 secret-material position(s) at the boundary, across the field(s) secretAccessKey",
    );
  });

  it("marks a truncation as a defect signal rather than a policy", () => {
    const withholding = summariseDatadogWithholding({ dropped: [{ pointer: "/deep", reason: "depth-limit" }] });

    expect(withholdingSentence({ withholding })).toContain("this is a defect signal, not a policy");
  });

  it("is empty when nothing was removed, so a clean family carries no apology", () => {
    expect(withholdingSentence({ withholding: summariseDatadogWithholding({ dropped: [] }) })).toBe("");
  });
});
