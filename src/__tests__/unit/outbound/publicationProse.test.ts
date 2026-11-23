import { describe, expect, it } from "vitest";
import { publicationProseMask } from "../../../outbound/publicationProse.js";

describe("publicationProseMask", () => {
  it("keeps plain prose exactly", () => {
    expect(publicationProseMask({ text: "The owner saw it fail." })).toBe("The owner saw it fail.");
  });

  it("blanks an inline code span to spaces of the same length", () => {
    expect(publicationProseMask({ text: "run `we` now" })).toBe("run      now");
  });

  it("closes a double-backtick span only on a double-backtick run", () => {
    expect(publicationProseMask({ text: "a ``x ` y`` b" })).toBe("a           b");
  });

  it("leaves an unclosed backtick as prose", () => {
    expect(publicationProseMask({ text: "a ` b" })).toBe("a ` b");
  });

  it("keeps every newline, so a line number read off the mask is the original's", () => {
    const masked = publicationProseMask({ text: "one\n```\ncode\n```\nfour" });
    expect(masked.split("\n")).toEqual(["one", "   ", "    ", "   ", "four"]);
  });

  it("does not let a code span cross a blank line", () => {
    expect(publicationProseMask({ text: "a `b\n\nc` d" })).toBe("a `b\n\nc` d");
  });

  it("blanks a link target and keeps its text", () => {
    expect(publicationProseMask({ text: "[the plan](https://x.test/a)" })).toBe(`[the plan${" ".repeat(19)}`);
  });

  it("blanks a reference definition line", () => {
    expect(publicationProseMask({ text: "[1]: https://x.test/a" })).toBe("                     ");
  });

  it("blanks a tag but restores its title value in place", () => {
    expect(publicationProseMask({ text: '<a title="hover text">x</a>' })).toBe(
      `${" ".repeat(10)}hover text${" ".repeat(2)}x${" ".repeat(4)}`,
    );
  });

  it("blanks a double-quoted span with its marks", () => {
    expect(publicationProseMask({ text: 'said "hi there" ok' })).toBe("said            ok");
  });

  it("blanks a blockquote line but only the markers of an alert block", () => {
    expect(publicationProseMask({ text: "> quoted\n\n> [!NOTE]\n> body" })).toBe(
      `${" ".repeat(8)}\n\n${" ".repeat(9)}\n  body`,
    );
  });

  it("normalises CRLF before masking", () => {
    expect(publicationProseMask({ text: "a\r\nb" })).toBe("a\nb");
  });
});
