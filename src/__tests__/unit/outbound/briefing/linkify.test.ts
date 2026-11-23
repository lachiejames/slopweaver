import { describe, expect, it } from "vitest";

import { linkifyText } from "../../../../outbound/briefing/linkify.js";

describe("linkifyText", () => {
  it("turns a bare http URL a composer typed into prose into a real link", () => {
    expect(linkifyText({ text: "see https://example.com/x for the run" })).toBe(
      'see <a class="raw" href="https://example.com/x">https://example.com/x</a> for the run',
    );
  });

  it("escapes the prose around the link, so no composer can add markup", () => {
    expect(linkifyText({ text: "<b>bold</b> & https://example.com" })).toBe(
      '&lt;b&gt;bold&lt;/b&gt; &amp; <a class="raw" href="https://example.com">https://example.com</a>',
    );
  });

  it("escapes text carrying no URL at all and links nothing", () => {
    expect(linkifyText({ text: "nothing to link here & nothing to escape but this" })).toBe(
      "nothing to link here &amp; nothing to escape but this",
    );
  });

  it("answers the empty string for the empty string", () => {
    expect(linkifyText({ text: "" })).toBe("");
  });

  it("leaves a `file:` URL outside the pages root as escaped text, never a dead link", () => {
    // A link to somebody else's machine scrolls nowhere and looks like the page ignored the click.
    const out = linkifyText({ text: "file:///Users/someone/Desktop/notes.html" });
    expect(out).toBe("file:///Users/someone/Desktop/notes.html");
    expect(out.includes("<a")).toBe(false);
  });
});
