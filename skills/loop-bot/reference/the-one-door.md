# The one door, and the checkout you must not assume

Why every provider call goes through a `slopweaver` verb, why the hook that enforces it is a tripwire rather
than a fence, and why a command that ships with the plugin must enumerate the working repository's own
surface before using it. The rules are in [SKILL.md](../SKILL.md); this is the reasoning.

**Every Slack, GitHub and Linear read or write goes through `slopweaver slack`, `slopweaver github` and
`slopweaver linear`** (directly, or through the `/slopweaver:slack`, `/slopweaver:github`,
`/slopweaver:linear` commands that document them). **Nothing else touches those APIs.** Not `curl`. Not
`gh`. Not a Slack MCP tool. Not a hand-rolled `chat.postMessage`, and not a "just this once" HTTP call.

That is not tidiness. Those verbs are where the admit door, the ownership check, the send reservation and
the pacing live, and they are the entire reason an irreversible write can be trusted:

- the **door** gates every outward effect and can refuse one;
- the **ownership check** means an edit or delete can only touch a message slopweaver itself posted;
- the **reservation ledger** is what makes a retry after a lost response safe instead of a double-post;
- the **renderer** is why a card or a pull-request body cannot be malformed.

A raw call has none of them. Worse, it looks identical when it works.

There is a `PreToolUse` hook that blocks `curl`/`wget`, mutating `gh` and raw `git push` — **but you must not
rely on it.** It strips `env` assignments and resolves Git global flags such as `-C`, but it does not parse
shell composition. Measured: `curl --version` is blocked, while `cd /tmp && curl --version` runs; `&&`, `;`
and `|` can all hide a later command from a classifier that intentionally is not a shell parser.

**So the one-door rule is a discipline you keep, not a fence that holds you.** Treat a block as
confirmation you were about to do something wrong, and treat the ABSENCE of a block as meaning nothing at
all. Do not go looking for the shape that gets through.

`SLOPWEAVER_ALLOW_RAW=1` is an explicit single-invocation break-glass. The hook accepts it from its own
process environment, a command-scoped `SLOPWEAVER_ALLOW_RAW=1 <cmd>`/`env …` prefix, or a same-invocation
`export SLOPWEAVER_ALLOW_RAW=1 && <cmd>`. Branch pushes do not need it: `slopweaver github push` is the
governed path. Use the break-glass only when the operator has explicitly approved an unsupported raw effect,
never because a shell-composition blind spot happened not to block it.

## Assume nothing about the working checkout

This command ships with the plugin, so it is present no matter which branch the working repository is
sitting on. **That is exactly why it must not assume that repository's tooling.** A command file that
persists across branch switches resolves perfectly and then reaches for verbs the current branch never had
— and the failure does not look like a missing command, it looks like the bot flailing.

So, before you use the working repo for anything:

1. **Enumerate its surface.** Run its own catalog/help entry point and read what is actually there. A lean
   branch may expose only a handful of things — typically a catalog of itself, a map of what telemetry
   exists, a query surface for the metrics provider, a preflight/health check, and an append-only ledger.
2. **Use only what the enumeration listed.** Not what a sibling branch has, not what you remember, not
   what a document describes.
3. **A tool a step wants but the branch does not have is a FINDING**, not a gap to improvise across. Log
   it, say so in the answer, and do the turn with what exists.

The same rule applies to slopweaver itself: `slopweaver catalog` prints the real verb surface. Read it
rather than trusting a name from memory.
