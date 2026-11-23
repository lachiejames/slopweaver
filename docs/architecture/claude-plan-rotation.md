# Claude plan rotation

Part of [Architecture](../architecture.md).

`src/claude/` decides which of the owner's Claude Max plans the fleet should be running on, so a session
limit on one plan does not stall every session until the owner switches accounts by hand. Measured, that
cost 6.2 hours of fleet stall in a single day across three separate walls.

Everything in this directory is **pure**: it parses, classifies and decides, and performs no credential
operation of any kind. That split is deliberate — a credential swap is the one part of this feature that
touches the owner's accounts, so the decision half is testable without going near one.

- **NOTHING copies a credential between keychain slots.** Which plan a session spends is chosen PER SPAWN
  by selecting a store, never by moving bytes — `src/claude/spawnStore.ts`. Two measurements are why a copy
  is never the route. **Refresh-token rotation is real on this provider** — fingerprinting one store's
  credential either side of its own scheduled refresh showed the access token replaced AND
  the refresh token replaced with it, while `refreshTokenExpiresAt` did not move — so two slots holding one
  credential is revoked the moment either refreshes, the one revocation mechanism here with evidence behind
  it. And **no session runs on the default slot**: measured, its access token had expired four days
  earlier, while all four configured stores were live and the whole fleet
  ran on them, because every session boots against a named store. The watch loop reads that slot only to
  classify it (`readActiveSlot`, `src/cli/commands/claude/watch.ts`), never to spend it. `claude rotate --commit` renders a
  registered refusal naming the store override, and the watch loop reports a recommendation and performs
  nothing.
- **The pre-spawn gate REPAIRS an expired store and fails closed on evidence.** A plan the provider answers
  `401` to is a cache miss, not a signed-out plan: every store's credential carries a refresh grant weeks out
  (27 to 29 days on all four, measured) beside its eight-hour access token, and nothing in this
  repository had ever read that field. The gate probes, repairs each store the provider REFUSED whose token
  has expired and whose grant is alive by running the CLI's own OAuth refresh under it, and re-probes. A refusal
  on a token with hours left is a superseded or revoked login that no refresh repairs, so its line names
  `slopweaver claude signin --plan <plan>`, and the gate files each plan's effective probe in the
  `claude-plan-probes` row the sign-in note floats from. An offline machine attempts nothing, because a probe that never got an answer is the network rather than a
  refusal. Three refusals carry three different permissions: a SPENT plan
  (`SLOPWEAVER_ALLOW_SPENT_PLAN`), NO readable gauge (`SLOPWEAVER_ALLOW_UNREADABLE_PLAN`, which then boots on the
  first configured plan and says that is configured order rather than a measurement), and a plans register that
  is present and does not read — unreadable, invalid, or its store unreachable — which NOTHING releases, pinned
  spawn or not, hatch or `--force`: the usage limit the owner set on every plan went unread with it, and going over a
  limit the owner set is the outcome that matters most to avoid. The `claude-plan-unusable` monitor
  floats that fault as one note the pass it is seen. Only a genuinely ABSENT register still falls through, and
  none of the three fires when an API key outranks the stores.
- **The survival historical trend holds every plan to the same usage limit.** `claude forecast` carries
  each row's limit into every plan state (`src/claude/survivalPlanState.ts`,
  `survivalForecast.ts`), and `survivalSimulate.ts` spends a plan only to its EFFECTIVE ceiling —
  `claudeEffectiveUsageCeiling`, the same function routing reads, in both the simulator's room arithmetic and the
  synthetic gauge the headroom router ranks. A 100% plan still lifts to the spend-out bar in its final hours; a
  limited one never passes its limit, so the trend can show the fleet dry with nominal allowance left: a limit
  the owner sets is respected even when it takes the fleet down. Every output is labelled a historical trend, never a fact.
- **An API key in the environment still outranks every store, and the gauge still says so.** `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN` and `apiKeyHelper` all resolve ahead of the saved claude.ai login a store holds
  (measured against v2.1.261), so under one of them a session presents an API key whatever store it was booted
  against — and an API key bills a Console organisation per token rather than spending a plan, so selecting a
  store changes nothing at all. `claude gauge` reports the condition, so three healthy plan readings are not
  mistaken for three healthy plans of fleet runway. Why API keys are not a second set of plans at all, and
  what the gauge and the trigger both go blind to under one: [api-key-lane.md](../api-key-lane.md).
- **A SIGNED-OUT store is reported differently from an expired one.** `claude doctor` under a store whose
  refresh token has been superseded writes back an empty credential rather than leaving the old one, so the
  life line read `EXPIRED at 1970-01-01 — the next touch is what repairs it`, false in both halves. No touch
  repairs a store with nothing to refresh from; only a browser sign-in does, and the line says so.
