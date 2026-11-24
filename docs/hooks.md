# Hooks — what runs automatically, and what each one refuses

Everything in `hooks/` is invoked by the Claude Code harness, never by a person. `hooks/hooks.json` is the
registration; **every entry is `scripts/hook.sh`**, which bounds the call and then runs the real target — a
shim in `scripts/` that resolves `tsx` and executes an entry point in `hooks/`, or a `slopweaver` verb
directly. Every hook file is a top-level invocation and nothing else — the logic it runs lives in
`src/admit/` or `src/memory/` and is unit-tested there.

**`PreToolUse` runs every check in ONE process per call, and every entry carries a `timeout`.** It is two
disjoint rows — door-gated tools, whose envelope ending refuses, and tripwire-only ones, whose ending releases
— so no call is handed to both. Both halves come from one incident — read [§ one process, and a bound on it](./hooks/registered-and-bounded.md#pretooluse-is-one-process-and-every-entry-is-bounded)
before adding an entry, because "add a hook" is not "add a row".

**An entry is registered through the one entry point or it is not registered.** `hook-bounded` in
`yarn lint` refuses a command that runs its target directly, an entry with no `timeout`, one whose declared
timeout is too short for the ladder, and one that passes the entry point a different timeout from the one it
declares. There is no allowlist and no exemption marker.

**Whether a rule wants a hook at all, and what a blocking one must do to be safe**, is
[where enforcement goes](./doctrine-rationale/enforcement-seam.md): a gate inside a command first, and a hook
only when it is inert by default, fails open and is bounded by the harness's own signal.

- [The registered set](./hooks/registered-and-bounded.md)
  - [`PreToolUse` is one process, and every entry is bounded](./hooks/registered-and-bounded.md#pretooluse-is-one-process-and-every-entry-is-bounded)
  - [The harness's promise is unmeasured, so the shims keep a budget of their own](./hooks/registered-and-bounded.md#the-harnesss-promise-is-unmeasured-so-the-shims-keep-a-budget-of-their-own)
- [One mirror per plugin root](./hooks/mirrors-and-failure-policy.md)
  - [The three that fail closed, and why the rest do not](./hooks/mirrors-and-failure-policy.md#the-three-that-fail-closed-and-why-the-rest-do-not)
- [The session depth advisory](./hooks/session-guards.md)
  - [The auto-compact window is each user's own setting, and Slopweaver never writes it](./hooks/session-guards.md#the-auto-compact-window-is-each-users-own-setting-and-slopweaver-never-writes-it)
  - [The cmux-send-into-the-supervisor guard](./hooks/session-guards.md#the-cmux-send-into-the-supervisor-guard)
  - [The home-git guard](./hooks/session-guards.md#the-home-git-guard)
  - [The call-state guard](./hooks/session-guards.md#the-call-state-guard)
  - [The poll gate](./hooks/session-guards.md#the-poll-gate)
  - [The raw-Bash gate](./hooks/session-guards.md#the-raw-bash-gate)
- [The browser guard — every Claude-in-Chrome call refused](./hooks/browser-memory-and-limits.md)
  - [The memory hooks — one before the write, one after](./hooks/browser-memory-and-limits.md#the-memory-hooks--one-before-the-write-one-after)
  - [What hooks do NOT do](./hooks/browser-memory-and-limits.md#what-hooks-do-not-do)
