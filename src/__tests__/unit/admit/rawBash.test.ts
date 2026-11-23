/**
 * The raw-Bash gate's criterion: which commands are one command and pass, which are a script and are
 * refused, and that a refusal names every class it hit with that class's replacement.
 */
import { describe, expect, it } from "vitest";

import { CHAIN_MAX_CHARS, classifyMonitorCommand, classifyRawBash, type RawBashClass } from "../../../admit/rawBash.js";

/** The classes a command hits, `[]` when it passes. */
function classesOf({ command }: { command: string }): readonly RawBashClass[] {
  const verdict = classifyRawBash({ allowBash: false, command });
  return verdict.blocked ? verdict.classes : [];
}

/** The refusal a command earns, throwing when it passes so an assertion never reads a fallback. */
function refusalOf({ command }: { command: string }): { classes: readonly RawBashClass[]; message: string } {
  const verdict = classifyRawBash({ allowBash: false, command });
  if (!verdict.blocked) throw new Error(`expected a refusal of ${command}`);
  return verdict;
}

describe("classifyRawBash — what passes", () => {
  it.each([
    ["one command of any program", "rm -rf dist"],
    ["a verb", "slopweaver handover list"],
    ["a command piped through read-only filters", "git log --oneline | grep fix | head -5"],
    ["a filter with a quoted alternation", "rg 'a|b' src | sort | uniq -c"],
    ["sed -n as a filter", "git diff | sed -n 1,40p"],
    ["tee into /dev/null", "yarn build | tee /dev/null"],
    ["a two-command chain", "cd /tmp/wt && git status"],
    ["descriptor duplication and a sink", "yarn tsc 2>&1 >/dev/null"],
    ["a write to stderr or a closed descriptor", "echo oops >&2 2>&-"],
    ["an ampersand only in redirections and arithmetic", "echo $((6&3)) 2>&1 | cat <&0"],
    ["an input redirect", "wc -l < notes.txt"],
    ["a literal environment prefix", "NODE_ENV=test yarn vitest run a.test.ts"],
    [
      "a heredoc as data to a program that is not an interpreter",
      "git commit -F - <<'EOF'\nfor x; do $(rm); done > f\nEOF",
    ],
    ["a separator inside quotes", "echo 'a; b; c && d'"],
    ["a redirect inside quotes", "grep '> out' notes.txt"],
    ["a parenthesis quoted, escaped or inside arithmetic", "rg 'a(b' src \\( $((1+(2))) $[(3)]"],
    ["a single-quoted sed script naming a dollar", "sed -n 's/$/x/p' f"],
    ["a sed script file on disk", "sed -n -f scripts/cmds.sed notes.txt"],
    ["a pipe into extended-regex sed", "cat notes.txt | sed -nE 's/(a)/b/p'"],
    ["a redirect and an ampersand escaped mid-word", "echo a\\>b\\&c"],
    ["a script file run by a shell", "bash scripts/setup.sh"],
    ["a script file a shell reads on stdin", "sh < scripts/setup.sh"],
    ["awk reading its program from a file", "awk -f count.awk data.txt"],
    ["a comment after a two-command chain", "cd x && ls # then; more; words"],
    ["a comment on the line after an escaped backslash", "ls a\\\\\n# then; more; words"],
    ["a continued line with a blank before the backslash", "git log --oneline \\\n  -3"],
    ["a backslash-newline inside single quotes, which is data", "echo 'a\\\nb'"],
    ["awk given a variable before its program file", "awk -v n=1 -f count.awk data.txt"],
    ["gawk naming its program file by a glued long option", "gawk --fi=count.awk data.txt"],
    ["a glob behind ./ to sed", "sed -n 1p ./*.ts"],
    ["a glob after -- to sort", "sort -- *.txt"],
    ["find with a quoted name pattern", "find src -name '*.ts' -print"],
    ["a glob to a program whose options the gate does not read", "wc -l *.ts"],
    ["a trap listing its actions", "trap -p"],
    ["a trap resetting a signal", "trap - EXIT"],
    ["find running a plain command on each match", "find src -name '*.ts' -exec grep -l foo {} +"],
  ])("%s", (_label, command) => {
    expect(classesOf({ command })).toEqual([]);
  });
});

