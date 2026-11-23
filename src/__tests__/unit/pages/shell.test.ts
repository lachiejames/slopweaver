import { describe, expect, it } from "vitest";

import {
  PLATFORM_SHELL_OPEN,
  SHELL_BYTES,
  SHELL_CLOSE,
  SHELL_OPEN,
  unwrapPageFragment,
  wrapPageFragment,
} from "../../../pages/shell.js";

const FRAGMENT = "<title>Café — ☕</title><p>x & y < z</p>\n\n  indented\n";

describe("the platform shell", () => {
  it("is the 368 bytes measured, split 354 opening and 14 closing", () => {
    expect(Buffer.byteLength(PLATFORM_SHELL_OPEN)).toBe(354);
    expect(Buffer.byteLength(SHELL_CLOSE)).toBe(14);
  });

  it("carries the five reset rules the Artifact tool's own skeleton documents", () => {
    expect(PLATFORM_SHELL_OPEN).toBe(
      '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,' +
        'initial-scale=1"><style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,' +
        "BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}" +
        "[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>",
    );
  });
});

describe("the current shell", () => {
  it("opens with the platform shell's doctype and metas and closes the document", () => {
    expect(SHELL_OPEN.startsWith(PLATFORM_SHELL_OPEN.slice(0, PLATFORM_SHELL_OPEN.indexOf("<style>")))).toBe(true);
    expect(SHELL_OPEN.endsWith("</style></head><body>")).toBe(true);
    expect(SHELL_CLOSE).toBe("</body></html>");
  });

  it("gives an authored page the platform reset at the specificity it always had", () => {
    expect(SHELL_OPEN).toContain(
      'body:where(:has(style:not([data-corr-style]), link[rel~="stylesheet"])){margin:0;padding:0;font:14px',
    );
  });

  it("gives a page with no design of its own the house layer, at the ruled measure", () => {
    expect(SHELL_OPEN).toContain("@layer house {");
    expect(SHELL_OPEN).toContain(':where(body:not(:has(style:not([data-corr-style]), link[rel~="stylesheet"]))) {');
    expect(SHELL_OPEN).toContain("max(6%, 1.25rem, calc((100% - 140ch) / 2))");
  });

  it("scrolls a wide table inside itself on a phone, keeping an id in a cell on one line", () => {
    // Measured at 375 wide: without the cell floor that page's `sd-…` ids wrapped onto 3 lines.
    expect(SHELL_OPEN).toContain(
      "@media (max-width: 40rem) { & table { display: block; overflow-x: auto; } & :is(th, td) { min-width: 9ch; } " +
        "& :is(th, td) code { white-space: nowrap; overflow-wrap: normal; } }",
    );
  });

  it("asks the network for nothing", () => {
    expect(SHELL_OPEN).not.toContain("http");
    expect(SHELL_OPEN).not.toContain("@import");
  });

  it("costs what its two halves cost", () => {
    expect(SHELL_BYTES).toBe(Buffer.byteLength(SHELL_OPEN) + Buffer.byteLength(SHELL_CLOSE));
    expect(Buffer.byteLength(wrapPageFragment({ fragment: "" }))).toBe(SHELL_BYTES);
  });

  it("wraps a fragment without changing one byte of it", () => {
    expect(wrapPageFragment({ fragment: FRAGMENT })).toBe(`${SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}`);
  });
});

describe("unwrapPageFragment", () => {
  it("recovers a fragment from the current shell byte for byte", () => {
    expect(unwrapPageFragment({ html: wrapPageFragment({ fragment: FRAGMENT }) })).toEqual({
      fragment: FRAGMENT,
      shell: "house",
    });
  });

  it("recovers a fragment from the platform shell byte for byte", () => {
    expect(unwrapPageFragment({ html: `${PLATFORM_SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}` })).toEqual({
      fragment: FRAGMENT,
      shell: "platform",
    });
  });

  it("recovers an empty fragment", () => {
    expect(unwrapPageFragment({ html: `${PLATFORM_SHELL_OPEN}${SHELL_CLOSE}` })).toEqual({
      fragment: "",
      shell: "platform",
    });
  });

  it("keeps a fragment that itself quotes the shell's closing tags", () => {
    const fragment = "<pre>&lt;/body&gt;</pre></body></html><p>tail</p>";
    expect(unwrapPageFragment({ html: wrapPageFragment({ fragment }) })).toEqual({ fragment, shell: "house" });
  });

  it("answers undefined for a document it did not shell", () => {
    expect(unwrapPageFragment({ html: `<!doctype html><html><body>${FRAGMENT}${SHELL_CLOSE}` })).toBeUndefined();
  });

  it("answers undefined for a shelled page missing its close", () => {
    expect(unwrapPageFragment({ html: `${SHELL_OPEN}${FRAGMENT}` })).toBeUndefined();
  });

  it("answers undefined for correction chrome stamped before the doctype", () => {
    const html = `<style data-corr-style="1">.corr{}</style>${PLATFORM_SHELL_OPEN}${FRAGMENT}${SHELL_CLOSE}`;
    expect(unwrapPageFragment({ html })).toBeUndefined();
  });
});
