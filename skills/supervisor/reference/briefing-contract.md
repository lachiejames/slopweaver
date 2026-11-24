# The fleet briefing — the seven rules, routing, sleep mode and successor handoff

The contract the republished artifact is kept to. The form's own fields and caps are in
[fleet-briefing-shape.md](fleet-briefing-shape.md); the rule that the briefing is the actual output, kept
alive continuously rather than assembled when asked, is in [SKILL.md](../SKILL.md).

§2's narration is the chat-side output; most of what actually needs the owner's own word lives in one
artifact, kept alive continuously rather than assembled when the owner asks. This is canon rather than a habit
because the gap was measured, not hypothetical: the owner could not tell, inside
this chat, whether a given line was a question aimed at the owner or a relay between two agents, and it cost the owner
missed decisions and answers to the wrong thing. The briefing therefore separates react-now from already ruled.

### The seven rules

1. **Republish on every sweep tick, every owner ruling applied, and every landing that closes an open
   item** — never only when the owner asks. A stale artifact reporting current state is worse than no artifact.
2. **Above the line: only what needs the owner's own word** — another person's surface, a tier-3 call per
   `cross-session-messages.md`, or this chat's own restart (§3a below, carve-out included). Never a menu in a
   session you dispatched, or a post to the owner's own DM that doesn't tag the bot; both are already yours to
   resolve. Numbered, each carrying what / why / options / lean / if silent, **every field capped by the form's
   own schema** — write the short version and fold the depth ([the shape](fleet-briefing-shape.md)). **Every
   option and `if silent` routes the owner to the supervisor chat**, worded "tell the supervisor <word>" — never
   "reply on the card" or "react", which the form and `briefing check` both refuse. **And a me-facing card
   never puts an action in the owner's own hands** — the owner does not touch their own code or
   config, ever; the owner instructs the supervisor and the session performs the edit on the relayed word. Cards
   that ended "then you reset", "in your own file", "only you can write", "add it now" cost the owner a
   repeated correction, so the form and `briefing check` refuse a me-facing `what` or option naming the owner as
   the actor of an edit, a command or a console click. Name the session instead: "tell the supervisor <word>
   and the session does it" (`src/briefing/ownHandAction.ts` carries the criterion and its deliberate
   over-breadth). **Nor does it hide a command the owner has to type behind its own fold** — a card whose two commands sat in `detail` while its `what` pointed at them left the owner finding no fold on the page at all and searching the linked page, when the card could simply have carried it. Put the command in `what` verbatim and leave the explanation folded (`src/briefing/commandAboveFold.ts`). **And every card declares whether it is THE OWNER'S TO ANSWER NOW** — `readiness` is `ready`, or
   `waiting` naming the session and the one event that ends the wait. Every ready card renders above every
   waiting one and the waiting ones get their own heading, because a card that says a session is still
   working is not a card the owner can react to: a not-ready card put at the top makes the owner squint to tell whether it is ready, while many of the
   ones underneath probably are. Declaring `ready` while the `what` says a session
   is still adopting, measuring, building or rewriting is refused by both the form and `briefing check`
   ([the shape](fleet-briefing-shape.md), `src/briefing/cardReadiness.ts`).
3. **Below the line: progressive disclosure.** Today's rulings, landings, the live fleet, traps hit — every
   one folds behind a collapsed section, never sits above the fold. A done list grows a block every sweep,
   so fold or drop the older ones as you add one; the page budget refuses more than five unfolded.
   **A fold is held to a SHAPE, not to a word count.** Text below the fold read as an unreadable wall, so the
   rule is: at most four blocks per fold, depth going DOWN into a nested fold rather than sideways, and the
   prose inside those blocks left alone ([the shape](fleet-briefing-shape.md) § "Fold first, then write").
   Write short labelled lines or one-sentence bullets because they read at a glance, not because a counter
   refuses anything else. A fold the form refuses is a fold to RESTRUCTURE, never one to publish anyway; and
   `slopweaver briefing archive` is what moves an old section's depth off the page. A pull request is cited
   `owner/repo#<n>` below the line; `tick close` qualifies every bare one a passing page resolved, against the
   nearest link in its own note ([the shape](fleet-briefing-shape.md)).
4. **A question for the owner is never chat-only.** It goes on the owner's Queue through `handover ask`, never the owner's
   DM (the owner reads the Queue through the localhost UI), one question per card, never a batch of
   unrelated asks in one.
