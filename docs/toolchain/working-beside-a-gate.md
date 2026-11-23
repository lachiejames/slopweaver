# Working beside a gate

Part of [Toolchain](../toolchain.md).

Three ways a session fails a gate, or loses a run, without anything in its diff being wrong. Each is a property
of how the gates read the tree, so each is avoided by how you work rather than fixed in the gate.

## A comment that demonstrates a pattern gate trips it

The text-scanning gates match a SHAPE, never a value, and they read every working-tree file, comments
included. So a module header that pastes a matching literal to show what a gate catches is caught by that
gate, on that line. A synthetic placeholder is no escape: a made-up token in the right shape matches exactly
as a real one does. MEASURED on `src/live/automation/definition.ts`, whose header pasted a synthetic
Slack channel id to illustrate `raw-workspace-id` and was caught on that line.

A real `raw-workspace-id`, or a forbidden identifier, refuses wherever `IDENTIFIER_VERDICT` reads `refuse`,
and a CREDENTIAL class — a token prefix followed by enough characters, for instance — always refuses
([the hygiene gate](../security/hygiene-gate.md)). The rule is the same for both, and for any gate
that matches a pattern rather than a listed value:

- **Describe the shape in words and carry the command that reproduces it** —
  `yarn slopweaver dev lint --only hygiene` — rather than spelling a literal that matches it.
- **Fix the comment, never the gate.**
- **Record the refusal as one of the pull request's Checks.** A gate refusing the file that argues for it is
  the strongest evidence the rule is mechanical rather than a preference; cleaned up quietly, it is lost.

## Leave the tree alone while a gate runs

A scanning gate lists the files first and reads them after, and it fails CLOSED on a file it listed and then
could not read — an unreadable file is a file the gate did not check (`src/lib/textFileScan.ts`, and the
`hygiene` gate of the local `pre-push` lane on the same terms in `src/hygiene/scan.ts`). So a scratch
file created and removed while a gate is running in the background fails the whole gate on a path that was never
part of the change. MEASURED on a pull request: a probe script written and deleted
inside one `Bash` call, beside a backgrounded `github push`, cost a full gate lap.

- Confirm `git status --short` is clean before backgrounding a gate, then leave the tree alone until it exits.
- A probe needed mid-gate goes under the session's scratchpad directory and runs by absolute path from there,
  never at the repository root.
- Two gates running at once in one worktree is the same hazard. A background task revived after a machine
  restart can start a second one with no sign that it did.

## Kill by id, never by a grep naming the pattern

A `ps … | grep "[p]attern" | xargs kill` matches the SHELL running it whenever the pattern also appears in the
same command line. The bracket trick hides only the `grep` process, never the parent whose argv carries the
string. MEASURED: a cleanup that killed a running `yarn validate` and then started a fresh one, in
one compound line, killed its own wrapping shell first; both runs reported exit 144, and the dead pool driver
left orphaned `vitest` fork workers behind. The `raw-bash-gate` refuses that compound shape today
([hooks](../hooks/session-guards.md#the-raw-bash-gate)), so what remains is the habit:

- Stop a background task by its task id (`TaskStop`), or a process by a PID captured BEFORE the command that
  names it.
- When a kill genuinely has to be by path, match the worktree's full path
  (`ps -Ao pid=,command=` filtered on `<worktree>/node_modules/vitest`), so it cannot reach another session's
  processes.
- Orphaned `vitest` forks do not exit on their own; reap them by PID.
