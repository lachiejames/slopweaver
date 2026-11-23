# Where the register lives, and how to get it back

The detail behind [the knowledge skill](../SKILL.md) § "Where it lives". Read it when you need to know which
database a write lands in, what a settle needs to be reachable, or how to rebuild the register from a file.

## One register, one store

Every knowledge verb reads and writes the `memories` table: `record` and `remember` write it, `recall`,
`list` and `quiz` read it, `export` and `restore` carry it out and back. `SLOPWEAVER_STORE_URL` names the
database, or the selection remembered under `$SLOPWEAVER_HOME/secrets` does — nothing here defaults one, and
every verb exits non-zero rather than writing somewhere else ([docs/store/overview-and-local-stack.md](../../../docs/store/overview-and-local-stack.md)).

**So `handover settle` and `handover finish` need the store reachable**, on any run that was STARTED. That is
the fleet-wide consequence of one register in the store, stated rather than left to be discovered: the
lesson gate reads this table, an unreachable one REFUSES with the database's own reason, and
`SLOPWEAVER_ALLOW_NO_LESSONS=1` is the way past a genuine outage — loud, and journalled as `forced`. A
`--lessons none` does NOT pass during an outage, because nothing could check the claim that the run learned
nothing.

The store is LOCAL, a Postgres on this machine, so this adds no provider to any path —
rule 3 has nothing to route.

## The append-only lessons file, and how to bring it in

`$SLOPWEAVER_HOME/knowledge/lessons.jsonl` is not the register. **No verb in this tree writes it — this
MACHINE can**, and knowing which is the difference between a two-minute import and a session spent hunting a
writer that is not there. `slopweaver` is a shell function that runs
`$(git rev-parse --show-toplevel)/bin/slopweaver`, so a session gets the CLI in ITS OWN checkout, and a
worktree whose HEAD predates the removal of the `knowledge/store.ts` module still carries it, and its
`appendFileSync` writes the file and never touches the table. MEASURED: seven of 89
worktrees under the ignored worktree root predated that removal, the file's last two lines were recent,
and neither claim was in the table. The one-liner that names which worktrees is in
`src/knowledge/lessonsDrift.ts`'s file overview, beside the measurement.

Nothing new can reach that code, so the file is a **straggler inbox** rather than a bug to close, and
`knowledge record` says so: when the file holds more importable lines than the table holds import keys plus
the keys `knowledge prune` retired into `knowledge/pruned/` (a pruned line is retired, never re-imported) it
prints the shortfall and the exact apply below (`src/knowledge/lessonsDrift.ts`). It is a notice and not a
gate — a lesson write is never refused because that file drifted. The file is kept because the rows it
holds were paid for, and one verb brings them in:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge import-lessons --file <path> --dry-run   # the preview
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge import-lessons --file <path> --apply     # the cut
```

The import key is the LINE's own digest plus its physical line number, so a file that has GROWN since the
last apply imports only what was appended — the keys of the rows already in the table do not move. A key
in a prune archive counts as applied. An accounted key (in the table or an archive) AFTER an absent one is a hole, which an append-only file never produces, and the apply refuses rather
than guessing.

`--rekey` is the one-off for a table imported under a WHOLE-file digest key, which goes stale for every row
the moment one line is appended. It rewrites each stored key onto the per-line
scheme after checking that the row's claim really is the claim on the line its key names, and one mismatch
abandons the whole rewrite. Measured on one install: 1,060 rows rekeyed, after which the apply
wrote the 37 lines appended since and nothing else. Two of the table's columns have no source in that file (`behaviour_change`, `retrieval_cue`),
and so does `learner` for any row but one the OWNER holds; they import as NULL, because inventing them would put a
fabricated fact into a register whose only value is that what it says was observed.

## The recovery leg

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge export --out <path>     # the recovery leg
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge restore --file <path>   # into an EMPTY table
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge restore --file <path> --merge   # into a live one
```

