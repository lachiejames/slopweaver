/*
 * `parseTagAssignment` — reading one `key=value` tag write, and each refusal it names: malformed text, an unknown
 * or derived key, and a value its key does not accept. It moved here when `rowTags.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { parseTagAssignment } from "../../../../handover/rowTags.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseTagAssignment", () => {
  it("reads a declared key and an allowed value", () => {
    expect(unwrap(parseTagAssignment({ text: "platform=slack" }))).toEqual({ key: "platform", value: "slack" });
  });

  it("reads a pattern value, splitting only at the first =", () => {
    expect(unwrap(parseTagAssignment({ text: "pr=lachiejames/slopweaver#1410" }))).toEqual({
      key: "pr",
      value: "lachiejames/slopweaver#1410",
    });
  });

  it("refuses text with no = as malformed", () => {
    expect(unwrapErr(parseTagAssignment({ text: "platform" })).code).toBe("TAG_MALFORMED");
  });

  it("refuses an empty value as malformed", () => {
    expect(unwrapErr(parseTagAssignment({ text: "platform=" })).code).toBe("TAG_MALFORMED");
  });

  it("names the nearest real key for a misspelt one", () => {
    const refused = unwrapErr(parseTagAssignment({ text: "platfrom=slack" }));
    expect(refused.code).toBe("TAG_UNKNOWN_KEY");
    expect(refused.message).toContain("did you mean platform?");
  });

  it("lists the keys when nothing is close", () => {
    expect(unwrapErr(parseTagAssignment({ text: "colour=red" })).message).toContain("the keys are platform, audience");
  });

  it("refuses a derived key, naming the field to change instead", () => {
    const refused = unwrapErr(parseTagAssignment({ text: "priority=p0" }));
    expect(refused.code).toBe("TAG_DERIVED_KEY");
    expect(refused.message).toContain("priority:");
  });

  it("refuses reply as a write, naming the draft it is read from", () => {
    const refused = unwrapErr(parseTagAssignment({ text: "reply=drafted" }));
    expect(refused.code).toBe("TAG_DERIVED_KEY");
    expect(refused.message).toContain("handover ask --action");
  });

  it("refuses a value outside the key's list, naming the list", () => {
    const refused = unwrapErr(parseTagAssignment({ text: "impact=huge" }));
    expect(refused.code).toBe("TAG_BAD_VALUE");
    expect(refused.message).toContain("critical | high | medium | low");
  });

  it("refuses a workstream that is not kebab-case", () => {
    expect(unwrapErr(parseTagAssignment({ text: "workstream=ISO Cert" })).code).toBe("TAG_BAD_VALUE");
  });

  it("refuses a pr that is not owner/repo#N", () => {
    expect(unwrapErr(parseTagAssignment({ text: "pr=1410" })).code).toBe("TAG_BAD_VALUE");
  });
});
