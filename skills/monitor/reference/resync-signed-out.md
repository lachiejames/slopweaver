# `resync-signed-out`: a scheduled resync stopped at a sign-in page

If the fleet needs the owner to sign in, a button goes in front of the owner. One morning three
`resync-atlas-*` rows failed and the fleet-health note restated each exit code. Two were sign-in walls — Trelica's
walk reached `https://acme.trelica.app`'s sign-in, Xero's reached `go.xero.com`'s — and nothing told the owner
which sign-in, or where. The third, Vanta, was a harness kill and an OAuth exit 1: no sign-in would have fixed it.
Declared in `src/monitor/registry.ts`, judged in `src/monitor/resyncSignedOut.ts`. The other monitors:
[the monitors](the-monitors.md).

## How a wall is recorded

- **The page walk notes it** (`src/browser/signInWalls.ts` § `signInNotingTransport`, wrapped once by
  `walkDeclaredPages`). Every page the walk captures, the root probe included, is judged by the platform's own `sessionLostOn`; a capture that reads signed
  out notes the REQUESTED url's origin in `src/browser/signInWalls.ts`. A visit that failed outright (a relay drop,
  a transport `SESSION_LOST`) notes nothing: no page was read, so no sign-in is proven. Trelica's own session check
  notes its origin the same way (`cli/commands/trelicaAtlas/syncRun.ts`). The walks outside the kit — hex, twilio
  and aether (`src/atlas/aether/walk.ts`) — note it from the walk's VERDICT: a page met the wall and none landed.
- **The resync drains it** (`src/live/resync/run.ts`). The register is process-scoped, exactly like the walk-stop
  register beside it, and `runResync` drains it around each step: a wall stops the steps and is stored as the
  attempt's `signInWall`. A failure with no wall carries no such field.
- **The slot is given back, not cooled** (`src/live/resync/outcome.ts` § `resyncExitCode`). A walled attempt exits
  `EXIT_DEFERRED`, so the ledger neither stamps a retry floor nor holds the row on a failure finding. `automation seat`
  then steps past the row with _AWAITING SIGN-IN_ (`src/cli/commands/automation/seatRefusals.ts`) until the owner's card is
  settled at or after the wall, and seats it the pass after; an unreadable hand register waits, never guesses.
- **A walk that lost the owner's Chrome to another live walk is given back the same way** — `RELAY_HELD`, noted by
  `src/browser/relayLeaseHold.ts` and stored as the attempt's `relayCollision`. Walks are serialised by the next
  pass, not penalised. MEASURED: `resync-atlas-hex` collided with a concurrent walk and earned a
  quarter-period retry floor (42h on its weekly cadence) plus a failure hold; `resync-atlas-xero` did the same on
  `go.xero.com`'s sign-in page the next day. A genuine failure still exits 1 and keeps its floor and its hold.

## The card

- **One per origin** (`perSubject`), keyed by the host (`mon-signin-acme-trelica-app`); two rows walled at
  the same origin are one card naming both. `work` context, `floats`.
- **The pass opens the window; the owner only signs in** ([waiting on a sign-in](../../hand/reference/waiting-on-a-sign-in.md)).
  When the pin is written, the subject carries `opens: <origin>`: on a NEW card the pass runs the pin on that page
  (`src/browser/openInWorkChrome.ts`) before it records the card, and only then raises the note, _Sign in to `<host>` in the work Chrome window
  that just opened on its sign-in page_, with the step's `opened` set and no literal. The pin execs Chrome with the
  recorded work profile in front ([profile and walks](../../../docs/browser-route/brief-profile-and-walks.md)), so
  the page cannot land in the personal one. A card already open opens nothing again. A page that fails to open is a
  `refused` action in the pass, and the card still posts, saying only which sign-in — never a window that is not there. Before any pin is written the card says only which sign-in.
- **It says what doing nothing costs.** Its `ifIgnored` line names the host's read as of the OLDEST last success
  among the rows the page stopped (or that it never synced), that each scheduled resync stops there again, and that
  the schedule raised it, not a run — routine freshness, which the owner ranks below an incident
  ([what the card shows](../../hand/reference/what-the-card-shows.md)). The card cannot yet see a run that needs the
  same sign-in, so an incident read waiting on it is not on this line.
