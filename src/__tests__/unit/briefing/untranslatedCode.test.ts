/*
 * A card's heading says what a thing is before it names its code (the owner, reading the
 * Vanta evidence card: "Network segregation two point one and three. What do those numbers mean?").
 */
import { describe, expect, it } from "vitest";

import { untranslatedCodeReason, untranslatedCodes } from "../../../briefing/untranslatedCode.js";

describe("untranslatedCodes", () => {
  it("finds the section numbers the owner could not place, word for word off the card", () => {
    expect(untranslatedCodes({ text: "Network segregation 2.1 and 3" })).toEqual([
      { code: "2.1 and 3", kind: "a section-number list" },
    ]);
  });

  it("finds the three control codes the Vanta drafts headline led with", () => {
    const text = "Read the CTRL-101, CTRL-102 and CTRL-103 evidence drafts in acme/acme-admin#101";
    expect(untranslatedCodes({ text }).map(({ code }) => code)).toEqual(["CTRL-101", "CTRL-102", "CTRL-103"]);
  });

  it.each([
    ["an ISO clause", "Close the A.8.22 gap?", "A.8.22"],
    ["a draft id", "Send sd-489d1ec2 as drafted?", "sd-489d1ec2"],
    ["a review pass id", "r3-07 has failed 11 rounds", "r3-07"],
    ["a hex id", "main is at a254f341, so land it?", "a254f341"],
    ["a voice turn or relay id", "From talk-063cca0c432f, recut it?", "talk-063cca0c432f"],
    ["a team key", "INC-33: share the write-up?", "INC-33"],
  ])("finds %s", (kind, text, code) => {
    expect(untranslatedCodes({ text })).toEqual([{ code, kind }]);
  });

  it("passes a code in parentheses after its meaning — the reference, not the words", () => {
    expect(
      untranslatedCodes({
        text: "Segregation of networks (NET-93) and the network-separation sections (2.1 and 3) say what you want?",
      }),
    ).toEqual([]);
  });

  it("passes a code inside brackets, nested parentheses, or a web address", () => {
    const text =
      "Review [acme-admin#18326](https://linear.app/acme/issue/JJJJ-1071/doc) for Platform (it tracks (JJJJ-1071))?";
    expect(untranslatedCodes({ text })).toEqual([]);
  });

  it("reads decimals, plain numbers, dates and words as words", () => {
    const text = "Confirmed 2.4 days ago, 18158 lines on 2026-10-05 across acme-admin and policy-mirror-dogfood";
    expect(untranslatedCodes({ text })).toEqual([]);
  });

  it("claims a draft id once, never again as the hex run inside it", () => {
    expect(untranslatedCodes({ text: "Send sd-4a1d9e2b?" })).toEqual([{ code: "sd-4a1d9e2b", kind: "a draft id" }]);
  });

  it("reads a three-part public id as no team key — the Vanta finding the owner endorsed", () => {
    const text = "Should the fleet switch the Vanta finding for CVE-2026-47429 back on, against RRRR-589?";
    expect(untranslatedCodes({ text })).toEqual([{ code: "RRRR-589", kind: "a team key" }]);
  });

  it("names a repeated code once", () => {
    expect(untranslatedCodes({ text: "NET-93 or NET-93?" })).toEqual([{ code: "NET-93", kind: "a team key" }]);
  });
});

describe("untranslatedCodeReason", () => {
  it("names each code with its family and shows the shape that passes", () => {
    const reason = untranslatedCodeReason({
      codes: [
        { code: "NET-93", kind: "a team key" },
        { code: "2.1 and 3", kind: "a section-number list" },
      ],
    });
    expect([
      reason.startsWith(
        'it names "NET-93" (a team key), "2.1 and 3" (a section-number list) before saying what they are',
      ),
      reason.includes('"Segregation of networks (NET-93)"'),
    ]).toEqual([true, true]);
  });
});
