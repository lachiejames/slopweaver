# The no-raw-Bash rule

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

**What the rule is for.** Agents do everything through `slopweaver` verbs, and raw Bash is banned the way
Python is, with a few whitelisted exceptions. It extends [the no-Python rule](./no-python.md), whose own reason
already covers it: some Bash work belongs in TypeScript too.

**Where the line is.** The chair settled the three open questions on the design page
(`~/.slopweaver/pages/raw-bash-gate-design/`), inside the owner's mandate. The shape that prompted the rule was a
600-character `a; b; c` call from the chair itself, so a batch of read-only one-liners is exactly the shape
the rule is aimed at:

- **Allowed:** ONE command of any program, piped only through read-only filters (`grep`, `rg`, `head`, `tail`,
  `wc`, `sort`, `uniq`, `cut`, `tr`, `column`, `cat`, `sed` without `-i`, `tee` into nothing). Or TWO
  commands chained, within 200 characters with heredoc bodies not counted (`cd <worktree> && git status`). A
  literal `NAME=value` prefix (never on a special builtin such as `:`, where POSIX mode keeps it), `2>&1`, `>/dev/null`, `< file`, and a heredoc handed as DATA to a program that is
  not an interpreter (`git commit -F - <<'EOF'`). A script FILE already on disk, by argument or `<`
  (`bash scripts/docs-site.sh`, `sh < scripts/docs-site.sh`): the gate refuses script text written into the call, and a
  committed file is reviewed where it lives.
- **Refused from day one**, every class a call hits named in one refusal with what to use instead:

| Class                        | What it catches                                                                                                                                                                                                                                                                                                                                                                                                       | Use instead                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `chain`                      | three or more commands by `;`, `&&`, `\|\|`, a newline or `&`; two past 200                                                                                                                                                                                                                                                                                                                                           | one call per command, or the verb that does both                                |
| `write-redirect`             | `> f`, `>> f`, `&> f`, `tee f` (BSD `tee -`, or a `-a` after a file, too), `sort -o f`, a sed `w` command, `>&3` or `/dev/fd/3`, a descriptor past stderr                                                                                                                                                                                                                                                             | the Write tool                                                                  |
| `in-place-edit`              | `sed -i`, `sed -I`, `perl -i`, `ruby -i`                                                                                                                                                                                                                                                                                                                                                                              | the Edit tool                                                                   |
| `sleep`                      | `sleep` anywhere, including inside `bash -c`                                                                                                                                                                                                                                                                                                                                                                          | an idle CI/clock wait: `handover park --wake-*`; a short one: run_in_background |
| `program-in-string`          | `node -e`, `bash -c`, `eval`, `trap '…' EXIT`, `find -exec sh -c`, `awk '<program>'` or `-W source`, `rg --pre` or `sort --compress-program`, a sed script an expansion spells (`sed "$X"`), `perl -e`                                                                                                                                                                                                                | a verb                                                                          |
| `jq`                         | `jq`, `gojq` or `jaq` anywhere: one command, a pipe stage, behind a wrapper or `xargs`, under `find -exec`, inside `bash -c` or a substitution                                                                                                                                                                                                                                                                        | the verb's own flags, the Read or Edit tool, or a verb built for the job        |
| `loop-or-branch`             | `for`, `while`, `if`, `case`, a function, a `( … )` subshell or `{ … }` group, an unquoted `(` inside a word (`time(sleep 1)`)                                                                                                                                                                                                                                                                                        | a verb that takes several ids                                                   |
| `substitution-or-assignment` | `$(…)`, backticks, bash 5.3's `${ cmd; }`, `<(…)`, `>(…)`, a bare `NAME=value`, `${X:=v}` or `$((X=1))`, a `{fd}<` redirection, a `${a[x=1]}` subscript or `[[ x=1 -eq 1 ]]` operand (a substitution, or a `$'…'` decoding into one, in a subscript too), `export`, `let`, `printf -v`, `hash`/`alias`/`enable`/`shopt`, a `"$VAR"`, glob- or find `{}`-named program                                                 | the literal value, read in its own call                                         |
| `stdin-script`               | a heredoc or here-string fed to anything but a filter, `git` or `slopweaver` (a copy onto stdin, one on another descriptor a `/dev/fd/3` operand reads, or any input a bare `exec` opens, included), `sed -f -` or `awk -f -` (any spelling of stdin, a `-f` name an expansion, glob or brace spells, or any `-f` file beside a fed stdin, which may be a link to it, included), or a pipe into anything but a filter | a verb                                                                          |
| `unreadable-wrapper`         | `env -P /bin sh`: a wrapper option no grammar lists, so the program is unknown                                                                                                                                                                                                                                                                                                                                        | the program, run directly                                                       |
| `unreadable-heredoc`         | a heredoc that never closes, or whose delimiter is `$'…'` or `$"…"`, so where bash ends its body is unknown                                                                                                                                                                                                                                                                                                           | a plain `'EOF'` delimiter, closed on its own line                               |
| `expanding-option`           | `node [-]e …`, `sed -n 1p *`, `find . -e?ec …`: a glob or expansion in an argument opening with one or a `-`, to an evaluator, awk, `sed`, `sort` or `find`, so it may expand to an option                                                                                                                                                                                                                            | `./*.ts`, or `--` before it                                                     |
| `split-word`                 | `$\⏎[1<<2]`, `\|\⏎\|`: an unquoted backslash-newline inside a word or straight after an operator, which bash removes before it reads a token                                                                                                                                                                                                                                                                          | a space before the backslash, or one line                                       |

