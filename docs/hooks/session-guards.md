# The session depth advisory

Part of [Hooks — what runs automatically, and what each one refuses](../hooks.md).

**The `session-depth-warning` check tells EVERY session when it has crossed the 500k advisory
line, and stops none of them.** The owner's ruling: blocking risks undesirable outcomes here, and the real problem
is usually not blocking at all but that the agent has no awareness there is a problem. It speaks to every
session, not only the pinned supervisor — MEASURED over 822 transcripts touched in ten days, the
pinned supervisor was 11.2% of all above-600k spend and every other session the other 88.8%.

So there is no block verdict, no refusal, no allowlisted handoff path and no break-glass grant: nothing is
refused, so there is nothing to waive. Past 500k the hook injects one advisory as `PreToolUse`
`additionalContext`, on every `Bash` call while the session stays past the line — repetition being the point,
since a pull gauge fails precisely by being something a degraded session stops consulting.

The advisory deliberately tells the warned session NOT to act on it. The same ruling put that decision
elsewhere — the supervisor is the one that looks at session depth and token spend — so the text states the depth, asks only that durable state stay current, and names
`slopweaver session depth` as where the respawn call is actually made.

Every path exits 0, so this hook cannot wedge a session even when it fails. The threshold, the measurement
behind it and the logic are in `src/sessions/sessionDepthAwareness.ts` and
`src/admit/sessionDepthWarningRunner.ts`, unit-tested there.

## The auto-compact window is a user setting, not a hook

**`~/.claude/settings.json` sets `autoCompactWindow` to 300000**, beside `effortLevel` and `model`. It is the
owner's user settings rather than a tracked project file, so it reaches every chat the owner runs on this
device — the fleet's worktrees and the owner's own sessions in every other project alike — and the number is written in
exactly one place. This repository tracks no project settings file of its own, and its gitignored
`settings.local.json` stays for machine-local things.

The owner's ruling: a 300k auto-compact window is a low-effort, high-reward way to save tokens, and a session sets
it rather than asking the owner to press anything. **No console press is needed** — `autoCompactWindow` is a
member of the Claude Code `Settings` interface, so a settings file is the whole mechanism. A second ruling covers
the owner's own chats as well as the fleet's worktrees: the setting lives at user level, because the drift risk is
one number and a project-level copy left every chat the owner personally runs on the 967k default.

Three facts a reader needs, and none of them is derivable from the file:

- **It takes effect at the next session start**, never on a running one, including the session that writes it.
- **It is edited by a session, never by the owner.** A JSON file carries no comment, so this section is where the
  number's reason lives — above all the drift number, **about half of the targeted tool calls after a compaction
  re-read something the session had already read** — and a change to the window updates both the key and this
  section in the same act.
- **Compaction is lossy, and the loss is measured rather than assumed.** MEASURED over seven
  days — roughly a thousand sessions and hundreds of squash commits on `origin/main`, repro (the script is read from the
  store, never the home, and writes `compaction.json` into its working directory, hence the scratch one)
  `cd "$(mktemp -d)" && slopweaver store authored-show --ref handover-evidence/auto-compact-at-300k/compaction.mjs --out compaction.mjs && node compaction.mjs`: only a handful of
  compactions fired all week, each dropping a context near a million tokens to tens of thousands, taking minutes;
  and **about half of the targeted tool calls after a boundary re-read something the session had already read before it**. At
  300k the same week would have fired **roughly four hundred** compactions and avoided **billions of cache-read tokens,
  a material share of the total**. The saving is measured; the cost at 300k is not, because both the seconds and the re-reads were
  measured on a boundary that dropped near a million tokens rather than 300k. `slopweaver session compaction`, the same
  measurement as a verb, settles it, and § below is the rule for what to do with the answer.

**When to move off 300k.** Both numbers that decide it are written automatically — every `compact_boundary`
record in `~/.claude/projects/**/*.jsonl` carries `durationMs`, `preTokens` and `postTokens`, and the
re-reads are recoverable from the tool calls around it. The same measurement prices every candidate window:
looser windows (350k, 400k, 600k) save progressively fewer billions of tokens with fewer compactions. So the marginal
trade between 300k and 350k is **more than a hundred extra compactions for roughly two billion extra tokens**. Move the window UP when a re-run shows the measured cost of one compaction (its seconds, plus
its re-reads priced at the same weights) exceeding that marginal saving. Do not move it on a feeling that
sessions seem worse; that is the judgement this measurement exists to replace.

