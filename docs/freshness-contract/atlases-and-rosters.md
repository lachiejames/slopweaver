# The atlas rolling window

Part of [The freshness contract for derived state](../freshness-contract.md).

Everything [above](../freshness-contract.md) is about the CORPUS. **The owner's ruling extends the same contract to
every atlas**: per-atlas windows defaulting to four hours, by the same logic the corpus already applies to Slack,
Linear, Notion, GitHub and the rest. It answers the second half of the owner's atlas-staleness ruling — a rolling
re-sync window so no atlas is ever more than a few hours stale — and it is deliberately ONE mechanism rather
than an atlas-shaped copy of the corpus's: the same `lib/duration.ts` vocabulary, the same "no watermark
means BEHIND at any threshold" rule, the same insistence that a skipped subject still prints a line.

**What it answers**, measured at the ruling: 24 published generations, every one of them older than four
hours, and eight daily scheduler recipes silent for four days. Reproduce the first with

```
for a in ~/.slopweaver/atlas/*; do echo "$(basename "$a") $(jq -r .updatedAt "$a/manifest.json" 2>/dev/null)"; done
```

## The window is per atlas, and four hours is the default the owner set

`freshnessWindow` on the descriptor (`atlas/kit/contract.ts`), a duration with a unit. It is OPTIONAL and the
default is `4h` — that IS the policy, not an absence of one, which is why it does not contradict the owner's
ruling that nothing may fall back to a boundary nobody chose. Cloudflare declares `2d` and says why beside the
field: it is meant to run daily, so a four-hour window would report it behind between every scheduled run.

The window is read by BOTH judgements an atlas makes about time — `kit/freshnessWindow.ts`'s estate sweep and
`kit/freshness.ts`'s per-cell `mayQuoteAsCurrent` gate — out of the one field. Neither carries a count of its own: two numbers meaning almost the same thing in two
places drift apart, which is why the generation clock is one derived value too.

**What is judged is `manifest.updatedAt`**, and it can be trusted only because `publishAtlas` DERIVES it from
the kind files a generation vouches for (`kit/manifestClock.ts`); no atlas's sync can assert one. An asserted
clock stands as far behind the records beside it as its sync left it — MEASURED at five days on
1Password and fifteen on Vanta — which makes a four-hour window meaningless in the direction that
reads as safe.

## A bounded live read counts as fresh

Call 2 of the ruling, and the rung that makes the window liveable. The corpus's ladder is just-in-time refresh
then loud refusal; an atlas cannot borrow the first rung, because a whole-atlas resync is minutes of provider
calls and holding a question on one is what the owner's atlas-staleness ruling already refused: a question as small as
"what is the organization id" must NOT hold the tag on a sync.

So an atlas past its window has three verdicts rather than two:

