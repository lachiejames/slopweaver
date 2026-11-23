import { describe, expect, it } from "vitest";

import { extractShellWord } from "../../../admit/argumentValue.js";

describe("extractShellWord", () => {
  it("joins adjacent quoted and unquoted runs and stops at the first unquoted whitespace", () => {
    expect(extractShellWord({ text: `py'th'"on"3 -V` })).toBe("python3");
  });

  it("decodes a $'…' run the way bash does — hex, octal and a simple escape — rather than reading it literally", () => {
    expect([
      extractShellWord({ text: "$'\\x70ython3' -V" }),
      extractShellWord({ text: "$'\\160ython3'" }),
      extractShellWord({ text: "$'a\\tb'" }),
    ]).toEqual(["python3", "python3", "a\tb"]);
  });

  it("decodes a $'…' run glued to other runs, so a word split across one still reads whole", () => {
    expect([
      extractShellWord({ text: "'py'$'\\x74hon'3 rest" }),
      extractShellWord({ text: "$'\\x67'cloud rest" }),
      // Decoded whitespace stays inside the word: it is quoted text, never a word break.
      extractShellWord({ text: "'gc'$'\\x6coud -V' ignored" }),
    ]).toEqual(["python3", "gcloud", "gcloud -V"]);
  });

  it("reads an escaped $ before a quote as a literal $ and an ordinary quote, never an ANSI-C opener", () => {
    expect(extractShellWord({ text: "\\$'\\x67'" })).toBe("$\\x67");
  });

  it("closes a $'…' run only on an unescaped quote, so its \\' stays inside the word", () => {
    expect(extractShellWord({ text: "$'it\\'s' next" })).toBe("it's");
  });

  it('reads a $"…" run as double quoting, and a $ inside single or double quotes as itself', () => {
    expect([
      extractShellWord({ text: '$"a b" c' }),
      extractShellWord({ text: "'$x'" }),
      extractShellWord({ text: `"$'x'"` }),
    ]).toEqual(["a b", "$x", "$'x'"]);
  });

  it("escapes exactly the shell's set inside double quotes — $, backtick, quote and backslash — and nothing else", () => {
    expect(extractShellWord({ text: '"a\\$b\\`c\\"d\\\\e\\f"' })).toBe('a$b`c"d\\e\\f');
  });

  it("answers the empty word for blank text", () => {
    expect(extractShellWord({ text: "" })).toBe("");
  });
});