A paid-for observation cannot be fetched again from a provider the way content can, so the table owes a
readable copy that depends on nothing but the file it writes — independent of the nightly backup leg
(`slopweaver store backup`, which carries `knowledge/` in its files leg ahead of the database), because that
one does not cover the case where the store itself is what you are rebuilding from. Both files are decoded
before anything is written, and both tables go in one transaction, so a bad ledger line writes nothing.

By default `restore` refuses a non-empty table: recovery into a fresh database keeps every `seq` verbatim.
`--merge` adds an export to a live database, all or nothing (`src/knowledge/restoreMerge.ts`):

- **A row already held identically** is skipped. "Identically" means column for column, bar `seq` and the
  generated `searchable`.
- **These refuse the whole merge**:
  - a held row that differs;
  - an import key another recording holds;
  - a duplicate key inside the export;
  - a `supersedes` or recall that links to nothing, or a recall linking to a recording of another claim.
- **Inserted rows are renumbered** above the live `seq`, in the export's own order. Timestamps are kept
  verbatim.

Either mode locks both tables for its transaction, asking WITHOUT waiting: while another session is writing
one, the restore rolls back holding nothing and asks again, about five seconds of asks before it refuses
`RESTORE_LOCK_BUSY` — so it never deadlocks with a two-table writer;
`src/__tests__/integration/knowledgeRestoreStore.test.ts` proves that back-off on a real Postgres (opt-in).
All-or-nothing covers rows, not sequences: Postgres never rolls back a `setval`, so a failed restore can
leave a gap in `seq`, never a collision — stated from Postgres's contract, not induced by a test. A
connection lost at COMMIT leaves the outcome unknown to the client, so a `DATABASE_FAILED` there may sit
beside rows that landed; `--merge` again is the recovery, skipping every row already held.

## An install's own domains

The committed vocabulary (`src/knowledge/domains.ts`) holds only the generic domains and every atlas platform.
A domain naming this installation's own repository, systems or processes is a name of the installation, so it
lives in the installation's store (`knowledge_domain`), never git (AGENTS.md § no organisation names). A home that
predates the store has its `knowledge/domains.json` imported once, on the first domain read, and never read again.
Add one:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge domains add --slug <slug> --holds "<what it holds>" \
  [--alias <from>=<to> ...] [--home <dir>] [--json]
```

`--alias` names a retired spelling and the domain it folds into, which may be the new domain or a committed
one. An add may only ADD: it refuses a slug or alias the store already holds, a committed domain or atlas
platform, an alias that is itself a domain or re-points a committed alias, and an alias folding into no domain.
Every row of one add goes in one transaction that commits only if none of its slugs was taken meanwhile; a
lost race is `KNOWLEDGE_DOMAIN_ADD_CONFLICT`, nothing written, and is not retried — run the add again. A store
that cannot answer refuses every domain-checked verb; there is no file to fall back on.

`knowledge domains` lists the install's own marked `(install)` (and under `install` in `--json`). No rows
means the install adds nothing. A retired file that will not import is `KNOWLEDGE_DOMAIN_IMPORT_UNREADABLE` or
`_INVALID`, and stored rows that would redefine a committed domain are `KNOWLEDGE_DOMAIN_ROWS_INVALID`: each
refuses every domain-checked verb rather than reading as empty. A slug no vocabulary holds is
`DOMAIN_NOT_CONFIGURED`, naming this verb and the home to add it under. `record`, `propose`, `prune`, `domains`
and `store rehearse` read the store of their `--home`; `remember` and `trace` take no `--home` and read the
ambient home's, the same one their store connection uses.

## Folding a restored or imported table onto the closed vocabulary

`restore` and `import-lessons` never consult the closed vocabulary, and neither does a `recalled` regrade,
which copies its claim's domain: a backup restores what was. `knowledge domains --migrate` then plans the fold of every retired spelling onto its canonical
domain; `--apply` rewrites, in one transaction, each moved claim's domain AND id (the id hashes the domain),
every `supersedes` naming it and every recall of it. It refuses while any stored domain is unmapped. Take a
`knowledge export` first — it is the undo.