- **`slopweaver claude rotate` reports, and `--commit` is a registered refusal.** It names the plan on the
  owner's word and writes nothing in either case. `--discard-unreturnable` is REJECTED rather than ignored:
  silently accepting it would tell a caller their accepted risk had been applied to an act nothing performs.
- **`slopweaver claude gauge` is the read-only surface.** It takes each
  store's token out of the keychain, spends one output token on a Fable model (which is what attaches the Fable
  week), reads the budget from the response headers and the probe's own cost from the body's `usage` counters
  (`probeCost`, under the hundred-token ceiling the cap exemption rides on) — no code path it reaches can write a
  credential. Its declared effect
  is `external-read` rather than `local-state`, because it genuinely reaches the provider and hiding that
  would put a network call outside the inventory built to find exactly that.
- **The gauge is a header read, not an endpoint poll.** An Anthropic API response carries
  `anthropic-ratelimit-unified-{7d,7d_oi,5h}-{status,utilization,reset}`; `utilization` is a fraction and
  `reset` is an absolute epoch second. The **week is the primary window** and always present; `7d_oi` is the
  Fable week. **No plan has a five-hour window**: measured on every signed-in plan, no `5h` trio came back at
  all, so `usage.ts` reads the five-hour trio only when it is there, all three fields or none — an absent trio is
  the plan's shape, a partial one is still `USAGE_SHAPE_CHANGED`. Every surface draws a five-hour window only when
  a plan carries one — the gauge table drops its column, the `PLAN` and routing lines drop the clause, the Fleet
  page drops the bar — never an empty bar or an unread plan. `GET /api/oauth/usage` returns a tidier body and is **not** used: measured,
  it answered `429` with `retry-after: 3568` on a first call, because its budget is shared with
  every Claude Code session on the machine already calling it for `/usage`. Two verbs read it, each once per run
  over a profile-scoped sign-in a probe binds to the plan: `slopweaver claude reset` for the free-reset block
  (`src/claude/resetStatus.ts`), and `slopweaver claude spend` for the `extra_usage` spend block, recorded in the
  readings ledger as an hour's evidence (`src/claude/spendStatus.ts`). Both share one key list
  (`src/claude/usageWire.ts`); a throttle defers either verb (exit 4) and never touches rotation.
- **It fails closed**, deliberately the opposite of `src/codex/quotaGate.ts`. That gate reads absent evidence
  as healthy because it gates an opportunistic spawn; this one decides which plan the fleet boots against, so
  an unrecognised shape becomes a typed `USAGE_SHAPE_CHANGED` that stops the machine.
- **Four refusals look like a plan limit and are not**: a `529` overloaded (which outnumbered real weekly
  limits four to one on this machine), an individual spend limit, and the two model-scoped weekly claims.
  Only `five_hour` and `seven_day` may rotate a plan; a model-scoped claim moves the model instead. The Ultra
  plan's `seven_day_overage_included` claim is recognised and gates nothing, and a claim label the gauge does
  not know is dropped rather than refused: it decides nothing, and refusing the whole gauge on it would blind
  routing exactly as the missing five-hour trio did.
- **N plans, never three — and one is a fleet.** Owner rulings: adding a fourth must be trivial,
  and one plan runs the whole of Slopweaver, and a chair handing off on one plan lands back on it. So
  nothing counts accounts. One row is not a bypass: its single gauge is ranked and routed like any other, and
  when the owner's pause or a usage limit leaves no eligible plan, a spawn refuses (`paused`, `usage-limit`;
  `src/claude/spawnStoreRefusals.ts`) rather than falling through to an ambient credential. Selection prefers
  the plan whose **weekly window resets soonest** — capacity about to be refilled is capacity that will
  otherwise be lost — then the lowest five-hour utilization, a plan with no
  five-hour window ranking ahead of any plan that has one (`fiveHourRankKey`, `src/claude/contracts.ts`).
  A missing five-hour window never excludes a plan and never refuses rotation while its week is read.
