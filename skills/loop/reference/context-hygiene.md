# The loop's own context is a running cost — keep it small, and respawn on the gauge

Bundled reference for the `loop` skill. Loaded when the body links here, not on every turn.

## What was measured, and why it is the loop's problem specifically

One loop session, read from its own transcript: 30 hours, 870 assistant turns — one every ~2
minutes — 371 `Bash` calls, 31 `SendMessage`, 19 task notifications, 4 `Monitor` re-arms. Output was 756k
tokens against 1.7k of fresh input and **297M of cache reads**, and the context it was carrying had reached
616k. Two screenshot tool results alone accounted for ~190k characters, held for the rest of the session.

That shape is the loop's, not a worker's. **The bill is turns × context, and the context only ever grows**, so
a surface that takes a turn every two minutes for thirty hours pays for every byte it ever admitted, on every
turn after it. A worker session ends; this one does not.

The loop controls all three factors, and each has its own rule below.

## 1. A wake costs one line, not a narrated turn

The stream prints one JSON object per admitted mention. Read it, run the three steps, go back to reading —
that is the whole turn. Do not narrate what you saw, do not summarise the line back, do not explain the
dispatch you just made. The dispatch's own printed output is the record, and it is already durable.

**Watch stdout alone.** The skill body already forbids `2>&1` on the `--follow` command, and the reason is
this one: Slack's socket produces frame-level chatter — pings, reconnect frames, rotations — far more often
than the bot is addressed, and a watcher armed on the merged stream wakes on every one of them. A wake that
finds nothing admitted is not a turn to narrate; it is a turn that should not have happened.

## 2. The loop never takes an image into its own context — a worker does

Structural since the worker-dispatch restructure, and worth stating so it stays that way:

- The loop **never reads the thread**. `turn brief` composes from the stream line's own text; `slack
read-thread` runs in the worker's session, which is where an inbound screenshot lands.
- The `inline` carve-out is already "not one tool call, not one file read" — so it cannot reach an image
  either. An ask carrying a screenshot is by definition not `inline`.
- An OUTBOUND image never enters anyone's context as pixels: `turn answer` reads the bytes off disk in code
  and uploads them.

So if an image is about to enter this session's context, something has gone wrong with the tiering rather
than with the image. Re-judge the ask as `fresh-visible-session` instead of looking at it here.

## 3. Respawn on the gauges — this session is not special, and there are TWO of them

**The loop is near-stateless by design.** Everything that must survive is already on disk before the process
ends: the arm/pid record, the ask lifecycle, the durable queue, the cursors and watermarks. The standing
sessions are therefore **closed and respawned on a gauge, not
nursed** — the accumulated transcript is cost, not state.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" session depth      # gauge 1: your own row is the one marked `self`
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen status      # gauge 2: exits 3 when DOWN *or* STALE
```

**Gauge 2 is which commit you are actually on, and it is the one that bit hardest.** Every worker you dispatch
inherits your bin, and the skill prose you follow comes from your `--plugin-dir` — two different paths that
drift independently. Measured: a loop ran a two-day-old worktree while fourteen pull requests landed,
so every fix in them changed nothing at all in the channel, and the day's public failures all ran the old
binary. `listen status` now reports both trees with a HEAD, a commits-behind count and a grade; **`stale`
means the drift touched code or prose you run.** It is also an `alert` on the supervisor stream, so it reaches
the owner whether or not you look.

**Respawn on either gauge with the verb, not by hand:**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" session respawn loop --successor <today-s-dated-loop-slug>
```

It refuses unless you are genuinely stale, no ask is in flight, and that doc's run is not already held by a
live session — the third gate is what stops two loop sessions ending up on one doc, which has happened
and had Slack load-balancing tags across two listeners with only one being watched. On success it boots the
successor and tells you the two steps only you can take: `listen disarm`, then stop your own listener child
and end this session. Write today's dated doc first; the verb will not invent one for you. The supervisor's
own sweep (`skills/supervisor/SKILL.md` § 6a) reads the same gauges and may send you the same instruction.

**A boot is not a respawn, and you are the one who confirms it.** The verb publishes no `respawned` event;
it writes a pending record naming the arm that was live and the tree the successor was booted into, and a
respawn run against that successor before it arms refuses by naming that boot. When YOU are the successor,
run this straight after your own `listen arm`:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" session respawn loop --confirm
```

**Carry the thread-reply channels across by hand — nothing else will.** They are recorded on the arm and a
`supervise` re-arm keeps them, but a successor arms FRESH after the predecessor disarmed, so there is no
record left to inherit. Read them off the live arm before you stand down (`listen status` names them), write
them into today's doc, and arm with `--thread-replies <C1,C2,…>` yourself. Drop them and the bot stops
answering replies under its own posts with nothing printing to say it changed.

It exits 0 and publishes `respawned` only when the live arm is not the predecessor's, is up, and its pid runs
from your worktree; otherwise it exits 3 and names what is missing. Re-run after that, it exits 0 only while
the arm it confirmed is still the live one — an earlier seat's confirmation never answers for yours, and after a `supervise` re-arm it reads 3.
Measured: a successor booted
into the right tree at the right HEAD was sent a table row out of its own doc as the pickup, never armed, and
four directory-shaped gates called it a safe handover anyway. A predecessor cannot see your arm before it
disarms (`listen arm` refuses over a live one), so this positive assertion from your side is the only signal
that exists — and any hand-run handover gate should call the same verb rather than re-derive it.

**A tag arriving while no listener runs is a no-op by design**, so the gap between the successor booting and
your own listener stopping is real — which is exactly why the verb boots the replacement FIRST and only then
asks you to stand down. Never leave the fleet without a listener while you decide.

## Escalating a fatal listener failure

`SKILL.md`'s "stop and escalate loudly" means `ListAgents` + `SendMessage` to the supervisor — resolve its
name, then message it. Never `cmux send` into its pinned workspace: that types into the box the owner talks
into, not a message queue (`.claude/rules/cross-session-messages.md`).
