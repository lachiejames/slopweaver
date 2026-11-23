# The monitors, and why each one is genuinely the owner's

A condition a session would simply fix is not a monitor. Rule 10 draws that line before the verb does, and
the hand register enforces it mechanically: `src/hand/step.ts`'s `fleetActorPhrase` refuses a sentence
naming the fleet as its actor, so a card that files work instead of doing it is rejected at post time.

Declared in `src/monitor/registry.ts`, in the order a pass posts them; read them at run time with `slopweaver monitor list`.

| Monitor                                               | Fires when                                                                                                 | Source                                                                                                    | Clears when                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`automation-held-on-you`](automation-held-on-you.md) | a recipe row stands on the owner's own uncleared hold                                                      | the recipe definitions' `hold`, through `standingHoldOf`                                                  | the owner's hold is cleared, the definition is gone, or the owner answered that hold's card                                                                       |
| [`recipe-stopped`](recipe-stopped.md)                 | a live recipe row went quiet past its own threshold                                                        | the recipe definitions, run stamps and slot ledger                                                        | the row fires again, the owner or the chair holds it, or a seat takes it                                                                                          |
| `recipe-repairing`                                    | a stopped row is taken by a seat's live repair row, or its firing held                                     | the same join, and `live/recipe/repairs.jsonl`                                                            | the row fires again, or the repair row is done or its run closes                                                                                                  |
| `corpus-sync-stopped`                                 | a `resync-corpus-*` row went quiet, steered or not                                                         | the same join, narrowed to the corpus resyncs                                                             | every corpus resync fires again, or the owner disables or holds it                                                                                                |
| `codex-plan-signed-out`                               | a registered Codex plan has nothing usable signed into it                                                  | the plan register, each store's `auth.json` shape, the `codex_sign_in_observation` rows                   | a newer sign-in lands, or the next live read finds it signed in                                                                                                   |
| [`claude-plan-unusable`](claude-plan-unusable.md)     | a probe found a registered Claude plan signed out, missing or failing, or the plans register does not read | the plan register and the store's `claude-plan-probes` row                                                | a probe reads the plan, or the owner pauses it; the owner's Done holds it until a probe re-tests; a register card, the next measured pass that reads the register |
| `secret-absent`                                       | a live settable secret is absent while a row it goes with is stored                                        | `secrets/` file names against `src/secrets/registry.ts`                                                   | the file is stored, its group empties, or the register marks it optional or retired                                                                               |
| `turn-signed-out`                                     | a Slack turn is blocked on a page's sign-in (`--sign-in-url`)                                              | `live/slack/asks.jsonl`, the hand register's `mon-login`                                                  | `turn unblock` lifts it; the owner's Done holds it until a newer turn blocks on that origin                                                                       |
| `resync-signed-out`                                   | a resync's newest attempt stopped at a platform's sign-in page                                             | `live/recipe/resync-state/`, the hand register's `mon-signin`                                             | an attempt gets past it; the owner's Done holds it until a newer attempt is walled again                                                                          |
| [`publication-leak`](publication-leak.md)             | the last `audit publications` run found a class of leak on a published object                              | `evidence/publication-audit/latest.json`, the sanitised report                                            | a complete run no longer finds that class on that object; a partial run settles nothing                                                                           |
| `codex-fleet-capped`                                  | no Codex account can take a pass, one or more at capacity                                                  | the store's `codex_fleet_cap` row, filed by the fleet read                                                | a read finds an account open, or the first reset named passes                                                                                                     |
| `codex-reset-failed`                                  | the newest measured reset claim on a Codex plan failed                                                     | `codex-reset/claims.jsonl`, each claim with the store before and after                                    | the next claim refills it, or the window it was spent on resets                                                                                                   |
| `prs-backed-up`                                       | a row is `blocked-on` a code owner, unqueued, CI not red                                                   | a `github landing --json` document, via `--landing`                                                       | the code-owner requirement clears, or the row moves on                                                                                                            |
| `bot-off-the-air`                                     | the listener heartbeat stopped, or the socket stayed down                                                  | `$SLOPWEAVER_HOME/live/listener/heartbeat.json`                                                           | the next heartbeat reports the socket connected                                                                                                                   |
| `chair-off-fable`                                     | nothing holds the pin, or the pinned chair booted off Fable                                                | the supervisor pin against the session ledger                                                             | a pinned chair's ledger row reports a Fable boot model                                                                                                            |
| `fseventsd-bloated`                                   | fseventsd holds over 2 GiB and no voice call holds a lease                                                 | `ps` and `top` by its binary path, and the call leases                                                    | its footprint falls to 2 GiB or under, or it runs under a new pid                                                                                                 |
| `store-rehearsal-failed`                              | the most recent restore rehearsal failed                                                                   | `backups/store/rehearsal/last.json`                                                                       | the next `slopweaver store rehearse` passes                                                                                                                       |
| `fleet-runs-dry`                                      | every routable Claude and Codex plan is measured spent for the threshold or longer                         | the latest filed `machine capacity` reading's ceilings, against the plan register                         | a read finds a route, the interval falls under the threshold, or the named reset passes                                                                           |
| [`host-week-runs-out`](host-week-runs-out.md)         | one model host's plans together are projected to run out for the threshold or longer before a reset        | the filed `machine capacity` readings (Codex) and the Claude drawdown journal                             | no dry hour is projected at the full trailing rate, or the projected spell's end passes                                                                           |
| `fleet-unhealthy`                                     | 24h of scheduled runs fail past a quarter, two die, or the bot is off                                      | the slot ledger, the repairs register, the listener heartbeat and arm record                              | the day's runs recover under every threshold and the listener is on the air                                                                                       |
| [`console-sync-failed`](console-sync-failed.md)       | a browser-triggered console refresh failed                                                                 | `live/console-sync-failures.jsonl`, and `console-sync-failure-append-failures.jsonl` for a row it refused | the failed run leaves the 24-hour action window                                                                                                                   |
| [`org-health`](org-health.md)                         | an open incident started, reopened or changed severity                                                     | the `org_health_incident` row, written by `org-health read`                                               | the paged incident resolves; a newer start or severity change re-keys the note                                                                                    |
| [`profile-unloaded`](profile-unloaded.md)             | a session touched in the last day last failed to load the owner's profile                                  | `profile/loads.jsonl` and each transcript's profile-hook boot                                             | every such session's newest observation is a load, or it stops running                                                                                            |
| [`steer-at-risk`](steer-at-risk.md)                   | a row the owner explicitly steered is at risk: named, asked, parked, dead                                  | `runs/*.jsonl` carrying an explicit-steer ruling                                                          | the reason clears, the row ships or finishes, or a later ruling replaces the steer                                                                                |
| `meeting-prep-due`                                    | a page tagged to a meeting (`page tag`) is inside its last hour                                            | `page-meetings.jsonl` against the store's published pages                                                 | the meeting starts, or the page is re-tagged to another meeting                                                                                                   |

