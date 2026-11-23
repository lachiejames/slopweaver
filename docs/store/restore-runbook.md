# Restoring the store, and rehearsing it without touching the live one

There is ONE live database: `postgres` in the `supabase_db_slopweaver` container, on `127.0.0.1:55322`. A
backup nobody has restored is a hope, and testing one by restoring it next to that database is exactly how
data gets lost: the owner's concern is that big changes made against the live database could delete data that
cannot be got back. So the rehearsal restores into a Postgres server
of its own, and it is refused rather than warned when anything about it points at the live one.

What a backup holds and how it is written: [the backup](backup.md), [its objects](backup-objects.md). Every
step below reads the FIRST destination on the list `store backup` resolves (`--destination <dir>` names
another, such as the SSD when the first is this Mac's own folder), through the backup key unwrapped from the wrap beside
the chosen backup under the master password ([the wrap](backup-key-and-vault.md#the-master-password-wraps-the-key)),
never the Keychain. The rehearsal reads that password from `secrets/backup-passphrase`; restore and recover ask
for it once. With no password set, or no wrap at the destination, the read refuses naming
`slopweaver store backup --create-master-password`.

## Rehearse: prove the newest backup restores

```bash
slopweaver store rehearse
```

In order, and every step before the first download is a refusal point:

1. **Reads what the live store is**: the database and port from the store selection, and the image ID and
   data-directory mounts of `supabase_db_slopweaver` from `docker inspect`.
2. **Refuses a target that is any of it**: the database name `postgres`, the port `55322`, or any
   `supabase_*_slopweaver` container. It also refuses if a container already has the throwaway's name,
   because the rehearsal never stops, adopts or removes a container it did not start.
3. **Picks the newest backup**: the lexically greatest `slopweaver/<instant>/` at the destination that has a
   `manifest.json`. It reads the manifest's key fingerprint, unwraps that key's wrap with the master password,
   decrypts the manifest, `storage.tar`, `files.json`, the dump and `vault.enc`, and checks every payload
   against the manifest's SHA-256. No password or no wrap fails the run here, after the target guard.
4. **Checks the legs that are not the database.**
   - `storage.tar` must list as a tar.
   - A manifest that records no Vault leg fails the rehearsal. A backup with no Vault in it is a backup
     that loses Vault's secrets.
   - The destination must hold every blob and chunk that `files.json` names. That check reads the
     destination listing only:
     - A whole blob or an uncompressed chunk must be exactly its recorded length.
     - A `zstd` chunk must only be non-empty, because its compressed length is not recorded. A truncated
       one passes.
     - No blob is decrypted or hashed, and the manifest carries no digest of `files.json`, so a same-length
       corrupt object passes too.
5. **Starts a throwaway**:
   `docker run --detach --rm --name slopweaver_rehearsal_db --publish 127.0.0.1:55422:5432 --env POSTGRES_PASSWORD <live image ID>`.
   The per-run password reaches docker through the client's environment, so it is never in a process argv. It has no volume and no bind mount, so its data lives only in the container's own writable layer. Docker
   is then asked what it actually mounted, and a single mount of any kind stops the throwaway before anything
   is restored.
6. **Restores into it**, with every command a `docker exec` into the throwaway's own container:
   - `createdb slopweaver_rehearsal`;
   - the store's three roles (the dump cannot carry them, [the backup](backup.md) says why);
   - the manifest's extensions;
   - `pg_restore --exit-on-error`;
   - the Vault rows through `vault.create_secret`, then counted against the manifest.
7. **Verifies the copy against live**, with live opened `default_transaction_read_only=on` and the server
   asked to confirm it before any query runs:
   - **Schema.** One line per relation, column, constraint, index, view, sequence, function, trigger,
     policy, enum, domain and extension across `public`, `drizzle` and `storage`. Every line must match once
     the nested AND chains of each column, constraint, index, policy and trigger line are flattened
     (`src/store/backup/flattenAndChains.ts`; an enum's raw labels never are): a `BETWEEN` is
     stored as a nested AND that `pg_restore`'s re-parse flattens, so the same constraint prints one level
     shallower in the copy. Nothing else is normalised — an OR, a `NOT`, a cast or a changed operand still
     differs.
   - **Row counts per table.** Live has kept moving since the dump, so a count that differs is checked
     against live's count up to the copy's own newest insertion time:
     - `equal` means the two counts match.
     - `reconciled` means live's count up to that point matches the copy.
     - `drifted` is reported but does not fail the run.
     - `missing` (a table only one side has) fails it.
   - **The newest rows, byte-equal.** For each table with a primary key, the newest 5 rows' `t::text` is
     hashed on both sides. A row that differs is judged by what live can say about it:
     - `changed-after-backup`: a timestamp on the live row is later than the dump. It does not fail.
     - `untracked-change`: the table has no column a rewrite bumps (`updated_at`, `loaded_at`, `last_*_at`
       and the like), so live cannot say. It is listed by key and does not fail. `public.content` is one:
       its loader rewrites a review comment in place when the thread is resolved.
     - `different`: the table has such a column and it says the row was not touched. It fails.

     The limits of that check:
     - A table with no primary key, or with no rows in the copy, is listed as unsampled, with the reason, and
       does not fail the run.
     - The run fails if the sample matched no row at all.
     - Older rows are covered by the counts only, never compared byte for byte.
8. **Stops the throwaway** by the container ID it started. `--rm` discards that container's layer and
   nothing else.
9. **Records the result**: writes `backups/store/rehearsal/last.json`, then files one knowledge row
   (domain `store`, verdict `confirmed` or `refuted`, with the numbers).

It exits 0 when the rehearsal passes, 1 when it fails or could not run, and 2 when it refuses the target.

### What passing the wrong name does

```bash
slopweaver store rehearse --into postgres --port 55322 --container supabase_db_slopweaver
```

```text
store rehearse: refused before anything ran — the rehearsal target collides with the LIVE store: --into postgres is the live store's database name (port 55322); --port 55322 is the live store's port; --container supabase_db_slopweaver is a container of the live Supabase stack. A rehearsal restores into a throwaway Postgres of its own and never into the one live database.
```

It exits 2. Nothing is downloaded, no container is started and no `last.json` or knowledge row is written.
Any one of the three flags alone is refused the same way. Three guards keep the rehearsal off the live
database even past the refusal:

- A target can only be made by the refusing constructor (`src/store/backup/rehearsalTarget.ts`).
- Every command it writes with names the throwaway's container.
- The live connection is read-only on the server side.

### Look at the copy by hand

```bash
slopweaver store rehearse --keep
docker exec -it slopweaver_rehearsal_db psql -U postgres -d slopweaver_rehearsal
docker stop slopweaver_rehearsal_db   # --rm: stopping it discards it
```

`--keep` leaves the throwaway running on `127.0.0.1:55422`. The next rehearsal refuses to start until it is
stopped, because the container name is taken.

- **Choose the throwaway:** `--into <db>`, `--port <n>` and `--container <name>` are checked against live
  exactly like the defaults.
- **Rehearse a specific backup:** `--from slopweaver/<instant>/`.
- **Rehearse another destination:** `--destination <dir>`, resolved exactly as `store backup` resolves it.
- **Sample size:** `--sample-size <n>` sets how many rows per table are compared.
- **Skip the knowledge row:** `--no-record`.

### What it leaves on disk, and what it deletes

**It deletes only copies it can fetch again.** Two things are removed:

- the throwaway container's own layer, discarded when it stops;
- an earlier retrieval of the same backup's dump, removed just before a fresh copy of the same object
  replaces it.

The decrypted copy stays under `$SLOPWEAVER_HOME/backups/store/retrieved/<prefix, slashes as _>/` (for
example `retrieved/slopweaver_2001-01-01T00-00-00-000Z/`), about 2 GB per backup. A second run of the same
prefix, or a hand `store restore --from <destination>/<prefix>` of it, retrieves into that same directory
again, so one prefix never holds two copies. Nothing prunes other prefixes. Remove old ones by hand when the
disk needs it.

`secrets.enc` is neither fetched nor opened, so the rehearsal never writes a decrypted credential anywhere,
even though it holds the master password that would open it. Rehearse it by hand with
`store restore --from <destination>/<prefix> --into <db> --secrets-into <dir>`.

## The schedule, and the card

The monthly rehearsal is a **standing row**, `store-restore-rehearsal-monthly`:

- It runs `store rehearse` at 04:00 on the 1st, an hour after the 03:00 nightly backup.
- `onMissed: backfill` means a machine that was off on the 1st catches up on its next tick.

This build declares the row. If it goes missing, `automation due` lists it as missing, and this writes it
back:

```bash
slopweaver automation register-standing
```

That writes the generic rows plus each team repository's rows registered in
`live/recipe/team-repositories.json`, so a restored home declares exactly the team rows it was registered for and
a fresh home declares none ([team repository rows](../../skills/automation/reference/team-repository-rows.md)).

It raises a card **only when a rehearsal fails.** The `store-rehearsal-failed` monitor reads `last.json`:

- A failed record posts one card: _"Decide the fix for the store backup — its restore rehearsal failed"_.
- A passed record is clear.
- No record at all is `unmeasurable`.

A rehearsal that stops _running_ is `recipe-stopped`'s card, not this one's.

`last.json` holds only the LATEST run, so a hand run overwrites a scheduled failure. The scheduled firing's
own reason survives on its slot record and its finding: a failed `automation run-due` attempt ends its `detail` with
the verb's closing stderr lines (`· why: …`), and a firing retired dead keeps it as `failureCause` on its run stamp,
[exactly once](../../skills/automation/reference/exactly-once.md).

## Restoring for real

The rehearsal proves a backup restores. **A whole machine** — the store, the files, the credentials and the
board, into one home — is `slopweaver store recover --destination <dir>`, one command after `yarn store:start`
and the master password pasted once ([a new machine](new-machine.md#the-recovery-in-order)). Recovering
only the store is `store restore`, which writes into the LIVE stack and is written for a machine whose store
is gone or being rebuilt:

```bash
slopweaver store backup --status                         # the newest written prefix
slopweaver store restore --from <destination>/slopweaver/<instant> --into store_recovered --compare
slopweaver store restore --from <destination>/slopweaver/<instant> --into store_recovered \
  --files-into <dir> --secrets-into <dir>                # the files and the credentials, same backup
```

`--into` refuses a database that already holds a store, so it cannot write over `postgres`. To point the
store at the recovered database, run `slopweaver secrets set store-url --stdin` with its connection string. On a
locked stack that is the lock's own login with only the database name changed, because `postgres:postgres` is
refused from the Mac ([the local lock](../../skills/store/reference/local-lock.md)). Then run `slopweaver store
lock`, which revokes the API roles' rights in that database.
Unpacking Storage objects over the live volume needs `--storage --overwrite-storage` (the
`restore-overwrites-storage` hatch). [The backup](backup.md) § Restoring has the details.

## What a run costs

MEASURED against one `slopweaver/<instant>/` backup, a 1,975,919,638-byte dump. The
`pg_restore` into the throwaway took 1231 and 1305 seconds on two runs, and the retrieved copy was about 2 GB. Each
run's own numbers are in its knowledge row (`slopweaver knowledge list --domain store --run store-restore-rehearsal-monthly`; a run appends
under the same id as the last, so the newest entry is the current verdict) and in `last.json`. To reproduce:
`slopweaver store rehearse`.
