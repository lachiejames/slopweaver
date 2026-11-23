# `org-health`: the organisation's incidents, loud when one starts, quiet otherwise

An active incident reaches the owner as one line naming it, moving the way a status
page does: root cause unknown so far, root cause confirmed and a fix dispatched, confirmed stable, resolved.
Healthy teams are never mentioned. It splits in two:

- **Loud**: a heads-up floating note when a new incident starts, almost like paging the owner, and again when its
  severity materially changes. That is the `org-health` monitor.
- **Quiet**: a resolution needs only a quiet update. No message, no digest. That is `org-health status`, read on
  demand. The console sidebar carries no Incidents indicator, so nothing draws it unasked.

## Four parts: one live read, one loud monitor, one quiet verb, one local acknowledge

- **`slopweaver org-health read`** reads the incident channel whole and writes the store's `org_health_incident` row
  (`src/orgHealth/storePort.ts`). The channel is the profile's `orgHealth.incidentChannelId`, and the
  token is the Slack read token every other read verb resolves. The monitor pass stays local, so this
  is the one network read in the lane.
- **`monitor check --only org-health --fire`** judges that snapshot. The chair runs both every `tick open`, after
  fleet health and before `meeting-prep-due`, so a meeting's prep page is still the note left on top.
- **`slopweaver org-health status [--json]`** judges the same snapshot on demand, through the same
  `orgHealthStanding` (`src/orgHealth/standing.ts`) the monitor uses, so the two never disagree on what is open or
  measured. It calls no provider.
- **`slopweaver org-health ack --ref <INC-n>`** records an acknowledgement of one open incident in the store's
  `org_health_acknowledgement` table, and sends nothing to incident.io or anyone (below).

**The store rows are the authority.** `$SLOPWEAVER_HOME/org-health/{incidents.json,sightings.json,acknowledgements.jsonl}`
are IMPORT-ONLY: each is read once, inserted only if no row exists yet, and never read or written again. A store that
cannot be reached is `STORE_UNAVAILABLE`, which every reader shows as `unmeasurable`, never a file read and never clear.

## What incident.io writes (MEASURED against the live channel)

- **One announcement per incident, edited in place on every status change.** The root's `*Status*:` is the
  current state. The thread's updates (`~Fixing~ → *Monitoring*`) only say WHEN it entered that phase.
- **Statuses map to four phases.** Investigating → investigating. Fixing → identified. Monitoring → monitoring.
  Documenting and Closed → resolved. An unmapped status is REFUSED, never guessed, so a new word gets noticed.
- **The weekly policy report carries the same `incident_message` metadata.** Its text is prose, not
  `[<Severity>] <title>`, so it reads as `other`. A broadcast reply reads as `other` too.
- **Known by its bot, then by any one feature.** The channel shows which bot is incident.io's: the one posting the
  metadata, or a `[<Severity>] <title>` message with an `/incidents/<n>` button. From that bot, any one of the
  title, the details' `*Severity*:` and `*Status*:` lines, or the button makes a candidate, parsed strictly, so a
  drifted field is REFUSED, never read as no incident. Another bot's message never is. With no bot shown, a
  signed message refuses the read. The residue: if all three features drift at once, it reads like the weekly report,
  and with no bot shown, a lone button reads like another bot's link.
- **Updates count from incident.io's app.** A reply is an update when its bot announced the incident, or belongs to
  the same Slack app (`app_id`, else `bot_profile.app_id`), so a reinstalled integration's new bot id still dates
  the move. Slack sets the app id; which bots the channel's history once showed is never trusted for updates. That is
  Slack's message shape, not measured here: the live shaped read shows neither field, so with no app id on the root
  only the announcing bot counts.
- **When the phase began.** A moving update (`~Fixing~ → *Monitoring*`) dates it. With none, an unedited root
  dates it at declaration. Otherwise the first complete read that saw the new phase dates it, by the root's latest
  edit, else the read's start: an upper bound on the move, never the move itself, marked `sighted`.
  The `org_health_sighting` row remembers that, so neither a cosmetic edit nor a same-phase update
  moves it (`src/orgHealth/sightings.ts`). It remembers each incident's severity and loud moment too (below).
- **Cost.** The live channel held 15 announcements in one history page. One read opened 2 threads and took 3.9s of
  the 120s tick (`/usr/bin/time -p slopweaver org-health read`).

## The read is bounded, and a broken read is never quiet

- **The read walks the whole channel every time.** Slack orders history by the ORIGINAL `ts`, so an incident
  reopened today can sit a month deep. A lookback window would clear it.
- **Threads are opened selectively.** Every unresolved announcement gets its thread read. A resolved one gets read
  only if it was touched or replied to within the week: a reopening update lands before incident.io edits the root,
  so the reply is what shows it.
