/**
 * What a projection removed becomes counts and field names a coverage reader is told — never the removed values,
 * and never a secret drop's full pointer, while a depth-bound truncation keeps its whole pointer as a defect handle.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDroppedField } from "../../../../atlas/kit/projection.js";
import { summariseWithholding, withholdingIsTruncated, withholdingSentence } from "../../../../atlas/kit/withheld.js";

const DROPPED: readonly AtlasDroppedField[] = [
  { pointer: "/0/credentials/privateKey", reason: "secret-material" },
  { pointer: "/1/credentials/privateKey", reason: "secret-material" },
  { pointer: "/1/webhook/signingSecret", reason: "secret-material" },
  { pointer: "/0/session/csrfToken", reason: "ephemeral-token" },
  { pointer: "/2/a/b/c/d", reason: "depth-limit" },
  { pointer: "/0/a/b/c/d", reason: "depth-limit" },
];

describe("summariseWithholding", () => {
  it("counts each reason, names distinct secret FIELDS sorted, and keeps depth-limit pointers whole and sorted", () => {
    expect(summariseWithholding({ dropped: DROPPED })).toEqual({
      ephemeralPositions: 1,
      secretFields: ["privateKey", "signingSecret"],
      secretPositions: 3,
      truncatedAt: ["/0/a/b/c/d", "/2/a/b/c/d"],
    });
  });

  it("names a field whose own name contains / or ~ as written, decoding the pointer's escaped last token", () => {
    const summary = summariseWithholding({
      dropped: [
        { pointer: "/0/headers/x-api~1key", reason: "secret-material" },
        { pointer: "/0/~0secret", reason: "secret-material" },
        { pointer: "/0/literal~01", reason: "secret-material" },
      ],
    });

    expect(summary.secretFields).toEqual(["literal~1", "x-api/key", "~secret"]);
  });

  it("summarises no drops as all zeroes", () => {
    expect(summariseWithholding({ dropped: [] })).toEqual({
      ephemeralPositions: 0,
      secretFields: [],
      secretPositions: 0,
      truncatedAt: [],
    });
  });
});

describe("withholdingIsTruncated", () => {
  it("is true when the walk hit its depth bound", () => {
    expect(withholdingIsTruncated({ withholding: summariseWithholding({ dropped: DROPPED }) })).toBe(true);
  });

  it("is false for designed removals only", () => {
    const designed = DROPPED.filter((drop) => drop.reason !== "depth-limit");

    expect(withholdingIsTruncated({ withholding: summariseWithholding({ dropped: designed }) })).toBe(false);
  });
});

describe("withholdingSentence", () => {
  it("states each part, in order, joined by semicolons", () => {
    expect(withholdingSentence({ withholding: summariseWithholding({ dropped: DROPPED }) })).toBe(
      "withheld 3 secret-material position(s) at the boundary, across the field(s) privateKey, signingSecret; " +
        "dropped 1 ephemeral request-scoped handle(s); " +
        "TRUNCATED 2 document position(s) at the depth bound — this is a defect signal, not a policy: /0/a/b/c/d, /2/a/b/c/d",
    );
  });

  it("states only the parts that are present", () => {
    const ephemeralOnly = DROPPED.filter((drop) => drop.reason === "ephemeral-token");

    expect(withholdingSentence({ withholding: summariseWithholding({ dropped: ephemeralOnly }) })).toBe(
      "dropped 1 ephemeral request-scoped handle(s)",
    );
  });

  it("names a secret drop by its field alone, never by the pointer that could identify the record", () => {
    const secretOnly = DROPPED.filter((drop) => drop.reason === "secret-material");

    expect(withholdingSentence({ withholding: summariseWithholding({ dropped: secretOnly }) })).toBe(
      "withheld 3 secret-material position(s) at the boundary, across the field(s) privateKey, signingSecret",
    );
  });

  it("is the empty string when nothing was removed", () => {
    expect(withholdingSentence({ withholding: summariseWithholding({ dropped: [] }) })).toBe("");
  });
});