## The cmux-send-into-the-supervisor guard

**The `cmux-send-supervisor-guard` check refuses a `slopweaver cmux send --workspace <ref>` aimed at
the pinned `/slopweaver:supervisor` workspace**, unless the caller IS that same session. That box is the one
the owner types into, and typed text there is indistinguishable from the owner's own — measured when a spawned
session delivered its report by `cmux send`ing into it, a class of problem the owner had to raise more than once.
`.claude/rules/cross-session-messages.md` names
`SendMessage` as the one way to reach the supervisor; this hook is the trip-wire that catches the alternative
before the process even starts.

Same INERT-by-default shape as the depth guard above: it does nothing unless
`$SLOPWEAVER_HOME/sessions/supervisor-pin.json` names a workspace (`cmux unpin`, and a `cmux pin` of another
workspace, remove the record when the pin leaves the workspace it names), and even then only for a command that
NAMES that workspace's own ref or id on `--workspace`. It fails open on a malformed payload or an unregistered
pin — a workflow trip-wire, not a security boundary, and a bug here that failed closed would block ordinary
`cmux send` traffic fleet-wide. The pin names its holder as a host AND an id (a Claude Code session or a Codex
thread), and the hook's caller is the Claude session in its payload, so a Codex-held pin is never the caller and
every Claude session's send at that workspace is refused. `slopweaver cmux send` itself carries the same refusal, resolved LIVE against
cmux rather than text-matched against the pin file, so a session that shells out to the governed verb gets an
identical answer either way (`src/cmux/supervisorWorkspace.ts`'s `supervisorSendRefusalMessage`, shared by
both). The logic is in `src/admit/cmuxSendSupervisorGuard.ts`, unit-tested there.

## The home-git guard

**`$SLOPWEAVER_HOME` is a git checkout of its own state repository**, and supervisor sessions commit to it
(`git -C ~/.slopweaver reflog` shows them). A bare `git` issued from anywhere under it answers about THAT
repository, never the worktree you meant. **The `home-git-guard` check refuses the READ half**: a
remote-facing `git` — `fetch`, `pull`, `merge`, `rebase`, `push`, `ls-remote`, or any `origin/…` ref — that
names no repository and resolves to the home. MEASURED: a sweep standing in
`supervisor-scratch/` ran `git fetch origin main` and `git rev-parse --short origin/main`, read the state
repository's `main`, and graded slopweaver's trunk as moved. Hatch `SLOPWEAVER_ALLOW_HOME_GIT_IMPLICIT`; the
criterion is `src/admit/homeGitGuard.ts`'s header.

**The WRITE half is deliberately not guarded**, because a local `git` in the home is ordinary work on the
state repository. So it stays a habit, and it is the more expensive trap: a `cd` under the home followed by
`git add -A && git commit --amend` neither errors nor falls through to your repository — it amends whatever a
supervisor last committed, sweeping in every dirty file other live sessions are writing. MEASURED:
one such amend added 2,752 files of unrelated in-flight fleet state to a supervisor's handoff commit.

- Every repository command is `git -C <explicit root>`; a handover or ledger edit is a plain file edit with no
  `git` at all.
- A surprise SHA is settled with `git -C <worktree> cat-file -t <sha>` before anything acts on it.
- An accidental amend is undone with `git -C ~/.slopweaver reset --mixed <the pre-amend sha from its
reflog>`: every file stays on disk, though anything another session had STAGED comes back unstaged.

## The call-state guard