- **A demand-gated atlas says who wanted the walk instead.** An atlas declaring `resyncDemand` (Aether) walks only
  when a person named it since its last success, so it only ever meets this page on someone's ask (the owner is asked
  only when a sync would be useful). Its attempt carries that mention as `demand`; the
  subject's `wantedBy` turns the line into _It walked because `<who>` named it on `<date>` — the stored read may
  already answer them_, and the mention's link sits behind the Details row. A slot nobody asked about exits 3 having
  opened no page, so it never raises this card ([the gate](../../automation/reference/demand-gated-resync.md)).
- **The owner's Done is honoured until a NEWER attempt meets the wall.** Between the owner's Done and the seat's next pass the
  walled attempt is still the newest; a card settled at or after it is held (`delivery: hold`) rather than
  re-posted. A newer attempt walled again posts afresh; one that gets past clears it. `signInAnswered` is the one
  rule the card and the seat both read, so "the owner has signed in" means one thing to each.
- **A card whose sign-in already holds leaves before the owner opens it.** The tick's `hand-recheck` reading, just before
  this one, visits the card's `opened` origin once through the atlas's own sign-in test and settles the card when the owner
  is already signed in — which this monitor then HOLDS exactly like the owner's Done, so the seat re-seats the resync
  ([rechecking](../../hand/reference/rechecking.md)).
- **Only a row that still exists raises it.** A retired row's state file outlives its definition, last wall and
  all, so the monitor and the fleet-health line judge only the states of rows a parsed definition names
  (`src/live/resync/activeState.ts`). A definitions directory that is absent or will not list, or ANY definition file that will
  not parse, keeps every state and is named as a blind spot — failing open, never hiding a wall: a retired row's
  stale wall would otherwise raise its sign-in card at every tick.
- **Datadog and GitHub are the fleet's** (the owner's ruling). Their wall is held, not carded, until a fresh
  `browser sign-in` look found the step the owner's; the seat seats the row so its session presses
  ([fleet sign-in](../../../docs/browser-route/fleet-sign-in.md)).
- **Fired every tick.** `supervisor tick open` runs `monitor check --only resync-signed-out --fire` (reading
  `sign-in-walls`) before the fleet-health reading, so the note is up when the fleet-health line names it.

## The fleet-health line says whose move it is

A button goes in front of the owner. `fleet-unhealthy`'s Details row
(`src/monitor/fleetHealthFate.ts` § `rowFatesOf`) gives every failing row ONE fate, in this order:

- **Needs you** — an OPEN hand card it waits on (`src/monitor/fleetHealthHand.ts` § `yourSteps`): this monitor's
  `mon-signin-<host>` card for a carried wall (_sign in to `<host>`, in your work Chrome_, `(+N more open)` past
  the newest), else a card whose `row` is its repair seat or failure finding. The line ends `[hand:<id>]`, which
  the note turns into an **Open its card ›** button to that card's Queue link. Where the step happens is
  `placeOf`, off the card: a registered plan email in it is _outside your work Chrome, as `<email>`_, a pinned or
  sign-in card _in your work Chrome_, a literal _in a terminal on this Mac, outside Chrome_.
- **Nothing for you** — the fleet presses its Datadog or GitHub `<host>` sign-in itself (the subject's
  `fleetPresses`, never read as the owner's Done); you pressed Done on its `<host>` sign-in, so its next attempt says whether it got past (or,
  while a failure hold pauses it, that it stays paused); else a seat repairing it; paused on its failure finding;
  or its next slot runs it again.

A wall this monitor carries with no open card reads Nothing for you rather than a button to nothing. A row that has
since run clean carries no fate.

## Residue

A walk not built on `walkDeclaredPages`, or a platform whose `sessionLostOn` misses its own sign-in shape, fails as
a plain failure and raises no card. A wall is recorded only when a step ran in the resync's own process; a verb
that shells a second `slopweaver` records nothing across that boundary.
