# The registered set

Part of [Hooks — what runs automatically, and what each one refuses](../hooks.md).

Every row's command is `scripts/hook.sh <declared timeout> <label> <target>`; the target is what the row
names, and a `SLOPWEAVER_HOOK_GIVE_UP=2` prefix — on the door-gated `PreToolUse` row only — makes a call the
envelope has to kill end REFUSED rather than released. A prefix, so an older mirrored `hook.sh` ignores it
rather than misreading it ([why](mirrors-and-failure-policy.md)).

| Event                            | Target                                                                                            | On failure |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| `PreToolUse` (three rows, below) | `hooks/pretooluse.ts` — every check below, one process                                            | per check  |
| `PostToolUse` (`Write`)          | `slopweaver memory hook --from-payload`                                                           | open       |
| `SessionStart`                   | mirror sync, dependency install, `slopweaver init`, `hooks/handover-run.sh`, `profile-context.sh` | open       |
| `PostCompact`                    | `hooks/handover-run.sh`                                                                           | open       |
| `Stop`                           | `hooks/handover-run.sh`                                                                           | open       |
| `UserPromptSubmit`               | `slopweaver claude seat --from-payload` — refuses a turn off every plan, or past its usage limit  | open       |

**Every `SessionStart` entry runs from the plugin root; every other event runs from the per-root mirror.**
`SessionStart` is the event that BUILDS the mirror, and its hooks start in parallel, so an entry there naming
the mirror ran before it existed on a fresh root and exited 127 — Codex's `codex-rules-context` included, since
Codex runs both manifests' `SessionStart` together. [Why, and the residue](mirrors-and-failure-policy.md#the-event-that-builds-the-mirror-cannot-run-from-it).

