# Rule 2 · No headless model, anywhere

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

**2 · No HEADLESS model, anywhere.** No Slopweaver process may start, exec, fork, schedule or background
`claude` or any other model runner **invisibly** — with no interactive session the owner can watch as it
runs and interrupt if the owner wants to. There is no transport exception for an invisible runner, and the rule
names a property rather than a mechanism on purpose: a ban on "detached or backgrounded `claude -p`" let
several surfaces claim compliance while the read verbs, `distil` and the console all spawned exactly that.

**The property, stated once so it stops being re-derived per surface:** a Slopweaver process may launch
`claude` only into a session the owner can see and interrupt as it runs — never detached, never resident,
never invisible. `slopweaver cmux spawn` satisfies this deliberately: it opens a new interactive cmux
workspace and starts `claude --plugin-dir …` inside it, visible from the moment it starts, and that is the
intended shape of tier-3 execution (see `docs/workstreams.md` and the routing-as-judgment work on choosing a
tier). It is not a ban on Slopweaver ever starting `claude` at all — that would forbid the exact thing it
protects. The rule never banned starting, exec'ing or forking `claude` within Slopweaver: a `cmux spawn` that
opens a visible, interactive, watchable session is exactly the wanted way of working, and an invisible session
is the only thing ruled out. Do not read a future tightening of this rule as re-banning
`cmux spawn` without an explicit, stated reason — the property is visibility, not the number of processes
between the owner and the model.

What the CLI may do instead: gather evidence, write a versioned **brief**, validate a result the session
composed, and perform an explicitly requested write. **All reasoning happens in an already-visible agent
session the owner can watch and interrupt** — whether that is the session already running, or one
`cmux spawn` just opened — that is what `turn brief` → `turn answer` and `store read` → `store collect` are for.

Two consequences, both deliberate and neither a defect to fix:

- **A Slack tag arriving when nothing is running is a no-op BY DESIGN.** Do not add automatic queue
  consumption, a restart or a retry to catch it — that is the resident executor wearing a different hat.

  **What a RUNNING VISIBLE session may do with a stranded ask.** The sentence above is about a machine
  reaching for work with nobody watching. It was read, once, as forbidding recovery altogether — which is
  how `src/live/turn/recoveryWording.ts` came to ship the wording half of "a failed turn never asks the owner to
  re-tag" while shipping no recovery at all, and why over one whole week not one stranded ask was ever
  answered. The owner's ruling draws the line where the rule actually draws it: the property is VISIBILITY, so a
  session the owner can see and interrupt may pick a stranded ask up, exactly ONCE, and say so in the thread. With
  no session running, nothing picks it up and the failure card stays standing — which is the same no-op the
  sentence above protects, not an exception to it.

  Two things make that a different shape from the banned one rather than a softer version of it. The
  re-dispatch happens inside a pass the visible loop session runs itself (`listen recover --scheduled`), so
  there is no process waiting to act on its own; and the bound is ONE, recorded as a `redispatched` event on
  the ask so it survives the session death the whole feature exists for. `src/live/listen/stranded.ts` holds
  the measurement behind the day-long staleness bound and why the lane re-admits an ask rather than replaying
  its old dispatch. **The `no-headless` gate is unchanged by this** — nothing in the lane launches anything.

  Read "nothing running" precisely, because the imprecise reading put a false claim into `docs/security.md`
  during the very change that wrote this rule. With **no listener**, a tag does nothing at all. With a
  listener but **no session**, the tag IS captured, queued, and **acknowledged in the thread** — `listen`
  posts a checklist and a reaction before any session exists. What does not happen is the ANSWER. The bot is
  meant to answer a tag; an immediate "I saw you" is the wanted behaviour, and the reply that follows is a
  visible session's deliberate act.

- **`slopweaver listen --follow --queue <path>` is explicitly ALLOWED.** It records addressed messages as
  durable JSONL and never invokes a model or posts an answer. The queue is _input a human later chooses to
  read_, not a trigger; without a visible session draining it, nothing happens. Do not delete it to satisfy
  the sentence above.

Enforced by the `no-headless` gate in `yarn lint` (`src/devLint/noHeadless.ts`), which has **no allowlist and
no exemption marker for going invisible** — that capability is gone rather than permitted, and no per-call
marker may bring it back. It does not yet separately recognise `cmux spawn`'s visible shape at all: today it
escapes the gate's narrow shell-position matching by accident (through `cmux send`), not because the gate
was told this one is fine. That is a real gap, not a feature — a future spawn added the same indirect way
would escape identically whether or not it opened anything visible. Closing it (teaching the gate `cmux
spawn`'s shape so the pass is deliberate rather than a blind spot) is real follow-up work, not yet done. A
`PreToolUse` hook could never hold this: `classifyRawCommand` is a raw external-write tripwire, not a
model-process policy, and has no `claude` branch at all. The console's one model spawn is NH008: a plan-funded Talk call holds a `codex app-server` thread for exactly the life of a call the owner opened by pressing the orb and can hang up — the stop route, a 30-second absent page stream, a 90-minute ceiling and the server's own exit each kill it (`site/lib/talkPlanCallWire.ts`, the ceiling armed in `site/lib/talkPlanCallBase.ts`) — so the gate scans `site/` too and passes a bare `spawn(` there only as a recognised call shape (`RECOGNIZED_SITE_SPAWNS`), exactly as NH006 recognises one; never a file list, and `exec`/`execFile`/`fork` stay refused. The gate scans `desktop/` and `tools/` as well (an audit's finding 23: both ran outside the scan, so a headless `spawn("claude", …)` there passed). `tools/` held no async child; `desktop/` holds five, none a model (`docs-site.sh`, the shell's own `desktop update`, an `osascript` that types `fleet resume` into a new visible cmux tab, the front-window read and the signed audio-permission helper), each passing as its own recognised call shape (`RECOGNIZED_DESKTOP_CHILDREN`) that `site/` cannot borrow and `src/` never sees.

`no-headless` bans the capability; it says nothing about a comment still describing the capability as live
after the fact. The old spawned-subprocess transport module (deleted, formerly under a now-nonexistent
`src`-tree `llm` directory) was removed, and five current surfaces kept citing it anyway — a live
`door-coverage` allowlist entry keyed on the deleted path among them — none of which a doctrine ban on the
capability itself could ever catch, because none of them ran the code. The `retired-claude-transport` gate
in `yarn lint` (`src/devLint/retiredClaudeTransport.ts`) is the mechanical half of that: it refuses a
current config, script or source naming the deleted directory or claiming a live `claude`
subprocess/transport, and exempts only a line that explicitly marks itself historical (`removed`, `used to …
now forbidden`, `historically`).
