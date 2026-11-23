import { describe, expect, it } from "vitest";

import {
  commandSegments,
  hasCommandSegmentOverride,
  hasInlineEnvironmentOverride,
  hasSegmentInlineEnvironmentOverride,
  shellSegments,
} from "../../../admit/shellSegments.js";
import { arithmeticEnd, descriptorDigits, heredocOperatorAt, opensComment } from "../../../admit/shellSpans.js";
import { stdinHeredocIndex } from "../../../admit/stdinHeredoc.js";

describe("shellSegments", () => {
  it("splits a simple `&&`-joined command into two segments", () => {
    expect(shellSegments({ command: "git status && git push" })).toEqual([
      { command: "git status ", separatorAfter: "&&" },
      { command: " git push", separatorAfter: undefined },
    ]);
  });

  it("splits on `;`, `|`, `||`, and a bare newline", () => {
    expect(shellSegments({ command: "a; b" })).toEqual([
      { command: "a", separatorAfter: ";" },
      { command: " b", separatorAfter: undefined },
    ]);
    expect(shellSegments({ command: "a | b" })).toEqual([
      { command: "a ", separatorAfter: "|" },
      { command: " b", separatorAfter: undefined },
    ]);
    expect(shellSegments({ command: "a || b" })).toEqual([
      { command: "a ", separatorAfter: "||" },
      { command: " b", separatorAfter: undefined },
    ]);
    expect(shellSegments({ command: "a\nb" })).toEqual([
      { command: "a", separatorAfter: "\n" },
      { command: "b", separatorAfter: undefined },
    ]);
  });

  it("returns the whole command as one segment when there is no separator", () => {
    expect(shellSegments({ command: "git status" })).toEqual([{ command: "git status", separatorAfter: undefined }]);
  });

  it("does not split on a separator character sitting inside a single-quoted run", () => {
    expect(shellSegments({ command: "echo 'a; b && c | d' " })).toEqual([
      { command: "echo 'a; b && c | d' ", separatorAfter: undefined },
    ]);
  });

  it("does not split on a real newline sitting inside a single-quoted run", () => {
    // The exact shape a `gh api graphql` multi-line query body takes — the reproduction that motivated
    // making this splitter quote-aware in the first place.
    expect(shellSegments({ command: "gh api graphql -f query='query Read {\nviewer { login }\n}'" })).toEqual([
      { command: "gh api graphql -f query='query Read {\nviewer { login }\n}'", separatorAfter: undefined },
    ]);
  });

  it("does not split on a separator character sitting inside a double-quoted run", () => {
    expect(shellSegments({ command: 'git commit -m "run; git push"' })).toEqual([
      { command: 'git commit -m "run; git push"', separatorAfter: undefined },
    ]);
  });

  it("does not split on a separator character escaped by a bare backslash outside any quote", () => {
    expect(shellSegments({ command: "echo a\\;b" })).toEqual([{ command: "echo a\\;b", separatorAfter: undefined }]);
  });

  it("resumes splitting on a real separator once a quoted run closes", () => {
    expect(shellSegments({ command: "echo 'a; b' && git push" })).toEqual([
      { command: "echo 'a; b' ", separatorAfter: "&&" },
      { command: " git push", separatorAfter: undefined },
    ]);
  });

  it("does not split on a separator immediately after an ADJACENT quote closes, joined shell-word style", () => {
    // 'a'; is still one shell word followed by a real `;` — the quote closing does not itself insert a
    // boundary; the `;` right after it is the actual separator.
    expect(shellSegments({ command: "echo 'a'; echo b" })).toEqual([
      { command: "echo 'a'", separatorAfter: ";" },
      { command: " echo b", separatorAfter: undefined },
    ]);
  });
});

