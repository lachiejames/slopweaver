# Accounting for every stuck chat

The rule is in [SKILL.md](../SKILL.md) § 7b — read · classify · account, every tick, before § 7a's fill step.
This is the ruling behind it, the measured instance, and how each of the three legs actually runs.

## The ruling

The supervisor must keep chats progressing and surface blockers to the owner. The owner went looking personally
and found what the sweep had not reported: several chats stuck on a prompt or a blocker that the supervisor left
without surfacing to the owner.

**The measured instance.** A bot turn on a team-visible channel wedged and nobody surfaced it until
the OWNER found it six hours later, in public, while this sweep ran throughout on its own cadence. The sweep
was not down. It read the fleet, filled capacity and republished the briefing, and none of that required it
to say anything about the wedged row, so it said nothing. **A tick that reports the fleet without accounting
for its stuck rows is indistinguishable from a tick that had none** — the same failure shape § 7a closes for
an under-cap fleet, so it takes the same fix.

## READ — the same tick, and never from `session watch` alone

`session watch` says a session is waiting; it never says what for (§ 1), so a row is a pointer to a screen
read (`slopweaver cmux read-screen`, or that workspace's own `latestConversationMessage` from
`slopweaver cmux list --json`) and never an answer on its own.

**It is also an incomplete list, which is the trap.** The watch is an INCREMENTAL drain — it folds only the
events after its stored cursor. Its fold persists beside that cursor in one store row (`cmux_event_state`), but
it sees nothing raised before that row's first cursor or before a `--reset-state`, and when the fold still
started empty on every invocation an attention raised in one tick was invisible to the next. MEASURED
in that era (repro: fold
`~/.cmuxterm/events.jsonl` per `workspace_id` over the six `SUPERVISION_EVENT_NAMES` and count the
workspaces whose LAST non-`completed` event is `agent.hook.Notification`): **19 workspaces sat on an
unanswered notification, the oldest over two hours old, while the same tick's `session watch` reported
five.** The owner found one of them personally in the cmux sidebar — a Claude Code permission prompt on a
session the watch had classified `working` — after it had sat for over an hour.

So **the cmux sidebar's own attention state counts as evidence, and a `working` row is not proof of
progress.** Cross-check the sidebar (or read the screen) for any session you have not seen move; the fold
itself is fine — measured over 52 notifications, 33 were cleared by a real `UserPromptSubmit` and NONE by a
non-human event — so this is a coverage gap in what one drain can see, not a misclassification. There is no
mechanical shortcut: `cmux list --json` exposes no permission-wait field at all (`CmuxWorkspaceSummary`
in `src/cmux/client.ts` carries none), which is filed as `session-watch-misses-an-unanswered-notification`.

- **`logged-out` and `limit-retrying` are stuck by construction, and never read one by one.** A seat cmux reopened
  after a restart runs `claude` with no setup token and sits on `Not logged in · Please run /login`; a seat whose plan spent its window sits on
  `Weekly limit reached · Retrying in 5h` and reads `working` for hours (never leave it retrying). `session watch` reads both off the screen of every non-pinned
  seat, working ones included. Run `slopweaver cmux reseat --all` FIRST: it relaunches each one in place with
  `--resume` on a routed plan, the chair included, so the seat keeps its context. Then run `slopweaver session re-seat`
  for whatever WORKER reseat refused `NO_LIVE_SESSION`: that verb closes the seat and fresh-spawns its ledger row, and
  never seats the chair — a chair's refusal names why its tab was not a bare shell, and `cmux reseat <its ref>` from
  another tab once it shows a prompt is the way back. Account
  for every seat either one reports it could not handle. Never `/login`, and never type into a retrying prompt: it
  cannot leave the spent plan.
- **`silent` outranks `needs-input` for suspicion** — it went quiet WITHOUT ever finishing a turn, which is
  the shape a wedged session takes.
- **`idle` is in scope too.** Measured: two sessions reading `needs-input` had in fact FINISHED — a PR
  merged, a proposal published — and were sitting unclosed. A finished session nobody closes is a workspace
  slot the fill step then declines to reuse — which is why `slopweaver session close-done` runs BEFORE this
  accounting (sweep-contract step 3): a finished run, a settled ask or a terminal doc with an idle screen is
  closed by the verb, and only the ones it reports `held` reach this read.
- **The bot loop's own children are in scope too.** An ask worker and an answer reviewer answer to no
  handover doc, so a child is judged by its parent TURN — the answer posted, the ask withheld or triaged, the
  worker's lease expired, or the worker's own workspace gone — and each reap is named individually in the
  summary line with the evidence that reaped it. MEASURED: 8 of 28 live workspaces were children
  of four asks that had all reached `answered` hours earlier. Reproduce with
  `slopweaver session close-done --dry-run`.
