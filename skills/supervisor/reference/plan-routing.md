# Which PLAN a spawn spends, and who decides

[model-tiering.md](model-tiering.md) settles which MODEL a spawn runs. This page settles which of the owner's
Max plans pays for it. The two are one decision, because the model a spawn names decides which budget it
draws down.

## The incident behind it

MEASURED from the owner's own three usage screens:

| Plan   | All-models week | Fable week | What the fleet could actually do there |
| ------ | --------------- | ---------- | -------------------------------------- |
| plan A | **100%**        | 53%        | nothing at all                         |
| plan B | 67%             | **100%**   | ordinary work only, no Fable seat      |
| plan C | 4%              | 2%         | anything — and it was untouched        |

Nothing routed. Half of plan A's Fable week was never spent and never could be. The owner and the fleet need to do
better at automatic routing between the plans: the supervisor is expected to manage it, and it did not manage it well.

## The two windows, and the order they gate in

MEASURED by sending one identical one-token request over one credential, changing only `model`:

- A request naming a **Fable** model comes back with an extra `anthropic-ratelimit-unified-7d_oi-*` trio —
  the FABLE-only week. Haiku, Opus and Sonnet requests carry no such headers at all. So a gauge taken with
  any other model is blind to half the picture, so the probe names Fable
  (`src/claude/gaugeProbe.ts`).
- A Fable request against a plan whose PLAN-WIDE week reads `rejected` is itself refused `429`, even with the
  Fable window `allowed` and half that week left. **Fable headroom on a plan-wide-exhausted plan is not
  spendable.** So the plan-wide pair gates first, always; the Fable window is a SECOND gate only Fable spawns
  face, and a ranking key only they use.
- **No plan has a five-hour window** (measured on every signed-in plan: no `5h` trio), so the week is primary and
  the gauge table, `PLAN` line, routing line and sign-in check name one only when a plan carries it. The trio is
  still PARSED: a plan sending one again is judged on it and ranks behind a plan with none, and a partial trio is
  still refused as a changed shape.

Reproduce both: `slopweaver claude gauge --json | jq '.plans[].gauge | {sevenDay, sevenDayFable}'`.

## What is automatic, and what is yours

- **EVERY spawn routes itself — not just `cmux spawn`.** The gate is a REQUIRED member of the spawn
  primitive's own deps and runs inside `bootCmuxWorkspace`, so a handover run, a `turn dispatch` bot worker,
  an answer reviewer and a seated automation all pass through it and a new spawn path cannot
  be written that skips it ([../../../src/claude/spawnStore.ts](../../../src/claude/spawnStore.ts)). It reads
  every configured plan's gauge LIVE — never a cached number, never `claude auth status`, which
  once reported a fresh account on a store whose requests were still going out on a spent token — picks the plan
  furthest below its own LEVEL LINE, in points: a line rising from 0 when its week opens to 95% five hours before
  its reset (100% at the reset inside those five hours), so a plan's reset is weighed and plans stay level against
  their own lines. It is points, never points per hour: ranked per hour, plan-four
  at 78% Fable 22 hours from its reset outranked an empty plan-three for the chair. It prints the choice with the reading it was made from
  (`claude routing: <plan> for a <class> spawn — …`). Whether that routing outlasts the week: [plan-survival.md](plan-survival.md).
- **It REPAIRS an expired store on the way.** A plan the provider answers `401` to is a CACHE MISS, not a signed-out plan:
  every store's credential carries a refresh grant weeks out beside its eight-hour access token (27 to 29 days on all four,
  measured). So the gate reads twice — probe, and for a store the provider actually REFUSED whose token has expired and whose
  grant is alive, run the CLI's own OAuth refresh under it and probe again. It prints what it did per store
  (`claude routing: <plan> repaired on demand — expiry <before> to <after>`), and names the reason when it declined to try —
  one no refresh fixes (`access-not-expired` is a superseded login) names `claude signin --plan`, and every spawn files its
  probes for `claude-plan-unusable`. **An offline machine attempts nothing**: a probe that never got an answer is the network,
  not a refusal, so a day without internet writes no credential and refuses the spawn saying which.
