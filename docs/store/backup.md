# The backup, and what it actually carries

Part of [The local Supabase store](../store.md).

`slopweaver store backup` is the backup leg. It writes every object, encrypted, to a **list of local
directories the install picks** (a local path rather than a cloud bucket; a list, local only). The usual pair is a
folder on this Mac for rollback and a pinned SSD for disaster recovery. Nothing goes to a cloud bucket. The list resolves like
every other per-install value and is never a constant:

1. `--destination <address>` replaces it with one address for one run;
2. otherwise `SLOPWEAVER_BACKUP_DIRECTORY`, the same;
3. otherwise the remembered `secrets/store-backup-directory`, one address per line in order.
   `--set-destination <address>` replaces it with one, `--add-destination <address>` appends one and
   `--remove-destination <address>` drops one, refusing to drop the last. A dropped destination is owed nothing
   more, so a staging it never got is released and pruned once the destinations still on the list hold it.

**A night is staged ONCE and sent to every destination in list order.** Each send goes through its own door,
writes its own key wrap, objects and receipt (`receipts/<id>.json` in the staging, where the id is 16 hex of the
root's SHA-256), and one destination that fails, throws or whose drive is out does not stop the next. A
one-run `--destination` never releases a staging the remembered list still owes.

An address is an absolute path or a `file://` URL. `s3://`, `gs://` and `drive://` are refused by name as not
built, and so is any other scheme; none is ever read as a path (local only until a
remote one is asked for). With none of the three set, the verb refuses and names all three. A relative path is
refused rather than resolved, because a scheduled run's working directory is not the operator's; a blank line
inside the list, or one folder named twice, is refused naming its line.

**A destination on an external drive is pinned to that drive** by volume UUID, so a night the drive is out
stages here as `DRIVE NOT PLUGGED IN` rather than writing to the boot disk, and reads need no pin
([an external drive](backup-external-drive.md)). A destination that is the home,
sits inside it, holds it, or is where the home's staging tree resolves through a link, is refused as
`DESTINATION_OVERLAPS`, because the plaintext staging lives there; a restore refuses the same for
`--files-into` and `--secrets-into` (`refusePlaintextInsideDestination`), and writes each credential by
rename so a link standing at its name is replaced, never written through. Below the staging root, every
staging directory is made one segment at a time and a link at any segment is refused
(`makeStagingDirectory`); a backup's own `<instant>` directory must be made by that run.
Reproduce with
`slopweaver store backup --check`:

```text
store backup --check: backup key <fingerprint> readable with no prompt (remembered destinations)
  this Mac (<root>): <root> reachable
    …the key's wrap line
  <volume> (<root>): DRIVE NOT PLUGGED IN — nothing is mounted at /Volumes/<volume> (pinned volume <uuid>)
```

It exits zero when at least one destination is reachable and none failed, so a drive that is out is reported
without turning the check red.

**A destination on the same device as the home is reported, not refused.** It survives a deleted or
corrupted home but not a lost disk, and `--check` prints a second line saying exactly that
(`sharesDeviceWithHome`, `src/store/backup/destination.ts`). An external volume is the stronger choice. Which
one to use is the install's decision, so the code reports the trade and leaves the choice there.

**Every object is encrypted under one backup key**: `SWOBJ1`, AES-256-GCM, a fresh IV per object
([backup objects](backup-objects.md#the-encrypted-object-format)). The key is 32 random bytes in the login
Keychain. The 03:00 run opens it with no prompt, `store backup --create-key` makes it once, and a password
manager can later wrap it for recovery ([the key, and the Vault leg](backup-key-and-vault.md)).

**The FILES go first and the database second**, because it is the files that cannot be
regenerated: bronze, members and lessons come first. The store is a projection of bronze and is RESET rather than migrated, so a dump
is a copy of something derivable while `corpus/bronze` is not. `BACKED_UP_FILE_ROOTS`
(`src/store/backup/plan.ts`) is the list — `corpus/bronze`, `corpus/members`, `corpus/history`,
`corpus/attachments`, `corpus/bodies`, `atlas`, `knowledge`, `pages`, `published-pages` — and it is widened
THERE rather than behind a flag, because a root a flag forgot is a file lost. The two page folders ride it only
until they are retired ([published pages](published-pages.md)).

**The two content-addressed sidecars are on that list because bronze holds the POINTERS and they hold what
the pointers name**, which is the one case where "derivable" is the wrong test. A record carries an
attachment's SHA-256 and never its url, because a Notion signed url expires inside the hour and "a url
written into bronze is a dead pointer by the time anyone reads it, and worse, it looks live"
(`src/corpus/notion/attachmentStore.ts`) — so restoring bronze without `corpus/attachments` gives back a
corpus whose every attachment reference resolves to nothing, with no re-fetch path from what was restored.
`corpus/bodies` is the honest edge case: a parsed page body **is** derivable, from the provider, and that
re-derivation is a full re-fetch of every page in the workspace, which is precisely the cost the sidecar
exists to remove (`src/corpus/notion/bodyStore.ts` — a Notion record's `raw` has only ever held the PAGE
object, never the body). Derivable at a price nobody would pay is not derivable in the sense this rule means.

**`atlas` is the same shape a third time, and it is the one that was missing.** An entity's `artifacts`
field is a list of `{byteLength, kind, mediaType, relativePath, sha256}` — a pointer — and
`src/store/schema/atlas.ts` stores it as `jsonb`, so `store import-atlas` lands the rows and never the
bytes. Measured: 1,915,850,793 bytes across 4,985 files under `$SLOPWEAVER_HOME/atlas`
(3,101 PNG, 239 PDF, 1,350 JSON; 3.4 GB for the whole root), in no backup at all. Restore the database
without this root and all of those artifact pointers resolve to nothing. The `corpus/bodies` price
argument does not even apply here: most of these atlases **cannot resync unattended**
(`src/cli/commands/store/importAtlasRun.ts`), so the files are not expensive to re-derive, they are not
re-derivable. The whole root goes in — kind files and `_superseded` generations included — because the
files are authoritative and the tables are a projection, which is the same reason `corpus/bronze` is on
this list while the store also holds it.

**The one thing a backed-up root does NOT carry is a withheld atlas companion.** An atlas that judges a
value too sensitive to publish writes it under `atlas/<platform>/_sensitive/` instead
(`AtlasPlatformPaths.sensitive`; `src/atlas/vanta/privacy.ts` is the writer that exists today, for
financial values). Every object the files leg writes is encrypted under the backup key, but this rule does
not depend on that. Whether a withheld value may leave its atlas at all is a separate decision from how it
is encrypted, and nobody has made that decision. `isBackedUpFileEligible` (`src/store/backup/plan.ts`) is a
fixed rule, not the flag the paragraph above refuses. There were **zero** such companions on this install
when the root was added, which is the point: the rule has to hold for the run that writes the first one.

**Nor does it carry an atomic write in flight.** `#lib/writeAtomic.ts` writes `<target>.<pid>.<uuid>.tmp` and
renames it into place; a file of exactly that shape is a partial copy of one the leg carries anyway, and
one whose writer died is a partial write nothing will finish. MEASURED: two orphaned
`corpus/bronze/slack/compact.jsonl.<pid>.<uuid>.tmp` files held 20.4 GB from dead writers and were walked,
frozen and queued for upload like data. The same `isBackedUpFileEligible` refuses the exact shape, so a file
merely named `notes.tmp` is still carried.

**And it is POSITIONAL, not a search for the name.** `atlasHomeShared.ts`'s `atlasPlatformPaths` puts the
companion at exactly one depth per generation — `atlas/<platform>/_sensitive/` live,
`atlas/_superseded/<platform>/<archiveId>/_sensitive/` archived — so the rule reads those two positions
and nothing else. A `_sensitive` deeper than that belongs to some provider's own id:
`atlas/vanta/policyDocuments.ts` names an artifact directory `encodeURIComponent(providerId)` and `_` is
unreserved, so a resource whose id IS `_sensitive` yields
`atlas/vanta/artifacts/policy-document/_sensitive/source.pdf`. A depth-blind rule drops that legitimate
PDF from every backup and says nothing.

**The archived depth is read off `atlas/kit/reset.ts`, not inferred from the live one.** `reset` archives
by `renameSync`ing the WHOLE platform directory into the slot, companion included, so the archived
companion sits one level BELOW the archive id rather than beside it. A rule reading it beside withholds
every live companion correctly and ships every archived one in the clear, a difference no tree without
archives can show. `backupFileRoots.test.ts` asserts both positions.

**Nor does it carry a path the owner protects.** A backup is run by a session, so the owner's
[protected paths](../security/protected-paths.md) bind it the way they bind a session's own reads and writes
(`src/store/backup/protectedPaths.ts`). The walk lists one directory at a time and prunes a `no-access` path
before opening it: a recursive listing of `corpus/bronze` would already have read a protected folder under it.
The night names every pruned path and the owner's reason as `NOT backed up`. A `read-only` source is still
carried, since a backup only reads it. A destination at or under any protected path, or holding a `no-access`
one, fails as that destination's own `HELD` arm before its door, on its spelling and where it resolves, and the
next destination is still written. A protected staging root or `secrets/` holds the whole run, judged under the
home's spelling and where a linked `--home` resolves; `--create-master-password`, the one mode writing under
`secrets/`, also refuses a protected master-password file. So does a registry that cannot be read or parsed: unlike
the tool hook, which fails open, a backup fails closed. Every mode is bound by this, `--status` included, which
also names a protected destination `HELD` and exits non-zero, so a held night never reads green. A staging made before this rule
may already hold protected bytes, and `--sweep-only` still sends it. A one-run `--destination` the sweep refuses
records nothing, so a later `--status` cannot name it; the refusal itself exits non-zero.

Order inside the list is legibility only — the corpus roots grouped, then `atlas`, `knowledge` last. `walkBackedUpFiles`
path-sorts every entry it returns and a restore reads the manifest's `files` rather than its `roots`, so a
backup taken under a shorter list still restores whole. `src/__tests__/unit/store/backupFileRoots.test.ts`
is the witness that each root resolves to its own directory and is actually walked.

One backup is up to six files under one prefix, `<project>/<instant>/`: four always, the credentials when a
master password is set, and Vault when a backup key is readable. At the destination, each one is an encrypted
object, and the backup key's wrap under the master password sits beside them at `<project>/keys/<fingerprint>.wrap`
([the wrap](backup-key-and-vault.md#the-master-password-wraps-the-key)):

| file            | what it is                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `files.json`    | every backed-up file's path, size and SHA-256, and a large file's chunk list — the files leg's manifest        |
| `store.dump`    | `pg_dump -Fc` of the OWNED schemas, staged whole; at the destination, the chunks `manifest.json` lists         |
| `storage.tar`   | the Supabase Storage volume's objects — the measurement bodies text cannot hold, Storage bucket `measurements` |
| `secrets.enc`   | `$SLOPWEAVER_HOME/secrets/`, encrypted under the master password — present iff one is set                      |
| `vault.enc`     | the `vault.secrets` rows, opened and sealed under the backup key — present iff a key was readable              |
| `manifest.json` | which database, which stack, when, every digest, and the extensions a scoped dump omits                        |

**The Vault leg carries what the scoped dump cannot**: `vault.secrets`, read opened (its own key never
leaves the server) and sealed at once under the backup key. Manifest version 3 makes `vault` a REQUIRED
field, `null` or not ([the key, and the Vault leg](backup-key-and-vault.md#the-vault-leg)).

**`storage.tar` carries the measurement objects, and the dump carries the rows that name them.** The
`measurements` import is the one writer through the Supabase Storage API ([§ "The measurements"](fleet-state-and-measurements.md#the-measurements)), so the
bucket's objects ride the tar and `storage.objects` rides the dump's `storage` schema. A dump with no tar
beside it is exactly the half-a-backup that restores a store listing files it cannot open, which is why the
two are never split. Re-measure with
`psql "$(cat ~/.slopweaver/secrets/store-url)" -c "select (select count(*) from storage.buckets), (select count(*) from storage.objects);"`.

**The credentials leg, and the one thing it does not protect.** The one
control asked for is one password, kept in the owner's own password manager. So `secrets/` is
collected, AES-256-GCM encrypted under an scrypt-derived key, and shipped beside the rest. That password is
the master password, `backup-passphrase`: generated once by `slopweaver store backup --create-master-password`
and kept as a `0600` file on this machine, because the 03:00 run is unattended and has no one to ask. **That
is not a weakness being glossed over** — every token the bundle holds already sits in plaintext in the same
directory, so a reader of that directory gains nothing from the password. The threat the encryption actually answers is somebody reaching the
destination's objects without reaching this laptop. Those objects are then encrypted a second time, under the
backup key, like every other object. A passphrase-derived keypair with the public half cached was
considered and rejected for buying only the case the plaintext directory already concedes, at the price of
a key file the ruling ruled out.

**`secrets: null` is a REQUIRED manifest field, not an omitted one.** An absent key and a null one read
identically to a careless reader, so the schema refuses a manifest that does not say, and
`backupLines` prints the credentials leg on every run in both directions. A leg that goes quiet when it
did not run is a thing you find out during a recovery.

**The master password is excluded from the bundle it encrypts.** Restoring it would hand back the one thing
the operator pastes from their password manager to open the backup at all. `store recover` writes the pasted
value back as `backup-passphrase`; after a bare `store restore --secrets-into`, `secrets set backup-passphrase`
is that step.

**A backup's bytes are content-addressed, so a night writes only what the destination lacks.** A small file
is one blob at `<project>/blobs/<sha256>`; the dump and every file of 64 MiB or more are chunks under
`<project>/chunks/<encoding>/`. MEASURED: cut into chunks, a 1.97 GB dump changes by 35–43 MB a
night. How each object is named, held, checked and restored: [blobs and chunks](backup-objects.md).

**Every write is atomic and verified.** The local transport (`src/store/backup/localDirectoryTransport.ts`)
writes each object as follows:

- It streams the object into a `0600` sibling `.partial-…` file, `fsync`s it, renames it over the target and
  `fsync`s the directory. A reader therefore sees the old bytes or the new ones, never a torn file.
- It refuses an object name that would land outside the root, and a symbolic link anywhere below it.
- Above the transport, the encrypting layer compares what landed with what it sealed, by length and SHA-256.
  A short or substituted object fails as `OBJECT_LANDED_WRONG` instead of being passed off under the
  plaintext's facts.

**The dump is scoped, and the measurement is why.** A whole-database `pg_dump` restored into a fresh database
fails at `realtime.list_changes`, whose body sets `log_min_messages` and needs a superuser the `postgres`
role here is not (measured). Everything outside those three schemas is what `yarn store:start`
creates on any machine, so the stack is re-created by the CLI and only what is ours is carried. A `-n`-scoped
dump also carries no `CREATE EXTENSION`, which is why the manifest records `pg_trgm` and its schema and the
restore creates it before replaying anything.

The store's three roles (`slopweaver_owner`, `slopweaver_bot`, `slopweaver_agent`) are not in the dump either:
roles belong to the server, not a database, and `yarn store:start` does not make them. The apply loop does,
before its migration (`storeRoleStatements`). The dump's policies name them, so a restore onto a server the
apply loop never ran on stops at the first policy (MEASURED against a live backup:
`role "slopweaver_agent" does not exist`), so the rehearsal creates them in its throwaway before `pg_restore`.

**Both Postgres tools run INSIDE the container.** The host's `pg_dump` is 15.19 and the stack is 17.6.1, and
an older `pg_dump` refuses its server outright; `docker exec supabase_db_slopweaver` is how every step
reaches 17.6. No payload ever passes through a JS string — each step's stdout or stdin is a file descriptor.

**Who runs it.** `slopweaver store backup-register` writes the `store-backup-daily` row into the in-repo
definition store (`verb-run`, argv `["store", "backup"]`, cadence `0 3 * * *` local), and the recipe
scheduler's own `automation run-due` tick runs it. The same verb writes `store-backup-sweep-hourly` beside it
(argv `["store", "backup", "--sweep-only"]`, cadence `30 * * * *`, `onMissed: "skip"`; `--cadence` moves only
the daily row), so a night the drive was out is sent at the first half-past firing after the drive is plugged
back in. With the drive still out, that hour prints `<root>: drive not plugged in at <mount point> — nothing
sent` for it and sweeps the other destinations; with every drive out it reads no key, exits 0 and settles its
slot. "Within the hour" assumes the scheduler is ticking and the row is not held; a large backlog may take longer
to upload. There is no cron and no launch agent — `AGENTS.md` rule 2. A failed nightly run
exits non-zero, which `run-due` records against the row, and overwrites `$SLOPWEAVER_HOME/backups/store/last.json`
with the failure; a sweep firing never writes `last.json`, even when it exits non-zero (below).

**`store backup --status` is green only when the last attempt wrote to a destination and failed at none**, and
reports, per destination, when bytes last reached it, so an unplugged SSD reads `last written <instant>` beside
this Mac's own line. A writing run names, per destination, any earlier staging that destination never got;
`store backup --sweep-only` sends those from the staging's retained `snapshot/` and takes no new dump. The
exit code of each case, strands, the snapshot, the sweep and its limits:
[each destination's record](backup-destinations.md).

**To run this row and nothing else, name it**: `slopweaver automation run-due --recipe store-backup-daily`, or
`--recipe store-backup-sweep-hourly` for the sweep; a row inside its cadence is still not run. The daily row is
registered behind the 42 `resync-*` rows the scheduler owns, and a tick takes due rows in store order, so
`--limit` — a prefix of that order — cannot reach it without draining rows that are not the caller's to run.

**Restoring, and the proof.** `slopweaver store restore --from <source> --into <db>` reads one of two
sources, told apart by path (`src/store/backup/destination.ts`):

- a **staging directory** under `backups/store/`, which holds plaintext;
- a **destination address**, `<root>/<project>/<instant>` as a path or a `file://` URL. This is exactly the
  address `store backup` prints for each destination it wrote. It asks once for the master password (a no-echo prompt or piped stdin, never
  argv) and reads through the key unwrapped from the wrap beside the backup, never the Keychain.

Before it writes anything, the restore verifies the manifest's digests. It then creates the database
(refusing one that already holds a store), re-creates the extensions, replays the dump and re-creates the
Vault rows.

- `--compare` counts every table in `public`, `drizzle` and `storage` on both sides and runs one full-text
  recall probe, because "the same number of rows" is not "the same answers".
- `--files-into <dir>` rebuilds the backed-up files from the destination's blobs and checks every digest.
- `--secrets-into <dir>` decrypts the credentials bundle under `<dir>` at `0600`, under the master password a
  destination restore already read; a staging restore asks for it on a no-echo prompt or piped stdin.
- `--drop-after` removes the copy once reported.
- Unpacking the storage tar over the LIVE volume needs its escape hatch (`restore-overwrites-storage`).

A staging directory's `vault.enc` is sealed too, so restoring its Vault leg needs the Keychain key. A manifest
that records Vault rows is refused before anything is written when no key is readable.

**Rehearsing, without the live database.** `store restore` writes into the live stack. The monthly proof
that a backup restores is `slopweaver store rehearse`. It reads the FIRST destination on the list `store
backup` resolves (`--destination <dir>` names another, and `--from <project>/<instant>/` picks one backup rather than the
newest), opening it with the master password in `secrets/` rather than the Keychain. It restores that backup,
Vault included, into a throwaway Postgres container of its own, compares it with
live read-only, and refuses a target that names the live
database, port or container before anything runs. The exact commands, what a wrong name does, the schedule
and the failure card are in [the restore runbook](restore-runbook.md).

A wrong password and a damaged bundle do NOT report the same thing, which matters because AES-GCM tells
you the same thing about both. Everything checkable without the key — the magic line, the header's JSON,
every declared length — is checked first, so a failure past that point says `WRONG_PASSPHRASE` and names
where the passphrase came from. The one case the cipher genuinely cannot separate, a corrupted ciphertext
body under an intact header, is stated in that message rather than papered over.

MEASURED against the live store — reproduce with
`slopweaver store backup --local-only` then `slopweaver store restore --from <dir> --into store_restore_proof --compare --drop-after`:

| what                                       | result                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| scoped dump of the 6,040 MB `postgres`     | 269.4 MiB in 34 s                                        |
| restored into a fresh database             | 4 min 11 s, 18 tables                                    |
| every table's count, live against restored | **identical**, `content` at 1,068,491 rows on both sides |

Lessons live in the store's `memories` table on the condition that this leg backs them up: an export on the same disk is not a backup. So every `handover settle` and `handover
finish` on a STARTED run needs the store reachable — an unreachable one refuses loudly and
`SLOPWEAVER_ALLOW_NO_LESSONS=1` is the way past a genuine outage. The slopweaver repo keeps its git remote.
