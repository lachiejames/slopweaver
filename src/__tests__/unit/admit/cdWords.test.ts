import { describe, expect, it } from "vitest";

import { cdOperandIndex, cdWords, withPwd } from "../../../admit/cdWords.js";

describe("cdOperandIndex", () => {
  it.each([
    { tokens: ["cd", "dir"], want: 1 },
    { tokens: ["cd", "-P", "-L", "dir"], want: 3 },
    { tokens: ["cd", "-P", "--", "-dir"], want: 3 },
    { tokens: ["cd"], want: 1 },
  ])("finds the operand of $tokens at $want", ({ tokens, want }) => {
    expect(cdOperandIndex({ tokens })).toBe(want);
  });
});

describe("cdWords", () => {
  it.each([
    { operands: ["cd", "dir"], redirects: false, tokens: ["cd", "dir"] },
    { operands: ["cd", "dir"], redirects: true, tokens: ["cd", ">x", "dir"] },
    { operands: ["cd", "dir"], redirects: true, tokens: ["cd", "dir", "2>", "x"] },
  ])("reads $tokens as $operands", ({ tokens, operands, redirects }) => {
    expect(cdWords({ tokens })).toEqual({ operands, redirects });
  });
});

describe("withPwd", () => {
  it.each([
    { token: "$PWD", want: "/h" },
    { token: '"$PWD"', want: '"/h"' },
    { token: '"${PWD}/talk"', want: '"/h/talk"' },
    { token: "${PWD}/talk", want: "/h/talk" },
    { token: "$PWDX", want: "$PWDX" },
    { token: "x/$PWD", want: "x/$PWD" },
  ])("writes $token as $want", ({ token, want }) => {
    expect(withPwd({ cwd: "/h", token })).toBe(want);
  });
});