**A console-voice call file in a live home is the owner's words, and nothing in Slopweaver removes one.** A throwaway
`--home`'s calls are a test's own, and removing them is fine. The `call-state-guard` check
refuses a hand-run `Bash` command that would delete, move or overwrite a live home's `talk/calls/`, its
`call-index.txt`, a `talk/unread-cursors/` cursor or `call-quarantine.jsonl` — an `rm` (or `unlink`, `rmdir`,
`shred`, `srm`, `trash`), `mv`, a `cp`/`install`/`ln`/`rsync`/`ditto` over one, a `truncate`, a `dd of=`, a `tee` that does not
append, an in-place edit, a `find -delete`, a `git clean`, `rm`, `mv`, `restore`, `checkout`, a forced `switch` or `reset --hard` (the
live home tracks its call files in git) or a truncating `>`, an ancestor such as
`rm -rf ~/.slopweaver/talk` included. An append (`>>`, `tee -a`), a read and a copy OUT pass. MEASURED: a seat cleaned up its own e2e test calls with
one `rm` of seven call files in the real home; four were unrecoverable, and every `talk unread` was refused until
`slopweaver talk quarantine` accepted the loss. A test call belongs in a throwaway `--home`; a call already gone is
quarantined, never edited out of the index. Both live homes are guarded — the environment's `$SLOPWEAVER_HOME` and
the account default — so a shell pointed at a throwaway home still cannot reach the real one. Hatch
`SLOPWEAVER_ALLOW_CALL_STATE_DELETE`, honoured inline on the refused segment too. **A tripwire, not a fence:** it
reads one shell command's own words, so a nested `sh -c`, an interpreter (`python -c`, `node -e`), `xargs`, `eval`, a
function, a symlink or hard link to call state, a git alias from a config file, a variable naming a whole path from outside the home
(`rm "$F"`) and a `HOME` assigned from an expansion (`HOME=$(…)`) all pass it — its silence proves nothing. An expansion below a home's directory reads as anything there
and is refused, and so is a git subcommand the command aliases itself (`git -c alias.x=… x`) and a program name the
shell rewrites (`r{m,m}`, `$RM`), judged as any remover. A literal `HOME=`, `SLOPWEAVER_HOME=`, `OLDPWD=` or `GIT_WORK_TREE=`
the command assigns is judged too (`HOME=/Users/<owner>; cd "$HOME/.slopweaver/talk/calls"`), and so is a
`GIT_WORK_TREE` the session inherits. The criterion and every
fail-open residue are `src/admit/callStateGuard.ts`'s and `src/admit/callStateOperands.ts`'s headers.

## The poll gate

**The `agent-tool-ban` check refuses a sub-agent in a session that said it may not spawn one.**
The owner's ruling, after a load incident: one worker ran nineteen sub-agents against a brief
that forbade them, each stuck 43 minutes on its PreToolUse hooks, while the machine sat at load 100-146. A
session declares its own ban with `slopweaver session no-subagents --why "<the brief clause>"`; this hook then
refuses `Agent` and `Task` in that session, printing the clause back with `SLOPWEAVER_ALLOW_SUBAGENT=1` as the
hatch. It FAILS OPEN on everything it cannot resolve — a malformed payload, no `session_id`, an unreadable
home — because failing closed would refuse the Agent tool across the whole fleet, including the detective
fan-out `skills/loop-bot` makes mandatory. The ban is DECLARED, never inferred from a dispatch's execution
mode, and it is scoped to a SESSION: the payload carries nothing marking a sidechain, so it cannot express
"the parent may spawn, a detective may not" ([fleet-attribution.md](../../skills/supervisor/reference/fleet-attribution.md)).

**The `poll-gate` check refuses a turn spent polling.** The owner's ruling: never poll; set a monitor with a
timeout on everything instead. Measured when it was made by replaying the previous 24 hours of
every transcript on the machine through this gate's own classifier
(`~/.slopweaver/evidence/token-usage-audit-03sep.md`): 1,959 of 15,540 requests did nothing but re-read a
log, `kill -0` a pid, call `TaskOutput` again or run an `until` loop — 13.7% of the day's spend — and 642 of
the 909 repeats came under 60 seconds after the previous poll of the same target (median 16s), each
re-sending a ~300K-token context to learn nothing had changed. The gate would have refused 521 of them.

