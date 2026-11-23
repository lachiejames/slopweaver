/**
 * `jqProgram.ts`: jq and its reimplementations are recognised by name, and found at any command start.
 */
import { describe, expect, it } from "vitest";

import { isJqProgram, jqAtAStart } from "../../../admit/jqProgram.js";
import { shellWords } from "../../../admit/shellLexing.js";

describe("isJqProgram", () => {
  it.each([
    ["jq", true],
    ["gojq", true],
    ["jaq", true],
    ["yq", true],
    ["jql", false],
    ["grep", false],
    ["", false],
  ])("answers %s for `%s`", (name, expected) => {
    expect(isJqProgram({ name })).toBe(expected);
  });
});

describe("jqAtAStart", () => {
  it.each([
    ["jq . file.json", true],
    ["/usr/bin/jq -r .x", true],
    ["chroot /sandbox /usr/bin/jq .", true],
    ["taskset -c 0 gojq .", true],
    ["find . -name x -exec yq . {}", true],
    ["grep jq notes.txt", false],
    ["echo jq", false],
    ["yarn lint", false],
  ])("answers `%s` with %s", (line, expected) => {
    const { words } = shellWords({ text: line });
    expect(jqAtAStart({ words })).toBe(expected);
  });
});