- **Budgets: 3 history pages, 10 threads, 2 pages per thread** (`src/orgHealth/policy.ts`). Over budget refuses
  BEFORE the first thread is opened. The pages bound the work; a 90s deadline bounds the time. Every Slack call,
  each history and reply page included, races the time left (`src/orgHealth/deadline.ts`), so a slow or hung channel
  writes its own `unmeasurable` inside the 120s tick rather than being killed. The other 30s are for that write. A
  page that answers past the deadline is refused too, whichever settled first. The deadline runs on a monotonic
  clock, so a wall clock stepped backward cannot extend it.
- **One state per read.** The thread's copy of the root must parse and carry the channel read's status, severity,
  title, reference, homepage, channel and lead. One differing in any of them, missing or no longer parsing is refused
  (`ROOT_MOVED`), never mixed with the older root; the next tick's read sees one state. An edit stamp alone decides
  nothing, so a cosmetic edit between the two reads passes. A new stamp WITH updates posted after the channel read's
  copy is a move away and back, and is refused the same way. Slack repeats the root on every replies page, so a page
  holding anything must repeat it, and every copy is checked. incident.io posts an update before it edits the root, so
  ANY update newer than the root's last edit naming another status (`Documenting` to `Closed` included), severity or
  title is refused too (`ROOT_BEHIND`), so a pair going away and back before the edit is caught by its first half; a
  root edited after its newest update moved with nothing said, and is read. An opened thread is the state at its own
  read, its root copy agreeing with the channel read's, so an update posted between the two calls is read with it.
  An announcement whose thread is not opened (a week-old resolved one reopening, say) is read as it stood at the
  history call, and a move after that call is the next tick's.
- **One read at a time, fenced by a generation.** A read takes the lane's lock first (`org-health-read`, under the
  per-home runtime directory, `src/stateRuntime.ts`), judged by the wall clock and never `--now`. A second read while
  one holds it reads nothing and exits 4, but it still commits the "under way" marker, which bumps the snapshot row's
  revision. Every outcome is a compare-and-set against the revision its own marker committed, never retried, so the
  older holder's outcome is refused (`REVISION_CONFLICT`) rather than landing over the newer marker: the cost is one
  tick's blindness, never a clear. A lock that cannot be taken at all (`READ_LOCK_UNAVAILABLE`) is fenced the same
  way. The residue: a holder paused past five minutes loses the lock. The supervisor kills its child at 120s, so only
  a suspended process or machine (a stopped job, a sleeping laptop) meets that.
- **The "under way" marker is committed first**, then exactly one outcome. A read the supervisor kills leaves the
  marker, so the last success never reads as current. A measured outcome publishes the snapshot and the sightings in
  ONE transaction, so one never moves without the other. A read that cannot commit the marker (the store is down)
  reads nothing from Slack, and only tick open's digest can say so: after a failed read it shows the tick's verdict
  `UNMEASURABLE`, whatever the pass said or whether it ran.
- **These all read `unmeasurable`, never clear:** no snapshot, an unmeasurable one, or one older than 45 minutes.
  A missing channel or token still writes the snapshot, naming what is missing.

## Loud: one note when an incident starts, reopens or changes severity

- **A loud moment is recorded by the read, not inferred by the monitor.** Each complete read compares an incident
  with its last sighting: never seen and not resolved is `new`, resolved then open again is `reopened` (`new` if it
  never paged), a different severity while open is `severity-changed`. Otherwise the last loud moment stands. It is
  dated by the START of the first complete read that saw it, so it only ever moves forward. An incident first seen
  already resolved has none, and neither does a re-grade while resolved.
- **First seen open long after it was declared is not news.** Past the 48h live window
  (`LIVE_INCIDENT_WINDOW_HOURS`, the one that starts an investigation) it gets no loud moment, so it never floats as
  "a new incident"; `org-health status` still counts it, and a later severity change or reopening (as `reopened`) still
  pages. An incident declared long before once floated as new; the owner wants no floating notes on the owner's screen
  until there is something ready for the owner's attention.
- **One subject for the whole organisation**, one note drawn in front of every note already up rather than a note
  per incident. The headline is the newest loud moment among every kept incident, ties to the
  higher ref: `INC-98 Critical · <title> — a new incident · +1 more open`, or `— severity changed from Major`. The
  count, and every incident behind Details (status, age, last update), are as of the moment it floated. Open goes
  to the incident's homepage. The snapshot caps a severity at 24 characters, so the title always has room.
- **The key is the moment's own**: `inc34-critical-<instant to the ms>`, so the key, the sentence and Open describe
  one page. A phase move, an update and a cosmetic edit change nothing loud — those are `org-health status`'s.
- **A headline that has since resolved reads clear**, so its card departs quietly. A resolution is never paged.
- **A key is posted once, and an old one never late.** Once its card is down, the owner's Done or a newer page replacing it,
  the key is HELD (`delivery: hold`, `shownKeys`, `src/monitor/heldKeys.ts`). A key whose instant is no newer than
  the newest key already posted, the card still up included, reads clear. So a page missed while the chair was off is
  never posted a week later, and a page re-dated by a read with no memory never replaces the card it repeats:
  that card comes down instead. A held key departs nothing. There is no `lapsesAt`: a key that lapsed while still the headline would
  settle and re-post on every pass.
