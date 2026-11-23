# The owner's own tables, and the column on the identity register

Part of [The local Supabase store](../store.md).

Three things live here, and one is mechanical.

**Per-person judgement is a COLUMN on `person`, not a file and not a table.** One file per person makes no
sense: people are tracked on the identity register, which is a table in Supabase, and facts about a person or a
per-person judgement are one of that table's columns. So `person.judgement` is a nullable
`jsonb`, typed `PersonJudgement` (`src/store/profile/types.ts`), carrying six named buckets — `facts`,
`channelPreferences`, `register`, `yesTriggers`, `noTriggers`, `reviewerRoles` — of statements that each
name where they came from, when they were observed, and the sha256 of their own text.

The null is load-bearing. Only a tiny fraction of the thousands of people placed by the member pull receive an owner brief, so the
overwhelmingly common value is `null` — which means _uncurated_, not _measured to have no preferences_. Every
reader here says so in as many words rather than printing an empty list.

**Only curation writes that column, and the reconciler proves it rather than promising it.** The member
pull's upsert in `src/store/identity/reconcile.ts` ENUMERATES the columns a conflicting row overwrites —
the platform id columns, the Google Admin fields and `updatedAt` — so it physically cannot clobber
judgement it did not author. That is a property of the reconciler's column list rather than of the column,
which is why `src/__tests__/unit/store/profile/schema.test.ts` asserts the word `judgement` appears nowhere
in that module — and asserts, beside it, that the module does still upsert `personTable` and does still
name a column in its `excluded` list, so the first check is over a file that genuinely writes people.

**Every write is pinned to the revision it was read at.** Optimistic, never locked, and for the reason the
handover board made the same choice: a lock held by a session that dies blocks everybody, while a refused
write costs one re-read and shows the curator what the other writer actually said. `REVISION_CONFLICT` is a
normal outcome, not an error path nobody expects.

**The judgement column is bot-readable**, deliberately. It carries no `visibility` lane of its own and a
row-level policy cannot hide one field while leaving the bot's identity lookup working. So putting something
here is a decision to let the Slack-facing bot use it, which is exactly what it is for — the composer and the
reviewer suggestion are its consumers. Raw private material stays in the corpus, where the private lane
applies.

### `owner_profile` — the one table dedicated to the owner

Global rather than per Claude project, in the owner's words: the owner doesn't really like how stuff it knows
about the owner is per project … the Slopweaver plugin is sort of supposed to be loaded globally. And, like if
the owner is in ACME admin, Slopweaver plugin should be there … with Claude there is this kind of annoying split
between like memories in one project like Slopweaver will not be present in another project like ACMEAdmin.
Claude's own project memories cannot span two projects; one row in one database reached by a globally-installed plugin can.

A SINGLETON, enforced by the database: the primary key is the literal `owner` and a CHECK refuses anything
else, the same way each per-source table pins its own `source`. A table that accepted a second row would
invite a per-project one, which is the split the ruling removes, and every reader would then have to pick.

`selfDescription` splits three ways and the split is a cost model. `alwaysLoaded` is injected into every
session in every project, so it is paid for on every session start and is named rather than computed from a
threshold. `waysOfWorking` is injected too, prefixed so a reader can tell it from a fact. `facts` is read on
request and never injected.

**`profile.json` does not move.** It is per-INSTALL configuration — which sources are on, which checkouts are
main, the bot's card chrome, the reaction emoji, the owner's Slack id. None of it describes a person.

### `organisation` — the organisation this install works for, written once

The organisation is written once and used everywhere, with no home directory of its own. The GitHub owner, Google domain, Slack hosts, Linear and Vanta workspaces, display
name, team repositories and dependency bots used to be constants in the code, so a repository meant for any install
named one. They are one row here instead, written only by `slopweaver org set` and read only through
`readOrganisation` (`src/organisation/read.ts`), which refuses `ORG_NOT_CONFIGURED` when the row is absent — never
a default, since a default is the constant again.

The row is the one place these values are WRITTEN, and not every reader takes them from it yet: among those that do not, the bump selector's
bot logins (`src/review/bumpSelection.ts`) and the console's placement (`site/lib/workspacePlacement.ts`) are still
constants.

