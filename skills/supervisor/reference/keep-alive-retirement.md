# How a retired chair's keep-alive actually dies

Child of [standing-sessions.md](standing-sessions.md) § "The keep-alive": every chair starts `claude watch --wait`
inside its own seat, and the watch is meant to die with that seat. This page is how the seat actually closes.

**cmux 0.65.2 refuses to close any workspace with a live process unforced** (`confirmation_required`). So
`cmux takeover` step 5 (`src/cli/commands/cmux/takeoverClose.ts`) forces the close only when:

- the predecessor's screen proves it idle; or
- every root of its tree is its own `claude` (by `ps` argv — `claude`, or `node` running Claude Code's own `cli.js`;
  cmux titles it by version), every shell under it
  (counted by name, matching the footer's count) hosts a `claude watch`, and another
  watch OUTSIDE the seat — its tree plus whatever `ps` places under a pid in it — covers it; your queued `--wait`
  one does (`src/sessions/keepAliveSeatClose.ts`). A
  stopped (`T`) or zombie (`Z`) watch is never cover, and a shell running anything beside its watch
  (`claude watch & sleep 600`), or not itself asleep on it (`ps` state other than `S`/`I`), is never closed this way.
  Nor is one whose own command is not the keep-alive — work a shell runs itself shows only there. The keep-alive is
  `[CMUX_WORKSPACE_ID=… SLOPWEAVER_CLI_DIR=<dir>] <dir>/bin/slopweaver claude watch [--wait]` (the CLI dir is the
  program's own tree), optionally `2>&1` and piped through
  `grep`/`ugrep` (match-mode flags, one pattern) or `head`/`tail` (one line count), called by name, each owning one
  direct child process (`src/sessions/keepAliveShellCommand.ts`). Filter arguments are an allowlist: a `;`, `&`, `$`,
  a redirect, any other program, a file operand, `tail -f` or `ugrep --filter` holds its chair. Bare, as
  [standing-sessions.md](standing-sessions.md) says, or through the boot chain's `| grep -v '^slopweaver:'` prefix,
  both close.

Anything else leaves the tab open with its ledger row. `session close-done` retries the same judgement each tick
for an unpinned workspace still titled `/slopweaver:supervisor`. A watch inside a chair the same sweep already
closed, by its idle close, its park or this judgement — seen on any tree read the sweep made of it, or placed under
one by the `ps` read taken before that close — is never cover, so two chairs covering only each other never both
close; a chair it closed whose tree or `ps` did not read holds every later keep-alive close until the next tick. A chair holding the ONLY keep-alive is held with a line
saying so. Step 6 retires the board row either way.

**Measured** (`slopweaver session close-done --dry-run`, then `ps -o command= -p <a keep-alive shell's pid>`): 50 retired chairs stood open, each held as a bare `screen busy`. Two causes were stacked:
Claude Code 2.1.323 writes its Bash-tool shell as `&& \builtin setopt …`, which the shell-command reading did not
admit, so no keep-alive (a bare one included) read as one; and every chair's boot chain pipes its watch through
`grep`, which a bare-only rule refused. `close-done` now prints the judgement's own reason on a held retired chair.

**Measured**: with step 5 unforced, every takeover stopped there (two successive chairs printed
`cmux workspace.close failed (confirmation_required)`), and four `/slopweaver:supervisor` workspaces were open at
once. Re-check with `slopweaver cmux list --json` — one pinned chair, plus at most one successor mid-handover.

**Residue**: the cover is one observed process-table snapshot, never a fenced hand-over — the same admission race
standing-sessions.md names, which only a fenced single-writer ownership protocol would close.