| verdict     | when                                                               | what a caller does                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`   | the generation is inside its window, **or** a bounded live read is | quote it                                                                                                                                                                            |
| `live-read` | behind, and the atlas declares a `liveReadCommand`                 | read the slice the question needs, live, and quote THAT — `slopweaver atlas vanta control-evidence --control <id>` is the worked example, one control rather than the whole posture |
| `resync`    | behind, with no bounded live read to fall back to                  | the loud arm: the verdict names `resyncCommand` and nothing is quoted as current                                                                                                    |

A live read inside the window makes the answer current however old the generation is, because the claim no
longer rests on the generation at all. That is enforceable only because something records the read:
`kit/liveReadStamp.ts` writes `$SLOPWEAVER_HOME/atlas/<platform>/live-read.json` and the ladder reads it back.
It is a file beside the generation rather than a field inside it for this reason — a bounded read
publishes no kind file, so a manifest carrying its clock would either assert a time it did not derive or vouch
for records nobody wrote.

**The stated limit**, because a freshness signal that hides its own scope is what this contract exists to
prevent: a live read against ONE control does not make the whole atlas current. What may be quoted is the
answer that RESTS on that read; a caller quoting a different slice is quoting the generation, and the
generation's own age governs there.

## Who runs the window

`slopweaver atlas freshness` is the judge — one manifest read and one live-read stamp per atlas, no network
call, and a non-zero exit when anything is behind. It holds itself to `refresh --if-stale`'s cost bar on
purpose: reading every entity of every atlas, which is what `atlas doctor` deliberately does, would make the
window cost more than the thing it watches.

**The scheduled row lives in the IN-REPO definition store**, which is call 3:
`$SLOPWEAVER_HOME/live/recipe/definitions`. `slopweaver automation run-due` is its executor — it loads the store, decides
due-ness from each row's cron `cadence` against the WATERMARK — the last cadence slot a run covered — in
`live/recipe/definition-runs.json`, and runs each due
`verb-run` row's verb in a child of the same CLI, through `cli/main.ts`, awaiting it before the next row
(`cli/commands/automation/runDueVerbProcess.ts`). Three more kinds ride it:
`alert-summary` and `datadog-alert-digest`, each a read leg whose form the door-routed `slack post` sends,
and `investigate`, which asks its question in the PRIVATE prompt conversation and briefs the posted message as
an ask so the ASK LANE answers it (the owner's ruling; the question goes to `slackBot.promptChannel` and the
finished card to the row's `params.postTo`). Nothing spawns a model, which is rule 2
rather than a design choice.

Two checks stand between a row and a run, and neither is a formality:

- **the verb must ROUTE**, against the same registry `slopweaver <noun> <verb>` uses, so the definitions
  directory — which nothing gates, by its own store's admission — cannot turn a typo into an arbitrary command;
- **the row's declared `effect` must cover the verb's own.** `kinds.ts` already refuses a row claiming more
  than its KIND can do, and for `verb-run` that check is toothless because the kind is `read-write`. The check
  that bites is against the VERB: a row declaring `read` may not run one whose manifest declares
  `external-write`. That is the owner's own reason for the field — some recipes both read and write, and some
  should only read — applied where it is decidable.

## Every atlas and every corpus source is REGISTERED, not written by hand

A briefing card that asks the owner whether an atlas needs a resync is the defect, not the question: the fleet runs
scheduled resyncs across every atlas and corpus, so a stale one is fixed rather than asked about. Measured when
that ruling was made:
`automation due` read _"no definitions — nothing is scheduled on this install"_ while `atlas freshness` judged
**36 of 36 atlases behind**. Every mechanism above shipped and nothing had ever been registered into it.

`slopweaver automation register-resyncs` closes that, and it RECONCILES rather than installs. It derives one row
per registered atlas bar the one exception below (from that atlas's own `resyncCommand` and `freshnessWindow`) and one per fetchable
corpus source (from `corpus/freshnessPolicy.ts`), and writes what the definition store is missing. Run it at
every visible decision point, never once: a hand-maintained roster is what drifted, so an atlas that lands in
the repository afterwards has to join the schedule by BEING REGISTERED and by nothing else.

**The one exception is declared on the atlas, never in the roster.** A descriptor carrying `resyncSchedule: {
kind: "manual-only", because }` derives no row, so the registrar retires a managed row it once wrote and the
atlas is read only when someone runs its `resyncCommand`. It is for a fact about the atlas itself, true on every
install. Xero is the case: its only live reach is a browser walk, which meets a sign-in page whenever that session
has lapsed, so a scheduled walk raises a sign-in card rather than a read ([Xero](../atlases/xero.md)). Unlike
`resyncDemand`, which still schedules a row and gates each slot on a mention, a manual-only atlas has no row at all.

Four properties are the contract rather than notes:

- **The cadence is DERIVED from the declared window** (`live/resync/cadence.ts`) — the largest evenly-spaced
  cron period no longer than that window, capped at daily. A window and a cron are two numbers that mean
  nearly the same thing, and writing both by hand is how they drift. A window over a day is capped rather
  than expressed in the day-of-month field, because a two-step there is not a 48-hour interval and reads
  exactly as though it were; Cloudflare's `2d` therefore runs daily, and the row says so.
- **A row names a TARGET, never a command.** Its argv is `automation resync --atlas <p>` or `--source <s>`, and
  the steps that runs come from the reviewed roster in this repository. The definition directory is ungated,
  so a row free to name arbitrary argv would put the choice of what runs in a file nothing reads.
- **Zero exit is necessary and not sufficient.** `automation resync` records a POSTCONDITION: an atlas attempt
  succeeds only when its generation clock MOVED. No attempt succeeds while a step left a browser walk STOPPED part way
  (`browser/walkStops.ts`): measured, `resync-atlas-hex` landed only a minority of its routes before every remaining visit
  answered `SESSION_LOST`, exited 0 and moved its clock on the API half. **A drop the transport RECOVERED from is
  not one of those**: `browser/relayRun.ts` rebuilds a dropped relay and re-addresses the page it lost, so such a
  walk reaches its own end, and the drop is reported on its own register (`takeRelayRecoveries`) rather
  than failing the attempt — measured, a large Linear walk stopped well before completion and exited on
  `Error: Session closed` while a retry under a much larger cap reproduced it, so the ceiling was never
  the clock. Measured, `atlas vanta sync` exits 1 having
  published a usable generation while `atlas trelica refresh` exits 1 having published nothing, and a run
  stamp cannot tell either from a healthy run. A corpus source's clock is the STORE's newest row for it
  (`store/newest.ts`), never its bronze watermark: the watermark moves the moment `refresh` writes a window
  file, whether or not anything ingests it, which is how `resync-corpus-linear` once reported success over a store
  whose newest linear row was more than ten hours older. The corpus step is `refresh --source <s>
