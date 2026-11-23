# Bronze, the store, and what each source holds

Part of [The local Supabase store](../store.md).

**The corpus keeps no semantic index and no locally-built lexical one**: `store read` and `store cite` select from the store's Postgres full text. `corpus/.cache/distil/batches.json`
is the distil batch cache `src/gold/distilCache.ts` reads, not an index.

## Bronze reaches the store, and the rows that never did

A record can sit in bronze forever and never reach the store. MEASURED: tens of thousands of rows stood in bronze that the store did not
hold, dominated by Slack, and replay materially increased the stored population. The finding that surfaced it was one Slack message:
`store detail` answered "the store has never held one" for a post that had been in
a Slack window file the whole time.

**The cause is two correct mechanisms composing into a permanent hole.** `refresh --store`
(`src/cli/commands/refresh/storeLeg.ts`) ingested only the window file that
run had just written. `corpusWriter.ts` dedups per `sourceId` against all existing bronze, so a record
that reached bronze in a run WITHOUT `--store` is deduped out of every later window file — and the leg,
which only ever reads the file this run wrote, can never see it again. Neither half is wrong alone. It is
**self-sealing**: the same dedup that makes the row permanent also makes a re-run look clean. Proven live
by the re-run printing `wrote 1 new, deduped 1178` and then `1 row(s) stored from 1 line(s)`.

**The answer is a seam, not a retry.** The `--store` leg's unit is the SOURCE, not the file:
`productionStoreIngest` plans that source's whole bronze through `planBronzeWindows`
(`src/store/bronzeWindows.ts`) and replays every window file. Steady-state cost, measured the same day:
slack under a minute over about a hundred thousand lines and some thirty window files, linear under a minute, github about fifteen seconds.

**`compact.jsonl` is deliberately NOT in that plan.** It is the canonical whole corpus — several GB
for slack alone — so replaying it on every refresh would put hours on a leg that has seconds. The
window files carry everything a refresh produced; `--full` reads the canonical file when somebody wants
the stronger claim, and every report says which one it made.

**Drift is REPORTED rather than discovered.** `slopweaver store status` measures it without being
asked: `missing = distinct native ids the pipeline would OFFER from the scanned bronze − the ids the store
holds`, per source, with the repair command on any non-zero line. Three properties are the design rather
than notes on it:

- **It reads through the loader's own pipeline.** Candidates come from `readSlice` and `projectAll` — the
  exact functions `ingestJsonl` calls — and rule D's deferral is released per FILE, as a whole-file ingest
  releases it. A drift report with its own reader would disagree with the loader the day either changed,
  silently, in the direction of claiming rows missing that the loader never meant to store.
- **A line-count subtraction cannot compute it**, which is why the probe exists: bronze lines include
  blanks, duplicate ids across window files, denylisted authors and refused rows, and the store holds rows
  no bronze file ever carried. Refusals and exclusions are counted and printed SEPARATELY, so a data-shape
  problem never reads as a loading problem.
- **The probe is an index scan, not a table scan.** `findPresentContentKeys`
  (`src/store/contentPresence.ts`) selects `source_id` alone off the `(source, source_id)` unique index, in
  batches of 2,000. MEASURED: 4.88s over all eight sources against 2.36s for the same verb
  without the scan (repro: `time slopweaver store status`), which is why it is default-on rather than a
  flag nobody would run. `--check` turns the same report into a gate by exiting 1 on any missing row; a
  bare `status` stays exit 0, because failing every existing caller on a gap it did not ask about is a
  wider change than the one that found the gap.

**An unmeasurable scan never reads as a clean one.** Both filesystem failures are typed as
`BRONZE_UNREADABLE` rather than counted as zero, in both places one could be swallowed: an unreadable FILE
in `readSlice`, and an unlistable DIRECTORY in `jsonlStatsIn` (`src/corpus/bronzeStorage.ts`), whose lenient
reading treats "cannot be read" as "never ingested". The drift scan lists through `listProtectedBronzeFiles`
(`src/store/protectedBronze.ts`), which keeps the strict reading and the loader's read order; the compactor and
`audit` keep the lenient one, and a directory that genuinely does not exist is an empty scan under either. A scan failure is a printed `bronze drift: NOT MEASURED` line that changes the exit code
only under `--check`, so a plain `store status` stays exit 0 when one bronze file loses its permissions. Under `--json` the same failure is a `driftFailure` string beside
the `drift` array, because a reader seeing `drift: []` alone cannot tell a source with no gap from a source
the scan never managed to measure.

**Bronze the owner protected is never read, and never offered as a repair.** Before a source's directory is
listed, the scan reads the protect list of the home in use and of the account's default home, the pair the
`PreToolUse` guard reads, and refuses any directory at, under or above a `no-access` entry. It judges each
directory and file again as the walk meets it, under its lexical and resolved spellings, so a symlink into a
protected tree is refused before it is followed. Such a source prints `NOT SCANNED`, naming the entry and the
owner's reason, with no count and no repair line; `--json` lists it under `withheld`, and it does not fail
`--check`, because no session may lift it. A protect list that cannot be read scans nothing (`NOT MEASURED`),
which `--check` does fail. `store ingest` and `refresh --store` take the same refusal before the store is
opened, so the printed repair line cannot read the bronze either. The residue: judging and opening are
separate system calls, so a path swapped for a symlink between the two is not caught.

## The fathom source holds raw transcripts by speaker, and nothing else

The store keeps the raw verbatim transcript by speaker, never a summary. Every `fathom` row is one call's words as `[HH:MM:SS] Speaker: text` lines, keyed on the
recording id whichever way it came in — the API lane (`refresh --source fathom`, calls the owner recorded)
or a share page (`fathom share <url>`, calls somebody shared with the owner; `attrs.via = "share-page"`). No summary,
no action item, no text Fathom's model wrote: the API shape has no field for one, and the share read drops
Fathom's notes in the page and keeps only their count (`attrs.providerNotesDropped`). A recap MAIL stays
where it arrived, in the `gmail` source.

`fathom share` commits the recording-id row, removes every version of a hand-written `share:<token>` row
(one carrying `attrs.actionItems`) from bronze, and settles the store — retiring here (`src/store/contentRemoval.ts`) the `share:<token>` identity of EVERY
token bronze holds a verb-read transcript for, then replaying the source. An upsert alone never removes an
identity bronze no longer holds, and the replay is withheld until the last hand-written row is gone, so the
retire set is derived from bronze rather than from the one share just read. Check it:

```sql
select source_id, body like '%ACTION ITEM%' as provider_text from content where source = 'fathom';
```

## Still open

**Atlas media in Supabase STORAGE** — the Storage API is written through by the measurements ([§ "The
measurements"](fleet-state-and-measurements.md#the-measurements)), but atlas media is not: an atlas entity
carries pointers only. The DISASTER half is closed: `atlas` is a backed-up root ([§ "The backup, and what it
actually carries"](backup.md)), so the roughly 2 GB of PNG and PDF under it ride the nightly upload as
content-addressed blobs, withheld `_sensitive` companions excepted. `store read` and `store cite` read the
store and nothing else.

The **live store's state** is `slopweaver store status`, which reports the migration record alongside the
counts — measured, `migrations: current — 2 recorded, nothing pending` and `store verify: clean`
over 9 declared tables. Both numbers move with every landing — re-read them rather than quoting these. The
live `postgres` database carries the squashed journal's schema, reset rather than migrated; `store baseline` is in [§ "The lifecycle"](lifecycle-and-schema.md).