**Why jq is refused by name.** The line above let ONE command of any program through, and jq is one command
that is a whole program. A supervisor chair once patched every tick form with `jq --rawfile … -f patch-N.jq` as
a background job, then edited the harness's exit trailer out of each output, all day, with the gate silent. jq
was already banned in this repository, the fleet builds its own commands for everything, and a chair never
needs raw Bash; almost any raw Bash should fail to execute, with an escape hatch for exceptional circumstances.
So jq is a class of its own, refused wherever the gate can see a program run, and no longer a read-only
filter; the tick form is written by `supervisor tick fill`; the hatch is unchanged.

**Why refuse rather than warn.** Warn-first is the soft loading that gets re-argued every time. A refusal names
its replacement, and the hatch is one prefix, so the cost of a false refusal is one retry.

**The measurement.** Over the 24 hours before the rule, 25,200 Bash calls in 179 sessions: 11,500 would have
been refused under this line, from 170 sessions, a median session seeing 40.5% of its calls refused. Reproduce
it from a checkout with `node_modules/.bin/tsx ~/.slopweaver/pages/raw-bash-gate-design/rules.mts 24`.
One class, a verb piped through `grep` (2,572 calls), stays ALLOWED: the chair ruled that shape is the VERB's
defect, to be fixed by a `--json` field or a flag ranked by how often each pattern was reached for.

**The gate.** `src/admit/rawBash.ts` (with `rawBashStage.ts`) is the pure criterion. `rawBashGuardRunner.ts` is
its `PreToolUse` check, `raw-bash-gate`, placed right after `admit` so a Python or door refusal is seen first.
It matches `Bash` and `Monitor`, and judges a Monitor command for jq alone: a Monitor script is a watcher and
needs its loop, but jq is banned wherever it runs. It FAILS OPEN, because it is a
workflow tripwire, never a safety boundary. A lone `rm -rf dir` is one command and passes.

**The hatch.** `SLOPWEAVER_ALLOW_BASH=1`, from the environment or as a prefix on the call's first command. It is
AMBIENT, like `SLOPWEAVER_ALLOW_PYTHON`: a hatch is journalled only on an outbound surface, and a local
tool choice sends nothing. It never opens a raw-door or Python refusal, and neither of theirs opens it.

**Evaluators fail closed.** `src/admit/programText.ts` names the programs that run program text of their own
(shells, `node`, `perl`, `R`, `julia`, …). Past the spellings each documents, an evaluator whose FIRST argument
is an option rather than its script file is refused, because an option the table cannot read may be the program
(`R --expression=…`, `deno --quiet eval …`). A lone `--version` or `--help` passes.

**Heredocs fail closed too.** A misread delimiter hides every command after it inside the "body", so a heredoc
whose end the gate cannot place is refused rather than decoded: one that never closes, and one whose delimiter
is `$'…'` or `$"…"`: bash 3.2 leaves `\u` literal where a newer shell decodes it, and a message catalog may translate a `$"…"` word (`src/admit/heredocDelimiter.ts`).

**What it cannot see.** An alias or function; code in a variable's inherited value (`x='a=7'` re-evaluated by
`$((x))`), because it reads the command and never the environment; an interpreter the evaluator table does not name; a program
on disk under a name the tables do not know (a copy or link of `sleep` or `bash`, by path or through a `PATH`
the call sets), because the gate judges a program by its name; a launcher
neither the wrapper grammar (`env`, `nice`, `timeout`, `xargs`, …) nor `find`'s exec actions name, running
another program from its own arguments (`sudo`, `flock`, `parallel`, `yarn exec`); program text a
program reads from a plain operand rather than an option (`sqlite3 db '.shell …'`); a script a script calls; a command another host runs (`ssh host '…'`); anything a verb runs for you. A refusal
confirms you were writing a script; its absence proves nothing.