A SINGLETON the way `owner_profile` is: the key is the literal `organisation` and a CHECK refuses anything else.
One typed column per field; a provider the organisation does not use is a stated `null` in its nullable column, and
the lists are `NOT NULL` arrays. `parseOrganisationRecord` validates the row on every read as well as every write, so
a row a hand-edit left wrong is refused as `ORG_INVALID` rather than placed by.
`revision` pins a write the same way: `org set` writes against the revision it read, and a moved one is
`ORG_WRITE_CONFLICT` with nothing written. The owner role writes; the agent and bot roles read, because every
placement — the bot's included — needs it. **This build's own repository is not a column**: it is derived off the
checkout's `origin` on each read, so it is right in every clone without a write. [org](../../skills/org/SKILL.md).

### `owner_voice_register` — the measured length register

The owner's measurement over a few thousand dictations and sent messages had been written into a markdown
file in an archived repository that no code path read. Slopweaver could tell a composer a WORD was banned and
could not tell one that a message was four times too long for the surface it was going to.

Keyed `(owner_id, surface, cohort)`. The cohort is necessary rather than tidy: every sampled Slack message the
owner sent measures median 14 / p75 29 / p90 54, while a 312-message calibration against one colleague measures
median 7 / p90 18. A single `slack` row would have to pick one and would describe neither, so
`cohortForSurface` takes the LARGEST sample — warning every channel post against a two-person calibration
would fire on almost all of them.

Every statistic is nullable and an absent one renders as `—`, the same three-valued discipline
`PlatformIdentity.active` uses: a reader must be able to tell "not measured" from "measured at zero". The
source genuinely gives no p75 for the DM cohorts and no measured percentile at all for GitHub, Linear or
Notion. A ceiling is NOT required to sit above p90, because a ceiling is an intent and a percentile is an
observation — the owner's own register gives p90 54 alongside a 50-word ceiling for a casual reply.

**The check warns and never refuses** (voice has no hard blocks), and a surface no
cohort measured reports `NOT CALIBRATED` rather than clean — the two are different values on
`AboveFoldVerdict` precisely so a check that could not run is never read as a check that passed.

The doors reach it through the context cache rather than the database, so the check runs with no connection
and no round trip. The count it compares is AUTHORED PROSE (code, quotes, URLs and identifiers removed by
`authoredProseOf`, the same extractor the sentence cap uses), while the register was measured over whole
sent messages — so this count runs low, which is the safe direction for a warning, and the warning says so.

### `standing_ask_event`, `standing_ask`, `standing_ask_coverage` — the owner's standing asks

The event table is the journal, each row the exact v1 line in `journal_seq` order; the other two are the projection
whose partial unique indexes hold one active generation per id and one active ask per card, coverage carrying its
ask's state by a cascading foreign key. Every read folds the lines and refuses a projection that disagrees, a
generation's origin included. That full fold reads all history, withdrawn generations too, on every operation, and
it is kept until a measurement shows the register is large: none has been taken. A write takes a
transaction-scoped advisory lock as its first statement at `read committed`, so a second writer decides against the
first's commit. `judgement/standing-asks.jsonl` is imported once under the `standing-asks` marker, which records the
sha256 and size of the bytes its lines were decoded from, both taken off one `O_NOFOLLOW` open of a regular file;
while the file stands, every later read and write checks it and refuses a change
(`STANDING_ASK_HOME_FILE_CHANGED_AFTER_IMPORT`). `store export` reaches the register through the same port's
transfer half (`src/profile/standingAskPort.ts`). Witness: `src/__tests__/integration/standingAskStore.test.ts`.

### Loading is mechanically enforced

_"To make sure that these things are actually loaded when they need to be loaded, I think there has to be
some kind of mechanical enforcement on a lot of them."_ `hooks/profile-context.sh` runs on `SessionStart` —
which Claude Code re-runs as `SessionStart:compact` after every compaction; a `PostCompact` row reaches no context
(`src/__tests__/unit/context/hookRegistration.test.ts` carries the measurement) — in every project the plugin
loads into, and emits the block as the harness's own `additionalContext`. It does NOT inherit `handover-run.sh`'s "no runs directory, exit in shell" fast path:
that reasoning does not carry here, because a repository that has never run a handover still needs the
owner's profile, and the early exit would make the common case the silent one.

It FAILS OPEN on every path, and the verb behind it exits zero on every path too. A session start that a
profile read can break is a session start somebody turns off, and the ruling is worth nothing once the hook
is disabled. So a refusal, a timeout and an unreachable database all produce an injected block that SAYS SO.