**`UserPromptSubmit` is the one entry that blocks a PROMPT**, not a tool call, and it blocks by a stdout
`{"decision":"block"}` line, never by exit 2: the CLI's own usage error is 2, so a seat whose CLI predates the verb
would block every prompt. The entry ends `|| true` for that reason. It refuses only a POSITIVE reading — an API key, or a boot credential
read and matched to no configured plan (the owner's ruling); a read that fails passes, and so does
a malformed payload. Hatch `SLOPWEAVER_ALLOW_UNROUTED_SEAT`; the judgement is `src/claude/seatAttest.ts`.
A seat ON a plan whose usage limit is below 100 then meets the per-turn usage gate (`src/claude/seatUsageGate.ts`),
which fails CLOSED: it holds the prompt at the limit, or when no recorded reading at most an hour old says the plan is
under it, and no hatch releases that hold. A plan at 100% reads nothing and passes exactly as before.

**A seat it already passed starts no node.** An `on-plan` verdict leaves `$SLOPWEAVER_HOME/live/seat-pass/<session>`
naming the seat's pid and process start (`src/claude/seatPass.ts`), and `bin/slopweaver` answers the next prompt
from it in bash (`hooks/lib/seat-pass.sh`) while that process lives, its registry record still matches, and the
marker is newer than both the plan register and Claude's `settings.json`. A seat on a limited weekly plan's marker
also names the plan and a window — from the second the pass was judged, so a clock stepped back misses, to the earlier of
the reading turning an hour old and a window resetting — and misses outside it or once the plan's snapshot
(`live/claude-usage/<plan>.json`) is not strictly older than it; a limited monthly-spend plan caches nothing. A plan
with no limit names `-` there instead, so a bare two-field marker from before the usage gate is a miss, as is any
line not exactly one of those two shapes. Every committed plan-register change clears every marker before it writes
its projections (`src/plans/store.ts`), so a change whose `accounts.json` write then failed still sends each seat's
next prompt to the full check. Any miss runs the full check unchanged, and a refusal is never cached. MEASURED under load 40+: the full check took 15–35 s against its 15 s
budget, and the cached path took 0.29 s. It lives in the launcher because a running seat reads `hooks.json` only
at boot, while the launcher is rewritten under it.

The `PreToolUse` checks that one dispatcher runs, in the order `src/admit/preToolUseChecks.ts` declares them —
the dispatcher stops at the first refusal, so the order decides which refusal a caller sees when two would
both refuse:

| Applies to                                                | Check                        | Its logic                                    | On failure |
| --------------------------------------------------------- | ---------------------------- | -------------------------------------------- | ---------- |
| every dispatcher tool                                     | `profile-held`               | `src/admit/profileHeldRunner.ts`             | **closed** |
| `Bash`/`Monitor`                                          | `bot-live-write-guard`       | `src/admit/botLiveWriteGuardRunner.ts`       | **closed** |
| `Bash`/`Monitor`/`Artifact`                               | `admit`                      | `src/admit/pretooluseAdmit.ts`               | **closed** |
| `Bash`                                                    | `main-checkout-guard`        | `src/admit/mainCheckoutBranchGuardRunner.ts` | open       |
| `Bash`                                                    | `main-checkout-dirty-guard`  | `src/admit/mainCheckoutDirtyGuardRunner.ts`  | open       |
| `Bash`                                                    | `home-git-guard`             | `src/admit/homeGitGuardRunner.ts`            | open       |
| `Bash`                                                    | `call-state-guard`           | `src/admit/callStateGuardRunner.ts`          | open       |
| `Bash`                                                    | `session-depth-warning`      | `src/admit/sessionDepthWarningRunner.ts`     | open       |
| `Bash`                                                    | `cmux-send-supervisor-guard` | `src/admit/cmuxSendSupervisorGuardRunner.ts` | open       |
| `Bash`/`Edit`/`Write`/`Read`/`Grep`/`Glob`/`NotebookEdit` | `protected-path-guard`       | `src/admit/protectedPathGuardRunner.ts`      | open       |
| `Bash`/`TaskOutput`                                       | `poll-gate`                  | `src/admit/pollGateRunner.ts`                | open       |
| `Bash`                                                    | `disk-scan-guard`            | `src/admit/diskScanGuardRunner.ts`           | open       |
| `Bash`                                                    | `whole-tree-check-guard`     | `src/admit/wholeTreeCheckGuardRunner.ts`     | open       |
| `Bash`                                                    | `run-due-deadline-guard`     | `src/admit/runDueDeadlineGuardRunner.ts`     | open       |
| `Bash`                                                    | `raw-bash-gate`              | `src/admit/rawBashGuardRunner.ts`            | open       |
| `Edit`/`Write`                                            | `main-checkout-edit-guard`   | `src/admit/mainCheckoutEditGuardRunner.ts`   | open       |
| `Edit`/`Write`                                            | `relay-words-guard`          | `src/admit/relayWordsGuardRunner.ts`         | open       |
| chrome MCP                                                | `browser-door-guard`         | `src/admit/browserDoorGuardRunner.ts`        | **closed** |
| `Agent`/`Task`                                            | `agent-tool-ban`             | `src/admit/agentToolBanGuardRunner.ts`       | open       |
| `Edit`/`Write`                                            | `memory-write-guard`         | `src/admit/memoryWriteGuardRunner.ts`        | open       |

`profile-held` is first because nothing after it should judge a call from a session that does not hold the
owner's profile: with no current delivery marker (`$SLOPWEAVER_HOME/profile/delivered/<context>`, written by
`profile-context.sh` only after it printed the profile, and void once a compaction lands in the transcript past it)
it refuses the call with the owner's profile in the refusal, so the retry passes
([loading is mechanically enforced](../store/owner-registers-and-roles.md#loading-is-mechanically-enforced)).
It is the one check that queues an `afterEmit` effect — its marker — which the dispatcher runs only after
`hooks/pretooluse.ts` has written every byte of stderr synchronously, so a refusal lost on the way out leaves the
context unmarked.
The same marker turns a spent dispatcher budget's release of `Edit`/`Write`/`Agent`/`Task` into a refusal
(`give_up_code`, `scripts/pretooluse.sh`), and keeps `UserPromptSubmit`'s cached pass from answering a session that
lacks it, so the full seat check carries the profile into that prompt.

"On failure" is per check and the dispatcher honours it per check: an unhandled throw inside one decides
that check's own verdict and never another's, so the browser guard failing closed cannot wedge a `Bash` call
and a thrown poll gate cannot open the door.

`hooks/lib/resolve-root.sh` is the shared root resolution every shim sources and `hooks/lib/bounded-run.sh`
is the budget every tool-call shim runs its hook under; nothing invokes either directly.

**Every `PreToolUse` guard runs from the INSTALLED plugin, not the session's checkout**
(`hooks/lib/guard-root.sh`): the `installPath` that `installed_plugins.json` names at the moment of the call,
with that install's dependencies linked in. A guard is fleet policy, and a dogfood session boots
`--plugin-dir <its own worktree>`, so from its own tree it obeys only the guards its own branch carries —
MEASURED: 148 Python calls ran after the Python gate landed, every one from a session whose base
predated it. It closes the marketplace route's half too: run from a cache install with no `node_modules`, a
guard dies on its first package import with exit 1, which Claude Code does not treat as a block. A guard
new on the session's own branch, or an install with no matching dependencies, falls back to the session's
tree. **The trade**: a branch that changes a guard is covered by its subprocess tests
(`src/__tests__/subprocess/admit/guardRoot.test.ts` and the guard's own), not tried live by its own session
before it merges.

## `PreToolUse` is one process, and every entry is bounded

MEASURED, and the reason both halves exist: the chair sat **27 minutes** on hook 6 of 7 for a
single `Bash` call, and six other seats showed 50 minutes to 2h19m on the same line. Ten `PreToolUse` entries
were registered, none carried a `timeout`, and each exec'd `tsx` over its own `.ts` file — so one `Bash` call
in one seat booted six TypeScript compilers, twenty seats at once booted a hundred and twenty, and a starved
boot had no deadline at all.

**Every entry carries a `timeout`** (seconds). The harness default is **600** — ten minutes of a wedged
tool call. A timed-out `command` hook is KILLED and the tool call
PROCEEDS, so a timeout is a liveness bound and never a gate: a guard that must refuse has to refuse in time,
which is the other half's job. `PostToolUse` is held at 20s and `PreToolUse` at 30s by
`src/__tests__/unit/context/hookTimeouts.test.ts`, which also fails an entry carrying no `timeout` at all.

**PreToolUse's 30 is runway, not budget.** MEASURED: with the inner budget failing closed, one
load episode still handed ~22 `PreToolUse:Bash` calls to the harness at T=20
(`hook_cancelled`, 20004–20823 ms), and each one RAN — verified on a `date +%s` whose real result landed 0.5s
after its hook was cancelled. Neither the inner verdict (then 15+2) nor the envelope (then 18/19) landed inside 20 on a
machine that starved. At 30 the decision budget is still 15; what grew is the room our own fail-closed ending
has before the harness's fail-open one. Repro: `grep -rh '"hook_cancelled"' ~/.claude/projects/ | grep PreToolUse`.

**One process runs every check.** `hooks.json` holds two `PreToolUse` rows whose matchers are disjoint and
together exactly the union of the ten per-check entries — no wider, because a matcher-less dispatcher
would fire on `Read`, `Grep` and `Glob`, which pay nothing. They are two only so the envelope can end a
door-gated call (`Bash`, `Monitor`, `Artifact`, `TaskOutput`, chrome MCP) closed and a tripwire-only one
(`Edit`, `Write`, `Agent`, `Task`) open; no call is handed to both, so each still starts one dispatcher. A THIRD
row, disjoint from both, hands `Read`, `Grep`, `Glob` and `NotebookEdit` to `scripts/pretooluse-protected-paths.sh`,
which starts no Node process unless a protected-path registry exists in the configured or default state home, and
otherwise runs `pretooluse.sh --only protected-path-guard` — so a read reaches that one check and no other, and every
ending it cannot decide RELEASES (`SLOPWEAVER_HOOK_GIVE_UP=0`, and `give_up` for that row): a read-side tripwire must
never stop a loaded session ([protected paths](../security/protected-paths.md)). `scripts/pretooluse.sh` runs a prebuilt esbuild bundle on plain `node`,
falling back to `tsx` over the source; `src/admit/preToolUseChecks.ts` is the registry and
`src/admit/preToolUseDispatch.ts` the pure rule that combines them. MEASURED the same day, same machine:
the six-hook fan-out a `Bash` call fired cost 0.99s wall / **2.15s CPU**; the folded dispatcher on the
bundle costs 0.24s wall / **0.17s CPU**. The cost that mattered was CPU, not wall clock — twenty seats
contending for it is how a hook boot starves for 27 minutes.

Three rules the fold is built on, each a behaviour you would otherwise have to discover:

- **The first refusal wins AND short-circuits.** The declaration order in `preToolUseChecks.ts` is the
  per-check registration order verbatim, and a refused call is never recorded by the poll gate as a poll.
- **A refusal goes out twice: stderr with exit 2, and a deny document on stdout.** Exit 2 alone renders as
  `hook error: [<the ~300-character hooks.json command>]: <reason>`, so the reason was the last thing on screen;
  a `permissionDecision: "deny"` document renders as `hook error: <reason>` and wins over the exit code, which
  stays as the fail-closed backstop. The reason comes first and the refusing check is named after it
  (`denyDocument`, measured there). Only exit 2 gets one; the shell envelope's own give-ups
  (`scripts/pretooluse.sh`, `hooks/lib/bounded-run.sh`) never reach the dispatcher and stay bracketed.
- **One check's exception never decides another's verdict.** Each row carries the failure policy its own
  entry carried (`onUnhandledError`), which is what keeps two fail-CLOSED guards inside a process with
  eight fail-OPEN ones.
- **The matchers are copied, never re-derived — and READ the way the harness reads them.** A `matcher` of
  only letters, digits, `_`, `-`, spaces, `,` and `|` is an EXACT-name list split on `|`/`,`; anything else
  is a JavaScript regex tested UNANCHORED. So `Edit|Write` never matched `TodoWrite` and `Agent|Task` never
  matched `TaskOutput`, while the folded union — which needs `mcp__claude-in-chrome__` — IS a regex and
  would match all three unless every alternative is anchored. `src/admit/hookMatcher.ts` is that rule,
  written once. Rewriting a matcher into a "better" one is a guard change wearing a refactor's clothes, and
  so is rewriting how one is read.

**Ten one-line compatibility shims**, `scripts/pretooluse-<id>.sh`, each `exec` `scripts/pretooluse.sh --only
<id>`, for a seat whose OWN checkout's `hooks.json` names per-check paths; `main`'s names only the folded
entry. Each runs ONE check rather than the registry: ten shims each running all ten would make the second
poll-gate pass refuse the call the first one recorded. `src/__tests__/unit/context/hookTimeouts.test.ts` holds
every shim to a real registry id and every per-check entry to a shim, so they are deleted together or not at
all. A check registered on the folded entry gets no shim: no `hooks.json` names a path for it.

**The bundle is built only for a versioned install**, at `$ROOT/.hook-build/` inside it. A marketplace install
path ends in the plugin version, so an update is a different directory holding no bundle — freshness with
nothing comparing mtimes. A root outside the plugin cache is a dogfood checkout, whose path does not change
when its source does, so it runs `tsx` over live source, which is what a dogfood session wants. The bundle
sits INSIDE the install because `--packages=external` resolves bare imports from the importing file's own
directory upward: anywhere else and a guard silently runs whatever `zod` happened to sit above it.

**A bundle that fails to build is a verdict on the install**, because esbuild walks every import the entry
reaches and `tsx` over the same tree dies with exit 1, which turns every guard off. MEASURED:
Claude Code's own auto-update left one install holding 61 of `src/`'s 106 entries, the entry
file present and `src/lib` absent, and every seat booted after that ran with no `PreToolUse` gate until it
was repaired. An install is judged only when esbuild is there and the entry fails a build to stdout too, so
an unwritable `.hook-build/` never condemns a whole install. A judged install's bundle is rebuilt from the
**marketplace clone** when that clone's HEAD is the commit the install is named for and its worktree is
clean — the same policy from a tree the copy never touched, cached inside the install so its deps resolve. Failing that, a tree runs only if it carries its own `tsx` and **builds**: the session's root, then
the shim's mirror, never the install again — the mirror of an install-rooted seat is a copy of the same
partial tree, so a path check alone would hand `tsx` the defect back. With nothing that builds, the shim
gives up `persistent` (open for `Bash`, closed for the browser). `guardRoot.test.ts` holds each rung down.

## The harness's promise is unmeasured, so the shims keep a budget of their own

The `20` above is the HARNESS's promise, and nothing on this machine has ever measured it for this shape. The
27-minute wedge above read as proof that Claude Code ignores a timeout was nothing of the kind: **a seat reads
`hooks/hooks.json` ONCE, at boot, from its own `--plugin-dir` worktree**, so a hook-config change reaches a
seat only when that seat next starts. The two seats held 20 and 42 minutes had both booted before their own
worktrees carried a timeout at all — one of them 16 minutes before, and it was the seat that WROTE the
timeouts. Repro, on any seat:

```bash
ps -p <pid> -o lstart=,args=                     # its --plugin-dir, and when it booted
git -C <that worktree> reflog --date=iso-local   # what hooks.json said at that instant
```

So `hooks/lib/bounded-run.sh` keeps a second, shorter bound that WE enforce, and `scripts/hook.sh` is what
applies it to every entry. On expiry it signals the whole process tree it launched — TERM, then KILL — and
writes one line naming the step and the budget. **The ladder, for a declared timeout T:**

| Layer               | Fires at | Who                                                                                                                                 |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| inner verdict bound | 15s (+2) | the two shims that HAVE one — the layer that picks the give-up CODE; the +2 is spent only on a pid that ignores its TERM            |
| envelope TERM       | `T-3`    | `scripts/hook.sh` — released the moment every pid it signalled is gone                                                              |
| envelope KILL       | `T-2`    | `scripts/hook.sh`, only for a pid that outlived its TERM — ends the call by the row's `SLOPWEAVER_HOOK_GIVE_UP` (2 refuses, else 0) |
| harness timeout     | `T`      | `hooks.json` — reached only when the machine starved every layer of ours, and the tool RUNS                                         |

**The two seconds between the KILL and `T` are runway, and they were measured, not chosen.** In one census
the harness had ended 1,522 `handover-run`, 495 `plugin-mirror-sync` and 254 `profile-context` calls whose
command WAS the envelope, against 438, 102 and 16 the envelope ended itself — the old ladder (TERM `T-2`, KILL
`T-1`) slept its whole escalation second even after every pid died on TERM, leaving one second for the lag
before our shell starts, the tree walk and process exit. Its wins released at 8.3–10.5 s against a TERM at 8.
The census and its repro are in `hooks/lib/bounded-run.sh`'s ladder.

**Only the top row is optional, and only one entry carries it**: `scripts/pretooluse.sh` spends
`SLOPWEAVER_HOOK_BUDGET_SECONDS` (15, which the variable may narrow and never widen) so it can return a CODE.
`PreToolUse` is declared 30, so even its 15+2 lands ten clear, which is the runway the
load-episode measurement above asked for. **Nothing in our tree can make the last row fail closed**: Claude Code runs
the tool when its own timeout fires, so the ladder's job is to end every call before it does. Which code a spent budget returns is [the failure policy](mirrors-and-failure-policy.md#the-three-that-fail-closed-and-why-the-rest-do-not). The other ten
entries have no inner bound at all and the envelope is the whole ladder for them. **Widening the inner
budget past `T-3` does nothing**, because the envelope wins; the envelope's own line names the declared
timeout for that reason. `scripts/pretooluse.sh` spends ONE budget across every step it runs, measured from `$SECONDS`,
which bash zeroes at shell start.

**Starting the clock at shell start is load-bearing.** A clock started after root resolution charges three
sourced libraries and `resolve_guard_root`'s ten forks of `grep`/`awk`/`sed`/`diff` to nobody, leaving a worst
case of 15 + a floored 1 + 2 of escalation = 18 against a declared 20, so **any prologue past two seconds hands
the ending to the harness**: the acme-admin seat lost seven `PreToolUse:Bash` calls exactly that way over two days
(`hook_cancelled`, `timedOut: true`, `timeoutMs: 20000`, 20043–20163 ms). The prologue is 0.17–0.55 s at
a 1-minute load of 24.6; the incident window ran at 146. A step with nothing left gives up rather than
starting one more.

**The payload read is the step a bound on the dispatch alone would have missed.** The shim reads the payload
itself (`PAYLOAD="$(cat)"`, because the fail policy has to look at it and a pipe cannot be read
twice), so a harness that writes the payload and never closes the pipe wedges the shim itself, with no
hook process for anything to kill. `cat` copies as it reads, though, so the bytes that arrived are still in
`$PAYLOAD` when the budget kills it — which is why a browser call still fails CLOSED on a read that never
finished, and why `give_up_code` is a function rather than a constant.

**Four details of the kill are load-bearing, and each was measured rather than reasoned.** The tree is read
ONCE, before anything is signalled, because a descendant is re-parented to init the moment its own parent is
reaped and `pgrep -P` then finds nothing. The shim WAITS for its own watchdog when the budget was spent,
because `wait` returns the instant the direct child dies: the first cut tore the watchdog down at that moment
and a grandchild that ignored `TERM` was still alive holding the hook's stdout. And the
dispatch runs with `pipefail` OFF, reading `PIPESTATUS`, because a hook that exits 0 before `printf` has
finished leaves printf on SIGPIPE at 141 — which pipefail would hand up as the hook's answer.
And **both watchdogs run with their own stderr silenced**, because bash reports a foreground child it
reaped after a signal — `line 95: <pid> Terminated: 15  sleep` — on the stderr of the shell that owned it,
and Claude Code renders ANY hook stderr as a hook ERROR. MEASURED: **2 of 15** runs of the shim
emitted that line, with and without the envelope alike, and 0 of 30 after; it is a failure banner carrying
no information on roughly one `Bash` call in eight. The envelope's watchdog has a real line to print, so it
keeps the true stderr on fd 4 — which is also the test: drop the `4>&2` and its `printf` writes to a closed
descriptor, so the subprocess case asserting `killed after Ns` reddens.

```bash
P='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"echo hi"}}'
for i in $(seq 1 30); do echo "$P" | ./scripts/hook.sh 20 pretooluse ./scripts/pretooluse.sh >/dev/null; done
```

**A budget that expires is not a verdict, and the shim says so rather than inventing one.** That is the same
trade the harness timeout already makes — a step that cannot finish in fifteen seconds is a starved boot, not
a decision — so a spent budget releases exactly the way an unresolvable runtime does.

**What it cannot do**: a call held with NO hook process alive is held by something we never launched, and
there is nothing for this to kill. That shape is REPORTED instead — `slopweaver perf`'s `stuck` grade, whose
claim boundary is in `src/live/perf/report.ts`'s header.

**It covers a registration that is not a shim too**: `bin/slopweaver memory hook --from-payload`,
`hooks/handover-run.sh`, `hooks/profile-context.sh`, `scripts/plugin-mirror-sync.sh` and
`scripts/plugin-install-deps.sh` all run inside the envelope, and one `bash` fork is ~2 ms against the ~280 ms
`tsx` boot beside it. MEASURED: mirror sync ran to 60158/60238/60079 ms against its declared 60000
on one seat in a single evening, and the transcript recorded a `hook_cancelled` with no `stderr` at all — the
silence the bound exists to end (its cause, an unbounded marker sweep, is fixed: [§ "One mirror per plugin
root"](mirrors-and-failure-policy.md)); the next slow step is made visible the same way without anyone having
to notice it. **The coverage is total by construction and `hook-bounded` keeps it so.** The ten compatibility
shims need nothing of their own: each `exec`s `pretooluse.sh`, so each inherits its budget.

**How to see it, per class.** `slopweaver perf --json`'s `hookOverruns.unbounded` is read off the
transcript's own `timedOut` field, so a hook the HARNESS ended is exact rather than inferred, and
`unboundedCommands` names the entry. It counts every event at any duration; `hookOverruns.overruns` is the
other class, `PreToolUse` calls alone, since 15 s is that hook's verdict budget and no other entry's:

```bash
grep -h '"hook_cancelled"' ~/.claude/projects/*/<session>.jsonl
```

`src/__tests__/subprocess/admit/hookBudget.test.ts` reproduces both classes against the shipped scripts — the
dispatcher wedged on an unclosed payload, one compatibility shim, both fail policies, and the
envelope over a target with no bound of its own and over one that ignores `TERM`.