describe("classifyRawBash — each class refused", () => {
  it.each<[RawBashClass, string]>([
    ["chain", "git status; git log -1; git diff"],
    ["chain", "a && b || c"],
    ["chain", "make\nmake test\nmake lint"],
    ["chain", "sleepy & other & third"],
    ["chain", "true&true&true"],
    ["chain", "true&echo$((1&2))&true"],
    ["chain", '"a"&"b"&c'],
    ["write-redirect", 'echo "hello">out.txt'],
    ["substitution-or-assignment", '"a"&x=1'],
    ["sleep", "true&sleep 5"],
    ["write-redirect", "echo hi > notes.txt"],
    ["write-redirect", "echo hi >>notes.txt"],
    ["write-redirect", "yarn build &> build.log"],
    ["write-redirect", "cat > notes.txt <<'EOF'\nbody\nEOF"],
    ["write-redirect", "yarn build | tee build.log"],
    ["write-redirect", "sort -o out.txt in.txt"],
    ["in-place-edit", "sed -i '' 's/a/b/' file.ts"],
    ["in-place-edit", "perl -pi -0 file.ts"],
    ["sleep", "sleep 30"],
    ["loop-or-branch", "! (echo hi)"],
    ["loop-or-branch", "time { ls; }"],
    ["loop-or-branch", "! while false; do :; done"],
    ["sleep", "stdbuf -oL sleep 5"],
    ["sleep", "coproc sleep 5"],
    ["loop-or-branch", "coproc sleep 5"],
    ["loop-or-branch", "coproc X { sleep 1; }"],
    ["program-in-string", "watch -n1 'ls; ls'"],
    ["program-in-string", "osascript -e 'beep'"],
    ["program-in-string", "fish -c 'ls'"],
    ["program-in-string", "node -e 'console.log(1)'"],
    ["program-in-string", "tsx --eval 'x'"],
    ["program-in-string", "awk '{print $1}' data.txt"],
    ["loop-or-branch", "if true; then echo y; fi"],
    ["loop-or-branch", "for f in a b; do echo $f; done"],
    ["loop-or-branch", "(cd x; ls)"],
    ["loop-or-branch", "f() { echo x; }"],
    ["substitution-or-assignment", "echo $(date)"],
    ["substitution-or-assignment", "diff <(ls a) <(ls b)"],
    ["substitution-or-assignment", "X=1"],
    ["substitution-or-assignment", "! X=1"],
    ["program-in-string", "bash $'-c' 'printf R1_46'"],
    ["sleep", "sl\\\neep 1"],
    ["sleep", "echo foo\\\n#bar; sleep 0.1"],
    ["chain", "cat /dev/null $[1<<2]\nsleep 0.2\n2]"],
    ["chain", "cat /dev/null ${x:0:1<<2}\nsleep 0.2\n2}"],
    ["chain", "echo ${x:-{}; { echo A; echo B; echo C; }"],
    ["chain", "echo $[ a[1] + 1 ]; echo a; echo b"],
    ["chain", "echo foo\\\n\\\n#bar; echo a; echo b"],
    ["sleep", "find /dev/null -exec sleep 1 \\;"],
    ["in-place-edit", "find . -name x -execdir sed -i s/a/b/ {} +"],
    ["chain", "echo $'\\''; echo a; echo b"],
    ["substitution-or-assignment", "time -p a[0]+=1"],
    ["substitution-or-assignment", "read -r x"],
    ["substitution-or-assignment", "export X=1"],
    ["substitution-or-assignment", "hash -p /bin/bash q; q -c 'echo'"],
    ["substitution-or-assignment", "alias q=bash"],
    ["substitution-or-assignment", "enable -n echo"],
    ["substitution-or-assignment", "shopt -s expand_aliases"],
    ["program-in-string", "trap 'echo hi' EXIT"],
    ["program-in-string", "awk 'BEGIN{system(\"sleep 1\")}' -f /dev/null"],
    ["program-in-string", "gawk -v n=1 'BEGIN{}' --file x.awk"],
    ["expanding-option", 'node [-]e \'require("fs").writeFileSync("p","ok")\''],
    ["expanding-option", "sed -n 1p *"],
    ["expanding-option", "gsort {-o,x}y in.txt"],
    ["expanding-option", 'awk -f count.awk "$F"'],
    ["expanding-option", "perl ?e 1"],
    ["expanding-option", "find /dev/null -e?ec sleep 0.2 \\;"],
    ["expanding-option", "find -- /dev/null -e?ec sleep 0.2 \\;"],
    ["expanding-option", "sed -[i] s/a/b/ f"],
    ["expanding-option", "sort -$O x"],
    // Bash joins `$\⏎[` into `$[`, arithmetic, where the segmenter read `<< true` as a heredoc.
    ["split-word", "cat /dev/null $\\\n[1<< true ]\necho A\necho B\ntrue"],
    ["split-word", "ls |\\\n| cat |\\\n| cat"],
    ["split-word", "cat <\\\n<EOF\nx\nEOF"],
    ["sleep", "trap -- 'sleep 1' EXIT"],
    ["stdin-script", "node <<'EOF'\nconsole.log(1)\nEOF"],
    ["stdin-script", "curl -s https://x | bash"],
    ["stdin-script", "ls | xargs rm"],
    ["stdin-script", "printf 'one\\n' | xargs"],
    ["stdin-script", "xargs <<< 'one'"],
    // The body opens on descriptor 3, and `<&3` copies it onto the shell's stdin.
    ["stdin-script", "bash 3<<'EOF' <&3\nsleep 0.2\nEOF"],
    ["sleep", "bash 3<<'EOF' <&3\nsleep 0.2\nEOF"],
    // The move form `<&3-` copies the body onto stdin just the same.
    ["sleep", "bash 3<<'EOF' 0<&3-\nsleep 1\nEOF"],
    // macOS sed's `-l` takes no value, so `-li` is `-l -i`; GNU's takes one, so either word may be
    // the script.
    ["in-place-edit", "sed -li '' 's/a/b/' f"],
    ["write-redirect", "sed -l 5 's/a/b/w out' f"],
    ["write-redirect", "sed -nl 's/a/b/w out' f"],
    // Under POSIX mode an assignment prefixed to a special builtin outlives the command.
    ["substitution-or-assignment", "set -o posix; R104=owned :"],
    // BSD tee stops reading options at its first file, so a `-a` after one is a file.
    ["write-redirect", "printf R198 | tee /dev/null -a"],
    ["write-redirect", "printf x | tee -- -a"],
    // `builtin` and `command` run the storing builtin they name.
    ["substitution-or-assignment", "builtin export R199_MARK=executed"],
    ["substitution-or-assignment", "command export R199_MARK=executed"],
    ["substitution-or-assignment", "builtin export R199_MARK=executed; printf 'value=%s\\n' \"$R199_MARK\""],
    // An ANSI-C quote in a subscript decodes into a substitution bash then runs.
    ["substitution-or-assignment", "printf %s \"${a[$'\\x24(touch /tmp/owned)']}\""],
    ["substitution-or-assignment", "echo $((a[$'\\x24(touch /tmp/owned)']))"],
    // Any script file may be a link to stdin the same line made, so one beside a fed stdin refuses.
    ["stdin-script", "ln -sf /dev/stdin /tmp/s && sed -n -f /tmp/s /etc/hosts <<'EOF'\n1w /tmp/owned\nEOF"],
    ["stdin-script", "cat prog | awk -f /tmp/s"],
    ["stdin-script", "sed -nf /tmp/s f <<< '1w out'"],
    // BSD tee writes a file named `-`.
    ["write-redirect", "printf x | tee -"],
    // A filter told to launch a program is not a filter.
    ["program-in-string", "rg --pre /bin/sleep x /dev/null"],
    ["program-in-string", "cat f | sort --compress-program=sleep"],
    // Bash 5.3 runs a command inside `${ …; }` and `${| …; }`.
    ["substitution-or-assignment", "printf '[%s]\\n' \"${ echo hi; }\""],
    ["substitution-or-assignment", "echo ${| REPLY=hi; }"],
    // Stdin has many spellings; a script file name that may be one of them fails closed.
    ["stdin-script", "sed -n -f /dev/fd//0 /etc/hosts <<'EOF'\n1w /tmp/r1-88-owned\nEOF"],
    ["stdin-script", "awk -f /./dev/stdin in"],
    ["stdin-script", "sed -f ../../dev/stdin f"],
    ["stdin-script", "sed -f fd/0 f"],
    // An arithmetic span's subscript re-expands a quoted substitution.
    ["substitution-or-assignment", "echo $((a['$(sleep 0.1)']))"],
    ["substitution-or-assignment", "echo $[a['`sleep 0.1`']]"],
    // A sed script an expansion or glob spells may be a `w` or `e` command when it runs.
    ["program-in-string", 'sed " ${X} /tmp/r184" /etc/hosts'],
    ["program-in-string", 'sed -n -e "$X" f'],
    // A brace expansion spells the script file as stdin.
    ["stdin-script", "sed -f /dev/{stdin,null} <r183.sed r183.input"],
    ["stdin-script", "awk -f /dev/{stdin,null} in"],
    // A heredoc held on another descriptor reaches a program that names it.
    ["stdin-script", "/bin/bash /dev/fd/3 3<<'EOF'\nsleep 1\nEOF"],
    // A script file an expansion or a glob names may be stdin when it runs.
    ["stdin-script", "sed -n -f /dev/fd/$((0)) /etc/hosts 3<<'EOF' <&3\n1p\nEOF"],
    ["stdin-script", "awk -f /dev/fd/[0] in"],
    // A subscript is expanded again when evaluated, so a quoted substitution inside one runs.
    ["substitution-or-assignment", "[[ -v 'a[$(sleep 1)]' ]]"],
    ["substitution-or-assignment", "test -v 'a[`sleep 1`]'"],
    ["substitution-or-assignment", "printf %s \"${a['$(sleep 1)']}\""],
    // Gawk's `-W source` is `--source` by another spelling.
    ["program-in-string", "gawk -f /dev/null -W source 'BEGIN { system(\"sleep 1\") }'"],
    ["program-in-string", "awk -f prog.awk -Wsource=x"],
    // An array subscript, a substring offset and a conditional's operand are all arithmetic.
    ["substitution-or-assignment", 'printf %s "${a[x=7]}"'],
    ["substitution-or-assignment", 'printf %s "${c:r=1}"'],
    ["substitution-or-assignment", "[[ y=1 -eq 1 ]]"],
    ["substitution-or-assignment", "test -v 'a[z=1]'"],
    // `/dev/fd/3` names the same inherited descriptor as `>&3`.
    ["write-redirect", "printf x | tee /dev/fd/3"],
    ["write-redirect", "printf x >/dev/fd/3"],
    // A named-descriptor redirection stores the descriptor's number in a variable.
    ["substitution-or-assignment", 'true {R175_FD}</dev/null; test -n "$R175_FD"'],
    ["substitution-or-assignment", "exec {a[1]}>&2"],
    // An escaped blank keeps the `#` after it inside the word.
    ["chain", "printf X\\ #Y; printf A; printf B"],
    ["chain", "printf X\\;#Y; printf A; printf B"],
    // A descriptor past 2 may be a file the caller's shell inherited.
    ["write-redirect", "printf owned >&3"],
    ["write-redirect", "printf owned 1>&4-"],
    // An unquoted `(` glued inside a word is an operator, so `time(` opens a subshell.
    ["loop-or-branch", "time(sleep 1)"],
    ["loop-or-branch", "!(sleep 1)"],
    // A `#` glued after `$((…))` or `$(…)` is part of the word, never a comment.
    ["chain", "printf '%s' $((1))#x; printf A; printf B"],
    ["chain", "printf '%s' $(true)#x; printf A; printf B"],
    // A builtin that stores into a variable rather than printing.
    ["substitution-or-assignment", "let R170_X=1"],
    ["substitution-or-assignment", "getopts ab R170_X"],
    ["substitution-or-assignment", "printf -v R170_X %s ok"],
    ["substitution-or-assignment", "wait -p R170_X"],
    // An expansion that assigns creates shell state inside one command.
    ["substitution-or-assignment", 'printf %s "${R169_X:=ok}"'],
    ["substitution-or-assignment", "echo $((X=5))"],
    ["substitution-or-assignment", "cat <<EOF\n${X=1}\nEOF"],
    // Find puts each path it visits where `{}` stands, the program name included.
    ["substitution-or-assignment", "cd /bin && find sleep -exec ./{} 0.2 \\;"],
    ["substitution-or-assignment", "find /bin/sleep -exec env {} 0.2 \\;"],
    // The descriptor copied is named by an arithmetic expansion.
    ["stdin-script", "bash 3<<'EOF' 0<&$((3))\nsleep 1\nEOF"],
    // A bare `exec` keeps descriptor 3 open for the command after it.
    ["stdin-script", "exec 3<<'EOF'\nsleep 1\nEOF\nbash <&3"],
    ["stdin-script", "exec 3<<< 'sleep 1'\nbash <&3"],
  ])("%s: %s", (kind, command) => {
    expect(classesOf({ command })).toContain(kind);
  });

  it("names a shell's -c payload as a program in a string, and walks it", () => {
    expect(classesOf({ command: "bash -c 'sleep 5'" })).toEqual(["sleep", "program-in-string"]);
  });

  it("walks the script a shell reads from a heredoc", () => {
    expect(classesOf({ command: "bash <<'EOF'\nsleep 1\nEOF" })).toEqual(["sleep", "stdin-script"]);
  });

  it("walks a substitution's own body", () => {
    expect(classesOf({ command: "echo $(sleep 1)" })).toEqual(["sleep", "substitution-or-assignment"]);
  });

  it("walks a substitution an unquoted heredoc body expands, and leaves a quoted one as data", () => {
    expect(classesOf({ command: "cat <<EOF\n$(touch x > out)\nEOF" })).toEqual([
      "write-redirect",
      "substitution-or-assignment",
    ]);
    expect(classesOf({ command: "cat <<'EOF'\n$(touch x)\nEOF" })).toEqual([]);
    expect(classesOf({ command: "cat <<EOF\nplain $HOME text\nEOF" })).toEqual([]);
  });

  it("closes a quoted delimiter where bash does, so the commands after it are counted", () => {
    expect(classesOf({ command: 'cat <<"E\\"OF"\ndata\nE"OF\nprintf A\nprintf B\nprintf C' })).toEqual(["chain"]);
    expect(classesOf({ command: "cat <<EO\\\nF\ndata\nEOF\necho a\necho b" })).toEqual(["chain", "split-word"]);
    // An unquoted body folds `tr\⏎ue` into the terminator `true`; a quoted one does not.
    expect(classesOf({ command: "cat <<true\ntr\\\nue\nprintf A\nprintf B\nprintf C\ntrue" })).toEqual(["chain"]);
    expect(classesOf({ command: "cat <<'true'\ntr\\\nue\nprintf A\nprintf B\nprintf C\ntrue" })).toEqual([]);
    expect(classesOf({ command: "cat <<'EOF'\ndata\nEOF" })).toEqual([]);
  });

  it("refuses a $'…' delimiter, whose escapes each bash version decodes its own way, still counting what follows", () => {
    expect(classesOf({ command: "cat <<$'EOF'\ndata\nEOF" })).toEqual(["unreadable-heredoc"]);
    expect(classesOf({ command: "cat <<$'E\\x4fF'\ndata\nEOF\necho a\necho b" })).toEqual([
      "chain",
      "unreadable-heredoc",
    ]);
    expect(classesOf({ command: "cat <<$'\\400'\nbody\n\nprintf a\nprintf b\nprintf c" })).toEqual([
      "chain",
      "unreadable-heredoc",
    ]);
    // bash 3.2 leaves `\u` literal, so its body closes at `A\u0000B` while a newer shell reads `A`.
    expect(classesOf({ command: "cat <<$'A\\u0000B'\nbody\nA\\u0000B\nprintf a\nprintf b\nprintf c" })).toEqual([
      "unreadable-heredoc",
    ]);
  });

  it('refuses a $"…" delimiter, which a message catalog may translate to another word', () => {
    expect(classesOf({ command: 'cat <<$"EOF"\ndata\nFIN\nprintf A\nprintf B\nprintf C\nEOF' })).toEqual([
      "unreadable-heredoc",
    ]);
  });

  it("refuses a heredoc that never closes, since a misread delimiter is what leaves one open", () => {
    expect(classesOf({ command: "cat <<EOF\nbody\nprintf a\nprintf b" })).toEqual(["unreadable-heredoc"]);
  });
});