**Failing open is not failing quietly.** A load that found nothing — no live read, no cache — opens its block
with a `# STOP` warning naming the reason and `slopweaver profile context`, the repair. Every attempt, by the
hook (`profile hook`, and Codex's `codex rules-context`) or by hand (`profile context`, which exits non-zero
when nothing loaded), appends one row to `$SLOPWEAVER_HOME/profile/loads.jsonl` — bar a **first boot** (below):
there every block, the hooks' and the reload's, carries `# FIRST BOOT` instead (`FIRST_BOOT_LINES`,
`src/context/loadLedger.ts`), and `profile context` exits 0 and records nothing (`profileContextDisposition`).

**Failing open at session start is not acting without it** (a session does nothing rather than act misaligned with the owner, and the recovery has to be automatic). The hook clears a
DELIVERY MARKER (`$SLOPWEAVER_HOME/profile/delivered/<context>`, `src/context/profileDelivery.ts`) in bash
before node starts and writes it back only after printing the owner's profile, so a hook the envelope kills — every one of
seven unloaded sessions measured, killed "after 7s" while node booted under load; the budget is now
60s — leaves none. The marker is per CONTEXT: a subagent is its own (both hosts put `agent_id` on its hook payload),
never covered by its parent's. It is tied to the transcript too, since a hook that never BEGINS clears nothing: it
records how far into `transcript_path` it was checked, and a compaction record past that point voids it — bar the
one boundary a compaction's own `SessionStart`, which runs before its boundary lands, expects. Four readers act on
it, and on the ledger with the seat's own boot records:

- **The PreToolUse `profile-held` check** (`src/admit/profileHeld.ts`), first in the dispatcher, refuses any
  guarded call (Bash, Monitor, Artifact, TaskOutput, Edit, Write, Agent, Task, the browser) from a context with
  no marker, and the refusal CARRIES the owner's profile from the last-known-good cache, so the retried call goes
  through: the recovery is the context's own next action. The marker and the hold's ledger row are written only
  once that refusal has left the process whole (`afterEmit`, `src/admit/preToolUseDispatch.ts`). With no copy
  anywhere it holds every call but `slopweaver profile context` — the launcher on `PATH`, never a path to one —
  which refreshes the cache for the next hold to deliver; a payload naming no session is refused outright, and a
  marker that cannot be written is recorded as a failed load. The one exception is a **first boot**, a machine no
  home of which carries any trace of the owner's PROFILE: EVERY call runs and nothing is delivered or recorded, on node and
  on the bash lane alike ([first boot](profile-first-boot.md)). A transcript it cannot read is
  marked `unread`, which vouches for the one retry its delivery asked for and is spent by it, so every later call is
  held and handed the owner's profile afresh until the transcript reads again and a reload marks a real offset. A spent
  dispatcher budget, or a dispatcher the `scripts/hook.sh` envelope ends, refuses every guarded call for a retry
  (`SLOPWEAVER_HOOK_GIVE_UP=2` on both rows), and neither refuses a context lacking the owner's profile without handing
  it over. A shim with no runtime or tree, a target that is not there, or a spent budget runs the **bash recovery
  lane** (`hooks/lib/profile-delivered.sh`; `give_up`, `run_target`): it checks the marker is current as node does,
  a failed transcript scan counting as not current, and otherwise delivers the owner's profile from `profile/context.txt`,
  the plain-text copy `writeContextCache` writes beside the cache, and marks the context behind it — so the seat
  recovers with no node at all; with no copy it lets the by-hand reload through, as node does. The envelope's own
  kill prints that copy into its refusal unmarked, since it never read the payload, cut short at 12 KiB or a second
  before the declared timeout. The shims resolve the launcher's home first, config file included.
- **The `UserPromptSubmit` seat check** carries the owner's profile into a prompt whose session lacks it
  (`src/cli/commands/claude/seatProfile.ts`), so a prose-only turn gets it too — best effort, since node's boot
  can outrun that hook's budget.
- **The door** (`src/admit/profileLoadGate.ts`) HOLDS an external write from a session whose newest observation
  is a failure (`PROFILE_NOT_LOADED`); no token waives a hold. Silence passes — a session nothing recorded is
  `unobserved`, never `unloaded`.
- **The `profile-unloaded` monitor** reports a running session in that state quietly, asking the owner nothing: as
  held and reloading once the hold's own row proves it met the session, as held with an unwritable marker when
  the hold delivered but could not mark, and as not yet held before that
  ([profile-unloaded](../../skills/monitor/reference/profile-unloaded.md)).