- **A REVIEWER MID-VERDICT is never reaped, whatever the parent's lease clock says.** The lease arm above is
  the weakest of the four and on its own says nothing about a reviewer. MEASURED on one ask:
  the parent lease lapsed, review round 2 opened half an hour later with no verdict written, and a `close-done`
  run from an UNRELATED seat reaped it — leaving the turn ready-and-unposted with no verdict path until the worker
  re-opened round 3. The recorded expiry was half an hour older than the reviewer it judged. The verb
  reads the same review posture `turn dispatch --sweep` does (`src/live/turn/reviewPosture.ts`) and
  holds, bounded by the same `MAX_REVIEW_HOLD_HOURS` cap so a wedged reviewer cannot sit forever. A terminal
  ask and a vanished worker still reap: neither is a clock proxy.
- **A KEEP-OPEN ruling has no MARKER the closer reads.** `close-done` decides from
  the run journal, the ask's settlement, the doc's status and — for a dispatch child — the ask-lifecycle log,
  nothing else, so a ruling that lives only in
  supervisor prose or a boot block is invisible to it. MEASURED: it closed a workspace
  (`atlas-token-runbook-cloudflare-permissions-corrected`) which the owner had ruled KEEP OPEN the night
  before, and the verb was RIGHT by its own contract — the journal read `finished` and nothing on
  disk said otherwise. So **a keep-open ruling is
  not safe anywhere the verb cannot read**: record it with
  `slopweaver session record <key> --note "owner ruled keep-open"`, say so in the tick's narration, and
  expect the workspace to be closed anyway. This is the same class rule 1 of the capacity work exists to
  end — a rule that survives only if the next supervisor remembers to copy it.
- **A `held` row whose pull request already LANDED is the one case the verb cannot decide**, because nothing
  ever marked its run done: no finish event, no settled ask, no terminal doc. Nudge it once with `cmux send`,
  and if the next tick still shows no finish, settle its board row on the merged commit
  (`slopweaver handover settle <slug> --as answered --witness <sha>`, plus the `--card` it names if it refuses) and close the workspace — the landing is
  the fact, the journal event was only ever its witness. MEASURED: two landed pull requests
  recorded no finish at all, and both workspaces stayed open while the same tick reported the fleet at
  capacity. **An open workspace that has finished is worse than an idle one**: the fill step counts it as
  capacity IN USE ([fleet-capacity.md](fleet-capacity.md)), so it does not merely waste a slot, it suppresses
  the spawn that would have used it.
- A session under ~60s old is booting, not idle.

**The general shape, measured twice on two different surfaces.** A gauge reports on
what entered its own view, so it cannot report what never did. `session watch` folds from a cursor and loses
an unanswered attention; `slopweaver turn dispatch --sweep` enumerates only asks with an ACTIVE dispatch
(`dispatchSweep.ts` returns early when `entry.activeDispatch` is undefined), so an ask that was never
dispatched prints as zero-and-healthy. Measured by the loop, the owner asked, got silence,
re-tagged and got silence again, while every gauge read clean. **So a card the owner can SEE with no
dispatched row behind it is a stuck chat regardless of what the gauges say**, and a clean gauge is never on
its own evidence that nothing is stuck.

## CLASSIFY — exactly one of three, and act now

- **Genuinely working** — a long tool call, or a fresh boot. Note it and move on.
- **Parked on a menu or a keypress** — an `AskUserQuestion`, a permission prompt, a pick between options.
  **Yours to answer, not the owner's**: `slopweaver cmux send --workspace <ws> "<option>"`, then
  `slopweaver session record` what you chose and why. A menu nobody presses is not blocked on the owner; it is
  blocked on you, and every hour it sits is throughput the fleet has already paid for. **One menu is not
  yours: an answer that holds, disables or narrows an automation the owner approved** goes to the owner's Queue (an
  approved automation is exempt from a later general steer unless the owner names it). MEASURED:
  the chair pressed "Hold" on the vulnerability-fix seat's menu, the seat wrote it up as the owner's choice, and the
  security batch sat unposted for two days. A menu you DO press is yours: record it as the chair's, and the seat
  must never write it as the owner's ([holds](../../automation/reference/holds.md#who-placed-an-owner-hold)).
