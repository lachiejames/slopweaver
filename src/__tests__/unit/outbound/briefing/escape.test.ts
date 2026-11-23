/**
 * The two page escapes: `&` first so later replacements are not double-escaped, and the attribute form adds
 * only the double quote. One pass over raw input — an already-escaped entity is escaped again, by contract.
 */
import { describe, expect, it } from "vitest";

import { escapeAttribute, escapeText } from "../../../../outbound/briefing/escape.js";

describe("escapeText", () => {
  it("leaves an empty string and plain text exactly as they were", () => {
    expect(escapeText({ text: "" })).toBe("");
    expect(escapeText({ text: "plain words, no markup" })).toBe("plain words, no markup");
  });

  it("escapes &, < and > and leaves a double quote alone", () => {
    expect(escapeText({ text: '&<>"' })).toBe('&amp;&lt;&gt;"');
  });

  it("escapes an existing entity's ampersand again, because it takes raw input", () => {
    expect(escapeText({ text: "&amp;" })).toBe("&amp;amp;");
  });
});

describe("escapeAttribute", () => {
  it("leaves an empty string and plain text exactly as they were", () => {
    expect(escapeAttribute({ text: "" })).toBe("");
    expect(escapeAttribute({ text: "plain words, no markup" })).toBe("plain words, no markup");
  });

  it("escapes the double quote as well as &, < and >", () => {
    expect(escapeAttribute({ text: '&<>"' })).toBe("&amp;&lt;&gt;&quot;");
  });

  it("escapes an existing entity's ampersand again, because it takes raw input", () => {
    expect(escapeAttribute({ text: "&quot;" })).toBe("&amp;quot;");
  });
});
