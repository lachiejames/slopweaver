/**
 * The files a command's redirections name — every one, or only those opened for writing.
 */
import { describe, expect, it } from "vitest";

import { redirectionTargets } from "../../../admit/shellFileRedirections.js";
import { shellWords, splitOperators } from "../../../admit/shellLexing.js";

/** The target texts of one command's redirections. */
function targets({ text, writing }: { text: string; writing: boolean }): readonly string[] {
  const words = splitOperators({ words: shellWords({ text }).words });
  return redirectionTargets({ words, writing }).map((word) => word.text);
}

describe("redirectionTargets", () => {
  it("names every file a redirection opens, attached or separate, and no heredoc or here-string operand", () => {
    expect(targets({ text: "cmd < in >out 2>> err <<EOF <<< text", writing: false })).toStrictEqual([
      "in",
      "out",
      "err",
    ]);
  });

  it("keeps only the writing ones under writing — truncate, append, read-write, and a bare >& onto a file", () => {
    expect(targets({ text: "cmd < in > a >> b <> c &>> d >& e", writing: true })).toStrictEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("names no file for a descriptor duplicated or closed", () => {
    expect(targets({ text: "cmd 2>&1 >&- <&3", writing: false })).toStrictEqual([]);
  });

  it("reads a quoted operator as data, never a redirection", () => {
    expect(targets({ text: "echo '>' out", writing: false })).toStrictEqual([]);
  });
});