- **The chair's own plan is in the reading, and is said before it walls.** `claude gauge` and the supervisor
  briefing's react-now lines carry `chairBudgetLines` (`src/claude/chairBudgetAlert.ts`): when the plan the
  pinned chair spends has a window the provider grades past `allowed`, or at the routing bar (the cap away from
  a reset, 95% by default — never the lifted spend-out bar, so it speaks before the wall even in a week's last
  hours; both are the register's `thresholds`, `skills/plans/reference/thresholds.md`), one `CHAIR —`
  line names the window, its reset and the Fable plan to hand the chair to — or says no other plan can take
  it. On a weekly window the owner's usage limit binds, the routing bar is a SHARE of that limit — 95% of the way
  to it, 47.5% on a 50% plan (`src/claude/budgetAlertPoint.ts`) — and the line names the limit, since routing stops
  at the limit itself. The owned plans are the ceiling; the line never proposes buying more. A chair still seated
  on a PAUSED plan has that plan probed beside a fleet-wide sweep — a `chair:` line and `--json`'s `chairReading`,
  carrying that plan's own `allowance` and `usageLimitPercent` — and it feeds the warning alone, never routing or
  balance. When that probe fails, or the paused account names no usage policy, `--json` carries `chairUnread` (the
  plan and the reason) and a `CHAIR —` line says its wall is UNKNOWN, never silence and never a plan with no limit.
- **Which account is pinned is CONFIGURATION, not a heuristic.** One entry in the accounts file carries
  `pinned: true`, and two carrying it is refused: the react-now surface lives in exactly one gallery, so two
  pinned accounts is incoherent rather than merely odd. The right answer is a fact about the owner's machine
  this code cannot observe — which account the owner's browser is signed into.
- **A rotating seat must not PUBLISH.** That is the constraint the seat mapping creates rather than one it
  solves. A page published from a worker lands in a gallery the owner's browser cannot open, so a session
  that needs to publish to that gallery is pinned. A run's own page is local HTML (`slopweaver page`), which
  no account owns.
- **The supervisor chair ROUTES like every other seat.** Pinned to the publishing account, it was
  MEASURED failing: four successive chairs booted on that one plan and walled its Fable week at 100%
  with its plan-wide week at 57% and four other plans free. So a chair
  handoff or reseat routes as a Fable spawn, and `chairCadence.ts` hands off a chair whose plan is unread
  while a measured plan is the route.
- **The publishing seat is PINNED to one account.** MEASURED
  by rotating and watching it break: artifacts are per-account. After the fleet swapped plans, an
  artifact published under the previous account read `artifact not found` and the gallery returned a
  different set entirely. The owner's react-now surface lives in ONE account's gallery and the owner's browser is
  signed into it, so a single shared credential slot means any rotation orphans the surface the owner reads.
  The owner's ruling: pin the publishing seat to one account. A pinned seat carries a `CLAUDE_SECURESTORAGE_CONFIG_DIR=`
  prefix on its boot line (`seatPinning.ts`), which is empty for a worker, so an unpinned boot line differs
  from the one this repo has always sent only by a fleet-worktree seat's `NX_DAEMON=false `
  (`cmux/fleetEnv.ts`: a detached nx daemon outlives its seat, and `cmux close` and
  `session close-done` reap one). A second, independent reason the seat may not drift:
  a link-shared page pins one VERSION and refuses to switch to Latest while it is externally shareable, so
  only the pinned account can pull an old version and publish a new one.
- **A model-scoped wall is REPORTED with its claim, never swallowed.** MEASURED as a defect:
  the classifier first marked a model wall `ignored` and dropped the claim, and `ClaudeLimitSignal.claim`
  was narrowed to the plan-wide pair, so the supervisor-chair rule was UNREACHABLE — a Fable wall reached
  the trigger as "hold" and the chair would have sat on a spent budget. Both modules were individually
  correct and fully tested; every unit test built its own signal by hand, so nothing exercised the seam. The
  compiler caught it when they were first wired together, and one existing test had confidently encoded the
  broken behaviour as the contract. The classifier reports the claim and the seat decides the response,
  with tests that drive real classifier output into the trigger rather than a constructed signal.
- **A per-model wall answers differently for the supervisor chair than for a worker, and that is a stated
  rule.** A model-scoped weekly cap normally means "use a different model" — the plan is healthy, one model
  on it is spent, and rotating would spend a second plan to solve what a `--model` change solves free. That
  holds for almost every session, since the model-tiering ruling puts almost all of them on Opus or Sonnet.
  The chair is the exception: it is the one seat that runs Fable, the owner's ruling keeps it on Fable,
  and it is the seat whose failure stops everything else. So for the chair a
  per-model wall ROTATES THE PLAN. `claimResponse.ts` holds this in one named place with tests that fail if
  the two seats ever collapse to one answer.
- **A per-model budget cannot be seen in advance, only after it bites.** Measured against a live
  plan, the response headers carry plan-wide utilisation and NO per-model figure for Opus or Sonnet; `representative-claim`
  names the binding claim without quantifying it (absent is fine; a label outside the known set refuses the gauge,
  since it names a window no trio reads). So the gauge is blind to a Fable or Opus budget until a
  wall is hit, and any design that claims to pre-empt one is claiming a number this code cannot read.
- **Keep-alive touches every store at a THIRD of the token lifetime, not at its edge.** A machine asleep,
  a closed lid or an overrun session can swallow one cycle, and a schedule with no slack turns a single
  missed tick into a dead plan; at a third, two consecutive misses are still survivable. A store never
  touched is always due, because there is no evidence it is alive and a needless refresh costs one API call
  while skipping a dead one costs an outage. A test replays the real timings of the two stores that died —
  touched five minutes apart, both `401` under nine hours later — and confirms the schedule would have caught both.
- **An idle credential store DIES ON ITS OWN within 8 hours, which sits underneath rotation rather than
  inside it.** Measured: two of three stores went `401 access token has expired` from nothing
  but the ordinary TTL, because nothing ran under them to refresh. A perfect trigger still lands on a dead
  store, so every configured store must be touched on a schedule. The primitive is not the obvious one:
  `claude auth status` does NOT refresh — it reads the credential without an API call and the keychain
  item's modification date does not move. The touch runs `claude --safe-mode mcp list` from inside the store's
  directory (`src/claude/storeRefresh.ts`), which starts no model, and only once the token is inside the CLI's
  own five-minute refresh window, because a refresh any earlier writes nothing; it counts only an expiry that
  moved forward (`src/claude/keepAliveTouch.ts`). Repairing an
  EXPIRED store needs no browser, because the refresh token lasts about four weeks; only a REVOKED token
  needs the owner's hand, and the only revocation ever observed was two slots holding one credential.
- **A moved modification date is NOT proof the touch repaired anything, and the exit code is not either.**
  MEASURED: `plan-two` and `plan-three` had been idle 39 and 42 hours and both answered
  `401 OAuth access token has been revoked`. `claude doctor` under each exited **0** and moved both keychain
  items' modification dates forward by more than a day, and neither store came back: the next probe answered `401 Invalid bearer token`, and
  what the touch had actually written was an EMPTIED credential, access token the empty string and
  `expiresAt` zero. The mdat move is what the original finding used as its witness, and it is the wrong one.
  The only falsifiable witness is the probe answering `200`, which is why the loop reads each store's
  remaining life AFTER the touches rather than reporting that a command ran.
- **A REFUSED credential is a different report from an unreadable one, and conflating them hid a two-day
  outage in plain sight.** A `401` carries no `anthropic-ratelimit-*` headers at all, so a header-only parser
  reports the first field it could not find. MEASURED: `slopweaver claude gauge` said of both dead
  plans `the rate-limit gauge is missing or unparseable at anthropic-ratelimit-unified-5h-status — ... run
slopweaver claude gauge once the shape is confirmed`: true in every word, and it sent the reader to
  re-check a header contract when what the owner needed was to sign in twice. `usage.ts`'s `readGaugeResponse`
  judges the STATUS before the headers and answers `CREDENTIAL_REJECTED` for a `401`/`403`, leaving `429` and
  `5xx` on the fail-closed shape path so a provider fault never sends the owner to sign in. A store whose
  credential has been EMPTIED is refused before the request is made at all, by the same predicate the watch
  report uses, so the two surfaces cannot disagree about whether a plan is signed in.
- **`slopweaver claude watch` is the foreground loop, and it RECOMMENDS.** It reads every gauge, runs the
  keep-alive touch on the stores that are due one, repairs a store the provider refused on an expired token
  before its probe is recorded, and names the plan the trigger would move the fleet onto,
  holding the plan it recommends leaving out until its crossed window resets so the recommendation is
  stable; it writes no credential (`src/cli/commands/claude/watch.ts`). `--dry-run` reports a tick with no
  effect at all. It is legal under doctrine rule 2 on the same footing as
  `listen --follow` — no model runs, it stays in the foreground of a visible session where it can be
  interrupted mid-tick, and it uses `execFileSync` only, which blocks and therefore cannot outlive its
  parent. It is not a scheduled job and must not become one. **A real run refuses to start beside a running
  watch** (`claude/watchStart.ts`, hatch `claude-watch-admission`), and refuses when the process table cannot
  be read; `--wait` queues instead, re-reading the table every 15s and writing nothing until none is running,
  then runs the loop as a blocking foreground child WITHOUT `--wait`, so "carries `--wait`" means "queued".
  That is a snapshot admission check, NOT a fence: two starts inside one snapshot window, or two `--wait`
  successors released together, can both run — or, each released loop re-checking and seeing the other, both
  refuse and leave none, which reads as absent. `session standing` exposes either on its next sweep and exits
  non-clear, and prevents neither — fenced lifetime ownership is follow-up work, not a property of this.

Continued in [the active plan and its accounts](claude-plan-rotation-active-plan.md).
