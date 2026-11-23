# A supervisor and the bot on another Mac, from this repo and its backup

Part of [The local Supabase store](../store.md). The owner's ruling (board row
`a-supervisor-and-its-bot-loop-come`): on a different computer, it should be easy to launch a supervisor that
launches the bot and runs things just the way they did before, from a Supabase backup. Nothing moves onto the
cloud to achieve it; the setup stays portable instead.

Nothing here runs anywhere but a Mac. The backup destinations are local directories — this Mac's folder for
rollback, the pinned SSD for disaster recovery — and nothing else ([the backup](backup.md)). A new Mac recovers
from the SSD, since the old Mac's own folder went with it. Portability means one checkout, one backup and the steps below, and
it is MEASURED by rehearsing them, never assumed.

**Two things must reach the new Mac before the recovery can read anything:**

- **The destination directory.** It is local by design, so another Mac reads it from the external drive the
  backups were written to, or from a copy of that directory. Reading needs no pin; only a write is held to the
  drive's volume UUID ([the backup](backup.md)).
- **The master password.** Every object is encrypted under a random backup key in the old Mac's login
  Keychain, and every backup sits beside that key's wrap under the one master password the operator keeps in
  their password manager ([the wrap](backup-key-and-vault.md#the-master-password-wraps-the-key)). The new
  Mac's Keychain is never read: the password opens the backup.

A backup whose destination holds no wrap (one taken before a master password was set, with no backup or
`--sweep-only` since) opens only on the Mac whose Keychain holds its key.

## What comes back, and from where

A supervisor boots off the board (`handovers/`), the run journals (`runs/`) and the store. The bot boots off
`responders.json`, `trusted-askers.json`, `general-rulings.json`, `profile.json`, the store's identity roster and the credentials. Every one of those comes back from
one backup:

| State                                                                                              | Carried by                                                                               | Written back by                             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| the store: memories, board and run rows, owner turns, fallback receipts                            | `store.dump`, `storage.tar`                                                              | `store restore --into`                      |
| the store's Vault secrets                                                                          | `vault.enc`, under the backup key                                                        | `store restore --into`                      |
| `corpus/*`, `atlas`, `knowledge`, `pages`, `published-pages`                                       | the files leg (`BACKED_UP_FILE_ROOTS`, `src/store/backup/plan.ts`)                       | `store restore --files-into`                |
| Slack, GitHub, Linear and the other tokens, `store-url`, `store-backup-directory`                  | `secrets.enc`, under the master password                                                 | `store restore --secrets-into`, then copied |
| `handovers/`, `runs/`, the boot files, `sessions/`, `judgement/`, the listener queue, recipe rows… | `authored_body` + `authored_file`, byte-exact (`src/store/fleet/authoredDirectories.ts`) | `store authored-restore`                    |
| Claude Code auto-memory, `~/.claude/projects/<project-dir>/memory/`                                | the same authored class, through the home's `claude-memory/` mirror                      | `store authored-restore`, into `~/.claude`  |

**The board and the journals ride the authored class, not their own tables.** `board_row` splits a doc's
front-matter into columns and `run_event` stores each journal line as `jsonb`, which keeps neither file's bytes;
`authored_file` does. **The boot files are named one by one** (`AUTHORED_HOME_FILES`): the home's other
top-level files are `.bak` copies, notes and caches.

**Auto-memory lives outside the home, so it rides a mirror** (`src/store/fleet/claudeMemoryMirror.ts`): the
nightly import copies each corpus into `claude-memory/<project-dir>/` before the authored walk, and
`authored-restore` writes it back into `~/.claude/projects/<project-dir>/memory/`. A corpus missing on disk keeps
its mirror, and the mirror never destroys bytes: every version it would remove or overwrite is first kept in
`claude-memory/<project-dir>/attic/<sha-prefix>-<file>`, which the store and the backup carry like the rest and
restore puts back in the home, never into `~/.claude`. So a session opened before the restore costs nothing: a
memory already in `~/.claude` with other bytes — a fresh `MEMORY.md`, or a same-named memory it wrote — is left
alone and named on an `INDEX` or `DIFFERS` line, and the old copy stays readable in the home's mirror, then in
its attic once the next nightly import follows the present file.

**A file deleted on the old machine stays deleted.** `authored_file` only ever adds, so every import that
walked the whole home from its own store rewrites `authored_absent` with the stored paths it did not find, and
`authored-restore` leaves those out and counts them. A file the walk listed and the read found gone counts as
absent on that same import. Without it, the first rehearsal brought back 22 recipe
definitions live had deleted, a HubSpot resync among them; a swept board doc would have come back the same way.

**Freshness is a standing row.** `store-import-fleet-nightly` runs `store import-fleet` at 02:30, half an hour
before the 03:00 backup dumps the store, so a restore gets last night's board rather than whatever was last
imported by hand ([declared rows](../../skills/automation/reference/declared-rows.md#the-nightly-fleet-import)).

## The recovery, in order

Three prerequisites, then one command.

1. Clone this repository, install the toolchain its `.nvmrc` and [toolchain](../toolchain.md) name, and
   `yarn install`.
2. `yarn store:start` from the checkout. The recovery never starts the stack itself; it refuses with this
   command when the stack is down. The start also locks the empty stack and writes `store-url` as the lock's
   login ([the local lock](../../skills/store/reference/local-lock.md)), which the recovery repoints at the
   recovered database. A `store-url` in the backup is never restored over it, and with no `store-url` the
   recovery refuses, naming this step, rather than guess the image's default login the lock refuses.
3. The destination directory is reachable on this Mac, and the master password is in reach (above).
   `slopweaver store recover --dry-run --destination <dir>` names the backup it would recover without asking
   for anything; the recovery reads the drive with no pin. Once it has run, with the drive plugged in,
   `slopweaver store backup --set-destination <dir>` remembers it and pins this Mac to that drive, so the
   nightly can write there again; `--add-destination <folder>` puts this Mac's own rollback folder beside it,
   and `slopweaver store backup --check` proves both without dumping anything.
4. Recover:

   ```bash
   slopweaver store recover --destination <dir>
   ```

`store recover` (`src/store/backup/recover.ts`) does, in this order:

- it creates the store's three roles, which a dump cannot carry ([the backup](backup.md) says why);
- it reads the master password ONCE, from a no-echo prompt (or piped stdin, never argv), unwraps the newest
  finished backup's (or `--from`'s) key from the wrap beside it, decrypts the backup and verifies every digest,
  so a mistyped password costs seconds;
- it decrypts the credentials under the same password **before** the twenty-minute database restore;
- it restores the database and its Vault secrets into `store_recovered` (or `--into`'s) and applies every
  migration this checkout carries that the backup predates;
- it rebuilds the files leg and moves it into the home;
- it writes the credentials, a `store-url` naming the recovered database and the master password as
  `backup-passphrase` into `secrets/` at `0600` — the password even when the backup carried no credentials;
- it runs `store authored-restore` against the recovered database: the board, the journals, the boot files
  and the rest of the authored state, then, when the home is `~/.slopweaver` itself, the Claude auto-memory
  into `~/.claude/projects/`. A present file is never overwritten and every written file is re-hashed.

Run it before opening Claude Code, and re-run it until it exits 0 before any `store import-fleet`: an import
walks the home it finds, so a half-restored home would record what it lacks as deleted. An `INDEX` or
`DIFFERS` memory line means a session got there first, so fold the old copy it names into the present file.

The connection string is the selected store's, with the recovered database in place of its own; a non-local
one is refused.

**Nothing the home already holds is overwritten**, bar one write. Absent is written, byte-identical is skipped,
and a difference is left in the recovery's staging (`backups/store/recover/<instant>/`) and named. The run then
exits non-zero, so a recovery is also a migration onto a Mac already in use. The one write: the home's own
`secrets/store-url` is replaced when the recovered URL differs from it by the database alone (same scheme,
login, password, host, port, options and fragment), and the report names both databases, never the URL. It is
replaced only away from a database holding no store, judged as the restore judges its target: any table in
`public`. A fresh stack's holds none, since `yarn store:start` migrates nothing; on a Mac already in use it is the
live store, so the recovery refuses before downloading anything, a dry run included, and says to recover beside it
with `SLOPWEAVER_STORE_URL` set to the home's own `store-url`. A URL taken from
`SLOPWEAVER_STORE_URL` never replaces it, since the environment selects for one run and never repoints the home. A file or credential whose home path
resolves through a link into the backup destination is refused, never written there. **A re-run resumes**: a marker in that
staging records the database, files and credentials steps as each lands, and a database holding a store no
recovery recorded restoring is refused rather than written into.

The report ends with what no backup carries (below). Then install the plugin the way
[dogfood](../../skills/dogfood/SKILL.md) does, sign each Claude plan and Codex account in again
(`slopweaver plans list` names them), and open the supervisor chat. `slopweaver handover list` is the first
check that the board came back.

**A backup taken without a master password set carries no credentials** (`"secrets": null` in its
manifest). The recovery says so, and every token is minted again from `slopweaver secrets status --all`.
`slopweaver store backup --create-master-password` on the machine taking the backups makes the next nightly
carry them.

**The new Mac then needs a backup key of its own.** The recovery restores no Keychain item, so its first
`store backup` refuses until `store backup --create-key` makes one. That backup is wrapped under the same
master password, beside the old key's wrap, so the older backups still open.

MEASURED, from one `slopweaver/<instant>/` backup into an EMPTY home with no store
selected. That backup was then read from a cloud bucket, so the two hours below include the download. The
same sequence today is:

```bash
slopweaver store recover --destination <dir> --into store_recover_proof --home <empty dir>
```

The run took about two hours. The database was restored about 30 minutes in. Rebuilding and moving the files
leg's 13,641 files took another hour and a half, which makes it the long pole. The authored restore then
wrote 18,532 files with 0 failed and left out 61 deleted since. The recovered home's `handover list` read 3,810 rows
with 0 unreadable. Against live, `git diff --no-index --name-status <home>/handovers ~/.slopweaver/handovers` showed
0 docs missing, 79 created since the backup and 59 edited since. That backup carried no credentials, so only
`store-url` was written. Run a second time, the same command fetched nothing and skipped all three marked steps.
Its authored restore wrote 0 files, found all 18,532 identical, and the run exited 0. Repeated the next day into a
fresh empty home, the same 13,641 files, 18,532 authored files and 3,810 rows came back, and the re-run
again wrote nothing and exited 0.

The pieces stay separate verbs for a partial restore: `store restore --into … --files-into … --secrets-into
…` and `store authored-restore`.

## What does not come back, on purpose or not yet

- **Sign-ins.** `claude-accounts/` and each `~/.codex*` hold OAuth material and are the `credential` class, so
  they never leave the machine. Each is a fresh sign-in.
- **`hygiene-denylist.txt`.** Every word in it is a word the authored leg refuses to store, so it can never ride
  the store. Re-create it by hand.
- **A file the authored leg refused as a credential.** The nightly import names each one; it stays on the old
  disk only.
- **The session transcripts** under `~/.claude/projects/`. Not in any backup yet.
- **Absolute paths.** `plans.json` and `profile.json` name directories under this machine's home, so a
  different user name means re-homing each plan with `slopweaver plans set-store-dir`, which keeps its alias,
  then signing it in again, and editing `profile.json`. The same holds for auto-memory: Claude Code names a project
  directory after its absolute path, and the restore writes each corpus under its old name rather than guessing
  the new one, so a different user name means moving each `memory/` directory by hand.
- **The backup key's Keychain item.** No backup carries it; the wrap opens the old backups and the new Mac
  makes its own key (above).
- **Supabase Storage objects.** `store recover` decrypts and verifies `storage.tar` but never unpacks it
  over the stack's volume; `store restore --storage --overwrite-storage` is that step
  ([restore runbook](restore-runbook.md)).

## Rehearsing it

`slopweaver store rehearse` restores the newest backup into a throwaway Postgres and compares it with live
([restore runbook](restore-runbook.md)); that is the database half. The home half is rehearsed by restoring
the authored class into a throwaway home and pointing the board at it, reading the live store and writing only
the throwaway. Make the directory first, and name the live store through the environment, never by copying
`secrets/store-url` into the throwaway: an import run from a home whose own secret names the live store would
record that home's walk as live's deletions (`absenceOutweighsWalk` refuses the worst of it, a set larger than
the walk):

```bash
SLOPWEAVER_STORE_URL=<live store url> slopweaver store authored-restore --home <empty dir>
slopweaver handover list --home <that dir> --json
```

A `--home` that is not the default never writes into `~/.claude`, so the rehearsal restores the auto-memory
mirror into `<that dir>/claude-memory/` and says it skipped the write-back.

MEASURED, before `authored_absent` existed: 17,979 files written in 66 s, 0 failed. `handovers/` was
byte-identical to live and `runs/` identical but for the one file refused as a credential. The six boot files
hashed the same as live, and `handover list` read 3,697 rows, 0 unreadable. `automation due` read 80 rows against
live's 58, which is the 22 deleted definitions the absent set leaves out.