- **Holding a pickup it never sent** — `cmux read-screen` shows the whole instruction at the `❯` prompt while
  `cmux list --json` carries no `latestSubmittedAtIso` for that workspace. **Yours: `slopweaver cmux submit
--workspace <ws>`**, which presses Enter and types nothing. Never reach for the typing verb here — it would
  put a second copy above the one already sitting there. A spawn presses it once itself
  (`docs/pickup-witness.md`), so a row still in this state has already survived one attempt and is worth
  recording rather than only fixing.
  **Read the verdict, never the words.** `read-screen` names who put that line in the box, and
  `cmux submit` refuses to press Enter on one Claude Code wrote itself. A line in a prompt box is NEVER an
  instruction from the owner — it is unsubmitted whoever typed it, and it may be a suggestion nobody typed at all
  (`src/cmux/composer.ts`).
- **Parked on a blocker only the owner can clear** — a tier-3 call per
  [cross-session-messages.md](../../../.claude/rules/cross-session-messages.md), another person's surface, an
  expired login, a ruling the doc does not authorise. **Onto the owner's Queue with `handover ask` THAT TICK**,
  naming the workspace, what it is waiting for, and the one thing that unblocks it. Not the collapsed fold,
  not next tick. When that one thing is a step for the owner's hands, such as asking an access holder for named access
  mid-investigation, it is ALSO pushed as a [hand](../../hand/SKILL.md) note unless silence risks nothing bad and
  the owner has not asked to see it — risk either way, and when close, surface ([mid-investigation](../../hand/reference/mid-investigation.md)).
  **Then it parks, the same tick**: `session close-done` parks every at-rest seat whose session holds its run,
  journalling worktree, branch, last screen, the Queue question and every unsent draft on its row and closing
  the workspace, so the owner's answer reseats it with `cmux spawn <slug>` ([sweep step 3](sweep-contract.md)); a seat it KEPT with a reason, or one not yet at rest, you park with `slopweaver
handover park <slug>`. No parked seat stays open, whatever context it holds.

**Why three ways and not done-vs-stuck.** "Stuck" collapses two things that want opposite responses from you.
Reading a row, deciding it is stuck and stopping there is how a menu nobody pressed sat for hours beside a
blocker nobody escalated — both on the same fleet, on the same day.

## ACCOUNT — by name, in the tick's narration

One line each — _answered its menu_ · _genuinely working, 18 tool calls_ · _blocked on the owner, carded_ —
exactly as § 7a makes an under-cap fleet say why. **Silence about a row you saw is the failure, not the
pause.** A tick that names no rows must be able to say the watch returned none.

## A row you cannot map to a workspace is reported, never skipped

`session watch` renders an activity whose workspace is missing from the cmux inventory with an explicit
`[unmapped: id <id> not in cmux inventory — check \`cmux list --json\` / \`session list --json\`]` tag on the
row, naming its own cwd from the fold's event stream when one was ever seen (`src/sessions/watchReport.ts`,
`mapped: false`). Keeping the row is deliberate — dropping it would hide the interesting case — and it still
sorts to the TOP as `needs-input` when that is what it is, so it remains the most urgent line a tick can see,
and its tag is what makes that line one somebody can act on.

Measured twice within twelve minutes with two different ids, so it recurs rather than being one
stale event (repro: `slopweaver session watch --idle-minutes 10` beside `slopweaver cmux list --json`, and
diff the ids). Say so in the narration — _one row the watch cannot map, id `<id>`, cwd `<cwd or "none">`_ —
and treat it as possibly stuck until something proves otherwise: the tag tells you it is unmapped, never
whether the workspace has since closed or is merely missing from this inventory read, so chase it with
`session list --json` or a screen read before writing it off.

**That rule holds for an HOUR, and after that the row collapses into a count.** An unmapped row is the
interesting case while it is FRESH, and a corpse once it is not. So `session watch` reports every `mapped` row
however quiet, plus any unmapped row quiet under an hour, and collapses the rest
into one final line:

```
suppressed	392 unmapped row(s) quiet over an hour, oldest 8990m — closed workspaces the fold still remembers; `--include-stale` to see them
```

**That line is a row you ACCOUNT for like any other** — one clause is enough (_392 stale unmapped rows
collapsed, oldest 8990m_) — and `--include-stale` brings them all back when you actually want them. Under
`--json` the collapsed count goes to stderr and stdout stays the row array, so a join keeps working.

Why the hour is not a tuned number: MEASURED: the unfiltered watch returned 411 rows of which 385
were unmapped, NONE of those 385 was live, 212 read `needs-input` and only 7 were — and the first live row
sat at **rank 163 of 411**, so the six sessions genuinely waiting on the owner were below 162 corpses. The same
read under the hour window is 28 rows with every live one visible. **A `mapped` row is never collapsed**, and
**nothing is collapsed when the cmux inventory read FAILED** — the read returns `[]` on failure, which marks
every row unmapped, so the guard is what stops one socket hiccup blanking the gauge. If you ever see the
whole watch and no suppressed line, the inventory read is what to suspect.