- **A note gone without the owner's press comes back on the next fired pass**, as `meeting-prep-due`'s does
  (`src/monitor/noticeReraise.ts`).
- **A read with no sightings memory seeds it.** A new home, or one whose import found no file, dates each first-seen open
  incident's `new` by its declaration rather than the read. A page the owner saw is no earlier than that, so the watermark
  reads an incident already paged clear, and one declared since pages. On a machine with no page ever
  shown there is no watermark, so its first read pages the newest open incident declared inside the live window.
  A reopening seen only by a seeding read is not paged.
- **The limits.** A severity changed and changed back between two reads is never seen. The window is the tick. A
  seeding read dates by Slack's time, floored to the second, so an incident declared within the same second as the
  newest key ever posted is not paged; `<=` is what stops the week-late page above.

## Quiet: `org-health status`

`org-health status --json` prints `tone`: `healthy`, `yellow` when every open incident is still Investigating, `red`
when any is Fixing or Monitoring, beside the count of all of them ongoing, and each open incident's line and page. An
unmeasurable or stale snapshot says why, never a zero. A phase move and a resolution are told only here. What yellow
covers is incident.io's declared Investigating incidents. A suspicion raised only in a bug thread has no source in
this lane.

**Whether the fleet is looking into it, and why** (a subtle visual indication that the fleet is looking into a
thing, and why). Each open incident carries an `investigation`
(`src/orgHealth/investigation.ts`): `lined-up`, `looking`, `findings` or `unmeasured`, read off a live board row
whose slug starts `incident-` and whose summary names the incident's homepage or channel id on a boundary — never its
bare `INC-n`; a row naming two open incidents investigates the one it names first. The state is the row's
`runDisposition`, never a journal merely existing. Findings are ready when the incident's own note is up on the row,
linking `/queue?open=hand%3A<note id>`, or when the row's question is the OWNER's by the board's `ownerWaitOf`, linking
`ask%3A<slug>` — the card the Queue draws, never the incident page. A question the owner already ruled on is
lined up again, as is a card the owner's spoken words landed on (`talk cards`, which the Queue holds off too), as is a registered ask naming any `blockedBy` or `doneWhen` (resolving either is a board scan or a probe run); a paused row draws
nothing; an `unmeasured` investigation is a staleness fact naming the incident. Only the `incident-*` listing is read, never the board
(`src/orgHealth/investigationRead.ts` carries the measurement), and a read that fails is `unmeasured`, never nobody
looking. Each incident's status line ends `· findings ready`, `· looking into it` or `· lined up`. The loud note is
unchanged: a genuinely new incident still floats, and its Open is the incident page.

**Acknowledging an incident, locally** (like acknowledging a page in a pager: quiet the signal while keeping it
visible, and bring it back if something changes). `org-health ack`
appends one row naming the incident's severity, phase, `phaseChangedIso`
and loud moment as they stood (`src/orgHealth/acknowledgement.ts`). The incident counts as `acknowledged` while the
NEWEST row for its ref, in ledger order, still matches all four. A severity change, a phase move, a move away and back,
or a reopening drops it to `none` again, and an update with no move does not. The verb refuses an incident that is
not open, one the snapshot holds open twice (status reads that ref `unmeasured`), or a snapshot that is not measured.
It also will not append behind a ledger row that fails to read, nor import a
legacy ledger with a bad line or one that is not a regular file (a dangling symlink included). Once
every open incident is acknowledged and none has findings ready, the standing reads quiet and its line ends
`· acknowledged`. The incidents stay listed, each `acknowledged · quiet until it changes`. Findings waiting on the owner
always defeat quiet, and so does any staleness fact on the reading, a failed re-read included. A ledger that fails to
read leaves every incident `unmeasured`: a staleness fact and no quiet, never `none`. The acknowledgement is a
local fact. Nothing reaches incident.io or a person, and the loud monitor ignores it.

## Deferred, named

These are not read: GitHub Actions, provider status pages, and which team an incident belongs to.

A blind lane reaches the chair, not the owner's screen. `tick open`'s digest prints `org-health-read:` (read whole, or
unavailable with how the child ended) and `org health:` (the verdict, `UNMEASURABLE` with why, then every action
the pass took; a `refused` one is never cut by the overflow cap; `src/supervisor/digestNotice.ts`). No `tick close` gate refuses on it,
exactly as for `meeting-prep-due`. Only `fleet-unhealthy` has one, being the fleet's own health.

An incident note and a `meeting-prep-due` note raised on the same tick both stay up: the incident note joins the
ordinary cascade from the top right, the meeting note its own from the top left, one level above.

`org health:` in the digest is the chair's, never the owner's: it is how the chair knows the lane is blind.

Code: `src/orgHealth/` (the parse, the read, the snapshot, the standing), `src/monitor/orgHealth.ts` (the reading and
the note), `src/cli/commands/orgHealth/` (the verbs).