describe("classifyRawBash — jq, banned wherever it runs", () => {
  it.each([
    ["the chair's tick-form patch, one command", "jq --rawfile f1 f1-17.txt -f patch-17.jq patch-16.json"],
    ["a filter over a file", "jq '.actions | length' tick.json"],
    ["jq by its path", "/usr/bin/jq . tick.json"],
    ["a reimplementation", "gojq . tick.json"],
    ["the same language over YAML", "yq -i '.a = 1' config.yaml"],
    ["behind a wrapper", "env jq . tick.json"],
    ["behind macOS arch", "arch -arm64 jq . tick.json"],
    ["behind chroot, a wrapper only the start grammar knows", "chroot /sandbox /usr/bin/jq . /tick.json"],
    ["behind taskset", "taskset 0x1 jq . tick.json"],
    ["behind macOS script, after its transcript file", "script -q /dev/null jq -n '1'"],
    ["behind an assignment prefix and a start-grammar wrapper", "FOO=1 script -q /dev/null jq -n 1"],
    ["behind xargs", "ls *.json | xargs jq ."],
    ["run by find on each match", "find . -name '*.json' -exec jq . {} \\;"],
  ])("%s", (_label, command) => {
    expect(classesOf({ command })).toContain("jq");
  });

  it("refuses jq as a pipe stage, where it was once a read-only filter", () => {
    expect(classesOf({ command: "slopweaver handover list --json | jq '.rows'" })).toEqual(["jq", "stdin-script"]);
  });

  it("walks into a shell's -c payload and a substitution to find it", () => {
    expect(classesOf({ command: "bash -c 'jq . a.json'" })).toEqual(["jq", "program-in-string"]);
    expect(classesOf({ command: "echo $(jq -r .id a.json)" })).toEqual(["jq", "substitution-or-assignment"]);
  });

  it("still refuses a jq nested past the walk's depth, under the substitution it hides in", () => {
    expect(classesOf({ command: "echo $(echo $(echo $(jq . a.json)))" })).toEqual(["jq", "substitution-or-assignment"]);
    expect(classesOf({ command: "echo $(echo $(echo $(echo $(jq . a.json))))" })).toEqual([
      "substitution-or-assignment",
    ]);
  });

  it("names the replacement and the hatch in the refusal", () => {
    const { message } = refusalOf({ command: "jq . tick.json" });

    expect(message).toContain("jq, which is banned");
    expect(message).toContain("SLOPWEAVER_ALLOW_BASH=1");
  });

  it("leaves a word that only mentions jq alone", () => {
    expect(classesOf({ command: "rg 'jq -f' src" })).toEqual([]);
    expect(classesOf({ command: "git log --grep jq" })).toEqual([]);
  });

  it("is opened by the hatch, for the exceptional case", () => {
    expect(classifyRawBash({ allowBash: false, command: "SLOPWEAVER_ALLOW_BASH=1 jq . a.json" })).toEqual({
      blocked: false,
    });
  });
});

