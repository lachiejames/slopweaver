import { describe, expect, it } from "vitest";

import {
  summariseJumpcloudWithholding,
  withholdingIsTruncated,
  withholdingSentence,
} from "../../../../atlas/jumpcloud/withheld.js";
import type { AtlasDroppedField } from "../../../../atlas/kit/projection.js";

/** The shape a real applications sync produces: one denied field, once per record. */
const APPLICATION_DROPS: readonly AtlasDroppedField[] = [
  { pointer: "/0/idpPrivateKey", reason: "secret-material" },
  { pointer: "/1/idpPrivateKey", reason: "secret-material" },
  { pointer: "/2/idpPrivateKey", reason: "secret-material" },
];

describe("summariseJumpcloudWithholding", () => {
  it("counts positions and names the field once, however many records carried it", () => {
    const withholding = summariseJumpcloudWithholding({ dropped: APPLICATION_DROPS });
    expect(withholding.secretPositions).toBe(3);
    expect(withholding.secretFields).toStrictEqual(["idpPrivateKey"]);
  });

  it("keeps ephemeral handles out of the secret count, so the secret number says what it protects", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [
        { pointer: "/apiKey", reason: "secret-material" },
        { pointer: "/continuationToken", reason: "ephemeral-token" },
        { pointer: "/nextPageToken", reason: "ephemeral-token" },
      ],
    });
    expect(withholding.secretPositions).toBe(1);
    expect(withholding.ephemeralPositions).toBe(2);
    expect(withholding.secretFields).toStrictEqual(["apiKey"]);
  });

  it("sorts field names, so a review diff shows an addition in place", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [
        { pointer: "/0/sharedSecret", reason: "secret-material" },
        { pointer: "/0/apiKey", reason: "secret-material" },
      ],
    });
    expect(withholding.secretFields).toStrictEqual(["apiKey", "sharedSecret"]);
  });

  it("keeps a depth-limit pointer whole, because it is a defect handle rather than a disclosure", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [{ pointer: "/graph/0/compiledAttributes", reason: "depth-limit" }],
    });
    expect(withholding.truncatedAt).toStrictEqual(["/graph/0/compiledAttributes"]);
    expect(withholding.secretPositions).toBe(0);
  });

  it("reports nothing withheld for a family that carried no denied field", () => {
    const withholding = summariseJumpcloudWithholding({ dropped: [] });
    expect(withholding.secretPositions).toBe(0);
    expect(withholding.ephemeralPositions).toBe(0);
    expect(withholding.secretFields).toStrictEqual([]);
    expect(withholding.truncatedAt).toStrictEqual([]);
  });
});

describe("withholdingIsTruncated", () => {
  it("is false for a family whose every removal was a designed one", () => {
    const withholding = summariseJumpcloudWithholding({ dropped: APPLICATION_DROPS });
    expect(withholdingIsTruncated({ withholding })).toBe(false);
  });

  it("is true as soon as one document was cut short", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [...APPLICATION_DROPS, { pointer: "/9/nested", reason: "depth-limit" }],
    });
    expect(withholdingIsTruncated({ withholding })).toBe(true);
  });
});

describe("withholdingSentence", () => {
  it("names the field and the position count", () => {
    const withholding = summariseJumpcloudWithholding({ dropped: APPLICATION_DROPS });
    expect(withholdingSentence({ withholding })).toBe(
      "withheld 3 secret-material position(s) at the boundary, across the field(s) idpPrivateKey",
    );
  });

  it("is empty when nothing was removed, so a cell does not carry an empty clause", () => {
    expect(withholdingSentence({ withholding: summariseJumpcloudWithholding({ dropped: [] }) })).toBe("");
  });

  it("says a truncation is a defect signal rather than listing it beside the policy drops", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [{ pointer: "/deep/nested", reason: "depth-limit" }],
    });
    expect(withholdingSentence({ withholding })).toBe(
      "TRUNCATED 1 document position(s) at the depth bound — this is a defect signal, not a policy: /deep/nested",
    );
  });

  it("carries no removed value, only the field name and where", () => {
    const withholding = summariseJumpcloudWithholding({
      dropped: [{ pointer: "/0/apiKey", reason: "secret-material" }],
    });
    expect(withholdingSentence({ withholding }).includes("/0/")).toBe(false);
  });
});
