# The listener stream — arming it, reading it, and what each line carries

How `listen --follow` is started and watched, the exact shape of every line it prints, and the indicator
contract a turn settles on its own. The rule this page serves lives in
[SKILL.md](../SKILL.md); this is the procedure and the detail.

**Never type a `listen --follow` line yourself. Ask for it, run what it printed, and disarm before killing:**

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen arm --background   # prints ONE line; starts nothing itself
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen disarm             # before you kill it, so the stop is clean
```

**Read the connection budget `arm` prints before you run its line.** Above the command, on stderr, it says
what Slack last reported for this app's Socket Mode connections and how long ago — or that no count has ever
been observed, so the arm opens blind. Slack caps the app at TEN and a closed socket keeps counting for tens
of minutes, so a reading above one means this arm is likely to be REFUSED at `hello`. A refused `hello` is
retried on the reconnect backoff for two minutes, and the arm exits only if Slack still reports more than
one after that. Nothing local frees a slot; they drain by themselves. The reading is a FLOOR of stated age, never a live
gauge — [docs/listener-supervision/runtime-and-watching.md](../../../docs/listener-supervision/runtime-and-watching.md#a-stop-closes-the-socket-and-the-apps-connection-budget-is-shown-before-another-is-opened) § "A stop CLOSES the socket"
says why nothing can do better.

**The kill is a clean close.** `listen` traps `SIGINT`/`SIGTERM`, closes the websocket by handshake and
exits 130/143, so a stopped listener stops counting against that cap far sooner. Still disarm FIRST: the
signal closes a socket, it journals nothing, and an unjournalled stop is counted as a death.

**Prove it privately first with a scoped arm.** `listen arm --background --dm-only` (or `--channels <C1,D2,…>`)
prints a listener that acts only on those conversations: a tag anywhere else is dropped before the whitelist,
with no reply, no reaction and no queue line, so nothing is left stranded on a colleague's message. The scope
is recorded on the arm and a `listen supervise` re-arm after a death keeps it. An `arm` action from `supervise`
on an UNARMED home has no record to inherit, so it is unscoped; run `listen arm --dm-only` yourself instead.

**Switch thread replies on one channel at a time with `listen arm --thread-replies <C1,C2,…>`.** That is what
makes a reply under one of the bot's own posts an address — the thread ROOT must be a message this install's
own bot user wrote, checked by exact id, and one thread wakes at most four replies a day. It is OFF with no
flag. The channels are recorded on the arm exactly as the scope is, and a `listen supervise` re-arm after a
death keeps them; an `arm` action from `supervise` on an UNARMED home has no record to inherit, so it answers
no thread replies and says so. **Switching it off is therefore a deliberate `listen arm` without the flag,
never letting the arm die.** `listen status` names the channels whenever any are on — and prints nothing
about them when none are — so a session inheriting this install can see the address surface rather than
having to read the listener's argv. `src/live/listen/mention.ts` is where the rule lives and where the
bounds are stated.

**READ THE CHANNELS BEFORE YOU DISARM — `disarm` clears the record they live on.** Persistence covers a
`supervise` re-arm after a death, where the record is still there to inherit from. It does NOT cover the
common case: a deliberate disarm-and-arm, which this loop does on every range that touches `src/live/listen`
or `cli/commands/listen` (more than once a day). There the fresh `arm` is composed from the flags YOU
pass, so an omitted `--thread-replies` switches the feature off — and `listen status` will then correctly
report no channels, truthfully reporting a state nobody chose. So:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen status --json   # read threadReplyChannels FIRST
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" listen disarm           # this clears the record you just read
```

then repeat those channels on the new `listen arm --thread-replies <C1,C2,…>`.

**A SUCCESSOR arms fresh, so persistence does not carry it across a handover either.** The predecessor
disarms before the successor arms, which leaves no record to inherit — so a handover doc must NAME the
thread-reply channels its arm carried, and the successor must repeat them on its own `listen arm`.

