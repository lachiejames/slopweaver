/**
 * The re-run fold read back: `splitFold` finds the fold in a body prefix, and `rerunItemsOf` reads its interior as
 * the command, tests and note items `./render.ts` writes, declining anything it did not write.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { rerunItemsOf, splitFold } from "../../../../outbound/github/parseRerunFold.js";
import { LAYOUT } from "../../../../outbound/github/render.js";

describe("rerunItemsOf", () => {
  it("reads a command, a tests list and a note, separated by one blank line", () => {
    const inner = [
      "```sh\nyarn test\n```",
      "<ul>\n<li>c3Body</li>\n<li>parse</li>\n</ul>",
      "<p>Run from the root</p>",
    ].join("\n\n");
    expect(rerunItemsOf({ inner })).toEqual([
      { kind: "command", lang: "sh", text: "yarn test" },
      { items: [[{ kind: "text", text: "c3Body" }], [{ kind: "text", text: "parse" }]], kind: "tests" },
      { content: [{ kind: "text", text: "Run from the root" }], kind: "note" },
    ]);
  });

  it("reads a command fenced one longer than the backtick run inside it", () => {
    expect(rerunItemsOf({ inner: "````sh\necho ```\n````" })).toEqual([
      { kind: "command", lang: "sh", text: "echo ```" },
    ]);
  });

  it("declines a command fenced longer than the renderer would pick", () => {
    expect(rerunItemsOf({ inner: "````sh\nyarn test\n````" })).toBeUndefined();
  });

  it("declines two items joined without a blank line", () => {
    expect(rerunItemsOf({ inner: "<p>One</p>\n<p>Two</p>" })).toBeUndefined();
  });

  it("declines an unclosed fence", () => {
    expect(rerunItemsOf({ inner: "```sh\nyarn test" })).toBeUndefined();
  });
});

describe("splitFold", () => {
  it("splits the main part from the fold's interior", () => {
    const text = `<p>Main</p>\n\n${LAYOUT.rerunOpen}\n\n<p>Note</p>\n\n${LAYOUT.rerunClose}`;
    const split = splitFold({ text });
    expect(split.isOk()).toBe(true);
    expect(unwrap(split)).toEqual({ inner: "<p>Note</p>", main: "<p>Main</p>" });
  });

  it("returns the whole text as main when there is no fold", () => {
    expect(unwrap(splitFold({ text: "<p>Main</p>" }))).toEqual({ inner: undefined, main: "<p>Main</p>" });
  });

  it("refuses a fold that does not end the body", () => {
    const split = splitFold({ text: `<p>Main</p>\n\n${LAYOUT.rerunOpen}\n\n<p>Note</p>\n\n<p>After</p>` });
    expect(split.isErr()).toBe(true);
    expect(unwrapErr(split).code).toBe("STRUCTURE");
  });
});
