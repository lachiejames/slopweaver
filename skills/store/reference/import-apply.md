# Applying a staged import — `store import --apply`

The last step of an import ([import and export](import-export.md) covers the export, the check, the plan and
staging). Nothing staged or answered is live until this runs.

```bash
slopweaver store import --apply <batch-id> [--stop-on-conflict] [--home <dir>] [--json]
```

It reads no export: the batch id is the one `--approve` printed, and every imported row it writes comes from the
staged rows; beside them its own statements write only what applying derives — a live row retired or withdrawn, a
revision, a journal position, and the receipt. An instant a replaced standing ask cannot record is refused before anything is read
(`IMPORT_INSTANT_INVALID`). Next the batch's receipt is looked for, in a short read of its own: a batch already
applied reports `already-applied` and nothing else runs, so a re-run after a commit of unknown outcome finds the
receipt whatever the home files now hold. Otherwise, before the transaction, each register's one-time import of its
legacy home file runs,
as before an export, each in its own transaction: those stand whatever the apply then does, so a refused apply can
leave that one-time migration committed. It writes only what the home file holds, never from the batch; a home-file
row equal to one the batch carries stands as the home's, and the batch, re-planned over it, may refuse as stale.
Inside ONE transaction
(`src/store/transfer/importApply.ts`), in this order, it locks the batch row so two applies of one batch serialise,
then every staging table and every register, so no guard can be disabled or dropped and no answer can change until
it commits (a guard's function body is database code, trusted as below); checks every
staging guard and the steer measurements' append-only guards are present and enabled; reads the receipt, and on
finding one returns `already-applied` there, writing nothing; otherwise refuses a replica-mode session
(`IMPORT_REPLICA_SESSION`); and
plans the batch AGAIN over the live store as that transaction sees it. Then, in this order, it refuses the whole
batch when:

- the fresh plan's comparison version, digest or questions are not the staged ones — the live store moved under a
  row, or a staged row is not the one planned (`IMPORT_BATCH_STALE`); the export is staged again instead;
- a row it would write has a need nothing live or written provides NOW (`IMPORT_DEPENDENCY_UNMET`): needs are judged
  on the fresh plan alone, so one met since staging no longer refuses;
- `--stop-on-conflict` was given and any append-only row differs (`IMPORT_APPEND_ONLY_CONFLICT`);
- an activation or conflict question is unanswered (`IMPORT_QUESTIONS_OPEN`, naming each).

Two refusals are DAMAGE to what staging wrote, never an owner decision, and no answer clears them: a staged row
that no longer decodes under its own register's schema (`IMPORT_STAGED_PAYLOAD_INVALID`, naming the part and row),
and a batch whose rows, questions or answers name something it does not hold (`IMPORT_STAGED_BATCH_INCOMPLETE`).
None of its rows is applied and the batch is left as it is. No verb repairs one: staging the same export again meets the
damaged batch and is refused (`IMPORT_BATCH_MISMATCH`), and a batch is removable only whole and only while nobody
has answered it ([import and export](import-export.md)), so a damaged batch holding an answer stays until the
store itself is repaired.

Every command the apply prints to paste — an `import-resolve` that acknowledges a difference, the `--apply` to run
again after a commit of unknown outcome — names the home it used, made absolute, whether `--home` or `$SLOPWEAVER_HOME` chose
it, and even when it is the user's default (a hint written with placeholders, such as `--from <dir>`, is not one): a bare command selects its home from the shell it is pasted into, so
the named home keeps it on the same home from any directory. The store is that home's unless the shell sets
`SLOPWEAVER_STORE_URL`, which wins over any home, and a connection string carries a password, so no printed command
names the store's (the home is printed in full): paste it into zsh or bash, whose `$'…'` quoting keeps a home
holding a control character on one line, each written as its UTF-8 bytes so any locale reads it back, in a shell whose `SLOPWEAVER_STORE_URL` is as the apply's was — unset if it was unset, the same
URL if it was set. When the apply's store came from that variable, it says so under the commands it printed.

Otherwise it writes each register through its own writer, in dependency order, then makes every check deferred to
commit fire at once (`set constraints all immediate`), so a deferred trigger acts before the read and not after it,
the receipt's own insert included. The last write is a receipt (`store_import_application`) counting every row
written, read back as written; a second apply of the batch finds it and writes nothing. Only then does it read the
store back inside the same transaction (`src/store/transfer/importApplyReadBack.ts`): the batch decided once more must
write nothing, and every instruction written, active or inactive (the store's read never shows an inactive one), must
be found under its own id, in the state written, under the question that admitted it. So an imported row a trigger,
rule or policy outside the migrations dropped without an error, or rewrote in a column the import compares, by the
time of that read — a trigger on the receipt's own insert included — refuses the batch.

Past those reads, code installed in the database is trusted, as it is for every writer, and so is a row a session
holding the store's owner role writes directly: a receipt is believed as found, so one inserted by hand makes the
batch read as `already-applied`. Every read before the writes, the receipt's first, trusts the store's row-security
policies to be the migrations' own: a row one hides from the store's role reads as absent, a receipt included. Not checked: what the apply derives beside the imported rows (a live row retired or
withdrawn, a journal position, a profile's revision), an id the store assigns, the content of an instruction written
inactive, a function a trigger runs, and any other table — so a trigger function that defers a check again, or
queues work for commit itself, is trusted too, since what runs at commit runs after every read the transaction can
make; and so is code a read itself runs, such as a row-security policy's function, that writes as it is read. A
failure inside the transaction rolls all of the batch back, the receipt included
(`IMPORT_APPLICATION_FAILED` names the register), and so does a commit the server refuses with a code that says it
rolled back (classes 22, 23 and P0, and 40001, 40002 and 40P01). A commit nobody answers, a connection dropped once
the body ran to its end, or one answered with any other code may have stood, so it is reported as unknown
(`IMPORT_COMMIT_UNCONFIRMED`), never as none of the batch written, followed by the one `--apply` command, naming the
same home and carrying `--stop-on-conflict` when the apply did, to run again: it finds the receipt and reports
`already-applied` if the commit stood, and otherwise tries the batch again, which a commit that fails the same way
every time fails again. An apply that found the receipt already there wrote none of the batch, so it reports
`already-applied` however its own commit ends; `writes` never counts the home-file migration, which any apply that did not find the receipt first may run. What each row writes:

- a row the store holds identically, nothing; a new record or measurement, as it is;
- a restored instruction, in the state its activation answer gave it — `leave-inactive` lands inactive;
- a conflict answered `take-imported`, the imported row over what it meets: a directive retires its live version,
  a standing ask withdraws every live ask it meets; `keep-current`, nothing;
- an append-only row that differs, nothing: the live row stands, and the report lists each difference with its
  alignment question, whether it was acknowledged, and both lines; one not yet acknowledged also prints the
  `store import-resolve --question <id> --action keep-current` that acknowledges it. An alignment is reported,
  never waited on.

Three owner rulings bind this, and the shape above is how each holds:

- **A restored standing instruction is not active on import.** The import ASKS before it imports, and on the
  answer it takes effect immediately afterwards.
- **An old instruction that conflicts with a current preference is never resolved by assumption.** Every conflict
  is a question showing both sides, listed on the Queue until answered, and an apply waits for it.
- **Imported rows land in the store, never under a home directory.** Steer verdicts are measurements and come over
  as history, with no activation question.

One register is not yet whole: the owner's judgement profile lands in `owner_profile`, while a live turn still
reads it from the home file (`src/live/turn/judgementProfileStore.ts`), so an imported judgement profile does not
reach a turn until that read moves into the store.