**That is the ONLY channel list a loop handover doc ever carries.** A successor doc writes the widened gap
pass as the deriving command — `listen recover … --discover-channels` — and never as the ids yesterday's
membership happened to hold. A membership list is timestamped evidence about the moment it was read, not the
next shift's recipe: a thirteen-id literal that was copied forward went blind to a private
channel the bot had been invited to, for a whole day
([edge-cases](edge-cases.md) § the WIDENED manual pass).

Run the printed line EXACTLY as printed, adding nothing — no `nohup`, `setsid`, `disown` or `2>&1`, and no
`--emit --json` (`--follow` already forces the JSONL). Never reuse a line saved from an earlier arm. Every
part of it is load-bearing: [docs/listener-supervision/runtime-and-watching.md](../../../docs/listener-supervision/runtime-and-watching.md) § "How the
listener runs" says why.

**A hand-typed `listen --follow` still captures tags and is INVISIBLE to supervision** — no arm record, so
`listen status` reads `unarmed` while the bot is genuinely listening, no heartbeat, and an undetectable
death; then the next session reads that `unarmed`, arms a SECOND connection, and Slack load-balances each tag
across the two with only one being watched. Measured: this skill's own start line was once that form.
Already on one? `slopweaver listen disarm` is not the fix (it clears a record that does not
exist and signals nothing) — stop the process in the session that owns it, THEN arm.

The armed listener does **not** exit after one tag. It stays connected, reconnecting on its own schedule, and
prints one JSON object **per line** for as long as it runs — one line per admitted mention, in order.
`--queue` is a durable, crash-recovery copy of the same stream, never a second trigger path; nothing
auto-answers from it.

