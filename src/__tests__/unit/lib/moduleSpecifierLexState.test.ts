/**
 * The module-specifier lexer's state: where it starts in a file, its character classes, and the operand and brace
 * judgements it makes from the tokens it has already pushed.
 */

import { describe, expect, it } from "vitest";
import {
  braceOpened,
  giveUp,
  isAsciiIdStart,
  isDigit,
  isLineBreak,
  isSpace,
  type LexState,
  lexStateOf,
  opensControlHead,
  operandNext,
  push,
  type SpecifierTokenKind,
} from "#lib/moduleSpecifierLexState.js";

/** A state that has already pushed `tokens`. */
function after({ tokens }: { tokens: readonly (readonly [SpecifierTokenKind, string])[] }): LexState {
  const state = lexStateOf({ fileName: "x.ts", text: "" });
  for (const [kind, value] of tokens) {
    push({ kind, state, value });
  }
  return state;
}

describe("lexStateOf", () => {
  it("starts past a byte-order mark and a hashbang line, and parses JSX by file name", () => {
    const text = "﻿#!/usr/bin/env node\nx";
    const states = ["x.ts", "x.tsx", "x.mjs", "x.d.ts"].map((fileName) => {
      const state = lexStateOf({ fileName, text });
      return [fileName, state.pos, state.jsx];
    });
    expect(states).toEqual([
      ["x.ts", 20, false],
      ["x.tsx", 20, true],
      ["x.mjs", 20, true],
      ["x.d.ts", 20, false],
    ]);
  });
});

describe("character classes", () => {
  it("matches TypeScript's line terminators and single-line white space", () => {
    const codes = [10, 13, 0x2028, 0x2029, 32, 9, 11, 0x85, 0x200b, 0xfeff, 65];
    expect(codes.map((code) => [code, isLineBreak({ code }), isSpace({ code })])).toEqual([
      [10, true, false],
      [13, true, false],
      [0x2028, true, false],
      [0x2029, true, false],
      [32, false, true],
      [9, false, true],
      [11, false, true],
      [0x85, false, true],
      [0x200b, false, true],
      [0xfeff, false, true],
      [65, false, false],
    ]);
  });

  it("tells an ASCII identifier start from a digit", () => {
    const chars = ["a", "Z", "$", "_", "0", "9", "-"];
    expect(
      chars.map((char) => [char, isAsciiIdStart({ code: char.charCodeAt(0) }), isDigit({ code: char.charCodeAt(0) })]),
    ).toEqual([
      ["a", true, false],
      ["Z", true, false],
      ["$", true, false],
      ["_", true, false],
      ["0", false, true],
      ["9", false, true],
      ["-", false, false],
    ]);
  });
});

describe("operandNext", () => {
  it("judges from the previous token, and leaves a word that is a keyword only sometimes unsettled", () => {
    const cases: readonly (readonly [SpecifierTokenKind, string])[][] = [
      [],
      [["identifier", "return"]],
      [["identifier", "x"]],
      [["identifier", "await"]],
      [["punctuator", "]"]],
      [["punctuator", ">"]],
      [["punctuator", "="]],
      [["number", "1"]],
    ];
    expect(cases.map((tokens) => operandNext({ state: after({ tokens }) }))).toEqual([
      "yes",
      "yes",
      "no",
      "unsettled",
      "no",
      "unsettled",
      "yes",
      "no",
    ]);
  });

  it("reads a `)` by its control head, and a `}` as settled only when it closed a block", () => {
    const control = after({ tokens: [["punctuator", ")"]] });
    control.lastParenControl = true;
    const block = after({ tokens: [["punctuator", "}"]] });
    block.lastBraceKind = "block";
    const expression = after({ tokens: [["punctuator", "}"]] });
    expression.lastBraceKind = "expression";
    const unknown = after({ tokens: [["punctuator", "}"]] });
    expect([control, block, expression, unknown].map((state) => operandNext({ state }))).toEqual([
      "yes",
      "yes",
      "unsettled",
      "unsettled",
    ]);
  });
});

describe("braceOpened and opensControlHead", () => {
  it("names a block, a function body, an expression or unknown by the token before the brace", () => {
    const cases: readonly (readonly [SpecifierTokenKind, string])[][] = [
      [],
      [["punctuator", ")"]],
      [["identifier", "else"]],
      [["punctuator", "="]],
      [["identifier", "return"]],
      [["punctuator", ":"]],
      [["identifier", "C"]],
    ];
    const control = after({ tokens: [["punctuator", ")"]] });
    control.lastParenControl = true;
    const states = [...cases.map((tokens) => after({ tokens })), control];
    expect(states.map((state) => braceOpened({ state }))).toEqual([
      "block",
      "function-body",
      "block",
      "expression",
      "expression",
      "unknown",
      "unknown",
      "block",
    ]);
  });

  it("knows a control head, `for await` included", () => {
    const cases: readonly (readonly [SpecifierTokenKind, string])[][] = [
      [["identifier", "if"]],
      [
        ["identifier", "for"],
        ["identifier", "await"],
      ],
      [["identifier", "await"]],
      [["identifier", "f"]],
    ];
    expect(cases.map((tokens) => opensControlHead({ state: after({ tokens }) }))).toEqual([true, true, false, false]);
  });
});

describe("giveUp", () => {
  it("records the reason and moves to the end of the text", () => {
    const state = lexStateOf({ fileName: "x.ts", text: "abc" });
    giveUp({ state, why: "because" });
    expect([state.why, state.pos]).toEqual(["because", 3]);
  });
});