describe("commandSegments", () => {
  /** Just the commands, for a case whose point is which segments exist at all. */
  function commandsOf({ command }: { command: string }): readonly string[] {
    return commandSegments({ command }).map((segment) => segment.command);
  }

  it("keeps a word-initial `#` comment and its separators inside one segment", () => {
    expect(commandsOf({ command: "true # ; python3 -V" })).toEqual(["true # ; python3 -V"]);
    expect(commandsOf({ command: "true # note\nls" })).toEqual(["true # note", "ls"]);
    expect(commandsOf({ command: "echo a#b; ls" })).toEqual(["echo a#b", " ls"]);
  });

  it("keeps a balanced substitution whole instead of cutting it at its own separators", () => {
    expect(commandsOf({ command: "echo $(true; python3 -V)" })).toEqual(["echo $(true; python3 -V)"]);
    expect(commandsOf({ command: "echo `a; b` ; ls" })).toEqual(["echo `a; b` ", " ls"]);
  });

  it("attaches a heredoc body to the segment whose operator opened it, and emits no body segment", () => {
    // The operator text stays in the segment (a caller lexes it); what never appears is a segment of its BODY.
    expect(commandSegments({ command: "cat <<'EOF'\npython3 -V\nEOF" })).toEqual([
      {
        command: "cat <<'EOF'",
        heredocs: [
          { body: "python3 -V", delimiter: "EOF", descriptor: 0, quoted: true, readable: true, stripTabs: false },
        ],
        separatorAfter: "\n",
      },
      { command: "", heredocs: [], separatorAfter: undefined },
    ]);
  });

  it("records the body, its delimiter, its quoting, its tab-stripping and its descriptor", () => {
    const segments = commandSegments({ command: "cat <<-EOF\n\tvalue\n\tEOF\n" });
    expect(segments[0]!.heredocs).toEqual([
      { body: "\tvalue", delimiter: "EOF", descriptor: 0, quoted: false, readable: true, stripTabs: true },
    ]);
    expect(commandSegments({ command: "cat <<EOF\nbody" })[0]!.heredocs[0]!.readable).toBe(false);
    expect(commandSegments({ command: "cat <<$'X'\nbody\nX" })[0]!.heredocs[0]!.readable).toBe(false);
    expect(commandSegments({ command: "bash 3<<'X'\nbody\nX" })[0]!.heredocs[0]!.descriptor).toBe(3);
    expect(commandSegments({ command: "cat <<\\X\nbody\nX" })[0]!.heredocs[0]!.quoted).toBe(true);
    expect(commandSegments({ command: "cat <<E'O'F\nbody\nEOF" })[0]!.heredocs[0]!.delimiter).toBe("EOF");
  });

  it("consumes several pending bodies in operator order, after the operator's own line", () => {
    const segments = commandSegments({ command: "cat <<'A' <<'B'\nfirst\nA\nsecond\nB\nls" });
    expect(segments[0]!.heredocs.map((heredoc) => heredoc.body)).toEqual(["first", "second"]);
    expect(segments.map((segment) => segment.command)).toEqual(["cat <<'A' <<'B'", "ls"]);
  });

  it("keeps a heredoc pending across a later separator on the SAME line", () => {
    const segments = commandSegments({ command: "cat <<EOF; echo header\nbody\nEOF" });
    expect(segments[0]!.heredocs.map((heredoc) => heredoc.body)).toEqual(["body"]);
    expect(segments[1]!.heredocs).toEqual([]);
  });

  it("runs an unterminated body to the end of the input, as bash reads one", () => {
    expect(commandSegments({ command: "cat <<EOF\nline one\nline two" })[0]!.heredocs[0]!.body).toBe(
      "line one\nline two",
    );
  });

  it("is not fooled by a here-string or by arithmetic that looks like one", () => {
    expect(commandsOf({ command: "grep x <<<'python3 -V'" })).toEqual(["grep x <<<'python3 -V'"]);
    expect(commandsOf({ command: "echo $((1 << 2))\nls" })).toEqual(["echo $((1 << 2))", "ls"]);
    expect(commandsOf({ command: "((x = 1 << 2))\nls" })).toEqual(["((x = 1 << 2))", "ls"]);
  });

  it("reads a NUMERIC delimiter as a heredoc, as bash does", () => {
    // The counterexample: `cat <<123` once emitted its body line as a command.
    const segments = commandSegments({ command: "cat <<123\npython3 -V\n123" });
    expect(segments.map((segment) => segment.command)).toEqual(["cat <<123", ""]);
    expect(segments[0]!.heredocs[0]!.body).toBe("python3 -V");
  });
});

