import { describe, expect, it } from "vitest";

import { linkPathFragments } from "../../../../review/slackEvidenceScan.js";
import { messageKeyOfSourceId, prKeyOf } from "../../../../review/slackEvidenceTypes.js";
import { REF } from "./harness.js";

describe("prKeyOf and linkPathFragments", () => {
  it("keys a pull request by owner, repo and number", () => {
    expect(prKeyOf({ ref: REF })).toBe("owner/repo#16349");
  });

  it("offers both link path spellings, deduped across pull requests in one repository", () => {
    expect(linkPathFragments({ refs: [REF, { ...REF, number: 1 }] })).toEqual([
      "owner/repo/pull/",
      "owner/repo/issues/",
    ]);
  });
});

describe("messageKeyOfSourceId", () => {
  it("reads a top-level message's own instant", () => {
    expect(messageKeyOfSourceId({ sourceId: "C1:1788832836.453699" })).toBe("C1:1788832836.453699");
  });

  it("reads a REPLY's own instant, not the thread root it names second", () => {
    expect(messageKeyOfSourceId({ sourceId: "C1:1788735639.410069:reply:1788744597.770309" })).toBe(
      "C1:1788744597.770309",
    );
  });

  it("reads a PINNED message's instant, so it merges with the live copy of the same message", () => {
    expect(messageKeyOfSourceId({ sourceId: "C1:pin:1788832836.453699" })).toBe("C1:1788832836.453699");
  });

  it("leaves a FILE alone, because it is a different object rather than another spelling of one message", () => {
    expect(messageKeyOfSourceId({ sourceId: "C1:1788832836.453699:file:F123" })).toBe("C1:1788832836.453699:file:F123");
  });

  it("leaves a canvas alone, which names no channel at all", () => {
    expect(messageKeyOfSourceId({ sourceId: "canvas:F999" })).toBe("canvas:F999");
  });
});