**Watch stdout alone, and never merge stderr into it.** Frame-level narration goes to stderr precisely so
stdout stays pure JSONL; a watcher armed on the merged stream wakes on protocol chatter instead of on tags.
Measured — [docs/listener-supervision/runtime-and-watching.md](../../../docs/listener-supervision/runtime-and-watching.md#two-streams-never-merged) § "Two streams, never merged".

A line with **no `kind` field** is an admitted mention — the ordinary case, and always this exact shape, no
wrapping and no clock to race:

```json
{
  "channel": "C…",
  "threadTs": "…",
  "messageTs": "…",
  "userId": "U…",
  "surface": "channel",
  "text": "the question, any @(id) mention normalised in — never stripped",
  "replyTarget": { "channel": "C…", "threadTs": "…" },
  "started": { "turnId": "turn-…", "workingTs": "…" }
}
```

**Every line on this stream is an ordinary tag, including a follow-up from someone already being answered.**
Every tag is judged, so a second tag from the same person arrives here like any
other and is judged on its own. What tells you one is a follow-up is the BRIEF, which names that
asker's other in-flight asks — [worker-contract.md](worker-contract.md) § "A rapid-tag burst".

**`started`, when present, is not optional to carry forward.** It names the checklist message `listen`
already posted at capture, right after the `:eyes:` reaction. Pass `started.turnId` and `started.workingTs`
straight through to `turn brief --turn-id --working-ts` below. `turn brief` also recovers the same ref on its
own from the ask-lifecycle log if these flags are ever dropped — `listen` durably records it the moment the
checklist posts, so a forgotten hand-off never orphans the message for good — but that recovery is a
safety net, not a reason to skip passing them: it costs a log scan and only fires when this step was missed.

**A line with `"kind": "witness"` is NOT an ask, and never goes to `turn brief` itself.** Under `--follow` only,
the listener also reads, silently — no reaction, no card, no reply — every thread in which a person tagged a peer
bot the profile names in `slackBot.witnessBotHandles`, and every thread in which a person tagged THIS bot:

```json
{
  "kind": "witness",
  "channel": "C…",
  "threadTs": "…",
  "messageTs": "…",
  "userId": "U… or B… — the peer bot's own replies are read",
  "witnessUserId": "U… the witnessed bot — absent on a line from the bot's own thread alone",
  "text": "the message, mentions normalised",
  "activation": true,
  "ownThread": false
}
```

`activation: true` is the tag that started a peer watch; every later message in that thread is `false`. A tag
of THIS bot is still an ordinary mention and wins the overlap — it starts the own watch, and every later
message there that does not tag the bot is a line with `ownThread: true`. A watch lapses 14 days after the
thread's last message and hands off at most 40 lines per thread per UTC day. Each line ends in exactly one of
`witness settle … --as nothing-checkable`, `witness dispatch`, `witness stand-down` when it tells the bot it is
in the way, or, on an `ownThread` line, `witness help`, whose stdout IS a mention line: forward THAT one into
`turn brief` exactly as below — [the witness skill](../../witness/SKILL.md).

**Every live indicator a turn raises is finalised by the turn itself, on EVERY terminal outcome — you never
clean one up by hand.** The reaction, the working card and its checklist, and Slack's native thinking
indicator (plus the re-assert timer that keeps it alive past its 2-minute timeout) all settle through one
seam, `src/live/turn/indicators.ts`'s `finaliseIndicators`, which `runTurn` calls for `answered`, `withheld`,
`refused`, `failed` and — from `turn dispatch --sweep`, for a session that died, timed out or never existed —
`abandoned`, and — for a worker's own FAILED report — `failed`. An answered turn ends on the completion
reaction with the card deleted; every other ending
clears the indicator, marks the card's in-flight step FAILED with the reason (prefixed so "held for review",
"refused by the admit door" and "this turn was abandoned" read as the three different next moves they are),
and CONVERGES the tag to exactly one lifecycle reaction — the whole set (queued, capture, all four terminals) is
retired first, so `:eyes:` never stands over a turn that will never answer and a failed attempt's warning
never stands beside its retry's completion emoji. A human's own reaction is never touched. A door
refusal folds a `failed` completion instead of escaping `runTurn`, so `--sweep` stops counting it as "still
working", and a turn quiet for five minutes says so on its own card. **A turn that ends without an answer
still POSTS, and its card FACE names no machinery**: a door refusal reads as a bar that was not met, a break
says something broke, both tag the owner in, and the finding, coverage and model stay in the Details fold —
split on the DOOR, not on any refusal, since a form failing its own schema is a break. **About to tidy up a
stuck card, a stale `:eyes:` or a standing indicator? That is a defect in this seam — report it.**

**Read every line as it arrives — never wait for one ask's turn to finish before reading the next.** A
non-whitelisted tagger's line never appears at all: the responder whitelist is a deterministic gate checked
before this stream ever prints a mention for it, and the socket logs and ledgers the refusal without your
involvement. If nothing has printed, there is nothing to do — go straight back to reading. A non-zero exit
with no JSON at all — missing credentials, `link_disabled`, reconnect exhaustion — is a real listener
failure, not a refusal and not a clock-wake: judge it, do not just retry blindly. **Degradable** (a transient
disconnect the listener already retried through, a rate limit that will clear): log it and recompute/resume
from the top. **Fatal** (a dead credential, missing GCP auth, anything you cannot self-serve): **stop and
escalate loudly** rather than silently retry-looping — a stalled loop nobody notices is the single most
expensive failure mode here.

**A corrupt `profile.json` stops the listener before it connects**: exit 1, `listen: will not start — the
profile at <path> is there but cannot be trusted (…)`, and `listen --check` reports `✗ profile`. An ABSENT
profile still starts, on default chrome. The rule is to fail loudly and fail early: the bot
down until the file is fixed beats capturing on chrome nobody chose. Fix the file or move it aside, then arm
again; a running listener already resolved its chrome at startup, so a file corrupted mid-run is caught at
the next arm.
