# Not now is a snooze — the note never offers a bare dismiss

Owner ask: _"a floating note never offers a bare dismiss"_ — its buttons are the specific answers. **Not now…**
swaps the band in place for **1 hour** · **3 hours** · **Tomorrow** · **Back**, and the title-bar close is
hidden; a close that still happens is read as the shortest snooze, never as a dismiss. Tomorrow is 09:00
Australia/Melbourne on the next calendar day, DST included (`src/hand/snooze.ts`).

## The press, recorded

The answer writes `<home>/hand-steps/dismiss/<id>.snooze-<choice>`, and reconcile turns it into
`<home>/hand-steps/snoozes/<id>.json` — `{ id, choice, pressedIso, untilIso }`, the wake time computed from the
marker's own stamp, so a re-read records the same instant (`src/hand/snoozeStore.ts`); of several presses on one
step, the latest stamp stands. A store it cannot write
keeps the marker, so the owner's press is never lost; the note closes only once its marker landed, so a press it could
not write leaves the note up to press again, and `hand snooze` refuses non-zero with the note still up. A snooze writes no register row: the step stays open throughout.
A `later` marker, which no button writes, is read the same way, consumed with no row and kept in
`<home>/hand-steps/later/<id>` for an open step (`src/hand/laterPresses.ts`).

Recording it also departs the step from the push ledger at the press, so its return is an arrival even with no
push pass while it slept. While it holds — or while a marker the store could not record still stands — every
raise reads the note as down, `hand push` leaves the step out of the outstanding set, and
`hand list` prints `snoozed until Sat 09:00` (`snoozedUntil` in `--json`). A
monitor that departs a card the owner snoozed settles it with the owner's snooze first, so `meeting-prep-due` holds it like the owner's
Done ([meeting-prep-due](../../monitor/reference/meeting-prep-due.md)). Any raise of the step's note forgets
its snooze.

## Nothing resident keeps time

Rule 2. The supervisor tick's `snooze-wake` reading runs `hand wake`, which raises each lapsed snooze's note
KEEPING its own step's note already up and drawing beside any other step's, forgets the snooze once drawn —
a raise that fails keeps it for the next tick — and exits 3 when nothing lapsed — 1 while a record will not read, since that
step is held down with a wake time nobody can know. The push lane stays arrival-only: a lapsed step
re-enters the outstanding set, which is an arrival ([the push lane](the-push-lane.md)).

```bash
slopweaver hand snooze gcloud-signin --for tomorrow   # the same answer from the note, the console or a terminal
slopweaver hand wake --json                           # {"keptDown":[],"sleeping":[],"woken":["<id>"]}; exit 3 = none lapsed
```

## Never for this kind, and When it gets worse

On a monitor's card the snooze page ends in **More…** instead of Back, and More… swaps in the two answers that
speak about the KIND rather than one step, then **Back** to the main band. Which it offers is the monitor's call
(`src/monitor/noteAnswers.ts`): a card carrying `slopweaver monitor check --fire` under a declared `mon-<prefix>-`
id. **Never for this kind** is offered unless the monitor is a notice, whose note is its only delivery; **When it
gets worse** only where the monitor declares `worsens` — today `fseventsd-bloated` (its footprint in bytes) and
`fleet-unhealthy` (its failing automations). Any other step draws exactly the two pages above.

Each writes `<home>/hand-steps/dismiss/<id>.mute-kind` or `.when-worse`. These are not snooze or Done markers: the
reconcile never reads them; `monitor check --fire`, `hand push`, `hand wake`, `hand show` and `hand mute` record
them before any raise (`src/monitor/kindAnswerPresses.ts`), and a store that will not write keeps the marker.

- **A mute** is `<home>/hand-steps/mutes/<monitorId>.json`. It keeps that kind's note down on every AUTOMATIC
  raise — a pass's arrival, a lost notice's re-raise, `hand push`, a lapsed snooze — and touches nothing else: the
  card still posts, sits on the Queue and in `hand list`, and `hand show <id>` still draws it, because the owner asked. It
  stands after the card it was pressed on settles. A muted arrival never takes `hand push`'s one note: the next
  arrival not kept down gets it. `hand mute list|add <kind>|remove <kind|subject>` reads, sets and reverses it; `add`
  refuses a notice kind; `remove` exits 3 when the kind was not muted — 1, naming it, while an unrecorded press of it still stands — and a card already open stays on the Queue.
- **A hold** is `<home>/hand-steps/escalations/<base>.json`, keyed by the card's occurrence base so a re-cut `.2`
  is the same subject. A press cannot know the number, so it writes a `pending` hold and the next fired pass
  records the subject's measure as its baseline. From then a pass reading it STRICTLY worse raises the newest open
  card's note — `it got worse (b → m unit)` on the pass row — and forgets the hold; a raise that fails keeps it,
  and one that launched counts as up, as every raise does. A monitor read clear, or a complete read without the
  subject, forgets it — and a subject its monitor re-keys is a new card whose note raises as any arrival's does,
  so `fleet-unhealthy` tripping a further signal (the bot going down beside failing syncs) comes up at once; a press on a card no longer open is moot; the fired-pass lease is asked before each
  hold is judged, so a pass that lost it judges no further hold, and a hold the owner re-answered while the pass ran is left for
  the next one; both are asked again once a raised note is up, before its hold is forgotten (`src/monitor/escalationStage.ts`).
  `hand mute remove <subject>`, the `mon-…` id `list` prints, releases a hold by hand and exits 3 when none stood.
  A mute of the kind outranks a hold: a subject reading worse under one raises nothing, and the hold is forgotten.
  Neither store ever keeps a notice's note down, however a record for one came to stand.

A press or a record is read only under a name `hand post` would accept as a step id, so every one listed is removable by
the id it is listed under, and a file named for anything else keeps nothing down. A press a store would not take keeps
its marker, so that step's note stays down until a pass records it; `hand mute
list` names it as `pressed, not recorded` and exits 1, and `hand mute remove <its step id>` discards it — exiting 1, naming the kind's own remove, when that kind is
muted all the same (a press recorded whose marker would not go leaves both), or naming the mute store when it will not
read. Every verb
that records presses — `monitor check --fire`, `hand push`, `hand wake`, `hand show` — does its work and then exits 1
after meeting one it could not honour, or a mute or hold store that will not read, so a tick surfaces whatever may still
hold a note down instead of a quiet 0 or 3. `hand mute add`, `remove` and a release do the same once their own act is
done: a remove that cleared what it names, with nothing else standing, keeps its 0. The one exception to "does its
work": `hand show <id>` never draws over an unrecorded press on THAT step, because a raise clears its step's markers
and would lose the press; it names the press with its remove and exits 1 instead.

Both stores fail closed: a record file that stands keeps the note down, read or not, and `hand mute list` names an
unreadable one and exits 1. A record path that can name no entry (too long, a non-directory on it, a symlink loop)
holds none — the write there fails the same way — so it keeps nothing down. A kept-down note reads `dismissed`, never `absent`, so the fleet health gate does not
refuse a tick for a note the owner took down — and while either store will not read, an absent note's standing is
unreadable instead, named, never passed off as the owner's dismissal.

```bash
slopweaver hand mute list                       # every mute and every hold until worse
slopweaver hand mute remove fseventsd-bloated   # its notes come back from the next pass that posts one
slopweaver hand mute remove mon-fsev-97860      # that subject's note is no longer held until worse
```