describe("classifyRawBash — the chain boundary", () => {
  const chainOf = ({ length }: { length: number }): string => {
    const head = "echo a && echo ";
    return `${head}${"b".repeat(length - head.length)}`;
  };

  it("allows a two-command chain of exactly the limit", () => {
    expect(chainOf({ length: CHAIN_MAX_CHARS }).length).toBe(200);
    expect(classesOf({ command: chainOf({ length: CHAIN_MAX_CHARS }) })).toEqual([]);
  });

  it("refuses one character past it", () => {
    expect(classesOf({ command: chainOf({ length: CHAIN_MAX_CHARS + 1 }) })).toEqual(["chain"]);
  });

  it("does not count a heredoc body toward the limit", () => {
    const command = `cd /tmp/wt && git commit -F - <<'EOF'\n${"x".repeat(400)}\nEOF`;
    expect(classesOf({ command })).toEqual([]);
  });
});

describe("classifyRawBash — the refusal", () => {
  it("reports every class a command hits, in canonical order, with each replacement", () => {
    const { classes } = refusalOf({ command: "sleep 1; echo $(date) > out.txt; sed -i s/a/b/ f" });

    expect(classes).toEqual(["chain", "write-redirect", "in-place-edit", "sleep", "substitution-or-assignment"]);
  });

  it("renders the four-line refusal naming the hatch and the replacement tool", () => {
    const { message } = refusalOf({ command: "echo hi > notes.txt" });

    expect(message.split("\n")).toHaveLength(4);
    expect(message).toContain("use the Write tool");
    expect(message).toContain("SLOPWEAVER_ALLOW_BASH=1");
  });
});