- **It FAILS CLOSED, before a worktree or a workspace exists, with THREE refusals and three different
  permissions.** (1) A successful read saying the account this session would boot on is SPENT —
  override with `SLOPWEAVER_ALLOW_SPENT_PLAN=1 <the same command again>`, or `--force` on `cmux spawn`. (2) NO
  plan's gauge readable at all even after repairs — a different fact, so a different permission:
  `SLOPWEAVER_ALLOW_UNREADABLE_PLAN=1`, which then boots on the FIRST CONFIGURED plan and says plainly that
  this is configured order and not a measurement. `--force` does NOT release this one, because permission to
  spend a plan you can see is spent is not permission to boot blind. (3) A plans register that is PRESENT and
  does not read — unreadable, invalid, or its store unreachable — refuses EVERY spawn, unpinned or a standing
  pin, and NOTHING crosses it: no hatch, no `--force` (a STALE store is read, not crossed: [boots refused](boots-refused.md)). The usage limit the owner set on each plan went unread with it,
  and going over that limit is the one thing that costs the owner's trust, so the gate fails closed and lets the
  owner know early. The `claude-plan-unusable` monitor floats that fault as one note the pass it is seen; the
  repair is `slopweaver plans validate`. Only a genuinely ABSENT register falls through to the ambient
  credential, with no store override on its boot line. **And none of the three fires when an API key outranks the stores** — `ANTHROPIC_API_KEY` and its
  siblings resolve ahead of every store login, so no store decides what the session spends and the gate says so
  and routes nothing. An overridden spawn still PRINTS its refusal, so it is as visible in
  the log as a refused one. Every allowed spawn carries an EXPLICIT store, with exactly two exceptions, each
  the absence of a routing question rather than a fall-through: an install with no register at all, and a session
  under an API key, where no store decides anything. The second prints a line saying so; the absent-register case
  is SILENT by design, because an install without the fleet has no routing question to report on.
- **The chair ROUTES; only the publisher pins.** A `role: supervisor` spawn or reseat carries no store and
  routes as a Fable spawn, exactly like a worker
  ([../../../src/claude/seatPinning.ts](../../../src/claude/seatPinning.ts)). MEASURED: while
  the chair was pinned, four successive chairs booted on plan-five and walled its Fable week at 100% with its
  plan-wide week at 57% and four other plans free.
- **A PINNED seat is never re-routed, but it IS checked.** A publisher seat, or any seat `--plan` named, boots
  against its fixed store, and a seat at its own weekly wall boots into the same retry banner a routed one
  does, so the gate reads the pinned store's gauge and refuses on it, with the same escape hatch. It is
  repaired too. A pinned seat whose OWN gauge is unreadable refuses even when other plans read fine, because those
  readings say nothing about this store — and its hatch returns this exact store, never a different plan's.
- **`--plan <alias>` names a Claude seat's plan** — `cmux spawn <slug> --plan <alias>` on the claude driver, and
  `cmux reseat <workspace> --plan <alias>` for one seat, the chair included. It outranks routing and travels
  as the seat's pinned store, so it is judged on its own live gauge, exactly as above, and never re-routed. A
  paused plan or a Codex alias refuses with exit 2 naming the registered plans ([../../../src/claude/requestedPlan.ts](../../../src/claude/requestedPlan.ts));
  `reseat --all --plan` refuses too, since one plan names one seat. On the codex driver the same flag names a
  Codex destination.
- **The backstop, for the plan that read healthy and hit its wall on the first request.** After the pickup
  command lands, a `claude` surface is watched for a usage-limit RETRY banner
  (`✻ Weekly limit reached · Retrying in 5h …`, [../../../src/claude/limitBanner.ts](../../../src/claude/limitBanner.ts)),
  the exact line two stranded bot workers once rendered. Finding one FAILS the spawn, so a `turn dispatch`
  ask is finalised `dispatch-failed` instead of being recorded as dispatched to a session that will retry for
  five days. `codex` gets the same treatment through its own exhaustion banner. An absent banner is not proof
  of health, only the bound the poll was willing to spend.
- **Every configured plan prints one `PLAN` line, each window with its OWN reset**, or `UNREAD`/`PAUSED`, ending
  `· lapses <iso>` or `· lapse UNRECORDED` from the configured row (Anthropic states no lapse date, so it is never
  read), never routing ([planReadingRender.ts](../../../src/claude/planReadingRender.ts)),
  after the table and in `--json`'s `planLines`. `tick open` lifts every one uncapped.
- **One command tells you what spawns next where.** `slopweaver claude gauge` prints, under a `balance` heading:
  the plans' spread in the all-models week and in the Fable week, graded against the owner's target (`balanced` to 10 points,
  `drifting` to 15, `out-of-band` past it); each plan's LEAN, the gap between its two
  seven-day budgets, NEGATIVE when the Fable week is behind and so is the capacity that strands; and the plan the next
  all-models and next Fable spawn would land on, and the chair's successor (asked with the chair flag its spawn
  carries, plus every plan LEVEL with that route, within one point of headroom), from `routeSpawnToPlan` itself, so
  it never names a plan a spawn would not pick.
  **A spread over fewer than two readable plans reads `UNMEASURABLE`, never `balanced`** — MEASURED on an install with
  one readable plan of three, and a fleet reported balanced on one reading is the one
  lie this feature must not tell; a ONE-plan install reads `NOT APPLICABLE`. `--plan <alias>` narrows to one
  plan and prints no balance block, since a spread over one requested plan would call the fleet unread.
