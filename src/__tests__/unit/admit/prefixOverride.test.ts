/**
 * `prefixOverride.ts`: what one command's own `NAME=value` / `env` prefix does to an override variable.
 */
import { describe, expect, it } from "vitest";

import { ASSIGNMENT, localOverride } from "../../../admit/prefixOverride.js";

const NAME = "SLOPWEAVER_ALLOW_BASH";

describe("localOverride", () => {
  it.each([
    ["SLOPWEAVER_ALLOW_BASH=1 jq .", "allow"],
    ["FOO=x SLOPWEAVER_ALLOW_BASH=1 jq .", "allow"],
    ["env SLOPWEAVER_ALLOW_BASH=1 jq .", "allow"],
    ["SLOPWEAVER_ALLOW_BASH=1 SLOPWEAVER_ALLOW_BASH=0 jq .", "clear"],
    ['SLOPWEAVER_ALLOW_BASH="1" jq .', "clear"],
    ["env -i SLOPWEAVER_ALLOW_BASH=1 jq .", "allow"],
    ["env SLOPWEAVER_ALLOW_BASH=1 -u SLOPWEAVER_ALLOW_BASH jq .", "clear"],
    ["SLOPWEAVER_ALLOW_BASH=1", "inherit"],
    ["jq .", "inherit"],
    ['FOO="x SLOPWEAVER_ALLOW_BASH=1 BAR=y" jq .', "clear"],
    ["FOO='x SLOPWEAVER_ALLOW_BASH=1' jq .", "clear"],
    ["FOO=x\\ SLOPWEAVER_ALLOW_BASH=1 jq .", "clear"],
    ["FOO=$(echo SLOPWEAVER_ALLOW_BASH=1 ) jq .", "clear"],
  ])("reads `%s` as %s", (command, expected) => {
    expect(localOverride({ command, name: NAME })).toBe(expected);
  });
});

describe("ASSIGNMENT", () => {
  it.each([
    ["FOO=1", true],
    ["_x=", true],
    ["1FOO=1", false],
    ["--flag=1", false],
  ])("answers `%s` with %s", (word, expected) => {
    expect(ASSIGNMENT.test(word)).toBe(expected);
  });
});