A `Bash` call is poll-shaped when EVERY segment is a probe or a no-op: a read of a log-like file (`cat`,
`head`, `wc`, `grep`, `ls`, `stat` on a path under a temp, scratchpad or state directory, or with a log
extension), a `tail` of anything, a `kill -0`, a `sleep`, an `until`/`while`/`for` loop — one that OPENS a
segment, so a verb quoting a loop inside its own `--evidence` argument is not one. `cd`, `echo`, `date` and an
assignment are no-ops; one segment of real work makes the whole call work. A `TaskOutput` call is a poll of
its task. The gate refuses the SECOND poll of the same target within 60 seconds, so a `TaskOutput` with
`block: true` that genuinely waited a minute is never refused, and a single read after a process finished
never is either. **A file that has not changed is never refused**: each poll records a change token — every
named file's path, real path, inode, size, mtime and ctime (`src/admit/pollFingerprint.ts`) — and a token inside the window whose every
file the last token already held, unchanged, is a re-read of a static file, allowed without moving the window: an equal
token, or a re-read naming fewer of the same files (`grep x A B` then `grep x A` share a target, keyed by the first path).
A file the last read did not name keeps the clock rule. MEASURED on one supervisor transcript: 12 of 16
poll-gate refusals were second reads of a handover doc, a published page, a tick's scratch JSON or a finished
task's output, every one older than the first read. A pid, a task, a foreground loop, a directory, a symbolic
link, a file this process cannot read, a word the shell expands (a substitution, a variable, a glob, a tilde), or an
option or redirect that could open a file the token cannot see, a `sed`, `awk` or `jq` riding the pipe, a command word with a path or one an assignment supplies, a substituted variable beside a single-quoted or escaped `$` or carrying a zsh modifier or subscript (`$S:r`, `$S[1]`), any character outside printable ASCII, tab and newline (a no-break space the shell keeps inside a word), an assignment whose value is more than one plain word or a `printf -v`, more than 64 named words, or a `cd`, has no token, and keeps the clock rule — in any segment of the call, not only the read itself. What the
token cannot see: a running process whose
log has gone quiet reads as finished. The refusal names the ONE command that replaces the poll when there is one
(`src/admit/pollReplacement.ts`): a verb's own `--wait` for a loop around `github checks`, `turn review --poll`,
`machine capacity`, `cmux spawn` or `github stack push`, `slopweaver wait --pid` for a pid probe and `slopweaver
wait --file` for a log read — all on the one wait contract, `src/wait/loop.ts`. **The replacement is not always
the verb the loop already runs**: a loop around `github read <pr-url>` or `github enqueue --dry-run` watching for
`merged` is answered with `github checks --number <n> --until merge`, the number lifted out of the loop's own
text, because the gap there was never capability. Then the generic recipe: `Monitor` with a timeout, or
`Bash` `run_in_background` and one blocking `TaskOutput`. Why it names the replacement: one measured week
saw 568 hand-rolled poll loops while this gate named only a shape, and a session refused a shape writes the loop
again — and re-measured five days after the wait contract landed, the rate had halved from 6.20 to 3.02
loops per 1,000 Bash calls. State is one file per session under
`$SLOPWEAVER_HOME/live/poll-gate/`; the break-glass is `SLOPWEAVER_ALLOW_POLL=1` in the session's own
environment. It fails open on everything it cannot read: it guards spend, and a broken spend guard that
wedged every shell call would cost more than the polling did. Logic in `src/admit/pollShape.ts`,
`pollGate.ts`, `pollGateStore.ts` and `pollGateRunner.ts`, unit-tested there.

## The raw-Bash gate

**The `raw-bash-gate` check refuses a `Bash` call that is a shell script rather than one command.** One
command piped only through read-only filters, or two commands chained within 200 characters, passes; a longer
chain, a write through a redirect, `sed -i`, `sleep`, a program in a string, a loop, a substitution or a script
fed on stdin is refused, every class named with what to use instead. It runs after every narrower `Bash` check
so their refusals are seen first, FAILS OPEN on a payload it cannot read, and opens with
`SLOPWEAVER_ALLOW_BASH=1`. The line, the measurement and what it cannot see:
[the no-raw-Bash rule](../doctrine-rationale/no-raw-bash.md).