## `recipe-stopped`, `recipe-repairing` and `corpus-sync-stopped`

A stopped job no seat has and no hold explains is ONE loud card for the whole set, re-judged every tick and held
off once the owner closes it: [recipe-stopped](recipe-stopped.md). A stop a seat is repairing floats a notice naming the seat and never a card: [recipe-repairing](recipe-repairing.md).
A stopped corpus resync has its own loud card whatever a steer says: [corpus-sync-stopped](corpus-sync-stopped.md).
A row stopped on the OWNER's hold is none of these, and gets one card each asking the owner to lift it, keep it or switch it off:
[automation-held-on-you](automation-held-on-you.md), which stays off once the owner answers it until that hold is placed
again. All three stopped cards declare `stopsWork`, so each stands on the owner's Queue under **Stopped automations**,
straight after the owner's priorities, while it is open.

## `codex-plan-signed-out`, `claude-plan-unusable` and `secret-absent`: the owner's paste, one card each

A Codex plan nothing is signed into is carded with `codex login` for that store, while routing's fallback stays
unasked: [codex-plan-signed-out](codex-plan-signed-out.md). A Claude plan a probe finds signed out, missing or
failing floats one note per fault episode, naming the plan by its email: [claude-plan-unusable](claude-plan-unusable.md).
Both fire on every supervisor tick, each straight after the read it judges. A live secret missing beside a stored row it goes with
is carded with its `secrets set` command, file names only: [secret-absent](secret-absent.md).

## `turn-signed-out`, `resync-signed-out` and `fseventsd-bloated`: one card per origin, and the owner's root restart

A Slack turn blocked on a page's sign-in is a top-tier card and note per origin before the answer posts: [turn-signed-out](turn-signed-out.md).
A resync walled at a sign-in page is carded per origin, the pin opening it; any other failure raises none: [resync-signed-out](resync-signed-out.md).
fseventsd past 2 GiB is carded with `sudo killall fseventsd`, held while a call is live: [fseventsd-bloated](fseventsd-bloated.md).

## `store-rehearsal-failed` and `codex-fleet-capped`

A passed rehearsal is `clear` and says nothing; a failed one is one card naming the backup and the first reason.
No record at all is `unmeasurable`, and a rehearsal that stopped running is
`recipe-stopped`'s card, not this one (`src/monitor/storeRehearsal.ts`).
Every Codex account out, one or more for capacity, floats a notice naming each reset — never a purchase and
never a queue card: [codex-fleet-capped](codex-fleet-capped.md).

## `fleet-runs-dry`: a note only when no Claude or Codex plan can start a seat

