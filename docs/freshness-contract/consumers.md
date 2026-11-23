# Which consumer does which

Part of [The freshness contract for derived state](../freshness-contract.md).

| consumer                                                                                                  | artefact                          | behaviour                 | why                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slack post` / `reply` / `edit`, `turn answer`, `queue release`, `slack poll` / `dm` / `channel --invite` | derived identity roster           | **JIT** then **refuse**   | `mentionsFromIdentity` runs the derive pipeline in-process when the roster is stale AND the send actually mentions someone; if the roster is still not fresh as of the send's ask, the send refuses rather than pinging from a roster that cannot see this week's joiners — growth after a derive that observed past the ask is concurrent and does not refuse                                                       |
| any of the above, mentioning NOBODY                                                                       | derived identity roster           | **proceed**               | a stale roster cannot change the output, and refusing there is failing closed on something that could not have mattered                                                                                                                                                                                                                                                                                              |
| `refresh`                                                                                                 | silver as a whole                 | **JIT** (rule 4)          | derive runs at the end of every refresh unless `--no-derive`, skipped when nothing it reads moved since the stamp, the whole recursed corpus tree included                                                                                                                                                                                                                                                           |
| `turn brief`                                                                                              | the BRONZE corpus vs the world    | **wait** past 4 hours     | the just-in-time gate — see its own section below. Not "has this corpus gone dark" but "could the last few hours have changed THIS answer". Waits only when the question is about a moving target AND a source it draws on is behind. `store read` and `store cite` read the STORE, whose freshness is a property of the last `slopweaver store load` and is reported by `slopweaver store status` rather than gated |
| `handover list`                                                                                           | main checkout vs its upstream     | **report loudly**         | see the note below                                                                                                                                                                                                                                                                                                                                                                                                   |
| `handover list` / `register-hygiene`                                                                      | board status vs `doneWhen` probes | **refuse-shaped already** | a doc claiming `done` while a probe fails is listed under CONTRADICTION; that is the loud form, and it stays                                                                                                                                                                                                                                                                                                         |

## Bronze freshness: who refuses, who does not, and what keeps it current

Rule 3 names a bronze refresh as the archetype of the loud-refusal arm, because an annotation alone is
not read. MEASURED on the owner's own home: `notion`'s cursor stood 11.4 days behind, and every answer for
eleven days printed
`notion [stale] … newest record is 11.4d old (> 7d)` on stderr and answered anyway. The signal was correct
and nobody read it, which is the same outcome as no signal.

So the two thresholds differ in KIND, not just in size:

- **`STALE_AFTER_DAYS` (7)** only annotates. It is the reader's fact, not a policy.
- **`REFUSE_AFTER_DAYS` (14)** stops the query. Fourteen days is the owner's own framing of the gap —
  not knowing whether the last couple of weeks of activity are even there — and deliberately twice the
  reporting threshold, so a merely quiet week is annotated and a fortnight of silence stops answering.

**The two thresholds also read DIFFERENT FIELDS, and that is the load-bearing half.** The annotation ages
`newestIso`, correctly: it is telling a reader how old the evidence is. The refusal ages the stored
**cursor**, because age POLICY is a claim about whether the world was looked at, and only the cursor makes
that claim. The two come apart in both directions, and each direction is a real ingest behaviour:

- a run that could not see its whole window — `--sample`, `--fetch-cap`, or a connector-reported gap — WRITES
  what arrived and deliberately HOLDS the cursor (`ingestSource.shouldHoldCursor`). Judging `newestIso` there
  would let one row from a knowingly incomplete run reset the clock for a fortnight.
- a run that saw the whole window and found NOTHING advances the cursor to the window end without producing a
  record. Judging `newestIso` there would refuse a quiet-but-checked source permanently, and no amount of
  refreshing could clear it.

Both were named by an adversarial Codex pre-mortem over this design (`codex plan --pass p3`, verdict BLOCKED) and both were then verified against this repository's own ingest code rather than taken on
trust.

**The refusal's command carries no `--since`,** for the same family of reason: an explicit `--since` overrides
the stored cursor and, in org mode, the per-repo cursors underneath it, so a `--since` pinned past a HELD
cursor would step over the exact interval the refusal is reporting and then advance past it. A bare
`--source <s>` resumes from the cursor and is always correct.

**A leg only refuses if `refresh` is what would fix it.** `absent` legs, legs with no cursor or an unparseable one,
`gold`, a flat `--corpus` root and every cursorless source are excluded by construction
(`isRefreshableLeg` = `BRONZE_SOURCES` minus `CURSORLESS_SOURCES`). Measured: the `self` leg — the owner's own writing, scanned off disk only when `refresh --self`
is typed — stood at **26.4 days** old while every other leg was inside a day, so a naive age test would have
refused every query on a corpus that was in fact current, naming a command that would not have fixed it.
`chatgpt` is the other cursorless leg: each refresh re-reads the owner's newest downloaded export whole, so its age
is when the owner last exported, which no `refresh` can move.

Judging the cursor also excludes those legs a second way — a cursorless source has no cursor to be old —
which is why a seeded demo home, whose records carry fixed June dates and whose sources have never been
refreshed, never refuses either.

Every answer's coverage line also carries the leg's stored resume **cursor**, so a claim states the
watermark it was composed over rather than leaving a reader to go and read `corpus/watermarks/`.

## The just-in-time gate: when a question WAITS rather than answering or refusing

The two thresholds above are both about a corpus that has gone quiet for DAYS. Neither answers the owner's actual
requirement: if something in the last few hours could change a question's answer significantly, wait for the
just-in-time refresh to finish first. Fourteen days does not fire on an afternoon, and seven days only annotates.

So the turn runs a third test, `src/retrieval/justInTime.ts`, and it has two halves that must BOTH hold:

- **(i) the question is about a MOVING TARGET** — it carries a recency marker (today, latest, current, still,
  since) or asks STATE rather than HISTORY. "What is the status of" and "who owns" ask what is true now; "why
  did we" and "what did we decide" ask what was true then, and a decision made in June does not change
  because Notion moved this afternoon. A recency marker OUTRANKS a history phrase in the same sentence.
- **(ii) a source that is actually BEHIND is one this question's retrieval DRAWS ON.** Free, and the half that
  stops the first from making everything wait: the selection has already run by the time a slice exists, so
  the sources of the slice are observed rather than guessed. A question answered entirely from
  GitHub never waits for Notion, however recency-marked it is. "Behind" here judges the stored cursor past
  `BEHIND_AFTER_MINUTES` (four hours — the same span a scheduled `--if-stale` tick can ask for), not the
  seven- or fourteen-day thresholds.

**Why the selection is the right judge, and the hole that leaves.** Any other relevance test is a guess about
what a question is "about"; the selection is the same one that will produce the evidence, so a source
contributing nothing to it cannot change what gets said. The hole, stated rather than discovered later: **a source
that is behind AND would have contributed had it been fresh is invisible to this test, because retrieval
cannot select records that are not there.** It is not closeable from inside a query — closing it would mean
fetching the thing whose relevance is being decided. The SCHEDULED slot is what bounds it; this gate is the
second line. That sentence is on the CARD (`src/live/turn/freshnessCard.ts`), not only here, because a caveat
only a source file carries is one the reader of the answer never sees.

**A WAIT is a refusal with card copy, not a spawned refresh.** The turn writes no brief, prints why, prints
the exact `slopweaver refresh --jit --source <s>` (no `--since`, same reason as above) and prints the two
lines the turn must post through `turn status` FIRST — because a wait the reader is not told about is a bot
that looks broken, which is the whole UX half of the ruling. The visible session performs the wait; nothing
headless is started. `--stale-ok` waives the gate, exactly as it waives the fourteen-day refusal.

**The estimate is measured, never invented.** Per-source floors, measured (reproduce one with
`time slopweaver refresh --source <source>` over a corpus already current): gmail 8s, github 57s, linear
6m 06s, slack 17m 34s, notion over 40 minutes. Notion's is a lower bound with no measured upper one, so it
renders "at least 40 min" rather than "about"; a source the pass never timed (`calendar`) falls to that same
unbounded floor rather than borrowing an optimistic number from a sibling.

**EVERY refresh takes a per-source refresh slot**, and it is `src/lib/loadSlots.ts`'s lock with a different
directory and a limit of one — pid-owned, liveness-probed, no release path to forget, taken by one exclusive
rename, and a refusal that names the holder. Two callers wanting the same afternoon therefore start ONE backfill
rather than two racing on one resume cursor; the second is dropped from that run with a line naming the pid. A
slot that cannot be taken at all drops its source too, with a line naming why — never a fetch without it.

**The owner's ruling is the scope**, and it is wider than `--jit`: corpus refresh needs a lock IN GENERAL, not
only for just-in-time refresh, because two refreshes running at once is undefined behaviour. So a hand-run `refresh`, the
scheduled `--if-stale` tick and a `--jit` wait all take it, and `--jit` decides only which remedy the
refusal names. A run whose sources were ALL dropped fetched nothing, so it exits 4 (`EXIT_DEFERRED`) rather
than reporting a success it did not have: the same run is correct once the holder finishes, so a scheduled
`resync-corpus-<source>` gives its slot back instead of cooling and holding the row.

**What keeps bronze current is `slopweaver refresh --if-stale`** — the cron-safe entry point. It reads each selected source's cursor first and refreshes only the ones past
`--stale-after` (a duration with a unit — `30m`, `4h`, `7d` — defaulting to 7d, the same age the query path
annotates at, so the two cannot drift into meaning different ages). A tick over a current corpus costs one file read per source and exits.

It never WIDENS a selection, so the scheduled command has to be spelled in full —
`slopweaver refresh --if-stale --all-sources --source gmail --source calendar`. A BARE `--if-stale` is
REFUSED rather than run:
alone it would inherit `refresh`'s implicit GitHub default and leave every other source ageing while
reporting success, and the mailbox and the diary are both excluded even from `--all-sources` because each is one person's private
correspondence.

**`derive` does not refuse at the heap ceiling.** It reads the `derive` projection rather than `bronze`,
which drops record bodies and all but four `raw` scalars — 80.8% of bronze's bytes, none of which silver
reads wholesale. On an 8,083 MiB corpus that needs ~16,231 MiB read whole, the verb completes in
46 seconds. `src/__tests__/unit/corpus/deriveProjection.test.ts` asserts every silver artefact is identical
under both projections, and it goes red if the projection stops precomputing the one boolean it derives from
the text it drops.

## The one row deliberately NOT converted to a refusal

The main-checkout-behind check stays a report, never a refusal for verbs that read it for correctness.
`src/checkouts/freshness.ts` records the ruling in its own header: _"No daemon, no auto-rebase, no
refusal on any drift — the owner ruled that overkill explicitly, and the reason is that a drifted base is
often FINE: it only matters when the change depends on something the newer base carries."_ Converting that row
would reverse a standing owner ruling, which is not a change to make inside an implementation PR. The check
stays loud where it already is (`handover list` prints "N commit(s) behind. Pull before trusting any verdict
above."), and the question of whether any verb should hard-refuse on it is the owner's to settle.
