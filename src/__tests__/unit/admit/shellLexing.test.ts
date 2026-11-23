import { describe, expect, it } from "vitest";

import { closingParen, substitutionAt } from "../../../admit/shellBrackets.js";
import {
  bodySubstitutions,
  hereStrings,
  shellWords,
  splitOperators,
  truncatingTargets,
  withoutRedirections,
} from "../../../admit/shellLexing.js";

/** Just the word texts, for a case whose point is the splitting. */
function textsOf({ text }: { text: string }): readonly string[] {
  return shellWords({ text }).words.map((word) => word.text);
}

describe("closingParen", () => {
  it("matches the nesting close, skipping quoted and escaped parentheses", () => {
    expect(closingParen({ from: 2, text: "$(a (b) c)" })).toBe(9);
    expect(closingParen({ from: 2, text: "$(echo ')') x" })).toBe(10);
    expect(closingParen({ from: 2, text: "$(echo \\) ) x" })).toBe(10);
    expect(closingParen({ from: 2, text: "$(echo $'\\')' ) x" })).toBe(14);
  });

  it("answers -1 when the group never closes", () => {
    expect(closingParen({ from: 2, text: "$(echo hi" })).toBe(-1);
  });
});

describe("substitutionAt", () => {
  it("finds `$(…)`, backticks and process substitution, in the right quote contexts", () => {
    expect(substitutionAt({ index: 0, quote: undefined, text: "$(a b) c" })).toEqual({ end: 6, inner: "a b" });
    expect(substitutionAt({ index: 0, quote: '"', text: "$(a b)" })).toEqual({ end: 6, inner: "a b" });
    expect(substitutionAt({ index: 0, quote: undefined, text: "`a b` c" })).toEqual({ end: 5, inner: "a b" });
    expect(substitutionAt({ index: 0, quote: undefined, text: "<(a b)" })).toEqual({ end: 6, inner: "a b" });
  });

  it("finds none inside a single-quoted run, and none in arithmetic", () => {
    expect(substitutionAt({ index: 0, quote: "'", text: "$(a b)" })).toBe(undefined);
    expect(substitutionAt({ index: 0, quote: undefined, text: "$((1 + 2))" })).toBe(undefined);
    expect(substitutionAt({ index: 0, quote: '"', text: "<(a b)" })).toBe(undefined);
  });

  it("runs an unclosed substitution to the end of the text rather than dropping it", () => {
    expect(substitutionAt({ index: 0, quote: undefined, text: "$(a b" })).toEqual({ end: 5, inner: "a b" });
  });

  it("closes a backtick at the first unescaped one, unescaping a nested backtick, `$` and `\\`", () => {
    const text = "`echo \\`yarn typecheck\\` \\$HOME \\\\ \\n` c";
    expect(substitutionAt({ index: 0, quote: undefined, text })).toEqual({
      end: text.length - 2,
      inner: "echo `yarn typecheck` $HOME \\ \\n",
    });
  });
});

describe("shellWords", () => {
  it("decodes a $'…' word the way bash does, and reads $\"…\" as double quoting", () => {
    const words = shellWords({ text: "bash $'-c' $'it\\'s' $\"a b\"" }).words;
    expect(words.map((word) => word.text)).toEqual(["bash", "-c", "it's", "a b"]);
    expect(words.map((word) => word.quoted)).toEqual([false, true, true, true]);
    expect(words.map((word) => word.dynamic)).toEqual([false, false, false, false]);
    expect(words[1]!.shape).toBe("__");
  });

  it("removes a line continuation, quoted or not, and keeps a backslash double quotes do not escape", () => {
    expect(textsOf({ text: "sl\\\neep 1" })).toEqual(["sleep", "1"]);
    expect(textsOf({ text: 'echo "a\\\nb" "c\\qd" "e\\$f"' })).toEqual(["echo", "ab", "c\\qd", "e$f"]);
    expect(textsOf({ text: "echo a \\\n" })).toEqual(["echo", "a"]);
  });

  it("removes quoting and reports it, so a quoted program name is still the program", () => {
    expect(textsOf({ text: "'python3' -V" })).toEqual(["python3", "-V"]);
    expect(shellWords({ text: "'python3'" }).words[0]).toEqual({
      dynamic: false,
      quoted: true,
      shape: "_______",
      text: "python3",
      unquotedPrefix: "",
    });
  });

  it("keeps a quoted separator, a quoted space and an escaped space inside one word", () => {
    expect(textsOf({ text: "git commit -m 'run; git push'" })).toEqual(["git", "commit", "-m", "run; git push"]);
    expect(textsOf({ text: "echo a\\ b" })).toEqual(["echo", "a b"]);
  });

  it("marks an expanded word dynamic and keeps its raw text, and collects the inner command", () => {
    const lexed = shellWords({ text: "$(which python3) -V" });
    expect(lexed.words[0]).toEqual({
      dynamic: true,
      quoted: false,
      shape: "________________",
      text: "$(which python3)",
      unquotedPrefix: "",
    });
    expect(lexed.substitutions).toEqual(["which python3"]);
    expect(shellWords({ text: "echo '$(python3 -V)'" }).substitutions).toEqual([]);
    expect(shellWords({ text: 'echo "$(python3 -V)"' }).substitutions).toEqual(["python3 -V"]);
  });

  it("masks every quoted, escaped or substituted character in the shape, index for index", () => {
    expect(shellWords({ text: '"hello">out' }).words[0]!.shape).toBe("_____>out");
    expect(shellWords({ text: "a\\>b'>'c" }).words[0]!.shape).toBe("a_b_c");
  });

  it("records the unquoted prefix, which is what makes a word an operator", () => {
    expect(shellWords({ text: "<<'EOF'" }).words[0]!.unquotedPrefix).toBe("<<");
    expect(shellWords({ text: "'>'" }).words[0]!.unquotedPrefix).toBe("");
    expect(shellWords({ text: ">out.log" }).words[0]!.unquotedPrefix).toBe(">out.log");
  });

  it("stops at a word-initial unquoted `#`, and keeps one inside a word", () => {
    expect(textsOf({ text: "ls # python3 -V" })).toEqual(["ls"]);
    expect(textsOf({ text: "echo a#b" })).toEqual(["echo", "a#b"]);
    expect(textsOf({ text: "echo '# not a comment'" })).toEqual(["echo", "# not a comment"]);
  });
});