5. **The chat reply is what moved, the exact URL, and one line per open item** — never a restatement of what the
   artifact already says, and never a page hash ([§ The chat reply](#the-chat-reply-what-moved-and-the-exact-url)).
6. **A ruled item is REMOVED from above the line the moment it's ruled**, not marked "ruled" in place. An
   answered item still sitting above the line is the exact failure this contract exists to prevent. **And
   only the owner's ruling (or the owner's word to drop it) removes one.** Reframing, stale-checking or splitting a card
   keeps it on the line with a note: nothing is removed before the owner has reacted to it. Nor does a list the owner
   reads keep a struck item.
7. **Staleness is visible at a glance.** The header always carries the time of the last sweep, updated on
   every republish, so "is this alive" never requires reading the content to answer. **And a page the owner has
   already read carries WHERE it changed** — computed from the diff against the frozen previous version, so
   a second round of reacting is not a second reading of the whole page ([corrections.md](corrections.md)). Freeze every publish; the correction is only possible against bytes.

**One more standing amendment, from the owner directly:** never put a question above the line
the owner cannot answer without expertise the owner doesn't have — plain words and the implication of each option, never a
question assuming ML or methodology fluency the owner has already told this chat the owner lacks.

**Rule 3's three sections are derivable.** `recent`, `earlierToday` and
`history` are 92.9% of a live form's bytes and 164 of 169 render refusals, and they are a log rather than
prose — so they get derived from the ledgers the way `yourList` is. The published page does not derive them
yet, so **keep authoring them and keep running `supervisor tick-record` every tick**. `briefing render --ticks <path|->` is the projection, opt-in and unpublished until the shadow
comparison is clean: [derived-narrative.md](derived-narrative.md).

### The page is RENDERED from a typed form, never hand-written

`slopweaver briefing render --form - --out <html> < <form.json>` — edit the form in the run's scratchpad each
sweep with `slopweaver briefing sweep-block` ([verbs](verbs.md)), never the HTML and never a script. A typed form is the right shape for this: every cap lives in the
schema, so a wall cannot be authored. One artifact, same URL all run; the form's fields, the caps and
`briefing check` are all in [the shape](fleet-briefing-shape.md).

### Routing: a question is never chat-only

- Resolve every instruction per §3 as normal, but a question that is properly **this chat's own** to raise
  with the owner — not routed to a session — is never phrased only in the chat reply. It goes on the owner's Queue
  (rule 4) first; a chat message that raises a new open item without also putting
  it in the artifact is incomplete, not a shortcut.
- **A relay between agents is never phrased as a question to the owner.** If a session reports a fact or asks the
  supervisor something and the supervisor already has the mandate to answer it (§3, `cross-session-messages.md`
  tiers), answer it and record the outcome — don't launder a peer's question into the owner's react-now list.
  Only what genuinely needs the owner's own hand (per `cross-session-messages.md`'s tier-3 set) belongs above the
  line.
- **Chat reply format is fixed**: what moved with its exact URL, then one line per open item, the question text
  alone — [§ The chat reply](#the-chat-reply-what-moved-and-the-exact-url).

### The chat reply: what moved, and the exact URL

**The rule**: every time the supervisor says a page was published or something is up to date, it prints the exact
localhost URL to go to, every time, and points the owner to it. A page hash narrated where an address belonged left
the owner asking which page it was.

- **Say what moved, then where to see it.** Never "published", "republished", a page hash, a tick number or a
  shift in chat — those are the chair's bookkeeping, not the owner's news.
- **The URL is the console's own surface** when the thing lives there: `http://localhost:3000/queue` (the owner's asks
  and cards), `/pull-requests`, `/workstreams` (the owner's outcomes, each a bar to the loop closed), `/fleet` (which
  agents run, which stopped on the owner, and the fleet against the handover board), `/alignment`. **Otherwise the file path** — a page at `$SLOPWEAVER_HOME/pages/<slug>/index.html`, the briefing's
  own `--out` file — or the permalink when the thing is a Slack post or a pull request.
- **"Up to date" carries an address too**: "the fleet is current — http://localhost:3000/fleet".
- **The form refuses the unpointed claim.** A lede or recent headline saying published, republished or up to
  date with no URL or absolute path beside it fails `briefing render` (`src/briefing/publishClaim.ts`, which
  also holds the console list). Chat has no form, so this section is the rule there; the gate covers the page.