**What it does not cover**, stated rather than discovered: a tool the dispatcher never sees (`Read`, `Grep`,
`TodoWrite`, `NotebookEdit`; `ScheduleWakeup` emits no PreToolUse at all); a turn that answers in prose when the
prompt hook was also killed; a machine starved past the declared 30s, which hands the call to the harness; the
`UserPromptSubmit` cached pass, which sees only that a marker exists (it only decides whether to carry the profile
into a prompt — every guarded call is still judged); a host naming no transcript, whose marker stands on the
`SessionStart` clear alone; a subagent's own compaction, when its payload names its parent's transcript; a store
repointed on a machine whose runtime is also gone, since the bash lane cannot check the copy's database
fingerprint; and a seat on a worktree older than this, which runs its own hooks.

The hook exits zero on every path, so a transcript's `hook_success` for it is judged by what it printed: the
always-loaded block is a load, anything else (a kill notice, nothing) a failure no row records.

**What the hook proves, and what it does not.** `src/__tests__/unit/context/hookRegistration.test.ts` proves
the REGISTRATION — the event, the script, and the two shapes that silently defeat it. It cannot prove
DELIVERY, because that is a property of the host: delivery is proved by running a session outside this
repository and looking for `ALWAYS_LOADED_MARKER` in its context, with the registration removed as the
negative control. The witness was checked rather than assumed — dropping the `PostCompact`
entry reddens exactly that test and restoring it turns it green.

**The cache is why it works with the stack down.** Every successful live read writes
`$SLOPWEAVER_HOME/profile/context.json`; a read that cannot reach the store, or reaches a row it cannot parse,
emits that file with its age stamped on it and the live failure named. A copy whose own owner section reads
`unavailable` (one a checkout without that rule wrote) is no cache, so it gets the STOP and never a load row. It
is DERIVED and nothing edits it — Supabase is the one place a
fact changes — and it is bound to the database it was captured from by a hash of the connection string, so a
machine that repoints `SLOPWEAVER_STORE_URL` never gets another install's owner described as its own. The
voice register is the deliberate exception to that binding and `context/cache.ts` says why: a length cohort
is a measurement of how THE OWNER writes, which is the same fact whichever database it was read out of.

### The memories seam, reserved rather than built

A second always-loaded source is settled: a Supabase `memories` table with full-text recall
and a very small always-loaded set. That is its own board row and is deliberately NOT built here. What is
built here is the envelope it lands in — `src/context/alwaysLoaded.ts` owns the ordering, the marker and the
status rendering, so that row adds a `memories` provider and changes no hook, no verb and no delivery test.
Nothing reserves its table, its columns or an empty-success reader for it: a fake empty reader would report
"no memories" on a machine where the table does not exist, which is a check that cannot fail.

### The 90 history files

`slopweaver profile harvest` applies a hash-pinned disposition manifest over the owner's archived profile unit
(`skills/profile/reference/harvest.md`). Dry by default. "Useful" is a judgement no directory rule computes,
and this tree proves it in both directions: `archive/team-model-2026-05.md` asks in its own text to be kept
after supersession, while `projects/e2e-overnight-KICKOFF-PROMPT.md` is an execution entrance whose
instructions contradict current doctrine and would be retrievable as advice.

`--apply` joins the harvested paths against the `self` bronze lane rather than re-scanning, because a
re-scan mints new section ids for the same prose and leaves both versions retrievable as current. "Dropped"
means excluded from the import and from future profile context, with the reason recorded — never deleting an
original, wiping the `self` lane, or removing rows already stored.

## The roles, and the one that earns its keep

`slopweaver_owner`, `slopweaver_bot`, `slopweaver_agent`. Segmentation only means something if some role
is denied something: **the bot cannot read a `private` row** — a private channel, a DM, the mailbox, the
diary — rather than being trusted not to. Verified live on the local stack, over a seven-row table holding
one private row: owner and agent count 7, the bot counts 6 and finds 0 private, and a bot insert answers
`permission denied for table content`.

