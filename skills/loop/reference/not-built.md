# What would mean this is not built

Bundled reference for the `loop` skill. Loaded when the body links here, not on every turn.

## What would mean this is not built

- An answer arrived but `ps` shows a `claude -p` child, a fleet drive or a launchd job produced it.
- The loop only works because the listener came back as a resident daemon, or because you re-ran
  `listen --once` in a shell loop of your own construction — the point is `--follow` staying connected.
- A non-whitelisted tagger's message reached YOU as a printed mention, or you did any operational work for
  one — the gate is supposed to stop this before the stream ever prints anything for it.
- Two tags arriving close together produced only one workspace, or the second one waited for the first to
  finish before this loop read it.
- This loop investigated a tag ITSELF — ran `grep`, read files, called live verbs, dispatched subagents —
  under an `inline` judgement, instead of dispatching a worker. The carve-out is a trivial ack needing zero
  research; "flailing through it itself" on one question is the exact failure the worker split exists for.
- A worker's answer was carried through the door by this loop as a matter of course, rather than posted by
  the worker itself from inside its own workspace.
- An ask was declined, softened, narrowed or routed to the owner because its honest answer would rank,
  compare or name colleagues — the functionality is never reduced or revoked.
  Tact is the ASKER's onus; the bot's is the most accurate, citation-backed answer. The rule, the worked
  case and what it does not license: `../../loop-bot/reference/tact-is-the-askers-onus.md`.
- A reviewer was briefed by prose — a pickup line the worker or this loop wrote — instead of opened through
  `turn review`, whose packet is composed by code from the answer's bytes.
- A worker that could not answer simply stopped, leaving a card saying "answering" over nothing, instead of
  reporting `turn resume --failed` for the sweep to finalise.
- A worker booted onto whatever model the saved default happened to be, instead of the tier pinned at
  dispatch from the decision's `"model"` or the explicit default.
- `read-only-subagent` ran in this loop at all — it must be refused here, always, never silently rewritten.
- The bot judged a question by matching capability terms rather than by reasoning about it the way a person
  would — check the actual `RoutingDecision` you composed, not just whether the final answer sounded right.
- This loop itself claimed a recipe row or otherwise did recipe work directly — a due row is a supervisor
  pass's decision, and a seated one is its own session's, never this one's.
- A fatal listener failure (dead credentials, missing auth) was silently retry-looped instead of escalated.
- A turn told the owner it had no credentials for an integration without ever LISTING the store — the
  failure, where "no Vanta credentials available — give me two files" was posted while
  `vanta-client-id` and `vanta-client-secret` sat in `$SLOPWEAVER_HOME/secrets/`.
  `slopweaver secrets status` names every token this install holds and never a value, so asking the owner for a
  file the owner already pasted is never the answer; a token genuinely absent is one `secrets set <name>` the
  owner does once.
- A `recovery-sweep`'s `recovered` survivor got its capture (reaction, checklist, status) but never a real
  answer — a frozen "working…" card left in Slack with nobody ever finishing the turn.
- Scheduled recovery's near-immediate `--deadline-ms` was skipped or set to the full cadence, turning it into
  a second blocking loop that stalls the live `--follow` stream instead of returning almost instantly when
  nothing was due.
- A DM from someone other than the owner got answered with no nudge toward a channel at all, on every single
  reply, as if that guidance were never read — or, the opposite failure, a refusal-shaped scold instead of an
  actual answer.
- A follow-up from someone already being answered was dispatched to its own worker with the brief's
  `ALREADY IN FLIGHT FOR THIS ASKER` section sitting right there — two independently-running answers to what
  was one person adding to their own earlier ask. Measured: the second answer said "nothing ran".
- A follow-up that needed nothing was judged `no-response` without `"exclude": true`, so it stays eligible
  for a later recovery pass to surface all over again.
- A sweep reported a clean board over an ask that was carded in a public channel with no session behind it.
  Every sweep across one measured half hour did exactly that. `UNROUTED — ROUTE IT NOW` is the
  line that must be there, first, before any healthy finding.
- A follow-up tag went unacknowledged — no reaction, no card — as if it had simply been dropped, violating
  the one rule everything else here already follows: never drop a tag.
