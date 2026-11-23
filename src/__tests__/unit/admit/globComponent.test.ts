import { describe, expect, it } from "vitest";

import { beforeSlashBrace, globComponentMatches, globComponentReadable } from "../../../admit/globComponent.js";

const CALL = "f1edcbb1-0000-4000-8000-000000000000.jsonl";

describe("globComponentMatches", () => {
  it.each([
    { name: "calls", pattern: "calls", want: true },
    { name: "calls", pattern: "call", want: false },
    { name: CALL, pattern: "*.jsonl", want: true },
    { name: CALL, pattern: "*.txt", want: false },
    { name: "call-index.txt", pattern: "call-*.txt", want: true },
    { name: "relays.jsonl", pattern: "call*", want: false },
    { name: "calls", pattern: "call?", want: true },
    { name: "call", pattern: "call?", want: false },
    { name: "calls", pattern: "call[st]", want: true },
    { name: "callx", pattern: "call[!st]", want: true },
    { name: "calls", pattern: "call[^st]", want: false },
    { name: "callm", pattern: "call[a-z]", want: true },
    { name: "call-", pattern: "call[a-]", want: true },
    { name: "calls", pattern: "call[z-a]", want: false },
    { name: "calls", pattern: "{talk,calls}", want: true },
    { name: "calls", pattern: "{talk,{x,ca{ll,t}s}}", want: true },
    { name: "talk", pattern: "tal{k..l}", want: true },
    { name: "talk", pattern: "{a..z}alk", want: true },
    { name: "calls", pattern: "call{1..9..2}", want: true },
    { name: "calls", pattern: "call{-1..+3}", want: true },
    { name: "relays.jsonl", pattern: "call{1..9}", want: false },
    { name: "calls", pattern: "call{s..}", want: false },
    { name: "{calls}", pattern: "{calls}", want: true },
    { name: "calls", pattern: "{calls}", want: false },
    { name: "{calls", pattern: "{calls", want: true },
    { name: "call*", pattern: "call\\*", want: true },
    { name: "calls", pattern: "call\\*", want: false },
    { name: "a,b", pattern: "a\\,b", want: true },
    { name: "calls", pattern: "[[:lower:]]alls", want: true },
    { name: "calls", pattern: "[[=c=]]alls", want: true },
    { name: "calls", pattern: "[a[.x.]]alls", want: true },
    { name: "calls", pattern: "[!]]alls", want: true },
    { name: "]alls", pattern: "[!]]alls", want: false },
    { name: "]alls", pattern: "[]]alls", want: true },
    { name: ":", pattern: "[[:]", want: true },
  ])("$pattern against $name is $want", ({ pattern, name, want }) => {
    expect(globComponentMatches({ name, pattern })).toBe(want);
  });

  it("answers 60,000 unmatched braces without rescanning from each one", () => {
    expect(globComponentMatches({ name: "talk", pattern: "{".repeat(60_000) })).toBe(false);
  });

  it("answers 30,000 unclosed classes each holding a POSIX class without rescanning past a bound", () => {
    expect(globComponentMatches({ name: "talk", pattern: "[[:a:]".repeat(30_000) })).toBe(false);
  });

  it("answers a run of stars against a name of repeats without backtracking", () => {
    expect(globComponentMatches({ name: "a".repeat(200), pattern: `${"*a".repeat(100)}b` })).toBe(false);
    expect(globComponentMatches({ name: "a".repeat(200), pattern: "*a".repeat(100) })).toBe(true);
  });

  it("reads a pattern unless a class range is reversed", () => {
    expect([
      globComponentReadable({ pattern: "x.jsonl" }),
      globComponentReadable({ pattern: "{a,[b-c]}*" }),
      globComponentReadable({ pattern: "[z-a]" }),
      globComponentReadable({ pattern: "{a,[z-a]}" }),
    ]).toEqual([true, true, false, false]);
  });

  it("fails open on nesting deep enough to overflow the stack", () => {
    expect(globComponentMatches({ name: "a", pattern: `${"{a,".repeat(200_000)}a${"}".repeat(200_000)}` })).toBe(false);
  });
});

describe("beforeSlashBrace", () => {
  it.each([
    { pattern: "/h/talk/calls/{a,b}.jsonl", want: "/h/talk/calls/{a,b}.jsonl" },
    { pattern: "/h/{talk/calls,other}", want: "/h" },
    { pattern: "/h/t/{x,{y,talk/calls}}/z", want: "/h/t" },
    { pattern: "{talk/calls,other}", want: "." },
    { pattern: "/{h/talk,x}", want: "/" },
    { pattern: "/h/\\{talk/calls,x}", want: "/h/\\{talk/calls,x}" },
    { pattern: "/h/{talk/calls", want: "/h/{talk/calls" },
  ])("$pattern is judged as $want", ({ pattern, want }) => {
    expect(beforeSlashBrace({ pattern })).toBe(want);
  });

  it("answers 60,000 nested slash braces in one pass", () => {
    expect(beforeSlashBrace({ pattern: `/h/${"{a/".repeat(60_000)}${"}".repeat(60_000)}` })).toBe("/h");
  });
});
