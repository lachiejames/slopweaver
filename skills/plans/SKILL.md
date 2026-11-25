---
name: plans
description: The ONE register of destinations a session can be seated on — a row per provider store directory, which account it is called after, whether it is paused, and which one a pinned Claude seat boots against. Claude and Codex in one list, model-agnostic, so no plan number has to be held in anyone's head. Use when you need to know which accounts this install can seat a session on, when adding or signing in a new Codex or Claude destination, when one account is spent or its subscription lapsed and should come out of the fleet, when a plan is dropped for good and its row should be removed, when deciding which store a pinned seat boots against, or when the generated Claude accounts file disagrees with the register. Phrases like "what plans do we have", "add another codex account", "pause that plan", "which account is plan-six", "the accounts file looks wrong".
argument-hint: "list [--provider claude|codex] | adopt | add --provider <p> --plan <alias> --store-dir <abs> [--email <e>] [--pinned] | pause --provider <p> --plan <alias> --reason <why> | resume … | lapse --provider <p> --plan <alias> --on <iso> | pin … | unpin … | clear-lapse … | set-email … --email <e> | set-store-dir … --store-dir <abs> | remove --provider <p> --plan <alias> | set-usage-limit --provider <p> --plan <alias> --percent <10..100> --allowance weekly-window|monthly-spend [--from <10..100>] | set-thresholds --provider <p> [--<field> <n>]... [--reset <field>]... | sync-accounts [--json] | usage [--json] | validate [--repair-projection]"
---

**Read the register, never guess a store directory.** The store's `plan_register` row is the one place that
says which destinations exist. `$SLOPWEAVER_HOME/plans.json` and `claude-accounts/accounts.json` are GENERATED
projections of it, kept so a seat on an older checkout still reads a file in the shape it already parses.
A store that cannot be reached is a refusal, never a read of those files. What each plan has USED is `plans usage`, asking no model host: [plan usage](reference/plan-usage.md).

```bash
slopweaver plans list                    # every destination, its account, its state, its store
slopweaver plans list --provider codex   # one provider
slopweaver plans validate                # exits 1 when it FINDS something — a diagnostic verb
```

## Why it exists

Plan routing must work for Codex as well as Claude and stay model-agnostic for future models, with clean
architecture and code re-use: one register, with it very clear which plan is bound to which account, or abstracted
from the owner entirely. The Claude plans were bought under different emails and will not match a neat list, and
the number of Codex plans scales up.

Two things follow, and both are properties of the code rather than conventions:

- **A row is a DESTINATION, not an account.** It names a directory a provider's own CLI is signed into. Nothing
  here can tell two directories signed into the SAME account apart from two signed into two, so **two homes
  signed into the same account add no capacity** — printed beside every sign-in instruction for that reason.
- **The alias is a selector, not a number the owner holds.** `plans list` prints it because it is the argument
  the next command takes. Every sentence that reaches THE OWNER names the provider and the account instead, and where
  the register maps no account it names the store directory — never `plan-six`.

## The one hard line

**No field in the register can hold a credential**; the code a provider mails the owner is the owner's to enter. From the console,
`plans connect --provider codex` opens Codex's own sign-in page in the browser, the owner's sign-in the consent, and registers
the plan once it lands ([connect](reference/connect.md)); by hand, `add` prints the `CODEX_HOME=<dir> codex login`
line for the owner's own terminal and stops there; the token behind a registered directory is the provider CLI's business,
never read, copied or rendered here. A Claude plan's setup token is minted by a seat with `slopweaver claude mint
--plan <alias>`, which pre-fills the plan's enrolled address so the owner never needs to know which address a plan is:
[setup-tokens](../supervisor/reference/setup-tokens.md). A Claude plan's held free reset is the fleet's to read and
redeem at a limit with `slopweaver claude reset --plan <alias> [--claim]`, over a sign-in a probe binds to the plan.

## Adoption is explicit, and nothing adopts by being loaded

An install that has adopted nothing reads as a DERIVED picture — the Claude plans the user signed in to
(`claude-accounts/accounts.json`) — with a `DERIVED_REGISTER` note; normal, so `validate` exits 0. **A plan comes
only from the user's own sign-in**: a Codex login found on the machine is never derived, adopted
or spent; one enters only by `plans add --provider codex`. Every change but `adopt` is refused until you run:

```bash
slopweaver plans adopt      # write the derived picture down as this install's register
```

## Adding a Codex destination

`$CODEX_HOME` genuinely isolates authentication — MEASURED: `CODEX_HOME=$(mktemp -d) codex login
status` reports "Not logged in" on a machine where the ambient home is signed in — so N registered homes are N
independent sign-ins. That measurement is the whole basis of scaling Codex up.

```bash
slopweaver plans add --provider codex --plan codex-two --store-dir /Users/you/.codex-two \
  --email owner@example.com --percent 30   # the owner's usage limit, bound from the start; omitted = the whole plan