- **`*` is the plan the pinned chair is SPENDING, read off its boot credential**: its descriptor-3 setup token,
  or the store it booted on when it declared none, per live session in the pinned workspace
  ([seatBoot.ts](../../../src/claude/seatBoot.ts)). A `chair:` line under the legend names each session; two tabs
  on two plans, or one unread, mark nothing and say so. `--json` carries it as `chair`. `B` is the pinned plan.
- **Yours: the react-now card.** `slopweaver claude gauge` prints one `claude budget:` fold line every tick, plus a
  `REACT NOW —` line per window at or past **75%** — on a weekly window the owner's usage limit binds, 75% OF THE WAY to it
  (37.5% on a 50% plan, and the line says that arithmetic) — naming which spawns it stops and where to move them,
  before routing stops so moving one is still the owner's choice. **The chair's own plan gets a `CHAIR —` line first**
  ([chairBudgetAlert.ts](../../../src/claude/chairBudgetAlert.ts)), under its `chair:` line and on the briefing's
  react-now lines: once a window on a plan the chair spends is graded past `allowed` or reaches 95% — 95% of the way
  to a binding weekly limit, named on the line — never the lifted 100%, it names that window, its reset and a hand-off.
- **The cap is the routing bar (95%) away from a reset, the spend-out bar (100%) inside one** — `spendCapFor` in
  [../../../src/claude/select.ts](../../../src/claude/select.ts); **the owner's usage limit lowers a weekly cap, holds a
  running seat per prompt, and nothing raises it** ([register and routing](../../plans/reference/register-and-routing.md)),
  one ceiling rotation, refusal and the gauge's `NEAR` all read: `NEAR` is where routing stops
  new work, so a 50% plan's week reads `NEAR` at 50%. A **weekly** window (plan-wide and Fable, each on its OWN reset)
  in its last five hours is spendable to the wall, as what is left strands; the **five-hour** never lifts. A spawn there can hit the wall and wait it out.
- **A Fable spawn never takes that lift on the PLAN-WIDE week, nor the chair's successor on its Fable week** (`--plan` aside); it ranks on the lesser of its two weeks' headroom ([fableSeatBars.ts](../../../src/claude/fableSeatBars.ts)).
  The lift once seated the chair on plan-two at 95%, unseen until the owner's screen. **Fleet down is p0.**
- **Every percent and lead time on this page is a DEFAULT** of the register's Claude `thresholds`, set
  with `plans set-thresholds`, recorded on each verdict: [thresholds](../../plans/reference/thresholds.md).
- **Once every plan's week is past its own card point, the card is ONE line**, "every plan past 75%" (or "of
  the way to its owner-set usage limit"), naming the state, what happens next and the next reset; a plan at its limit
  counts at the wall. The fold line keeps every number. It fires only once EVERY CONFIGURED plan has answered.

## The chair's hand-off cadence

Three rules govern every spend across plans, the chair's included, and the cadence below serves them:

- **The fleet never dies.** No seat, and above all not the chair, hits a usage limit mid-run.
- **Work routes to draw usage down across every plan**, weighing each kind of limit (Fable, the week, five hours),
  when each one resets and how much each plan has left.
- **No plan usage is left on the table.** There is always more work, so a plan is spent close to 100% before it
  resets.

