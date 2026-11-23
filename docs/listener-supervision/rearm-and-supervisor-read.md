# The re-arm and escalation contract

Part of [Listener supervision](../listener-supervision.md).

The loop session ticks `slopweaver listen supervise` on its own poll (15 seconds is the natural interval —
one heartbeat). On a DOWN verdict it journals a `died` event, then answers:

- **fewer than 3 deaths in the last 15 minutes** → clear the arm record and hand back an arm command, which
  the session runs. It is composed from what the DEAD arm carried, so the replacement keeps that arm's scope
  and its thread-reply channels rather than silently widening or narrowing what counts as an address.
- **3 or more** → journal `escalated`, leave the listener **DOWN**, and print the question to record with
  `slopweaver handover ask`.

**The escalation STANDS.** The first implementation escalated correctly and then, on the very next tick, saw
an unarmed home, concluded "nothing is running" and handed back an arm command — which would have let the
session re-arm anyway and made the whole contract decoration. Found by running it, not by reading it. Now a
standing escalation holds until an `armed` or `disarmed` event lands after it: a person (or a session acting
on a person's instruction) running `listen arm` or `listen disarm`. Another automatic tick can never lift its
own hold.

The threshold is not arbitrary. It is the rule the loop session set for itself during the first incident, made
permanent: a third kill gets a durable `handover ask` rather than a fourth silent re-arm, because at that point
re-arming IS the blind retry-loop rule 2 forbids.

The window matters as much as the count. Three deaths over three days is a listener that occasionally loses a
socket; three inside fifteen minutes is something eating the process, and re-arming into it just produces a
fourth corpse.

**Leaving the bot down is the correct outcome there.** A supervisor that keeps arming is indistinguishable
from no supervisor at all, except that it hides the problem for longer.

## What the supervisor session reads

The owner wants the supervisor session to see what the Slack socket is doing — its current state — and to know
with confidence when something is wrong.

`slopweaver listen status --json` is that, and it is designed for a sweep calling it every tick rather than
for a human reading a log:

```json
{
  "grade": "down",
  "why": "DOWN socket-down — arm <arm-id> pid 2925 is alive and beating, but its Socket Mode connection has been down for 141s",
  "armId": "<arm-id>",
  "pid": 2925,
  "socketState": "connecting",
  "lastEventAgoMs": null,
  "heartbeatAgoMs": 3120,
  "deathsInWindow": 1,
  "escalated": false,
  "threadReplyChannels": [],
  "lastDeath": {
    "armId": "<previous-arm-id>",
    "atIso": "2001-01-01T00:00:00.000Z",
    "reason": "process-dead",
    "lastLog": "listen: could not open a Socket Mode ticket: Slack refused apps.connections.open: invalid_auth\nlisten: reconnecting in 16000ms (ticket-open-failed)\n"
  }
}
```

**`lastDeath.lastLog` is the field the whole report exists for.** "The socket died and no one knows why" is
not answered by recording that it died; it is answered by keeping what the process was SAYING as it went. The
tail of the dying arm's own log is captured at the moment the death is observed — the next arm's log will not
contain it — and stored on the journal entry. It is evidence, deliberately not a diagnosis: nothing infers a
cause from it. A foreground arm has no log file, so `lastLog` is absent there, which is stated rather than
faked with an empty string.

## A false RED is as expensive as a false GREEN, and this one shipped

Measured the first time a listener ran under this feature: `status` read `DOWN … socket-down … for 180s`
while the listener's own output said "connected to Slack over Socket Mode" and frames kept arriving. The beat
was being written — `writtenAtIso` advanced — but `socketStateSinceIso` was frozen at startup and
`lastSocketEventAtIso` never appeared. The callbacks were never firing.

The cause is worth naming, because the compiler should have caught it and could not. The beat's two callbacks
were passed into the deps builder as a **conditional spread**:

```ts
...(beat === undefined ? {} : { onSocketFrame: beat.noteFrame, onSocketState: beat.noteSocketState }),
```

A spread is exempt from excess-property checking. The builder's parameter list did not declare those two
fields, so they were dropped silently and `tsc` said nothing. They are now named parameters, which puts the
checker back in charge of the wiring.

**What it would have cost.** The listener beats in its startup `connecting` state forever, so after 90
seconds every read is `socket-down`. `supervise` journals that as a death, hands back a re-arm command, and
on the third tick escalates — on a perfectly healthy arm. Worse, a session acting on those re-arm commands
would have started a second listener beside a live one and split the tags. A monitor that cries wolf is not
merely useless; here it actively breaks the thing it watches.

## `unarmed` is a statement about the RECORD, not about the machine

It means "no registered listener", and those are not the same thing. A listener started without
`--heartbeat <armId>` never self-registers, so supervision cannot see it at all — and it is still holding the
socket.

Measured the first time this shipped: a listener that predated the feature (`pid 29371`, argv
`listen --follow --queue …`, up 8h40m) was answering tags while `listen status --json` reported
`grade: "unarmed"`. Both were correct. `~/.slopweaver/live/listener/` did not exist, so there was no record
to read.

**The hazard is what a caller does next.** Arming on an `unarmed` reading, while an unregistered listener is
running, gives the app TWO Socket Mode connections — Slack load-balances a tag across them, and only one is
being watched. `arm`'s already-armed refusal cannot save you here: it reads the record, and the running
listener is not in it.

So the order matters, and `slopweaver listen disarm` is not the first step. It clears a record that does not exist and
sends no signal, which would leave the old process running while making the home look freshly clean — it
reads like progress and changes nothing. Stop the unregistered process in the session that owns it, THEN
`arm`.

## Four grades, not three

`healthy`, `degraded`, `down`, `unarmed`. The ask named three; the fourth earns its place because `unarmed`
is not a fault. It means no listener is running at all, which is correct and expected whenever no live-loop
session is up — a supervisor that graded that `down` would raise an alarm every night, and a monitor that
cries wolf nightly trains its reader to ignore it. `down` means a listener is supposed to be answering and
is not. `degraded` covers `starting` and `reconnecting`: real, temporary, not yet worth waking anyone.

## The grade is not the whole answer — which COMMIT it is on sits beside it

`listen status` also reports the loop's own freshness: the two trees it runs on (its `bin`, which every worker
it dispatches inherits, and its `plugin-dir`, which is the skill prose it FOLLOWS), each with a HEAD, how far
`origin/main` is ahead, and a grade of `current`/`behind`/`stale`/`unmeasured`. **The verb exits 3 when the
listener is DOWN _or_ its freshness grades `stale`.**

This is here rather than in a verb of its own because a `healthy` grade was measurably not enough. A loop read
`healthy` all day while running a two-day-old worktree — its `bin` one commit behind, and its `plugin-dir`
sixty-three behind — so a run of landed fixes changed nothing at all in the channel and every public
failure that day ran the old binary. Every gauge in this document read fine. The
grader is `src/live/standing/freshness.ts`, and `stale` specifically means the missing commits touched code or
prose the loop runs, so an ordinary few-commit drift stays `behind` and is reported without shouting.

## The subscribable event category is Slopweaver's own stream, not cmux's

The steer also asked for an `events` category the supervisor's sweep can subscribe to, naming cmux's event
stream. That stream is **cmux's**, carrying cmux's own hook events, and Slopweaver reads it
(`src/cmux/events.ts`) rather than publishing into it — there is no Slopweaver-side emitter for it to use. So
the category is a stream Slopweaver owns ([docs/supervisor-events.md](../supervisor-events.md)): the listener
publishes onto it and `slopweaver events tail --follow` subscribes. `live/listener/arms.jsonl` stays the
durable record of every arm, death and escalation, which a sweep can also tail directly.