# then, in THE OWNER'S terminal:  mkdir -p /Users/you/.codex-two && CODEX_HOME=/Users/you/.codex-two codex login
```

`add` creates the directory (mode 0700) BEFORE writing the row, refusing the add when it cannot: `codex login` refuses a missing `CODEX_HOME` (measured on codex-cli 0.155.1), though the line still carries the `mkdir -p`. Once published, `add` installs Slopweaver there as `codex plugin-sync` would; a failed install keeps the row and exits non-zero. Once the owner signs in, `codex route` asks the new home's own app-server for its limits and takes work there with no further step.

## Which account is each store ACTUALLY signed into

`--email` is what the owner TOLD the register; only the store's own `codex app-server` knows who is signed in.

```bash
slopweaver plans sync-accounts   # one live read per Codex store; records each signed-in address on its row (the fix for ACCOUNT DRIFT)
```

A signed-in store gets its address written onto its row, one change per row, refused if the row was
repointed at another store mid-read. A store with nothing signed in prints its `CODEX_HOME=<dir> codex login`
line and is never touched; `codex route` excludes it until the owner signs in. Two stores that answer with the same
account are named, because they add no capacity. The read is the one `docs/security/data-flow.md` lists.

`--store-dir` must be ABSOLUTE: a provider CLI resolves a relative path against its own working directory, and
Claude hashes the string to find its keychain service, so a rewritten spelling addresses a different, empty
credential.

## A broken destination floats one note

Every supervisor tick reads every unpaused row: Claude through `claude gauge`, Codex through `codex route`. The
`claude watch` keep-alive reads every Claude row too. A row that reads signed out, missing locally or failing its
probe floats ONE note naming it by its email, with the owner's one step. It fires once per fault and clears when a probe
reads the row again ([claude-plan-unusable](../monitor/reference/claude-plan-unusable.md),
[codex-plan-signed-out](../monitor/reference/codex-plan-signed-out.md)). A paused Claude row is never read; a paused
weekly Codex row still is, for its sign-in and limits, so its note still fires, and it is never routed.

## Taking a destination out of the fleet

A pause is a STATE, not a countdown, with no return date; every surface prints its reason. A plan gone for good
is REMOVED: its store and sign-in stay on disk, a running seat keeps running, and its alias may come back only
at that same store. Removal, `unpin`, `clear-lapse`, `set-email`, `set-store-dir` (the same account at a new path,
alias kept) and the ambient Codex plan:
[removing a plan](reference/removing-a-plan.md).

```bash
slopweaver plans pause --provider claude --plan plan-two --reason "the subscription lapsed"   # then resume …
slopweaver plans remove --provider codex --plan codex-two
```

When a paid subscription ENDS is a different fact from whether it is paused: `plans lapse --provider <p> --plan
<alias> --on <iso>` (strict ISO-8601, kept as typed; a renewal records over it) pauses nothing, skips no probe and
moves no route. `plans list` and every `claude gauge` `PLAN` line end on `lapses <iso>`, or `lapse UNRECORDED`; a
Codex row also prints the date its own sign-in states, and Anthropic states none: [lapse dates](reference/lapse-dates.md).

**A lapse does decide each model host's LANE.** `plans list` closes on one line per lane (`--json`: `lanes`): `fill`
while two or more plans stand (not paused, lapse unrecorded or ahead), `lean` on one, `unavailable` on none,
`unregistered` with no row. A lean Claude lane moves the supervisor chair to Opus with no timer sweep, and with both
lanes recorded lean the idle-capacity gate stops refusing ([model-tiering](../supervisor/reference/model-tiering.md)).

**One Claude plan is a whole fleet**: rotation needs no second plan. No count rule
exists: `parseClaudeAccounts` refuses only a pinned plan that is paused. Pausing the last live Claude plan is
allowed and stops every unpinned spawn with a non-bypassable `paused` refusal naming `claude resume`; a
`--plan` spawn whose plan is paused refuses the same way.

## Giving the fleet only part of a plan

The owner can say the fleet may have fifty percent and no more, and the fleet maximises to that
limit, never over it: at a 30% limit it stops rather than exceed 30%. A row's **usage limit** is that number,
10 to 100 in steps of ten, and a row with none recorded allows 100.

```bash
slopweaver plans set-usage-limit --provider claude --plan plan-one --percent 50 --allowance weekly-window
```

- **The console sets it.** Settings → Models draws one drop-down per plan at its limit; the Fleet page reads a stopped plan as
  "stopped at your usage limit of 30% of its week", never "capped", and offers to raise it to 40% and continue.
  Both pass `--from` the limit drawn, so the verb refuses a stale choice (`site/lib/planUsageLimit.ts`).
- **Weekly windows only.** It lowers the bar on the plan-wide week (and Claude's Fable week) to the lower of the
  house bar and the limit; a five-hour window, should a plan carry one again, keeps the house bar. A reading AT the limit refuses. On such a week
  the react-now card fires `alertAtPercent` of the way to the limit, the chair's warning `routeAtPercent` of the way,
  and the gauge reads `NEAR` at the limit itself (37.5%, 47.5% and 50% on a 50% plan by default).
- **No override crosses it.** `--force`, a named `--plan` and the spent- or unreadable-plan hatches never seat
  work on a plan at its usage limit: those bypass a provider refusal, and this is the owner's own number.
- **A register that does not read fails CLOSED.** No limit can be read, so no Claude spawn boots, pinned or not,
  and no hatch crosses an unread limit (a STALE store is READ under its hatch: [boots refused](../supervisor/reference/boots-refused.md)); `claude token`, `mint` and `reset` refuse before any probe.
  The `claude-plan-unusable` monitor floats ONE note naming the fault: fail closed, but let the owner know early.
- **The one-token gauge probe stays allowed past a limit**, how the fleet learns a capped plan has room again:
  the owner's ruling is that under a hundred tokens counts as zero, strictly under. Each probe MEASURES its cost
  (`claude gauge --json` `plans[].probeCost`, 35 measured); 100 or over prints `PROBE COST`, an alarm, never a refusal.
- **A Claude `monthly-spend` row is routed in DOLLARS.** An Enterprise seat is metered in dollars a month.
  `slopweaver claude spend --plan <alias>` reads its spend and limit off the provider's usage answer and records it
  for an hour; every Claude routing gate (spawn, rotation, the watch, the PLAN line, capacity) judges the row on
  that newest hour-fresh reading. Open, it is the FALLBACK lane behind every eligible weekly plan, least spent
  first; at its limit it refuses; with no fresh reading it takes no work, never read as 0%. A Codex
  `monthly-spend` row stays NOT MEASURED: nothing reads a ChatGPT plan's credits.
- **A running seat is held at it too, prompt by prompt.** The `UserPromptSubmit` seat check judges a seat on a
  plan under 100% against that plan's last RECORDED reading (`src/claude/seatUsageGate.ts`), and holds the prompt
  at the limit — or as NOT MEASURED when no reading at most an hour old says it is under it. A weekly plan's reading
  is the snapshot every `claude gauge` and non-dry-run `claude watch` tick leaves in `live/claude-usage/`; a
  monthly-spend plan's is `claude spend`'s. No hatch releases the hold, and a plan at 100% reads nothing. Residue:
  it is a recorded reading, not live usage, a turn in flight finishes, and the hook's 15 s budget fails open.

## The house bars live in the register too

No limit is fixed in code; each lives in the store, and every steer about Claude applies to Codex too.
The routing bar, the spend-out bar and its lead time, the alert and acceptance bars, the balanced and drifting
spreads, and Codex's alert and pause bars are the register's `thresholds`, one set per provider. `plans list`
prints them, each marked `set` or `default`.

```bash
slopweaver plans set-thresholds --provider claude --route-at-percent 94 --acceptance-at-percent 89
slopweaver plans set-thresholds --provider codex --reset pause-at-percent
```

Coupled fields move in ONE change, so no invalid register is ever published; an ordering the gates cannot honour
(an alert at or past the routing bar, say) refuses the whole change. Fields and defaults:
[thresholds](reference/thresholds.md).

## When the projection disagrees

A writer on an older checkout edits `plans.json` or `claude-accounts/accounts.json` directly and never
reaches the store row, so its change is DIVERGENCE rather than a source update. A read REPORTS it and the
row stays authoritative; healing on read would silently discard whichever change somebody meant.

```bash
slopweaver plans validate                      # exit 1 + PROJECTION_DIVERGED
slopweaver plans validate --repair-projection   # regenerate both files from the row, no new revision
```

The row commits BEFORE the projections, and the commit and the projections are not one transaction. So a
failure between them reports `PROJECTION_WRITE_FAILED`, naming the committed revision. It is never a
rollback, because re-applying the change would double it. `--repair-projection` is the named repair. Two
writers racing on one revision: one wins, and the other gets `REGISTER_REVISION_CONFLICT` with nothing
written. Every seat's cached pass is cleared before the commit; if it cannot be, the change refuses as
`SEAT_PASSES_NOT_CLEARED` with nothing written.

Detail — the file shapes, the structural rules, what each diagnostic means, and how routing consumes the
register: [register and routing](reference/register-and-routing.md); which Codex destination new work takes:
[Codex routing](reference/codex-routing.md).
