import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { DM_PURPOSES, isOwnerDm, ownerDmPurposeRefusal, parseDmPurpose } from "../../../../outbound/slack/dmPurpose.js";

const OWNER = { ownerUserId: "U0OWNER", promptChannel: "D0PROMPT" };

describe("parseDmPurpose", () => {
  it("reads each of the three purposes the rule names", () => {
    expect(DM_PURPOSES.map((value) => unwrap(parseDmPurpose({ value })))).toEqual([
      "investigation-finding",
      "dogfood-case",
      "asked-for",
    ]);
  });

  it("refuses a fourth purpose by naming the whole list", () => {
    const parsed = parseDmPurpose({ value: "blocked-on-you" });

    expect(unwrapErr(parsed)).toContain("investigation-finding, dogfood-case, asked-for");
    expect(unwrapErr(parsed)).toContain('got "blocked-on-you"');
  });
});

describe("isOwnerDm", () => {
  it("matches either configured spelling of the owner's DM exactly", () => {
    expect(isOwnerDm({ channel: "U0OWNER", ...OWNER })).toBe(true);
    expect(isOwnerDm({ channel: "D0PROMPT", ...OWNER })).toBe(true);
  });

  it("compares with surrounding whitespace trimmed, on both sides, and resolves nothing else", () => {
    expect(isOwnerDm({ channel: " U0OWNER ", ...OWNER })).toBe(true);
    expect(isOwnerDm({ channel: "D0PROMPT", ownerUserId: undefined, promptChannel: " D0PROMPT\n" })).toBe(true);
    expect(isOwnerDm({ channel: "D0SYNOTHERDM", ...OWNER })).toBe(false);
  });

  it("is false for another conversation, and for an install that configured neither", () => {
    expect(isOwnerDm({ channel: "C0TEAM", ...OWNER })).toBe(false);
    expect(isOwnerDm({ channel: "U0OWNER", ownerUserId: undefined, promptChannel: undefined })).toBe(false);
  });
});

describe("ownerDmPurposeRefusal", () => {
  it("holds a purposeless post to the owner's DM and says there is no hatch", () => {
    const lines = ownerDmPurposeRefusal({ channel: "U0OWNER", dmPurpose: undefined, ...OWNER });

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("declares no --dm-purpose");
    expect(lines[2]).toContain("deliberately NO escape hatch");
  });

  it("holds a purposeless post to the prompt conversation the same way", () => {
    expect(ownerDmPurposeRefusal({ channel: "D0PROMPT", dmPurpose: undefined, ...OWNER }).length).toBe(3);
  });

  it("lets a post to the owner's DM through once it declares a purpose", () => {
    expect(ownerDmPurposeRefusal({ channel: "U0OWNER", dmPurpose: "dogfood-case", ...OWNER })).toEqual([]);
  });

  it("never asks anything of a post aimed somewhere else", () => {
    expect(ownerDmPurposeRefusal({ channel: "C0TEAM", dmPurpose: undefined, ...OWNER })).toEqual([]);
  });
});