describe("stdinHeredocIndex", () => {
  it("selects the only heredoc, and the LAST one when there are two", () => {
    expect(stdinHeredocIndex({ command: "bash <<'EOF'" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash <<'A' <<'B'" })).toBe(1);
  });

  it("selects none when a later descriptor-0 redirection replaces stdin, spaced or GLUED", () => {
    // The glued form is a counterexample: `<<'A'</dev/null` is one whitespace word, so a
    // word-level check saw only the leading heredoc and missed the redirection that actually wins.
    expect(stdinHeredocIndex({ command: "bash <<'A' </dev/null" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash <<'A'</dev/null" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash <<'A' <<<'x'" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash <<'A' <&3" })).toBe(undefined);
    // An OUTPUT operator on descriptor 0 rebinds stdin too.
    expect(stdinHeredocIndex({ command: "bash <<'A' 0>/dev/null" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash <<'A' 0>>log" })).toBe(undefined);
    // A backslash-newline between the descriptor and its operator is a continuation the shell removes —
    // a counterexample, where the body binds to descriptor 3 rather than stdin.
    expect(stdinHeredocIndex({ command: "bash -s 3\\\n<<'A'" })).toBe(undefined);
  });

  it("leaves the heredoc selected when an output redirection names another descriptor", () => {
    expect(stdinHeredocIndex({ command: "bash <<'A' >/dev/null" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash <<'A' 2>&1" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash <<'A' &>log" })).toBe(0);
  });

  it("counts heredocs on every descriptor but selects only descriptor 0", () => {
    expect(stdinHeredocIndex({ command: "bash 3<<'A'" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' <<'B'" })).toBe(1);
    expect(stdinHeredocIndex({ command: "bash <<'A' 3</dev/null" })).toBe(0);
  });

  it("follows a descriptor copied onto stdin back to its heredoc, in the order bash applies them", () => {
    // A counterexample: the body opens on 3, then `<&3` makes it the shell's stdin script.
    expect(stdinHeredocIndex({ command: "bash 3<<'A' <&3" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 0<& 3" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 0>&3" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 4<&3 <&4" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash <&3 3<<'A'" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 3</dev/null <&3" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' <&-" })).toBe(undefined);
    // `<&3-` MOVES descriptor 3 onto stdin, so the body is still read — and 3 is closed after.
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 0<&3-" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 4<&3- <&4" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 4<&3- <&3" })).toBe(undefined);
    // An expansion picks the source when bash runs, so a copy of one fails closed to a held heredoc.
    expect(stdinHeredocIndex({ command: "bash 3<<'A' 0<&$((3))" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash 3<<'A' <&$fd" })).toBe(0);
    expect(stdinHeredocIndex({ command: "bash <&$fd" })).toBe(undefined);
  });

  it("selects none for a command with no heredoc, and ignores one inside quotes or a substitution", () => {
    expect(stdinHeredocIndex({ command: "bash script.sh" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "bash > out.log" })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "echo '<<A' " })).toBe(undefined);
    expect(stdinHeredocIndex({ command: "diff <(cat x) y" })).toBe(undefined);
  });
});

describe("hasInlineEnvironmentOverride", () => {
  it("recognises a bare `NAME=1` prefix on a single-segment command", () => {
    expect(
      hasInlineEnvironmentOverride({ command: "SLOPWEAVER_ALLOW_RAW=1 git push", name: "SLOPWEAVER_ALLOW_RAW" }),
    ).toBe(true);
  });

  it("does not recognise the override when the whole command is compound", () => {
    // This is the whole-command boolean deliberately left conservative — `hasSegmentInlineEnvironmentOverride`
    // is the one safe to relax per-segment.
    expect(
      hasInlineEnvironmentOverride({
        command: "SLOPWEAVER_ALLOW_RAW=1 git status && git push",
        name: "SLOPWEAVER_ALLOW_RAW",
      }),
    ).toBe(false);
  });
});

describe("hasSegmentInlineEnvironmentOverride", () => {
  it("recognises an override scoped to the exact segment that carries it", () => {
    const command = "git status && SLOPWEAVER_ALLOW_RAW=1 git push";
    expect(hasSegmentInlineEnvironmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(true);
  });

  it("does not leak an override from one segment into a different, unrelated segment", () => {
    const command = "SLOPWEAVER_ALLOW_RAW=1 git status && git push";
    expect(hasSegmentInlineEnvironmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(false);
  });

  it("carries a preceding bare `export NAME=1` forward through `&&`", () => {
    const command = "export SLOPWEAVER_ALLOW_RAW=1 && git push";
    expect(hasSegmentInlineEnvironmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(true);
  });

  it("does not carry a backgrounded export past the `&` that forked it", () => {
    const name = "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK";
    expect(
      hasCommandSegmentOverride({ command: `export ${name}=1 & wait; yarn typecheck`, name, segmentIndex: 1 }),
    ).toBe(false);
    expect(
      hasCommandSegmentOverride({ command: `sleep 1 & export ${name}=1; yarn typecheck`, name, segmentIndex: 1 }),
    ).toBe(true);
    expect(hasCommandSegmentOverride({ command: `export ${name}=1; yarn typecheck`, name, segmentIndex: 1 })).toBe(
      true,
    );
    expect(hasCommandSegmentOverride({ command: `export ${name}=1 2>&1; yarn typecheck`, name, segmentIndex: 1 })).toBe(
      true,
    );
  });

  it("does not carry a preceding bare export across a pipe", () => {
    const command = "export SLOPWEAVER_ALLOW_RAW=1 | git push";
    expect(hasSegmentInlineEnvironmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(false);
  });

  it("returns false for an out-of-range segment index", () => {
    expect(
      hasSegmentInlineEnvironmentOverride({ command: "git push", name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 3 }),
    ).toBe(false);
  });

  it("stops at `env -`, exactly as the parser this replaced did", () => {
    // Real bash clears the environment here, but recognising that would newly ARM the hatch for existing
    // callers — this resolver may only narrow, so `-` ends resolution instead.
    expect(
      hasSegmentInlineEnvironmentOverride({
        command: "env - SLOPWEAVER_ALLOW_RAW=1 git push",
        name: "SLOPWEAVER_ALLOW_RAW",
        segmentIndex: 0,
      }),
    ).toBe(false);
  });

  it("lets the segment's OWN prefix close an override a preceding export opened", () => {
    // Measured by running both halves: the boolean OR this replaced read all three as armed,
    // because a prefix that set the variable to something else only failed to ADD an override.
    const reassigned = "export SLOPWEAVER_ALLOW_RAW=1\nSLOPWEAVER_ALLOW_RAW=0 git push";
    const unset = "export SLOPWEAVER_ALLOW_RAW=1\nenv -u SLOPWEAVER_ALLOW_RAW git push";
    const cleared = "export SLOPWEAVER_ALLOW_RAW=1\nenv -i git push";
    expect(
      hasSegmentInlineEnvironmentOverride({ command: reassigned, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 }),
    ).toBe(false);
    expect(hasSegmentInlineEnvironmentOverride({ command: unset, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(
      false,
    );
    expect(
      hasSegmentInlineEnvironmentOverride({ command: cleared, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 }),
    ).toBe(false);
  });

  it("takes the LAST assignment in one prefix, and never arms on a quoted value", () => {
    // A quoted `"1"` stays UNarmed, exactly as on the base commit: decoding it would newly open the raw hatch
    // for every existing caller, and this resolver's change may only narrow what they accept.
    expect(
      hasSegmentInlineEnvironmentOverride({
        command: "SLOPWEAVER_ALLOW_RAW=1 SLOPWEAVER_ALLOW_RAW=0 git push",
        name: "SLOPWEAVER_ALLOW_RAW",
        segmentIndex: 0,
      }),
    ).toBe(false);
    expect(
      hasSegmentInlineEnvironmentOverride({
        command: 'SLOPWEAVER_ALLOW_RAW="1" git push',
        name: "SLOPWEAVER_ALLOW_RAW",
        segmentIndex: 0,
      }),
    ).toBe(false);
  });
});

describe("hasCommandSegmentOverride", () => {
  it("resolves the index against the heredoc-aware splitter, where the segments differ", () => {
    // The body line is not a segment here at all, so segment 1 is `ls` — under the flat splitter it is the body.
    const command = "cat <<'EOF'\nSLOPWEAVER_ALLOW_RAW=1 git push\nEOF\nSLOPWEAVER_ALLOW_RAW=1 git push";
    expect(hasCommandSegmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 1 })).toBe(true);
    expect(hasCommandSegmentOverride({ command, name: "SLOPWEAVER_ALLOW_RAW", segmentIndex: 0 })).toBe(false);
  });
});

describe("the unquoted spans a splitter steps over", () => {
  it("opens a comment only on a word-initial, unescaped `#`", () => {
    expect(opensComment({ command: "echo a # b", index: 7 })).toBe(true);
    expect(opensComment({ command: "#x", index: 0 })).toBe(true);
    expect(opensComment({ command: "a#b", index: 1 })).toBe(false);
    expect(opensComment({ command: "echo $#", index: 6 })).toBe(false);
    expect(opensComment({ command: "X\\ #Y", index: 3 })).toBe(false);
    expect(opensComment({ command: "$((1))#x", index: 6 })).toBe(false);
  });

  it("reads descriptor digits only when they start a word, across a line continuation", () => {
    expect(descriptorDigits({ command: "cat 3<<EOF", index: 5 })).toBe(3);
    expect(descriptorDigits({ command: "bash -s 3\\\n<<'A'", index: 11 })).toBe(3);
    expect(descriptorDigits({ command: "cat <<EOF", index: 4 })).toBeUndefined();
    expect(descriptorDigits({ command: "a3<<EOF", index: 2 })).toBeUndefined();
  });

  it("parses a heredoc operator whole, and refuses a here-string or a missing word", () => {
    expect(heredocOperatorAt({ command: "bash 3<<-'EOF'", index: 6 })).toEqual({
      delimiter: "EOF",
      descriptor: 3,
      dollarQuoted: false,
      end: 14,
      quoted: true,
      stripTabs: true,
    });
    expect(heredocOperatorAt({ command: "cat <<EOF", index: 4 })).toEqual({
      delimiter: "EOF",
      descriptor: 0,
      dollarQuoted: false,
      end: 9,
      quoted: false,
      stripTabs: false,
    });
    expect(heredocOperatorAt({ command: "cat <<<x", index: 4 })).toBeUndefined();
    expect(heredocOperatorAt({ command: "cat <<", index: 4 })).toBeUndefined();
  });

  it("skips an arithmetic or parameter expansion whole, so its `<<` is a shift", () => {
    expect(arithmeticEnd({ command: "$((1 << 2)) x", index: 0 })).toBe(11);
    expect(arithmeticEnd({ command: "$[1<<2]", index: 0 })).toBe(7);
    expect(arithmeticEnd({ command: "${x:0:1<<2}", index: 0 })).toBe(11);
    expect(arithmeticEnd({ command: "((x<<1))", index: 0 })).toBe(8);
    expect(arithmeticEnd({ command: "$((1", index: 0 })).toBe(4);
    expect(arithmeticEnd({ command: "a((x))", index: 1 })).toBeUndefined();
    expect(arithmeticEnd({ command: "echo", index: 0 })).toBeUndefined();
  });
});
