# Recovery after an outage

Part of [Listener supervision](../listener-supervision.md).

A `died` → `armed` gap is a window in which a tag may have arrived at nobody. The scheduled sweep
(`slopweaver listen recover --scheduled`) is what closes it.

**A permanently unreadable channel is an exclusion, not a failure.** A sweep with any failure is `partial`,
and a partial sweep advances no watermark by design — so one `not_in_channel` channel counted as a failure
pinned `completedThroughTs` for six days, every sweep returning `recovered: 0`. Such a channel is
not partially read; it is **unreadable**, permanently, for this token — the same category as the hundreds of public
channels the sweep excludes before it starts, reached one API call later because Slack's own `is_member`
said otherwise. So it is not a weakening to report it as an **exclusion**:

- `not_in_channel` → `{ reason: "not-a-member" }`, and `channel_not_found` → `{ reason: "gone" }`, so a
  channel vanishing from the sweep never looks like a channel with nothing in it.
- A channel that could be **partially** read still poisons the sweep.
- An excluded channel is not counted as completed either — it contributed nothing and was never read.
- Every sweep's output carries `excludedChannels`, so an operator finds out **which** channel the bot needs
  inviting to, instead of watching a watermark sit still and not knowing why.

**Every read stage classifies the same way.** A `not_in_channel` answered to a **thread** read — what the
background phase gets when it polls a remembered checkpoint in a channel the bot has been removed from —
pinned the watermark for seven hours under a healthy listener when only the history read excluded it. So:

- The thread page reader types `not_in_channel` / `channel_not_found` exactly as the history reader does,
  never as the generic `PAGE_FETCH_FAILED` no caller can tell from a rate limit, and ONE classifier
  (`recoverShared.ts#permanentExclusion`) is consulted by every read stage —
  history, foreground thread, background thread. A thread-stage exclusion excludes the whole channel: the
  foreground loop stops reading it, its root hints are dropped, and a remembered checkpoint is **kept**, so
  an invite back resumes from the right cursor. Repeats of one channel collapse to one `excludedChannels`
  entry. A transient thread failure (a rate limit, a network fault) is still a failure and still makes the
  sweep partial. A DELETED root is not transient — `thread_not_found` answers identically forever — so
  `recoverShared.ts#goneThread` reports it in `goneThreads` and a complete sweep retires its checkpoint unless that channel was excluded; scored as a
  failure, two deleted roots in one incident channel made 3 of 4 due sweeps partial. Audited for the same asymmetry: discovery failing is a whole-scan failure
  with nothing to exclude, and a contradictory-metadata channel is a data fault, not a membership fact —
  both stay failures.
- **A pinned watermark gripes.** `listen recover --scheduled` publishes a `recovery-stalled` event at
  `alert` severity onto the supervisor stream when the watermark it just persisted is an hour or more old
  while the listener grades `healthy` or `degraded` — edge-triggered, once, until another listener event
  intervenes ([docs/supervisor-events.md](../supervisor-events.md)). Its only other symptom is a sweep that
  keeps running on cadence and printing `recovered: []`, which is exactly the number nobody reads.

**What else a pass does, and what it answers with:**

- **Every well-formed thread root in a channel read without a failure enters the checkpoint inventory**,
  replies or not, at no extra Slack call (`recoveryRootRegistrations`, `src/live/listen/recoverThreads.ts`) — so
  a tag posted later under a root that had no replies when it was read is still reachable once the root leaves
  the history window. A channel whose foreground read fails registers nothing, and a scheduled sweep that ends
  partial for any reason persists none of its inventory: the previous one stands (`nextSweepState`,
  `src/cli/commands/listen/scheduledRecoverState.ts`).
- **The background thread poll runs in two lanes.** Roots inside `RECENT_ROOT_HORIZON_HOURS` (seven days) take
  up to four fifths (rounded up) of each sweep's background budget, the older tail, when it has a
  thread due, keeps at least one read whenever two or more remain, either lane's unspent share spills to the
  other, and nothing is dropped for age (`src/live/listen/recoverThreadPlan.ts`).
- **A bot card counts as an answer, too.** Beside `already-answered` (an answer naming the ask exactly),
  `answered-in-thread` excludes a tag whose thread carries a bot CARD from this install inside the tag's own
  interval, so an answer that went out through `slack post`/`reply` rather than `turn answer` is not answered a
  second time. It is the weaker claim: the card lane cannot tell an answer from a nudge or a heads-up, so any
  such card in that interval stops the tag being recovered (`src/live/listen/answeredInThread.ts`).
- **A manual pass says whether it looked.** Its `--json` carries `completeness`, `failures` and
  `excludedChannels`; a channel `--channels` names that it could not read makes the pass `partial`, and a
  partial pass exits 1 rather than reading as all clear (`src/cli/commands/listen/manualRecoverReport.ts`).
- **`--discover-channels` widens a manual pass's breadth**, never its reply. It adds the bot's own
  `conversations.list` membership to the typed list, so a channel the bot joined yesterday is read; a
  survivor found there outside `--channels` comes back `wrong-place` with no brief command.
- **A scheduled sweep also notices a live incident**, from the channel list it already fetched. A new
  incidents.io channel inside the live window becomes one `incident-…` board row and its `--json` reports it
  under `incidents`, never counted against `completeness`: a row, no model (rule 2), and a partial scan still
  registers what it did list ([incident](../../skills/incident/SKILL.md), `src/incident/detect.ts`).

## What is still open

- **The reaper is unnamed**, and is deliberately not chased. The critical-memory-pressure hibernation path is
  the strongest surviving hypothesis and is unproven; what the watchdog incident showed is that the reap fires in
  cross-session bursts, so it is a machine-wide or harness-wide action rather than anything one session
  causes. If it is ever confirmed, record it here — the design does not change either way, because rule 2
  puts every process Slopweaver may start inside the class that gets reaped.
- **A reconciled death recovers the FACT, never the cause.** `superseded` cannot distinguish a reap from an
  operator who stopped a listener without running `listen disarm`, because the discriminator lives in the
  harness's own task bookkeeping. Fixed at the source, not inferred.
- **A pull cannot bound an outage tighter than its own interval.** Reconcile runs once per supervisor pass
  ([§ "Where it runs"](journal-and-watchdog.md#where-it-runs-and-the-one-ambiguity-it-leaves)) and before every `listen supervise` decision, so a death is DETECTED only at the next of
  those. A DOWN arm's recorded time comes from its last heartbeat, accurate to one beat interval (15s); a
  `superseded` one is stamped when the arm that replaced it was armed: an upper bound, not the moment it died.
- **The A/B on the reaper was inconclusive.** A harness-tracked background task and a detached twin, both
  ticking every five seconds, were started together and were both still alive 2h15m later. No reaping event
  fired in the window, so the experiment discriminated nothing — reported rather than quietly dropped.
