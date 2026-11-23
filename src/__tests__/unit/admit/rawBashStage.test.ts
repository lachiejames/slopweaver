/**
 * One pipeline stage judged on its own: what its program is asked to do, whether a pipe feeds it, and which
 * nested script it hands back for the caller to walk.
 */
import { describe, expect, it } from "vitest";

import { stageFinding } from "../../../admit/rawBashStage.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** Judge one stage's text. */
function judge({
  text,
  later = false,
  stdinBody,
}: {
  text: string;
  later?: boolean;
  stdinBody?: string;
}): ReturnType<typeof stageFinding> {
  return stageFinding({ later, stdinBody, words: shellWords({ text }).words });
}

describe("stageFinding", () => {
  it("passes a plain command, and a read-only filter a pipe feeds", () => {
    expect(judge({ text: "git log --oneline" })).toEqual({ classes: [], nested: [] });
    expect(judge({ later: true, text: "grep -v fix" })).toEqual({ classes: [], nested: [] });
  });

  it("refuses a pipe into a program that is not a filter", () => {
    expect(judge({ later: true, text: "xargs rm" })).toEqual({ classes: ["stdin-script"], nested: [] });
  });

  it("hands a shell's -c payload back to be walked", () => {
    expect(judge({ text: "bash -lc 'sleep 5; echo x'" })).toEqual({
      classes: ["program-in-string"],
      nested: ["sleep 5; echo x"],
    });
  });

  it("hands back the heredoc a shell reads as its program, and only names one an interpreter reads", () => {
    expect(judge({ stdinBody: "sleep 1", text: "sh" })).toEqual({ classes: ["stdin-script"], nested: ["sleep 1"] });
    expect(judge({ stdinBody: "console.log(1)", text: "node" })).toEqual({ classes: ["stdin-script"], nested: [] });
    expect(judge({ stdinBody: "a commit message", text: "git commit -F -" })).toEqual({ classes: [], nested: [] });
  });

  it("refuses a heredoc or here-string fed to any program that is not a known data reader", () => {
    expect(judge({ stdinBody: "io.open('x','w')", text: "lua" })).toEqual({ classes: ["stdin-script"], nested: [] });
    expect(judge({ text: "tclsh <<< 'exec touch x'" }).classes).toEqual(["stdin-script"]);
    expect(judge({ stdinBody: "body", text: "slopweaver github comment --body-file -" })).toEqual({
      classes: [],
      nested: [],
    });
    expect(judge({ stdinBody: "a\nb", text: "sort" })).toEqual({ classes: [], nested: [] });
  });

  it("hands back what eval runs, and a shell payload another program runs from its arguments", () => {
    expect(judge({ text: "eval 'a; b'" })).toEqual({ classes: ["program-in-string"], nested: ["a; b"] });
    expect(judge({ text: "find . -exec sh -c 'sleep 1' \\;" })).toEqual({
      classes: ["program-in-string"],
      nested: ["sleep 1"],
    });
    expect(judge({ text: "find . -exec 'sh' -c 'sleep 1' ';'" }).nested).toEqual(["sleep 1"]);
    expect(judge({ text: "grep bash -c notes.txt" })).toEqual({ classes: [], nested: [] });
  });

  it("hands back fish's uppercase -C and a long --command payload", () => {
    expect(judge({ text: "fish -C 'sleep 1'" })).toEqual({ classes: ["program-in-string"], nested: ["sleep 1"] });
    expect(judge({ text: "fish --init-command 'sleep 1'" }).nested).toEqual(["sleep 1"]);
    expect(judge({ text: "fish --command='sleep 1'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "fish scripts/setup.fish" })).toEqual({ classes: [], nested: [] });
  });

  it("hands back the command line env splits out of one string, in each spelling", () => {
    const splits = [
      "env -S 'sleep 1'",
      "env -vS 'sleep 1'",
      "env --split-string='sleep 1'",
      "A=1 env -S'sleep 1'",
      "env -u HOME -S 'sleep 1'",
    ];
    expect(splits.map((text) => judge({ text }))).toEqual(
      splits.map(() => ({ classes: ["program-in-string"], nested: ["sleep 1"] })),
    );
    expect(judge({ text: "env -u HOME git status" })).toEqual({ classes: [], nested: [] });
  });

  it("hands back the here-string a shell reads, and passes one fed to a filter", () => {
    expect(judge({ text: "bash <<< 'sleep 1'" })).toEqual({ classes: ["stdin-script"], nested: ["sleep 1"] });
    expect(judge({ text: "node <<<'console.log(1)'" })).toEqual({ classes: ["stdin-script"], nested: [] });
    expect(judge({ text: "grep x <<< 'a x b'" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "bash<<<'sleep 1'" })).toEqual({ classes: ["stdin-script"], nested: ["sleep 1"] });
    expect(judge({ text: 'bash<<<"$x"' }).classes).toEqual(["stdin-script"]);
  });

  it("refuses a program named by an expansion, and passes an expansion as an argument", () => {
    expect(judge({ text: `"$SHELL" -c 'printf x > out'` })).toEqual({
      classes: ["substitution-or-assignment"],
      nested: [],
    });
    expect(judge({ text: "$EDITOR notes.md" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: 'env "$X" -c y' }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: 'ls "$HOME"' })).toEqual({ classes: [], nested: [] });
  });

  it("refuses a program a glob or brace expansion picks, and passes a quoted one or the test builtin", () => {
    expect(judge({ text: "/bin/s[h] -c 'echo > out'" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "./run*" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "/bin/{ba,}sh x" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "'./run*'" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "[ -f x ]" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "ls src/*.ts" })).toEqual({ classes: [], nested: [] });
  });

  it("reads a > glued after = or - as the redirect bash makes it, and a quoted arrow as text", () => {
    expect(judge({ text: "printf data x=>written.txt" }).classes).toEqual(["write-redirect"]);
    expect(judge({ text: "echo a->out" }).classes).toEqual(["write-redirect"]);
    expect(judge({ text: "grep 'x=>y' src/a.ts" })).toEqual({ classes: [], nested: [] });
  });

  it("refuses a wrapper given an option its grammar does not list, and reads one it does", () => {
    expect(judge({ text: "env -P /bin sh -c 'echo owned > out.txt'" })).toEqual({
      classes: ["unreadable-wrapper"],
      nested: [],
    });
    expect(judge({ text: "env FOO=1 sh -c 'sleep 1'" })).toEqual({
      classes: ["program-in-string"],
      nested: ["sleep 1"],
    });
    expect(judge({ text: "env" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "/usr/bin/env -- sleep 1" }).classes).toEqual(["sleep"]);
    expect(judge({ text: "/usr/bin/nice -n 5 bash -c 'ls'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "command -v git" })).toEqual({ classes: [], nested: [] });
  });

  it("refuses sed or awk reading its script from stdin, however stdin is fed", () => {
    expect(judge({ text: "sed -f - /etc/hosts<<<'1e touch x'" }).classes).toEqual(["stdin-script"]);
    expect(judge({ text: "awk -f - in <<< 'BEGIN{system(\"x\")}'" }).classes).toEqual(["stdin-script"]);
    expect(judge({ text: "sed -f -", later: true }).classes).toEqual(["stdin-script"]);
    expect(judge({ text: "sed -f edits.sed in" })).toEqual({ classes: [], nested: [] });
  });

  it("names an evaluator's program string with the value glued to its flag", () => {
    expect(judge({ text: "osascript -e'return 7'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "lua -e'print(1)'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "node -e'console.log(1)'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "node --print=1" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "pwsh -Comm 'Get-Date'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "node scripts/build.js --verbose" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "deno --quiet eval 'console.log(1)'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "deno repl --eval 'Deno.exit()'" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "deno run scripts/check.ts" })).toEqual({ classes: [], nested: [] });
  });

  it("refuses a sed script that runs a shell command", () => {
    expect(judge({ text: "sed '1e touch out' in" }).classes).toEqual(["program-in-string"]);
    expect(judge({ text: "sed 's/.*/touch out/e' in" }).classes).toEqual(["program-in-string"]);
  });

  it("tells a descriptor duplication and a sink from a write to a file", () => {
    expect(judge({ text: "yarn tsc 2>&1 >/dev/null" })).toEqual({ classes: [], nested: [] });
    expect(judge({ text: "yarn tsc >out.log" })).toEqual({ classes: ["write-redirect"], nested: [] });
    expect(judge({ text: "echo a>b" })).toEqual({ classes: ["write-redirect"], nested: [] });
  });

  it("names a sed script that writes a file, and a sed that edits in place", () => {
    expect(judge({ text: "sed -n 's/a/b/w out.txt' f" })).toEqual({ classes: ["write-redirect"], nested: [] });
    expect(judge({ text: "sed -Ei.bak 's/a/b/' f" })).toEqual({ classes: ["in-place-edit"], nested: [] });
    expect(judge({ text: "sed -I '' 's/a/b/' f" }).classes).toEqual(["in-place-edit"]);
    expect(judge({ text: "ruby -pi.bak x.rb f" }).classes).toEqual(["in-place-edit", "program-in-string"]);
    expect(judge({ text: "ruby -Ilib x.rb" })).toEqual({ classes: ["program-in-string"], nested: [] });
  });

  it("names a sed w after an address, a GNU W, and the w flag under another delimiter", () => {
    const writes = ["sed '1w out.txt' f", "sed -n '$w out' f", "sed '1,5W out' f", "sed 's|a|b|gw out' f"];
    expect(writes.map((text) => judge({ text }).classes)).toEqual(writes.map(() => ["write-redirect"]));
  });

  it("passes a sed whose replacement merely holds a w word", () => {
    expect(judge({ text: "sed 's/new/a wide/' f" })).toEqual({ classes: [], nested: [] });
  });

  it("names perl's in-place switch with a backup suffix, never a valued -I or -M that holds an i", () => {
    expect(judge({ text: "perl -pi.orig x.pl f" })).toEqual({
      classes: ["in-place-edit", "program-in-string"],
      nested: [],
    });
    expect(judge({ text: "perl -Ilib -MList::Util x.pl" })).toEqual({ classes: ["program-in-string"], nested: [] });
  });

  it("names a perl or ruby program string behind any argument-free switch, never an in-place suffix", () => {
    const evals = [
      "perl -0777e 1",
      "perl -lne 1 f",
      "perl -E 1",
      "perl -de 1",
      "perl -wCSe 1",
      "ruby -ne 1 f",
      "ruby -Ue 1",
      "php -r 1",
      "php -nR 1",
      "php -qB 1",
    ];
    expect(evals.map((text) => judge({ text }).classes)).toEqual(evals.map(() => ["program-in-string"]));
    expect(judge({ text: "perl -0777pi x.pl f" }).classes).toEqual(["in-place-edit", "program-in-string"]);
  });

  it("names a tee write to a dash-named file after --, and passes a tee to a sink", () => {
    expect(judge({ later: true, text: "tee -- -out" }).classes).toEqual(["write-redirect"]);
    expect(judge({ later: true, text: "tee -a /dev/stderr" }).classes).toEqual([]);
  });

  it("names a sort output file in any spelling, never a sort key", () => {
    const writes = ["sort -o out f", "sort -oout f", "sort -uo out f", "sort --output=out f"];
    expect(writes.map((text) => judge({ text }).classes)).toEqual(writes.map(() => ["write-redirect"]));
    expect(judge({ text: "sort -k2,2 -t, f" }).classes).toEqual([]);
  });

  it("names a bare append, an array-element assignment and a whole-array assignment", () => {
    expect(judge({ text: "X+=1" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "a[0]=1" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "a=(1 2)" }).classes).toEqual(["substitution-or-assignment"]);
    expect(judge({ text: "a+=(3)" }).classes).toEqual(["substitution-or-assignment"]);
  });

  it("resolves the program past a wrapper and a path", () => {
    expect(judge({ text: "timeout 30 /bin/sleep 5" })).toEqual({ classes: ["sleep"], nested: [] });
  });

  it("reads a GNU long option by any prefix of its name, as getopt_long does", () => {
    expect(judge({ text: "gsed --expr='1w out.txt' /etc/hosts" }).classes).toEqual(["write-redirect"]);
    expect(judge({ text: "sed --in-pl s/a/b/ f" }).classes).toEqual(["in-place-edit"]);
    expect(judge({ text: "sort --out=x f" }).classes).toEqual(["write-redirect"]);
    expect(judge({ text: "sed --fi - f <<< '1e touch x'" }).classes).toEqual(["stdin-script"]);
    expect(judge({ text: "sed --expr='s/a/b/' f" })).toEqual({ classes: [], nested: [] });
  });

  it("reads Homebrew's g-prefixed GNU tools as the tools they are", () => {
    expect(judge({ text: "gsort -o /tmp/out /etc/hosts" }).classes).toEqual(["write-redirect"]);
    expect(judge({ text: "gsed -i s/a/b/ f" }).classes).toEqual(["in-place-edit"]);
    expect(judge({ text: "/opt/homebrew/bin/gtimeout 5 gsleep 1" }).classes).toEqual(["sleep"]);
    expect(judge({ text: "genv -S 'sleep 1'" }).nested).toEqual(["sleep 1"]);
    expect(judge({ text: "git log" })).toEqual({ classes: [], nested: [] });
  });
});
