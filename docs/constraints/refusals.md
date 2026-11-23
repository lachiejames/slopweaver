# What the corpus may refuse to hold

Part of [Design constraints](../constraints.md).

**A junk AUTHOR may be excluded from the SYNC, and never from a live read.** That is the owner's ruling, and
the two halves are one decision rather than a rule with an exception.

Measured on this install when the owner ruled: one Slack app had written **999,981 records — 45.2% of every
Slack record and 63.2% of all corpus bytes** — carrying 23,692 distinct alert signatures between them, of
which the top 20 were half the million. It was dead: 999,801 of them landed in a three-month burst that was
switched off, leaving 180 records in all of 2026. The platform that emitted them still answers about them
live, through a door this install already has. The owner's reason: those records add nothing, because the
information is already in Datadog and the owner and the fleet have better ways of searching it there. The owner's
stated limit in the same ruling is what bounds this — junk may go, and data integrity still matters, so no human record is
ever taken with the alerts.

**The unit of a denial is a `(bot app, channel)` PAIR, and an author ban was measurably too blunt.** The owner
took the session's recommendation on a page measured over the 2,136,908-row store.
The same Datadog app is **99.8%** of `#monitor-feed` and **14.1%** of `#sync-alerts`, where
1,381 human rows are the actual conversation, so a bare author ban took **7,968 rows across 32 other
channels**. An entry may name a scope — `<id> @ <channel>` — and a bare `<id>` still denies everywhere.
The threshold that separates those two channels is the same one the detector uses, and it is not a tuning
surface: holding the share at 95% and moving the row floor, 100 finds 20 pairs, 500 finds 16, 2,000 finds 10.

**Rule D: a denied alert humans replied under is kept, at INGEST and by the PURGE alike.** The owner first
deferred rule D out of the quick win and had every existing such record deleted retroactively,
so that retroactive delete took all 1,068,650 rows the scope selected, the 4,251 rule-D rows among
them. **What that cost is measured, not hypothetical: 1,478 of the 1,503 human replies in
`#monitor-feed` now sit in the store with no parent alert.** Repro:

```sql
select count(*) from content_slack cs
where cs.channel_name = '#monitor-feed' and not cs.is_bot and cs.thread_ts is not null
  and not exists (select 1 from content_slack r
                  where r.channel_id = cs.channel_id and r.message_ts = cs.thread_ts);
```

So the purge honours the rule and `store exclusions purge --delete-human-threads` is the waiver that
reproduces that retroactive run; bronze is what makes either direction reversible. The measurement that earned the
rule back: `#monitor-feed` holds 1,505 human rows, of which
**1,503 are thread replies** in 424 threads spanning fourteen months — production incidents being
diagnosed — and only 2 are top-level channel messages. Keeping the alert that STARTED such a thread costs
**42 rows** and is what stops a reply being an orphan. A streaming caller cannot know this from one record,
so it DEFERS a denied in-thread row and settles it at end of file; the held set is bounded by how many
denied rows carry a `thread_ts` at all, measured at **471** across the whole store.

**The detector proposes; it never applies.** `slopweaver store exclusions detect` finds the pairs one app
dominates; it proposed sixteen, the quick win acted on two, and re-run against the store those
two left it names **fourteen holding 59,274 rows** — 43% of which arrived in the last thirty days, so the
set grows at about 851 rows a day whatever anyone decides. Which of them become denials is the owner's
call on the `account-for-human-chatter-in-bot-channels` row. A proposal becomes policy only when somebody writes its line into the denylist, and once written
it stays written however the channel's share drifts afterwards — a rule that recomputed itself every sync
would silently start indexing a channel the week it got busy, and nobody could say why the corpus changed.

**The live half is the part a future session will be tempted to "tidy".** The owner added it unprompted: a bot
tagged into a thread that cannot see what everyone else in it can see is a problem, so live reads keep Datadog's
messages and only the sync excludes them. So
`src/corpus/syncExclusion.ts` is reachable from ingest, the store and the corpus readers, and from nothing
under `src/live/`. That is asserted structurally by `unit/corpus/syncExclusion.test.ts` rather than left to
review, because a convention nobody can grep lasts until the next session.

**The ids live off-repo, at `$SLOPWEAVER_HOME/sync-author-denylist.txt`**, for the reason
`org-domains.txt` does: an entry names one workspace's own accounts, so it is per-install state and a
committed constant would be wrong for every other install ("tools in the codebase, state outside it"). The module ships the mechanism and names no id; an
install with no file excludes nothing, which is right for a fresh home. An UNREADABLE file refuses the run —
an index quietly rebuilt with the denylist off is indistinguishable from one built with it on until someone
notices the corpus grew by a million rows.

**It excludes at every WRITE, inside the boundary.** Bronze write, silver derive and both of the store's
entrances (`ingestJsonl` in `src/store/ingestJsonl.ts` and `ingestRecords` in `src/store/ingest.ts`) resolve the denylist themselves, so a
caller cannot be the one that forgets. Measured with a store entrance that did not: the fill put
**about a million** `#monitor-feed` rows into Postgres, six days after the owner said not to, and tens of thousands of Nightfall rows
followed the next day, the day that app was denylisted.

**An IDENTITY exclusion rides the same two entrances, and for the same reason.**
`$SLOPWEAVER_HOME/identity-exclusion.txt` names, one whole name per line, who no indexed answer may present
as a PERSON, and `src/corpus/identityExclusion.ts` is its mechanism (the owner's ruling). It is
a SCRUB rather than a verdict: a phantom attendee sits inside a real meeting whose transcript the owner
wants, so `scrubExcludedIdentities` narrows the record's roster between admission and projection instead of
dropping it, and DECREMENTS `attendeeCount` rather than assigning the survivors' length — that count
legitimately exceeds the stored roster on a meeting large enough to hit `MAX_STORED_ATTENDEES`, and
assigning would silently rewrite every such meeting's real size to the bound.

Both entrances resolve it, exactly as they do the author denylist, because a write path that never hears
of a list is the defect recorded above. Two things it deliberately is not: it is not
a decode-time filter, since `compact.ts` reads window files through the BRONZE projection and rewrites them,
so filtering there would silently edit the operator's own capture; and it carries no heuristic at all — the owner's
ruling is to exclude specific names a session is confident are low value, never to infer them.

**Bronze is never deleted, and that is what makes a store purge reversible.** An excluded author's historical
bronze rows stay on disk — on this install 5.4 GB the store does not hold. `slopweaver store exclusions
purge` removes what the denylist covers from the STORE, previewing by default and deleting only with
`--apply`, and re-ingesting the same bronze with the denylist line removed restores exactly what it took. A
denylist entry naming a USER id is reported as unresolved rather than acted on: a user reaches the store only
through a `person` row identity reconciliation may have merged with other handles, and deleting by that
would delete rows a different identity wrote.