The owner's ask: a note only when the fleet caps before a reset, never on a schedule. One plan spent is not a
card — its provider's router moves on. Only every configured provider out at once is the owner's decision: both when
both are configured, the one alone when only one is.

- **What it reads.** The newest `machine capacity` reading the supervisor tick filed, bounded at the judged
  instant, its `ceilings` decoded strictly and re-judged (`src/monitor/fleetRunsDryCeilings.ts`), against the
  plan register as it stands. No probe, no provider connection. A snapshot proves the present for both providers
  and forecasts no burn; the projection is [`host-week-runs-out`](host-week-runs-out.md)'s card.
- **Fires** only when the absence of a route is measured capacity: the reading is at most two hours old
  (`FLEET_DRY_MAX_AGE_MS`), the machine is open (the document's own `hold` is `false` and its ceiling open), no provider read failed, the re-judged reading selects no route,
  and every routable plan is refused by its router (at its usage limit, or refusing at zero headroom) with a window
  spent to a positive `available` and a reset still ahead. Only a window an all-models seat spends counts (Claude's `five-hour` and `seven-day`,
  Codex's `five-hour` and `weekly`), so a spent Fable week or an unknown window never does. A window read at its
  whole 100 under a register bar of 100 is not spent either, because a raw 99.995 rounds onto it while that router
  still admits it — so under the default spend-out bar a Claude week with no usage limit never proves dry. A selected route is
  `clear` whatever any other plan says or any read failed, because a seat can start. With no route, a failed
  provider read, a paused or unread plan, a refused plan with no spent window, a plan its router holds `open` (even
  at a headroom rounded to zero), one carrying headroom no route took, or a plan register that moved past the reading (a plan the reading never measured, a usage limit raised, a
  monthly-spend plan moved onto a weekly window, a Claude plan registered on monthly spend, a measured weekly-window plan carrying no window its usage limit
  lowers — Claude's `seven-day`, Codex's `weekly` — or an incoherent ceiling — the machine under another id, a plan's id and kind naming two providers, a window name
  repeated, or one id on two ceilings:
  `src/monitor/fleetRunsDryRegister.ts`) is `unmeasurable`, never
  clear or dry. A Codex monthly-spend plan is passed over, since nothing reads it; a Claude one never is, since a
  router takes it on a fresh spend reading and its spend window names no reset, so it reads unmeasurable. The
  interval ends at the earliest plan's return — a plan with a spent five-hour window inside a spent week returns
  at the later — and fires at `MIN_DRY_HOURS` or more. That end is a **lower bound**, so the card says "at least":
  a ceiling carries a refusal's reason, not its kind, so a plan also refused for something a reset does not cure
  can stay out past its window's reset. Not seen: the account behind an alias changing — its store re-signed, or
  its row hand-edited onto another store — because a ceiling carries no store and no verified identity.
- **A plan at its usage limit is spent.** A limit the owner set can make the fleet dry ON PURPOSE while the provider still
  shows allowance left (a set limit is respected even if it means taking the fleet down), so an `at-usage-limit` ceiling counts exactly as zero headroom does.
- **Keyed** by the reset's hour plus a digest of which plans are spent. **An open card is held while it fires
  with the same set** (`holdsWhileFiring`, `holdRevision`); a plan coming back or going out re-cuts it. It settles
  on a clear pass, or once its hour passes even unmeasurable (`lapsesAt`).
- **Every plan is on the card** (every Claude and Codex plan is accounted for): the machine, then each Claude and Codex plan with its status, the spent window holding it, its
  reset, its account and its free resets (held, or unread), the plan whose reset ends the interval marked. A fleet
  too big for the details caps is `unmeasurable`, never a card that drops a plan.
- **The card is the owner's decision**: hold until the reset (the lean, since no route opens before it), or shed the least
  urgent seats. Never a purchase, never a click in a provider UI. `work` and `floats`, raised by the
  [hourly fleet-capacity survival read](../../automation/reference/declared-rows.md#the-hourly-fleet-capacity-survival-read);
  the threshold is [plan survival](../../supervisor/reference/plan-survival.md)'s.

## `fleet-unhealthy`: one note when the fleet as a whole is failing

The owner's steer: syncs failing for everything and the bot unhealthy reach the owner's screen, unasked. ONE
card for the whole condition, keyed by which signals trip, drawn in front of the notes already up, run FIRED at every
`tick open`, and `tick close` refuses a tripped verdict with no note up. It goes up only on a CHANGE since the
last note, paced and in the owner's waking hours. A blind spot makes `--fire` refuse, so `tick close` does
too; a listener NEVER ARMED (no arm record, no heartbeat, an empty arm journal) is an `INFO` line, not a blind spot, so
the job signals still post. Thresholds, the pacing, the death criterion, and why a
day's nineteen deaths once reached nobody: [fleet-unhealthy](fleet-unhealthy.md).

## Why `bot-off-the-air` is the owner's, when a session looks able to fix it

It is not. Rule 2 bans a headless or auto-restarted model outright, and a Slack tag arriving with no session
running is a no-op BY DESIGN. Seating a visible bot session is the owner's hand, every time — which is exactly the
class this register exists for.

## Why `prs-backed-up` takes the document rather than fetching it

This lane opens no network connection of its own, so it cannot go stale against `github landing`'s own
ranking, and a scheduled pass cannot turn into a rate-limit problem. Hand the document in; with none, the
monitor is `unmeasurable` and says so rather than reporting the queue clear.

**An EMPTY document is `unmeasurable` too.** `github landing` narrows on `--repo`, `--author`, `--limit` and
`--include-drafts` without changing the document's shape, so a pass handed a tighter capture than the pass that
posted would otherwise read `clear` and settle every open `mon-prs-` step while the pull requests were still
blocked on a code owner. Absence of rows is absence of evidence. The failure direction is chosen: a card that lingers one pass too long is
recoverable with `hand done`, and one that vanished is not.

**The residue, stated rather than discovered.** A document that still carries rows but was narrowed _within_
a repository — `--limit` past the open set, say — is indistinguishable from a complete one, and a subject it
drops will settle. Capture the document at one scope and keep it there for a lane that fires cards.

## The wording is authored, not derived

A sentence built out of a monitor id reads like a log line, and the whole value of the card is that the owner can
act off the one line without opening anything. Two edges the tests hold down:

- **`chair-off-fable` speaks differently about its two subjects** — "seat a chair on Fable" is wrong when
  nothing is pinned, and "pin one" is wrong when a chair is sitting there on the wrong model. It also avoids
  the noun "supervisor" for a mechanical reason: a determiner in front of it trips `fleetActorPhrase` and
  the register would refuse the card.

**The refusal is a tell, not a fence.** A card the register or the posting form refuses is printed with the rule
that refused it, and nothing is posted. That is the hand gate working as designed, reported rather
than worked around; weakening another lane's gate to get a card through would be the wrong trade.

## A monitor's card is re-confirmed only by that monitor's own pass

The Queue marks a card fresh only when its facts were re-confirmed (`site/content/console/queue.mdx`). For a
`mon-*` card the hand register still holding it proves nothing — a step outlives a monitor that has gone clear —
so `handover currency` reads the monitor's own last recorded pass (`reading last --producer "monitor check <id>"`,
filed by the tick) and confirms the card only when that pass is firing on a subject whose step id is the card's
base, at the pass's instant (`src/handover/currencyCards.ts`). Clear, steered, unmeasurable, a pass that no longer
names it, one that will not read, no recorded pass at all, or a `mon-*` step no monitor in this build still
defines leaves the facts unconfirmed with that reason. So a
monitor the tick does not run with `--only` keeps its cards unconfirmed; giving one a fired tick reading is what
lets them read fresh.

## No monitor watches a parked run, and a set monitor posts one card

A run that recorded a question is already an ask on the owner's queue, drawn from its own shape (problem, options,
lean, stakes). A hand step for it can only be a copy of that ask with the context removed. Once,
`parked-on-you` did exactly that: 25 `mon-park-*` notes in one second, each reading "Answer:
<question>" and opening nothing — a useless queue card that explains nothing and carries none of the context the
owner needs to react honestly. No such monitor exists: `unit/monitor/registry.test.ts`
pins the roster, so adding one is a visible diff. `hand retract` took the 25 down.

Two mechanisms stop the class from coming back through any other monitor:

- **The posting form is fenced at the store.** `src/hand/posting.ts`'s `postingRefusal` runs inside
  `appendHandRow`'s own lock for every posted row, so no writer can skip it; `hand post` and `monitor check` call it
  first only to report early. So a card that asks for a decision must open the record holding the choice or carry
  it whole, and a card asking the owner to react must open its queue item. Every step must also say where it happens, so each card links
  its own queue card, `/queue?open=hand:<id>` on the configured console base, with `id` the occurrence it is
  written as (`base.2` for a re-arrival) (`src/monitor/card.ts`).
- **A set is one card.** Every monitor except `prs-backed-up` (`perSubject`, one code-owner pick per pull
  request), `codex-plan-signed-out` (`perSubject`, one sign-in per plan), `claude-plan-unusable` (`perSubject`, one
  card per faulted plan), `secret-absent` (`perSubject`, one
  paste per missing file) and `resync-signed-out` (`perSubject`, one sign-in per origin) folds its whole set into one subject. The pass refuses a reading that carries more than one subject:
  it posts nothing and settles nothing (`src/monitor/pass.ts` § `readingShapeRefusal`).
