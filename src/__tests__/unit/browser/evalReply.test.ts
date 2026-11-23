import { describe, expect, it } from "vitest";

import { evalReplyValue } from "../../../browser/evalReply.js";

describe("reading the value out of a client eval reply", () => {
  it("takes the JSON under the Result heading", () => {
    const stdout = '### Ran Playwright code\n```js\nfoo()\n```\n### Result\n{\n  "matches": true\n}\n';
    expect(evalReplyValue({ stdout })).toEqual({ matches: true });
  });

  it("stops at the next heading, so a section printed after the result is not swallowed into it", () => {
    const stdout = '### Result\n{\n  "y": 12\n}\n### Page state\n- Page URL: https://example.com\n';
    expect(evalReplyValue({ stdout })).toEqual({ y: 12 });
  });

  it("answers undefined when there is no Result section", () => {
    expect(evalReplyValue({ stdout: "### Ran Playwright code\n### Page state\n" })).toBe(undefined);
  });

  it("answers undefined when the section is not JSON", () => {
    expect(evalReplyValue({ stdout: "### Result\nundefined\n" })).toBe(undefined);
  });

  it("answers undefined on an empty reply rather than throwing", () => {
    expect(evalReplyValue({ stdout: "" })).toBe(undefined);
  });

  it("reads a bare value, not only an object", () => {
    expect(evalReplyValue({ stdout: "### Result\n2611\n" })).toBe(2611);
  });
});