**The lane reaches the four per-source tables through their parent, not through the key.** A composite
foreign key carries no row-level security across, and RLS is judged per relation: a bot query that reads
`content_slack` directly is answered from `content_slack`'s own policy, and `content`'s `visibility =
'public'` is never consulted. With `true` on the side tables — which is what the first generated policies
carried — every private message's channel, thread, reply and reaction counts were readable by the one
role built to be denied them. So each side table's `bot_read` is `botSeesPublicParent()` (`schema/rls.ts`):
`exists (select 1 from content c where c.id = content_id and c.visibility = 'public')`, migration
`0007_bizarre_living_tribunal`. `src/store/client.ts`'s side-row read stays a bare primary-key lookup on
purpose — the guard is on the table, so a caller that forgets cannot leak.

MEASURED on `rls_lane_proof` — a copy of the live store's seven content-bearing tables
(over a million content rows, about a fifth of them private, most of those Slack rows with a side row; github, linear and
notion held no private parent then, so the predicate hides nothing there and closes the class anyway),
Postgres 17.6, `set role slopweaver_bot`. **Both columns are the same database**, the predicate flipped
between runs with `ALTER POLICY … USING (true)` and the migration re-applied — an earlier attempt compared
the proof copy against the live store and the caches alone moved a number 3×.

| As `slopweaver_bot`                        | `USING (true)`                               | correlated on the parent                       |
| ------------------------------------------ | -------------------------------------------- | ---------------------------------------------- |
| `count(*) from content_slack`              | several hundred thousand — every private row | about three quarters of that — the public ones |
| Slack side rows whose parent it cannot see | **a couple of hundred thousand**             | **0**                                          |

The plan half is why the finding asked for a re-measure rather than a one-line fix: an RLS predicate is a
security qualifier the planner applies before any user-supplied condition, so it can change which index
paths are usable. It does. Each shape below is one the client actually issues; reproduce with
`explain (analyze, buffers)` under `set role slopweaver_bot`:

| Shape                                                              | `true`  | correlated   | What changed                                                                             |
| ------------------------------------------------------------------ | ------- | ------------ | ---------------------------------------------------------------------------------------- |
| A — side row by primary key (`sourceRowFor`, one per detail)       | 0.07 ms | 0.24 ms      | the same index scan, plus one PK probe into `content`                                    |
| B — `--channel` semi-join count (`predicates.ts` `semiJoin`)       | 170 ms  | 458 ms       | the predicate is applied to every `content_slack` row before the channel filter          |
| C — bare `count(*)` over a side table                              | 49.8 ms | **2,469 ms** | loses the index-only scan on `idx_slack_bot`; several hundred thousand PK probes instead |
| D — per-source facet, newest 50 (`predicates.ts` scalar subselect) | 114 ms  | 135 ms       | the outer scan is unchanged; 50 extra probes                                             |

**C is the price, and it is a shape no verb issues.** Every read in `client.ts` reaches a side table either
by primary key (A, D) or through a semi-join already filtered by `content` (B); nothing counts a side table
whole, and a bot connection that did would be asking a question its own lane makes meaningless. It is
recorded because the next person to add a side-table aggregate needs to know what it costs, not because the
store pays it today.

**`IN` is not a cheaper spelling of the same predicate — it is 600× worse.** `content_id in (select c.id
from content c where c.visibility = 'public')` was measured on the same database and CANCELLED after
**26 minutes** on shape C, against `EXISTS`'s 2.5 s: the planner materialises the whole public id set per
scan instead of probing the primary key. Recorded so the obvious-looking simplification is not tried again.

**`store verify` reads the predicate, not only the policy's name.** A database whose `content_slack_bot_read`
reverted to `USING (true)` keeps the same name, operation and role, so a comparison on those three verifies
the leak above clean. Verify therefore compares every policy's `USING` and `WITH CHECK` as Postgres deparses
them (`pg_policies.qual`/`with_check`) against the schema's expression deparsed BY THE SAME DATABASE: per
table, a same-named temp table and a `to public` probe policy inside a savepoint that is rolled back, so the
store's own catalog is never written and no lock is taken on its tables (`predicateProbeStatements`,
`src/store/lifecycleVerify.ts`). A hand canonicaliser was rejected: stripping Postgres's parentheses makes
`a and (b or c)` equal `(a and b) or c`. MEASURED on a scratch `predicate_proof` pushed from the
schema, then `alter policy content_slack_bot_read on content_slack using (true)` and `alter policy
memories_owner_all on memories with check (false)`: the name-only verifier read clean and exited 0; this
verifier exited 1 naming both, and the live store verifies clean under it.