- A `--deadline-ms` wait hung past its own deadline instead of waking — the clock never won a race it should
  have DECIDE. That is the guarantee: which side won is always settled within a bound. It does NOT extend to
  what the Slack-winning side does once it has won — an admitted address's handler (the capture reaction,
  checklist, status posts) is awaited exactly as unbounded as the no-deadline path has always awaited it, on
  `main` before this feature ever existed; `--deadline-ms` decides a winner promptly, it does not newly bound
  a pre-existing, unrelated characteristic of what winning then triggers. The one accepted exceptions on the
  CLOCK side specifically, stated rather than left for the reader to discover — one of them genuinely
  bounded, one not: the clock can be delayed by the shared Slack retry door's backoff between retries, capped
  at 30s, after a real transient failure on THIS ticket-open attempt specifically — that one is bounded. The
  SAME door's rate-limit block is not: it can already be open before this ticket-open's own first attempt (an
  unrelated caller sharing the same app-token scope, not only after this attempt fails), and — because the
  block is SHARED infrastructure, not exclusive to deadline mode — a caller exempt from waiting on it can
  keep extending its deadline with repeated 429s while this ticket-open's own `AbortSignal` has no seam into
  that wait at all. This is a pre-existing property of the shared door itself, used identically by every
  Slack call in this program, not something `--deadline-ms` introduces or could bound without giving the
  block wait its own abort seam — real follow-up work, not yet done. A stalled or slow ticket-open request
  itself, once an attempt actually starts, is aborted immediately; that was the actual gap two review passes
  found, and it is closed. And, when the clock wins, `cancel()`'s own socket teardown is capped at
  `CLOSE_TIMEOUT_MS` (2s) rather than genuinely confirmed — MEASURED against a real Socket Mode connection,
  whose peer routinely did not fire its own `close`/`error` event at all, so this is a routine cost paid on
  most real clock-wins, never a rare exception. A whole CLASS stays out of scope on purpose, rather than one
  named instance of it: anywhere a clock is read and a wait is armed off that reading with no `await` between
  the two — inside `waitChunked`'s own chunk loop, and in the outer conversion from the absolute deadline to
  the first relative duration handed to it — only a suspend landing inside that exact, uninterrupted
  synchronous statement sequence could stale it, which is indistinguishable from the machine being frozen
  mid-instruction generally; no code fix closes that without an OS-level guarantee this program does not
  have. The realistic version this class was meant to exclude — a suspend spanning an ALREADY-ARMED chunk,
  the actual laptop-closed scenario — is IMPROVED, not fully closed, and the honest reason is a deep,
  platform-level tension rather than an oversight: `waitChunked` recomputes its remaining time on every chunk
  boundary against `performance.now()`, a MONOTONIC clock chosen deliberately so a backward wall-clock
  adjustment (an NTP correction, a manual date change) cannot extend the wait instead of shortening it. On
  Linux that clock is `CLOCK_MONOTONIC`, which explicitly EXCLUDES time spent suspended — the same clock
  `setTimeout` itself is built on, so this is not unique to this file. The fix genuinely closes the WORSE bug
  it targeted (nominal-arithmetic decrementing that would have AMPLIFIED an overshoot across chunks); what it
  does not do is wake up the instant a wall-clock deadline has already passed during a suspend — no portable
  Node clock satisfies both "immune to backward wall-clock jumps" and "suspend-aware" at once, and neither
  does the raw timer primitive underneath it. That residual is folded into the same OS-suspend disclosure
  above rather than claimed solved. A third bound closes what remained: once the clock wins, the work arm
  gets `WORK_ARM_GRACE_MS` (30s) to unwind, covering even a per-frame side effect with no abort seam of its
  own — the responder whitelist's fixed gate line, say — that would otherwise block `consumeMentions`'s
  sequential frame loop from ever noticing the clock had already won; and a rejection anywhere in that chain
  (the work arm itself, or the socket's own `cancel()`, whose interface permits rejection even though the one
  real implementation never does) is caught and narrated rather than left as an unhandled promise Node's
  default policy can terminate the process over. What stays out of scope, stated at the PRINCIPLE rather than
  naming another instance: any single synchronous statement sequence with no `await` in it — an OS suspend
  landing inside one, same as above, but also a genuine application bug (a busy-loop, a synchronous handler
  that never yields) — starves the whole event loop, so no timer or `AbortSignal` anywhere in this design can
  fire until it ends. That is not a gap this feature can close; it is what "single-threaded" means, and
  defending against it needs an external supervisor (a process watchdog), not more async code here.

  Two more, both disclosed rather than closed with more code, because both are properties of relative-timer
  waits in general — not something specific to this feature, and not something the near-immediate deadline
  scheduled recovery actually arms (well under a second, never the multi-day span where `waitChunked`'s
  chunking even activates) meaningfully risks. First: if Slack's fatal `link_disabled` disconnect and the clock winning land
  in the same tight window — the frame observed but the socket not yet closed when the deadline fires —
  `stepAfterDrain`'s abort check can report `clock-wake` before the fatal reason is inspected. That DELAYS
  the escalation by one loop iteration (the next `listen --deadline-ms` call hits the same disabled link and
  reports it as the independent fatal exit it now correctly is), not loses it. Second: the absolute deadline
  is converted to a relative duration once, then waited out against a MONOTONIC clock (deliberately, per the
  backward-adjustment fix above) — so a FORWARD wall-clock correction mid-wait (an NTP sync, a manual date
  change) does not shorten the wait to match the corrected time, exactly as a plain `setTimeout` called at
  the original instant would not either. Continuously re-deriving the relative duration from a live wall
  clock throughout an already-armed wait is a materially different, larger design than reading it once.

- A live `--follow` line was discarded because it was checked for a `kind` field — the main stream never
  wraps a line or races a clock; that shape belongs only to `listen recover --scheduled`.
- A refusal closed or cancelled a `--deadline-ms` connection, or WON the race, or caused it to be reported as
  satisfied when it should not have been. The one narrow, accepted exception, stated rather than silently
  possible: frames on one connection are handled strictly sequentially, so a refusal whose own
  `refuseResponder` call never settles can still block a LATER, genuinely eligible address buffered right
  behind it on the SAME connection from ever being admitted — and if the clock then wins and the grace period
  elapses, that buffered frame is discarded with the rest. This is the same "what a per-frame handler does is
  unbounded" characteristic already accepted for an admitted handler, extended to a refusal that never
  yields; closing it fully would mean giving `refuseResponder`'s own call an abort seam, which is real
  follow-up work, not yet done.
- A compound owner instruction was answered as ONE turn instead of two — the whitelist add folded into the
  same reply, or the referenced person's question skipped entirely.
- A compound instruction's reply was attributed to the OWNER instead of the referenced person — check
  `askedBy` on the actual `turn brief`/`turn answer` calls, not just that something was sent.
- The referenced person's answer was refused as stale because `--accounted-for-ts` was omitted or named the
  wrong message — the owner's own later instruction tripping the freshness check it should have been
  excluded from. The same refusal with the flag apparently set means it named ONE ts where several were
  owed: it takes a comma-separated list, and the acknowledgement step usually has more than one later human
  message to account for.