describe("bodySubstitutions", () => {
  it("finds what an unquoted body expands, and nothing behind a backslash", () => {
    expect(bodySubstitutions({ body: "value $(python3 -V) end" })).toEqual(["python3 -V"]);
    expect(bodySubstitutions({ body: "value `python3 -V`" })).toEqual(["python3 -V"]);
    expect(bodySubstitutions({ body: "literal \\$(python3 -V)" })).toEqual([]);
    expect(bodySubstitutions({ body: "nothing here" })).toEqual([]);
  });
});

describe("withoutRedirections", () => {
  it("drops an operator and its operand, attached or spaced, and keeps real arguments", () => {
    expect(textsOf({ text: ">/tmp/out python3 -V" })).toEqual([">/tmp/out", "python3", "-V"]);
    expect(
      withoutRedirections({ words: shellWords({ text: ">/tmp/out python3 -V" }).words }).map((w) => w.text),
    ).toEqual(["python3", "-V"]);
    expect(
      withoutRedirections({ words: shellWords({ text: "cmd > out.log 2>&1 arg" }).words }).map((w) => w.text),
    ).toEqual(["cmd", "arg"]);
    expect(withoutRedirections({ words: shellWords({ text: "echo '>' python3" }).words }).map((w) => w.text)).toEqual([
      "echo",
      ">",
      "python3",
    ]);
  });
});

describe("truncatingTargets", () => {
  const targets = ({ text }: { text: string }): readonly string[] =>
    truncatingTargets({ words: splitOperators({ words: shellWords({ text }).words }) }).map((word) => word.text);

  it("names a truncating target, spaced, attached, numbered or &>, and never an append, a dup or quoted data", () => {
    expect([
      targets({ text: "echo > a" }),
      targets({ text: "printf x 2>b" }),
      targets({ text: "cmd &> c >> d &>> e 2>&1" }),
      targets({ text: "echo '>' f" }),
      targets({ text: 'cmd >"g h"' }),
    ]).toEqual([["a"], ["b"], ["c"], [], ["g h"]]);
  });

  it("reads a descriptor-less >& onto a file name as &>, and onto a number or - as a dup", () => {
    expect([
      targets({ text: ": >& i.txt" }),
      targets({ text: ": >&j.txt" }),
      targets({ text: "cmd >& 2" }),
      targets({ text: "cmd >&-" }),
    ]).toEqual([["i.txt"], ["j.txt"], [], []]);
  });
});

// `stdinHeredocIndex` lives in `stdinHeredoc.ts` and is tested in `shellSegments.test.ts`: choosing the winning
// redirection needs the segment's raw TEXT, because `<<'A'</dev/null` is one whitespace word.

describe("hereStrings", () => {
  it("reads a literal here-string, spaced or attached, quotes removed", () => {
    expect(hereStrings({ words: shellWords({ text: "bash <<< 'yarn typecheck'" }).words })).toEqual(["yarn typecheck"]);
    expect(hereStrings({ words: shellWords({ text: `sh <<<"yarn lint" 2>&1` }).words })).toEqual(["yarn lint"]);
  });

  it("leaves out a run-time operand and a heredoc", () => {
    expect(hereStrings({ words: shellWords({ text: 'bash <<< "$line"' }).words })).toEqual([]);
    expect(hereStrings({ words: shellWords({ text: "bash <<EOF" }).words })).toEqual([]);
  });
});