describe("classifyMonitorCommand", () => {
  it.each([
    "jq . tick.json",
    "until test -f done; do sleep 5; done; jq . out.json",
    "while true; do gojq . a.json; sleep 5; done",
    "tail -f log | jq .",
  ])("refuses jq in `%s`, naming jq alone", (command) => {
    const verdict = classifyMonitorCommand({ allowBash: false, command });
    expect(verdict.blocked).toBe(true);
    expect(verdict).toMatchObject({ classes: ["jq"] });
  });

  it.each(["until test -f done; do sleep 5; done", "tail -f log | grep jq", "a; b; c"])(
    "lets `%s` through, since a watch loop is a Monitor's shape",
    (command) => {
      expect(classifyMonitorCommand({ allowBash: false, command })).toEqual({ blocked: false });
    },
  );

  it("is opened by either hatch", () => {
    expect(classifyMonitorCommand({ allowBash: true, command: "jq ." })).toEqual({ blocked: false });
    expect(classifyMonitorCommand({ allowBash: false, command: "SLOPWEAVER_ALLOW_BASH=1 jq ." })).toEqual({
      blocked: false,
    });
  });
});

describe("classifyRawBash — the hatch", () => {
  it("is opened by the process environment", () => {
    expect(classifyRawBash({ allowBash: true, command: "a; b; c" })).toEqual({ blocked: false });
  });

  it("is opened by a prefix on the command's first command", () => {
    expect(classifyRawBash({ allowBash: false, command: "SLOPWEAVER_ALLOW_BASH=1 a; b; c" })).toEqual({
      blocked: false,
    });
  });

  it("is not opened by another hatch's prefix, nor a prefix on a later command", () => {
    expect(classesOf({ command: "SLOPWEAVER_ALLOW_PYTHON=1 a; b; c" })).toEqual(["chain"]);
    expect(classesOf({ command: "a; b; SLOPWEAVER_ALLOW_BASH=1 c" })).toEqual(["chain"]);
  });

  // Bash sets only FOO here, so the hatch's text inside its value opens nothing.
  it.each([
    'FOO="x SLOPWEAVER_ALLOW_BASH=1 BAR=y" jq .',
    "FOO='x SLOPWEAVER_ALLOW_BASH=1' jq .",
    "FOO=x\\ SLOPWEAVER_ALLOW_BASH=1 jq .",
    "FOO=$(echo SLOPWEAVER_ALLOW_BASH=1) jq .",
  ])("is not opened by its text inside an earlier assignment's value: `%s`", (command) => {
    expect(classesOf({ command })).toContain("jq");
  });

  it("is still opened by a prefix after a plain assignment", () => {
    expect(classifyRawBash({ allowBash: false, command: "FOO=x SLOPWEAVER_ALLOW_BASH=1 jq ." })).toEqual({
      blocked: false,
    });
  });
});
