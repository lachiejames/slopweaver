# The no-Python rule

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

Slopweaver builds its own tools for everything in TypeScript, so each is type-safe, tested, linted and exposed
through the CLI. Anything a session reaches for Python to do is a sign of a tool that should have been built
that way instead — and for Python that is true 100% of the time, where for Bash it is only sometimes.

**What prompted it was a FINDING, not a breach.** A session titled "Python heredoc in bot turn reads Slack
compact JSONL" was fixing what happened: a bot turn's Python heredoc read a multi-gigabyte Slack `compact.jsonl`
whole and expanded to tens of gigabytes at the swap hold, its argv read `Python -` so `machine capacity` called it a
foreign hog, and the `whole-file-json` gate cannot see inside a heredoc. The fix that landed is TypeScript. So
the rule is what that incident argues for, and the two halves it asks for are this rule and the supervisor
chair's own tick mechanics, which were Python scratch scripts.

**What the rule is.** Work done with Python is done in typed, tested TypeScript reached through a `slopweaver`
verb — 100% of the time. That some Bash work belongs in TypeScript too is its own gate, with its own line:
[the no-raw-Bash rule](./no-raw-bash.md).

**What the gate is, and the boundary it does NOT claim.** `no-python` (`src/devLint/noPython.ts`) reads every
tracked `.ts`, `.md`, `.sh`, `.py` and extensionless file under `src/`, `eval/`, `hooks/` and `skills/` — a
suffixed script such as `probe.bash` is outside that selection, so its shebang is not read — and refuses four
shapes: a `.py` file, a Python
shebang, a literal command handed to a `child_process`/`execa` binding the file imports and never rebinds (a
name a parameter or local shadows anywhere is dropped, so a false refusal of valid code becomes a rare miss),
and an interpreter
word at COMMAND position in a comment, a Markdown file or a shell line — in prose it must also carry the
evidence of a real invocation (an option, a redirection, a `*.py` path). That sharpening is what keeps a
backticked interpreter name in a list of interpreters, a generated `list-python-packages`, narrative naming the
language, and a command held as test DATA outside the criterion; all four stand in this tree today. It is a
static tripwire over visible text, never a shell: it does not expand an alias or a variable, follow a wrapper
function, read a heredoc body's semantics, or see a command assembled at run time. A block confirms you were
wrong; its absence means nothing.

**Why a DEBT list rather than a rewrite.** The gate's first run found 22 instructions, and all but one are a
measurement's reproduction command in a doc comment — which this repo's own rule REQUIRES a measured comment to
carry. Replacing one is not a text edit: the replacement has to be run and shown to give the same number, and
several need private corpus files or live provider state. Rewriting them from inspection would have put 21
unverified commands into canon to clear a lint, which is the failure the reproduction rule exists to prevent. So
they are recorded in `src/devLint/noPythonDebt.ts`, keyed by exact path and trimmed line with a count, and a
converted one goes STALE and fails the gate — the list can only shrink. There is no exemption marker: a false
positive is retired by sharpening the criterion.

**The runtime half is enforced by the admit hook.** `src/admit/pythonInvocation.ts` refuses a Python invocation
in a walk of its own, independent of the raw-tool table, through an ambient or per-segment
`SLOPWEAVER_ALLOW_PYTHON` hatch that `SLOPWEAVER_ALLOW_RAW` does not open. `src/admit/rawTools.ts`'s interpreter
paragraph and [the hook page](../hooks/browser-memory-and-limits.md) describe that boundary and what it cannot see.