--store`, bar `chatgpt`, whose step is `chatgpt sync` and whose row is seated only once a home holds an export
  (`live/resync/roster.ts`), so a zero exit means the refresh itself confirmed the window file reached the store, and an
  attempt that exited zero over a store holding no row for that source fails. The clock is not required to
  MOVE — a quiet window writes nothing new, however well the fetch went — and never advance a cursor to make
  a page look green. **A demand-gated atlas asks first**: one declaring `resyncDemand` (Aether) runs no step on a
  slot no person asked about and exits 3, recording nothing, so its `lastSuccessAtIso` honestly keeps the age of
  its last read ([demand-gated resyncs](../../skills/automation/reference/demand-gated-resync.md)). **A sync
  already running is NOT YET, not a failure**: `atlas vanta sync` meeting a LIVE holder of its sync lock no older
  than the 15-minute stale threshold exits 4, so the slot is given back rather than holding the row on a finding (measured on
  a scheduled slot); a dead holder or one past that threshold is taken over, while a record it cannot
  parse, or a live holder's it cannot age, still exits 1 (`admit/operationLock.ts#acquireOperationLockDetailed`).
- **A row this registrar does not own is never touched.** A hand-written row, a paused row, and a
  managed-looking row no pass recorded writing are each reported and left where they are.

## The page that says whether the schedule is keeping up

`slopweaver briefing render --freshness` projects one collapsed section carrying every atlas and corpus
source with its last generation, its cadence and whether it is late. Its summary is DERIVED
(`briefing/freshness.ts`) and a form that writes the section itself is refused, for the same reason
`yourList` is: this section exists because a number nobody was checking went wrong, so a composer free to
type one would rebuild the hole it fills.

It keeps four states apart that look alike — **late**, **failing**, **blocked on a human**, and
**unscheduled**. The last is the one the ruling is really about: an atlas can be perfectly fresh today and
carry no row at all, and a page reporting only staleness would call it healthy right up to the moment it
went stale for good.

## Who actually ticks it

**A session a supervisor pass seats for the job, and nothing standing.** The owner's ruling, building on the
no-standing-runner rule below and the owner's doubt that a standing session was needed at all: a resync row is the
`resync` kind, which `automation due` reports as SPAWN, and `slopweaver automation seat --limit <n> --model <m>` opens one
visible session on as many due rows as the seating session judges one session should take. That session
claims each row, runs it with `automation run-due --recipe <id> --claim-id <token>`, and closes.
`skills/automation/SKILL.md` is both halves of that.

The no-standing-runner rule is what this implements: no cron, no launch agent, no headless model, and a visible session is always
the thing that runs — one that exists for the pass, never for ever.

`automation run-due` is claim-aware, so two sessions can never run the same forty-three syncs at once, and
takes a bound (`--limit <n>`) so a pass need not be held for hours by a schedule that has drifted a long way
behind; a bare `run-due` drains every due row. A bound is a PREFIX of store order, so a session wanting one particular row — `store-backup-daily`
or `store-backup-sweep-hourly`, registered behind the resync rows — selects it by name with `--recipe <id>` rather than raising the bound
until the sweep reaches it.

**There is no cutover to type.** `automation register-resyncs` writes every row it owns on the kind its target
needs — `resync`, or `verb-run` for a compile-only atlas run in the tick — read from the build at the moment
of the write, so a row a hand repair or a reinstall recreated on the other kind is repaired on the next
ordinary pass. A row on a kind no seat can reach prints above every other `automation due` line —
[a kind a seat can reach](../../skills/automation/reference/a-kind-a-seat-can-reach.md) carries the
failure that rule was written from.

## Member rosters stay in sync, and are visible when they do not

Every `refresh --source X` re-pulls X's member list — one cheap call per source — and `derive` rebuilds
people and identities from the fresh rosters. `memberBytes` in the stamp makes an aged roster visible (the
measured case: `corpus/members/github.jsonl` weeks old while linear and notion were current): a
member roster that grew since the last derive makes silver stale on its own, with no bronze change needed, and
the verdict names the source. Two gaps remain, both stated rather
than silently carried:

- A source that is never selected by a `refresh` is never re-pulled at all. The stamp cannot show what nobody
  asked for.
- GitHub member hydration needs a resolvable org (`--repo`, or a resolvable repository in config). Without one
  the lane is skipped, which is why `github.jsonl` was the row that aged.