### Sleep mode

- Once the owner has said they're going to bed, or enough hours pass with no owner message that it's a safe inference,
  keep republishing on every sweep tick exactly as before — staleness still matters overnight, and a silent
  gap in an unattended briefing is indistinguishable from one nobody is running.
- **Stop DM pings** during that window. The one exception is an outage-class event — the bot off the air,
  an automation overdue with nothing seated — the same `--min-severity alert` class §7's sweep contract already watches for and
  acts on before anything else.
- Anything that would otherwise have gone out as a DM ping overnight instead accumulates into the morning's
  react-now list, so nothing is lost, only deferred to when the owner is actually looking.

### Successor handoff

**The handoff has one trigger, printed to you, refusing nothing.** `tick close` prints **HAND OFF THIS TICK** —
then the hand-off, with the successor's slug, as its prompt in place of the sweep — at your fifth auto-compaction
(a trial, [ledger-and-gauges.md](ledger-and-gauges.md) § Do not hand off early), when your plan nears its week,
your Fable week drifts past the plan routing picks, or you run an older Claude Code than a fresh seat boots
([plan-routing.md](plan-routing.md) § The chair's hand-off cadence). Depth is never one: you compact at 300K.
Either way the successor is opened while you can still open one, rather than when a sweep feels long.

**The doc you write for your successor OPENS with the invocation, and it is not optional prose.** The
`fresh-supervisor-handoff-NN` handover doc a predecessor writes is the successor's whole first turn, so its
first instruction is: _invoke `/slopweaver:supervisor` through the `Skill` tool as your first act — reading
`skills/supervisor/SKILL.md` with `cat` is NOT running the skill_ — followed by the § 7 sweep arming and
`slopweaver cmux takeover`. A supervisor that read the file instead left the owner to ask whether the skill was
running; supervisors hand over to other supervisors, so information is easily lost or distorted over time. The doc's
`summary:` names the shift; the boot block carries shift state only ([state-doc.md](state-doc.md)). **Its
front matter carries `role: supervisor`**: `cmux spawn` reads the seat from the doc's role (`seatForRole`,
`src/claude/seatPinning.ts`), never from the slug, so a doc without it boots the successor as a worker. The
chair's seat pins no plan: the successor routes as a Fable spawn onto the plan furthest below its Fable level
line ([plan-routing.md](plan-routing.md) § The chair's hand-off cadence). The successor's witness is `slopweaver claude
gauge`'s `chair:` line — never `claude auth status` or `userEmail`, which read the shared account record
([setup-tokens.md](setup-tokens.md)).

**And the successor's own FIRST SWEEP confirms it happened**, because a doc that says "invoke it" is worth
exactly as much as the last one was. The witness is mechanical: `slopweaver cmux events --name
agent.hook.PreToolUse --workspace <its own ws>` prints the tool name per call, so a `Skill` line for this
workspace is proof, and no line means the skill was never invoked — invoke it then, before the tick
continues. `cmux takeover` gate (a) reads the same shape to prove `ScheduleWakeup` was armed, and when no such
event exists (Claude Code 2.1.296 runs no PreToolUse hook for that tool) it reads this session's own transcript
for the `tool_use` instead — either way never the caller's own say-so (`docs/cmux-client/verbs-and-events.md` § 3).

A successor supervisor after a compaction boots from **both** halves together, not either alone: the state
doc (§4) carries the narrative and this artifact the current reactive picture, above the fold — keep both
current, since a transcript is not durable across a restart and a file is. A fresh workspace replacing a
predecessor also takes over the PIN itself once its own sweep (§7) is armed — `slopweaver cmux takeover` runs
the whole gated sequence and refuses loudly on any check failing (`docs/cmux-client/verbs-and-events.md` § 3 has the steps) —
and reads §3b (below) on boot, same as its predecessor should have. **Once the pin is yours and the picture is
genuinely read, run `slopweaver supervisor reoriented` once, with no `--attempt`.** The desktop's fleet health reads
a chair green only on a sign it gave itself since it took the seat; with neither that line nor a sweep closed, ten
minutes past the takeover the app reads the supervisor DOWN and floats a note. Measured: a chair seated by
handoff read down three hours later while sweeping, because only a recovery nudge had ever asked for the line.
