/*
 * `classifyRawCommand` on a tool behind a compound-statement keyword (`do`, `then`, `!`): the keyword is skipped and
 * the tool behind it classified, while `do` as an ordinary argument is left alone.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand } from "../../../../admit/rawTools.js";

describe("a command hidden behind a compound-statement keyword", () => {
  // Measured: `shellSegments` cuts `for f in a; do <tool> …; done` into three segments, and the
  // middle one's FIRST token was `do`, so the tool behind it was never classified and the whole line passed.
  // `AGENTS.md` meanwhile claimed the escape was `cd x && …`, which was blocked and had been for some time.
  const external = ["c", "u", "r", "l"].join("");

  it("blocks a tool in a for-loop body", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `for f in a; do ${external} https://x; done` }).blocked).toBe(
      true,
    );
  });

  it("blocks a tool in a then-branch", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `if true; then ${external} https://x; fi` }).blocked).toBe(
      true,
    );
  });

  it("blocks a tool behind a negation inside a loop body", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `do ! ${external} https://x` }).blocked).toBe(true);
  });

  it("still blocks the compound shape the docs wrongly claimed was open", () => {
    expect(classifyRawCommand({ allowRaw: false, command: `cd /tmp && ${external} https://x` }).blocked).toBe(true);
  });

  it("leaves a segment made only of keywords alone", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "done" }).blocked).toBe(false);
  });

  it("does not treat the WORD do as a command when it is an argument", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "echo do the thing" }).blocked).toBe(false);
  });
});