The chair is the one seat that never respawns, so it once sat on plan-five to 100% of its week while others read
10–20% Fable, on an older Claude Code than its seats ran. `tick close` judges the chair (`chairCadence.ts`, at the
register's `alertAtPercent` and `driftingSpreadPercent`), printing **HAND OFF THIS TICK** when any of five holds: its plan's seven-day or Fable window is at 75% or more, unless the
chair successor's route (`nextChair`, never the ordinary Fable route) still picks that plan, the gauge counts that plan LEVEL with the route within one point of headroom (`chairLevelWith`, the tick's own resolution: one chair was told to leave one pass after its spawn when its own draw moved the route by under a point; ranking the SPAWN off such a plan instead nearly doubled the week simulation's Fable spread), or a complete gauge's chair route is a plan already at 75% or more on either week (MEASURED: with every routable plan past the line, chairs each handed off after one or two passes to a plan just as far past it), never at the routing bar (95%, `routeAtPercent`, or the plan's lower usage limit), its all-models week alone deciding when its Fable week went unread; its Fable week is over 15 points
above the chair successor's route, a level plan excepted (the drifting band), off the tick's gauge; its plan has NO complete reading
while a different, measured plan is the chair route, partial gauge included (plan-five once walled unseen); it runs an older Claude Code (its
transcript) than PATH's `claude`; or its process has run 36h AND `origin/main` has since changed `skills/supervisor`, `.claude/rules` or `AGENTS.md` (a chair must not run for days on stale canon;
`chairCanon.ts`). The plan is each session's BOOT credential (descriptor-3 token, else its store) as `claude gauge`'s
`*` reads it — never telemetry's `organization.id`. **A Codex chair is judged on stale canon alone**, from the instant its pin or chain link took the chair, and its plan budget and Codex CLI freshness print UNMEASURED ([codexChairCadence.ts](../../../src/supervisor/codexChairCadence.ts)). **Advice, never a refusal**; an unmeasured half is named; a re-run of a recorded close never re-judges.
**Its LAST line is then the hand-off, IN PLACE of the sweep prompt** (`chairHandOffPrompt.ts`; a chair once re-armed
past plan-one's 97% Fable week into the wall). Its `--driver claude|codex` is the plan register's, read only on a
hand-off (one plan of either provider): [chairSuccessor.ts](../../../src/supervisor/chairSuccessor.ts),
Claude only on a route that PICKS, a Codex or ambient-Claude pick confirmed by the spawn's own live read; no seatable host keeps the sweep prompt under `HAND-OFF TARGET UNAVAILABLE — <why>`. The successor owns the re-arm. A chair SEATED on Codex is not yet judged at all: the five checks read Claude sessions only.
Five staggered plans never wall a window; the chair held on one does (`unit/claude/routingSpreadSimulation.test.ts`). **Context fill is a REMINDER, never a sixth reason** (the owner's ruling, soft only): a chair session at half its `autoCompactWindow` or more prints `chair cadence: REMINDER — … around half full`, and the verdict, close prompt and re-armed sweep stay as they were — hand off at the next natural break ([chairContext.ts](../../../src/supervisor/chairContext.ts)); no `autoCompactWindow`, a settings file changed since the session booted, or one on another filesystem than the session registry, reads UNMEASURED.

## A cap is routed around, never bought out of

Enough plans are bought, and nobody asks for more money. A spent plan is answered by
routing, a capped Codex by `codex plan-fallback` / `review-fallback` until the reset. `hand post` refuses buying a
plan, usage or credits, negated too (`src/hand/purchase.ts`), and any poster but the pinned chair (`seatPost.ts`):
the cap note is the [`codex-fleet-capped`](../../monitor/reference/codex-fleet-capped.md) notice, accounts and resets.

## A plan the fleet may not spend is PAUSED, and is still configured

`slopweaver claude pause <alias> --reason "<why>"` writes that reason and the pause date onto the plan's REGISTER row
in `plans.json` — the same change as `plans pause --provider claude`, never the generated accounts file alone,
which routing does not read (`plans validate` names that divergence `PROJECTION_DIVERGED`) — and
the three places config becomes a probe list — this gate, the fleet-wide `claude gauge` read and the `claude
watch` loop — skip it and print the reason once instead of an unrepairable refusal on every spawn. Asking for
it by name still reads it, and `claude resume <alias>` puts it back. Why it is a row and never a deletion,
what the pause is refused for, and where a plan's store lives:
[plan-rows-and-stores](plan-rows-and-stores.md).

## Every seat boots on a setup token, so a sign-in cannot replace a plan

Every seat boots on a per-plan `claude setup-token`, giving up what an inference-only token cannot do (Claude in Chrome, Remote
Control, claude.ai-hosted MCP connectors, plugin-marketplace sync, Claude Design, claude.ai projects).

When the routed plan's store directory holds a `setup-token`, the seat boots on that token over a file
descriptor against an UNBOUND store of its own, so a `/login` inside any seat mutates nothing routing reads. A
plan hands over its token with `slopweaver claude token --plan <alias>`, which writes it only once it proves the
windows and the enrolled account, and a seat mints one with `slopweaver claude mint --plan <alias>`, which
pre-fills the plan's enrolled address so the owner only enters the code. Mechanism, invariant and residue: [setup-tokens.md](setup-tokens.md).

## When a plan reads "no login"

That step stays the owner's hand: point the owner at `slopweaver claude signin`, and never silently run the fleet on one plan
while others are logged out. What each row's state means, how identity is enrolled and checked, and why one repaired
store does not prove a week without a sign-in: [plan-signin.md](plan-signin.md).
