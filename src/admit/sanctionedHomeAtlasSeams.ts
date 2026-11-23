/**
 * The sanctioned seams of the Slopweaver home and the atlases: the door's own hook, the Claude credential and mint seams, the store backup lane, the append-only ledgers and journals under `$SLOPWEAVER_HOME`, and the atlas generation stores.
 *
 * One part of the sanctioned-seam catalogue: `./sanctionedSeams.ts` spreads it into `SANCTIONED_SEAMS`, which stays
 * the one table `./coverage.ts` reads, so a module is still sanctioned in exactly one place. A new row goes in the
 * part whose theme its module belongs to, and a part nearing 300 code lines splits again.
 */

/** The sanctioned seams of this part, keyed by repo-relative path. */
export const HOME_ATLAS_SEAMS = {
  "hooks/pretooluse.ts": "door-internal",
  // The ONLY reader of a Claude credential, and there is no writer beside it: one
  // `security find-generic-password`. The write, the rollback and the lock directory went with the credential
  // COPY they existed for (§ Why there is no writer here, in that file). Local machine state exclusively — one
  // read of a macOS keychain item under a store the owner configured. It reaches no provider.
  "src/claude/keychain.ts": "local-state",
  // The on-demand credential repair: one `execFileSync` of the Claude CLI's own model-free `--safe-mode mcp
  // list` under one credential store, selected purely by an environment variable, so that store's own expired
  // access token is refreshed IN PLACE at the moment a spawn wants it. Local machine state exclusively — the
  // same keychain item `keychain.ts` above already accounts for. The API call the CLI makes on its own behalf
  // is an OAuth credential refresh, not a read or write of any provider surface this repository doors, so it
  // is deliberately NOT described as a doored provider read. It starts no model.
  "src/claude/storeRefresh.ts": "local-state",
  // A seat's setup token: one `mkdirSync` of the seat's own unbound store under
  // `$SLOPWEAVER_HOME/claude-accounts/unbound/<seat>`, and the token file written into a plan's configured store
  // directory by `claude token` once it has proven itself. Local machine state exclusively; the one probe
  // request that proves a token goes through `probeStore.ts`, which is the gauge's own request.
  "src/claude/seatToken.ts": "local-state",
  // `claude mint`'s throwaway directory under `$SLOPWEAVER_HOME/claude-accounts/minting/<uuid>/`: making it
  // `0700`, writing the pty program, the `$BROWSER` capture script and an empty `0600` screen log, the abort
  // file, and removing it — leftovers included — on every path out. Local files exclusively; the token it
  // captures is written through `seatToken.ts` above only once `seatTokenAdmit.ts` has proven it.
  "src/claude/mintPty.ts": "local-state",
  // The one `spawnSync` of `/usr/bin/expect` running the vendor's `setup-token` login under a pty, on a worker
  // thread so the verb can poll for the authorize URL meanwhile. An OAuth login the owner completes in their own
  // browser, not a model session; the only request it makes is the login's own token exchange, which is no
  // provider surface this repository doors.
  "src/claude/mintPtyWorker.ts": "local-state",
  // A seat's cached usage pass under `$SLOPWEAVER_HOME/live/seat-pass/`: the one atomic, back-dated write of a
  // marker and every removal of one or all of them (a stale pass, a committed plan-register change). Local files
  // exclusively; the reading a pass rests on was taken by `claude gauge`, which reaches the provider itself.
  "src/claude/seatPassMarker.ts": "local-state",
  // The restore half of the same lane: it fetches a backup from the local destination into the staging area
  // above, decrypting each object, before `restore.ts` replays it into this machine's own stack. What is left
  // here is checking a staged manifest is on disk and making the directory the bytes land in.
  "src/store/backup/restoreSource.ts": "local-state",
  // The files leg of that restore, split out of the file above when it grew past the size ratchet. The
  // blobs it fetches come through the decrypting transport the verb resolved; the `mkdirSync` left here is
  // making the directory under `--files-into` that the bytes land in.
  "src/store/backup/restoreFiles.ts": "local-state",
  // Putting the credentials back: one `0700` directory under `--secrets-into` and one file per secret at
  // the mode it was taken at, plus reading this machine's own passphrase on the backup side. It reaches no
  // provider at all — the bundle it opens was already fetched by the restore above, and the plaintext never
  // leaves the directory the caller named.
  "src/store/backup/secretsBundle.ts": "local-state",
  // Removing a home's retired on-disk copies of the Storage address and key from `$SLOPWEAVER_HOME/secrets`,
  // once the running stack has just supplied both. A local delete of this machine's own files; it reaches no
  // provider.
  "src/store/objects/retiredCopies.ts": "local-state",
  // The store backup's staging area under `$SLOPWEAVER_HOME/backups/store`: one directory per backup holding
  // the dump, the storage tar, both manifests and the upload receipt, plus `last.json`. The WRITE out of it
  // is doored — `cli/commands/store/backup.ts` routes it through `throughDoor` as an `external-write` — so what
  // is left here is the local half: making the directory, writing what the dump already produced, and removing
  // a staged copy the destination has verifiably taken. It reaches no provider.
  "src/store/backup/run.ts": "local-state",
  // That staging area read and written as a store, split out of the file above when it grew past the size
  // ratchet: the directory listing, the receipt each upload leaves, and the prune. The upload it drives is
  // the doored one the verb routes; everything left here is local files.
  "src/store/backup/staging.ts": "local-state",
  // The record of the most recent attempt, `last.json`, in the same staging root. One small local file
  // written and read back; it reaches nothing.
  "src/store/backup/lastOutcome.ts": "local-state",
  // `store export`'s publishing half: a private staging directory beside `--out`, the part files and the
  // manifest written into it, an exclusive claim on `--out`, and the rename onto that claim. Every path is
  // one the caller named; it reaches no provider.
  "src/store/transfer/bundlePublish.ts": "local-state",
  // The sweep of EARLIER stagings the destination never got. Its uploads go through the same transport the verb
  // resolved under the door; what is left here is reading a staged manifest off disk and writing a receipt
  // beside it.
  "src/store/backup/sweep.ts": "local-state",
  // The store lock (`store lock`, `store start`): `docker exec` into this machine's own Supabase containers
  // (`edge.ts`), the pinned Supabase CLI (`lockRun.ts`), the pending-password file under
  // `$SLOPWEAVER_HOME/store-lock` (`pendingFile.ts`), and the verified pre-change copy in `store-lock/backups/<instant>` with its Storage
  // extraction scratch (`backupGate.ts`, `storageProof.ts`). Every one is this machine's own stack or home; none
  // reaches a provider.
  "src/store/lock/edge.ts": "local-state",
  "src/store/lock/backupGate.ts": "local-state",
  "src/store/lock/storageProof.ts": "local-state",
  "src/store/lock/pendingFile.ts": "local-state",
  "src/cli/commands/store/lockRun.ts": "local-state",
  // The files leg: every held-back file is cloned into a `snapshot/` directory inside its own staging
  // directory before it is hashed, so the bytes named and the bytes sent are one frozen copy. The upload of
  // each clone is the doored one the verb routes; what is left here is making that directory and removing it
  // when the leg ends.
  "src/store/backup/filesLeg.ts": "local-state",
  // Its small-file half: each blob frozen into that snapshot and the clone removed once sent.
  "src/store/backup/smallFiles.ts": "local-state",
  // Its two halves around a list of destinations: `filesPrepare.ts` makes the staging's `snapshot/` directory
  // once a night and removes it on a failed freeze or once every destination holds it; `filesSend.ts` makes and
  // removes a chunk scratch directory inside the staging around each destination's send. Every byte that leaves
  // goes through the doored transport the verb routes per destination.
  "src/store/backup/filesPrepare.ts": "local-state",
  "src/store/backup/filesSend.ts": "local-state",
  // One receipt per destination, under the staging's own `receipts/` directory, made `0700` before each is
  // written. Files in this machine's home; they reach no provider.
  "src/store/backup/receipts.ts": "local-state",
  // The chunk store under that backup. `chunkUpload.ts` stages each encoded chunk in a scratch file inside the
  // staging directory and removes it once sent; `largeFiles.ts` removes each frozen clone once its chunks
  // landed; `chunkRestore.ts` writes a rebuilt file beside its target and renames it into place. Every
  // transfer to or from the destination is the doored one the verb routes; these touch only local staging files.
  "src/store/backup/chunkUpload.ts": "local-state",
  "src/store/backup/largeFiles.ts": "local-state",
  "src/store/backup/chunkRestore.ts": "local-state",
  // The credentials leg of that backup: one `secrets.enc` written into the same staging directory, at
  // `0600`. The upload out of it is the doored one the verb above routes; this file only seals the bytes.
  "src/store/backup/stageSecrets.ts": "local-state",
  // Every `docker exec` into this machine's own Supabase containers: pg_dump, pg_restore, createdb, dropdb,
  // psql and tar. The containers are `yarn store:start` on this laptop, so the spawn is local-machine state in
  // exactly the sense `docker`/`psql` are excluded from the reaching-tool table for (`admit/rawTools.ts`).
  // Nothing here reaches a cloud control plane; the only write out of the staging area is to the destination,
  // and that goes through the door in the verb above.
  "src/store/backup/stack.ts": "local-state",
  // The restore rehearsal's docker edge: `docker run` of a throwaway Postgres on this laptop, `docker inspect`
  // of it and of the live database container, `docker exec` into the throwaway by the ID it printed, and
  // `docker stop` of that ID. Local-machine state in the same sense as the file above; it reaches no provider.
  "src/store/backup/rehearsalDocker.ts": "local-state",
  // The Storage selection's `docker context inspect` of the active daemon's address, then two `docker inspect
  // --format` reads of this laptop's own Supabase gateway and Storage containers pinned to that address: the
  // published API port and the service key, read and never written. Read-only against
  // local-machine state in the same sense as the two files above; it reaches no provider.
  "src/store/objects/selection.ts": "read-only-tool",
  // `store recover`'s disk edge: moving the files leg and the decrypted credentials out of the recovery's own
  // staging under `backups/store/recover/` into the home it is rebuilding, never over a file that differs, and
  // the marker a re-run resumes from. Everything it writes is this machine's home; the fetch that fed it is
  // `store restore`'s own read of the destination.
  "src/store/backup/recoverFiles.ts": "local-state",
  // The credentials half of that same edge, split out of it: the `secrets/` directory it creates in the home and
  // a credential's earlier staged copy it removes once the credential no longer conflicts. Local state for the same
  // reason as the files leg: it writes only this machine's home, from the recovery's own staging.
  "src/store/backup/recoverSecrets.ts": "local-state",
  // The rehearsal's download directory under the staging root and its `tar -tf` listing of the downloaded
  // `storage.tar`. The destination reads themselves go through the transport the verb resolved; what is left here
  // is making the directory the bytes land in and reading a local file.
  "src/store/backup/rehearsalSource.ts": "local-state",
  // The rehearsal's `last.json` beside the backup's own: one small local file written and read back.
  "src/store/backup/rehearsalRecord.ts": "local-state",
  // The encrypted backup's local destination (a local path, no bucket): a directory
  // on this machine the operator named, written with a staged rename and read back. It reaches no provider.
  "src/store/backup/localDirectoryTransport.ts": "local-state",
  // The object format's two directions: ciphertext and unverified plaintext written only under a private
  // temporary, renamed into place once whole. Local files in, local files out.
  "src/store/backup/objectCrypto.ts": "local-state",
  // The encrypting decorator's private scratch directory, made and removed around each object.
  "src/store/backup/encryptingTransport.ts": "local-state",
  // The backup key in this Mac's login Keychain: `/usr/bin/security` find, add and show-keychain-info. It never
  // prompts and never prints the key; it reaches no network.
  "src/store/backup/backupKeychain.ts": "local-state",
  // The backup key's wrap: a private scratch directory, made and removed around each read or write of the wrap,
  // which then moves only through the backup transport. Local files; it reaches no provider.
  "src/store/backup/keyWrapStore.ts": "local-state",
  // The master password handed to `/usr/bin/pbcopy` on stdin, the one way it is shown: this Mac's clipboard,
  // never argv or stdout; it reaches no network.
  "src/store/backup/masterPassword.ts": "local-state",
  // The Vault leg: `docker exec` psql into this machine's own Supabase database to read or import
  // `vault.secrets`, sealing the export under the backup key into the staging directory and removing each
  // plaintext scratch file the moment it is sealed or imported. Local-machine state like `stack.ts`; it reaches
  // no provider.
  "src/store/backup/vault.ts": "local-state",
  // The overlap guard making the home's own staging root, `0700`, before it compares that root with the
  // destination by identity; and the staging directories below that root, made one segment at a time so no
  // link sits between. Directories in this machine's home; they reach no provider.
  "src/store/backup/destination.ts": "local-state",
  "src/store/backup/stagingDirectory.ts": "local-state",
  // The backup verbs' shell making the operator's named destination directory, `0700`, before a writing run. A
  // directory on this machine or a mounted volume; it reaches no provider.
  "src/cli/commands/store/verbShell.ts": "local-state",
  // The destination list and its external-drive pins: `--set-destination`, `--add-destination` and
  // `--remove-destination` write `secrets/store-backup-directory` and the home's `destination-pin.json`,
  // restoring the previous pin bytes when a later step fails; `diskutil info -plist` reads which volume is
  // mounted at a `/Volumes` path; and the destination root is made one folder at a time, each checked to still
  // sit on the pinned drive. This Mac's home and its mounted volumes; no provider.
  "src/cli/commands/store/destinationSettings.ts": "local-state",
  "src/store/backup/darwinVolume.ts": "local-state",
  "src/store/backup/madeFolders.ts": "local-state",
  // The one `drizzle-kit generate` call: spawns the repository's own `node_modules/.bin/drizzle-kit` with
  // an explicit `--out`, which writes a migration file into that directory and nothing else. It needs no
  // database — the CLI diffs the schema against the newest snapshot beside the migrations — and the
  // connection variable is blanked in the child's environment so it cannot reach one by accident. Run by
  // `store push` into `supabase/migrations/` and by the drizzle-migrations gate into a scratch copy.
  "src/store/generate.ts": "local-state",
  // The unit lane's CI merge (`yarn test:unit:merge`): two `spawnSync`s of the repository's own
  // `node_modules/.bin/vitest` — `list --filesOnly` and `--merge-reports --coverage` — over the shard reports
  // in `.vitest-reports/`, writing `coverage/` and a scratch JSON report. Nothing leaves the machine.
  "src/testLanes/unitMerge.ts": "local-state",
  // `readLandedMigrations`: one `git ls-tree` and one `git show` per migration file, both of `origin/main` as
  // this checkout last fetched it, to hash what has LANDED before `store push` applies anything. Read-only
  // against the local object store; it never fetches, so it reaches no remote and no provider.
  "src/store/lifecycle.ts": "read-only-tool",
  // The door's catch-up snapshot: a walk of the checkout's own `supabase/migrations/` that writes each file's
  // bytes, every symlink followed, into one `mkdtemp` directory under the OS temp root, each file created exclusively
  // so a name the temp volume folds into another (`A.sql` beside `a.sql`) throws rather than overwriting. The pending files are classified and applied from that
  // copy, so a file swapped mid-wait is never the one applied; landing is read from git objects, and the
  // final `store verify` reads the LIVE tree on purpose, so a swap surfaces as a refusal. Then `rmSync` of
  // that same directory on every path out; a removal the filesystem itself refuses throws rather than being
  // hidden. The database it applies to is the local store only (`isLocalStoreUrl`); nothing leaves the machine.
  "src/store/catchUp.ts": "local-state",
  // The keep-alive touch: runs the Claude CLI's own diagnostic under one credential store, selected purely
  // by an environment variable, so that store's own credential is refreshed in place before it dies of the
  // ordinary access-token lifetime. Local machine state exclusively — the same keychain items keychain.ts
  // above already accounts for, and the verb writes nothing to the ACTIVE slot at all: the credential copy is
  // retired, so a tick that names a plan to rotate to now REPORTS that and performs nothing. The API call the
  // CLI makes on its own behalf is a credential refresh, not a read or write of any provider surface this
  // repository doors.
  "src/cli/commands/claude/watch.ts": "local-state",
  // The released `--wait` start: one `execFileSync` of THIS SAME CLI (`process.execPath` over its own
  // entrypoint, minus `--wait`), blocking in the foreground with inherited stdio. It reaches nothing
  // `watch.ts` above does not already account for — it IS that verb, run as a child so a ticking watch never
  // carries `--wait` in its argv.
  "src/cli/commands/claude/watchAdmission.ts": "local-state",
  // The sign-in walk. Three seams, all local machine state. Two `writeFileSync`s: the identity ENROLLMENTS
  // under the Slopweaver home (which account the owner asserted belongs in which store — never a
  // credential), and the local `file://` status page, which is written to disk precisely BECAUSE publishing
  // it would put it in one account's gallery and a sign-in moving accounts is what makes a gallery
  // unreachable. The `execFile` is the vendor's own `auth login`, run synchronously with the terminal
  // inherited so the owner watches and interrupts it: it starts no model, and it is the one act doctrine
  // reserves for the owner's hand, which is why nothing here runs without their explicit go. It reaches no provider
  // surface this repository doors — the account chooser it opens is the owner's browser, not an API.
  "src/cli/commands/claude/signinRun.ts": "local-state",
  // `plans add --provider codex`: the production `ensureStoreDir` seam's one `mkdirSync` creates the empty 0700
  // store directory the row names, so the printed `codex login` line works first time. It writes no credential
  // and reaches no provider — the sign-in itself is the owner's own terminal command.
  "src/cli/commands/plans/storeDirLive.ts": "local-state",
  // `protect add|remove`: its one `rmSync` deletes `$SLOPWEAVER_HOME/protected-paths.json` when an edit leaves it
  // empty, so the read-side hook row keeps starting no Node process; the write beside it is `writeFileAtomic`. Both
  // touch only that one state-home file, under the home's operation lock, and reach no provider.
  "src/cli/commands/protect/run.ts": "local-state",
  // The supervisor-scratch verbs (`tick-capture`, `refresh-run`, `scratch-carry`, and `tick` which runs the
  // same capture and refresh). Every write lands in the one scratch directory the caller named — a tick's own
  // new directory, a staged `session-start` file it removes, three files copied no-clobber. `scratchChild`'s
  // `spawnSync` launches THIS SAME CLI's read verbs (the tick's readings and `session-start --json --no-record`),
  // each of which passes its own door; none reaches a provider itself. They replaced a copied shell script
  // doing exactly these acts with no gate at all.
  "src/cli/commands/supervisor/scratchRun.ts": "local-state",
  "src/cli/commands/supervisor/scratchChild.ts": "local-state",
  "src/cli/commands/supervisor/scratchRefresh.ts": "local-state",
  // `supervisor tick close`'s list refresh: its one removal is the private `mkdtemp` directory it made under the OS
  // temp dir for the refresh child, on every path out; the refreshed file — or a `--your-list` file the caller named,
  // read through one no-follow descriptor — is copied into the tick's own directory.
  "src/cli/commands/supervisor/tickCloseRefresh.ts": "local-state",
  // `supervisor tick close`'s page render: its one write is a private copy of the bound list's checked bytes, into
  // a `mkdtemp` directory inside the tick's own directory, and its removals are that directory on every path out.
  // It reaches no provider.
  "src/cli/commands/supervisor/tickClosePage.ts": "local-state",
  // The memory gate's pre-push installer. Its two filesystem writes land on exactly one path, the state
  // repository's own `.git/hooks/pre-push`, and nowhere else. Its `spawnSync` runs THIS SAME CLI's
  // `memory gate --help`, a read-only, write-free probe whose ONLY purpose is to prove the launcher it is
  // about to bake in actually answers the verb — installing against a path that merely exists shipped a
  // hook that refused every push with a usage error (that module's § why the binary path is baked in).
  // It reaches no provider.
  "src/memory/prePushHook.ts": "local-state",
  "src/__tests__/cassetteRedactLocal.ts": "local-state",
  // The backup tests' fake bucket: a directory under the test's own temp root that uploads are copied into.
  "src/__tests__/unit/store/directoryTransport.ts": "local-state",
  // The `backupRun*` tests' shared world: a `mkdtemp` sandbox home and destination under the per-file temp root,
  // removed by each file's `afterEach`, and scratch files for planting or opening one encrypted object, removed on
  // every path out. It reaches no provider.
  "src/__tests__/unit/store/backupRunWorld.ts": "local-state",
  // The `slack tagged` tests' throwaway home: every write lands in the `mkdtemp` directory it just made under the
  // per-file temp root, which the calling test removes. It reaches no provider.
  "src/__tests__/unit/cli/commands/slack/taggedFixture.ts": "local-state",
  // The bot-live-write guard tests' throwaway home: a profile and one dispatched ask written into the `mkdtemp`
  // directory it just made, removed by the calling test. It reaches no provider.
  "src/__tests__/unit/admit/botTurnFixture.ts": "local-state",
  // The journalled-hatch tests' grant: `withLiveGrant` writes one grant row into the `mkdtemp` home it just made
  // under the per-file temp root, and removes that home on every path out. It reaches no provider.
  "src/__tests__/hatchGrantFixture.ts": "local-state",
  // The profile-held tests' delivery marker: `seedProfileDelivered` writes one marker into the throwaway home the
  // calling test made, so the check under test is not refused first. It reaches no provider.
  "src/__tests__/profileDeliveredFixture.ts": "local-state",
  // The answered-triage tests' incident home: `writeAnsweredTriageHome` writes the call, its index, the relay turn,
  // its card landing and one parked draft only under the throwaway home the calling test made and removes. It
  // reaches no provider.
  "src/__tests__/answeredTriageHome.ts": "local-state",
  // The stated-candidates tests' home file: `writeStatedCandidatesFile` writes one `workstreams/stated-candidates.json`
  // only under the throwaway home the calling test made and removes. It reaches no provider.
  "src/__tests__/statedCandidatesFixture.ts": "local-state",
  // The doctor plugin-report tests' plugin roots: a manifest, skills and the hook mirror's slot layout, written
  // only under the directory the calling test made under the per-file temp root and removes. It reaches no provider.
  "src/__tests__/pluginRootFixture.ts": "local-state",
  // The Outlook verb tests' throwaway home: `fakeOutlookShell` makes one `mkdtemp` directory under the per-file
  // temp root and removes it when the calling test disposes of the shell. Its mailbox is an in-memory fake, so
  // it reaches no provider.
  "src/__tests__/fakeOutlookShell.ts": "local-state",
  // The store-import apply tests' staged batch: each helper makes one `mkdtemp` directory under the per-file temp
  // root to stage an export from, and removes it on every path out. Its store is none, or a throwaway database it
  // creates and drops on the server the opt-in admin URL names — never the operator's own store.
  "src/__tests__/integration/storeImportApplyHarness.ts": "local-state",
  "src/__tests__/unit/store/transfer/stagedBatch.ts": "local-state",
  // The console browser lane's fixtures: `mkdtemp` homes and scratch under the per-file temp root, seeded through
  // the checkout's own `bin/slopweaver` with an explicit `--home`, a `next start` of the built console on loopback
  // under an allowlisted environment with no credential, and a throwaway database created and dropped on the server
  // the admin URL names. Each removes what it made. It reaches no provider.
  "src/__tests__/e2e/fixtures/consoleSeed.ts": "local-state",
  "src/__tests__/e2e/fixtures/consoleWorker.ts": "local-state",
  "src/__tests__/e2e/fixtures/globalSetup.ts": "local-state",
  // The capture walks `browser console-shot` runs over those same fixtures: one directory and the walk's raw
  // picture and observation file inside it, the directory the verb names through the capture-dir variable and
  // removes afterwards. It reaches no provider.
  "src/__tests__/e2e/capture/consoleWalks.capture.ts": "local-state",
  // The console browser lane's runner (`yarn test:e2e`): spawns the checkout's own CLI build, console build and
  // Playwright, a `git fetch` of the event's base commit from the checkout's own `origin` (as `ci.yml`'s coverage
  // floor does) and a `git diff`, and appends one line to CI's job summary file. It reaches no provider.
  "src/testLanes/desktopE2e.entry.ts": "local-state",
  "src/admit/ledger.ts": "door-internal",
  // Reads which worktree `cwd` belongs to (`git rev-parse --git-dir`/`--git-common-dir`), exactly the same
  // class of probe as `cmux/worktree.ts` below — a local checkout read, never a write, let alone an external
  // one. Backs every main-checkout guard, each a workflow safety net rather than a door concern. The seam
  // lived in `mainCheckoutBranchGuard.ts` until `declaredMainCheckouts.ts` needed the same predicates
  // without the two importing each other; only its address changed.
  "src/admit/mainWorktree.ts": "local-state",
  // Reads `git status --porcelain` at a caller-given cwd — a local checkout read, never a write, same class
  // as `mainCheckoutBranchGuard.ts` above. Backs the main-checkout cleanliness line `slopweaver doctor`
  // prints and the dirty-write guard's own decision, neither of which is a door concern.
  "src/admit/mainCheckoutCleanliness.ts": "local-state",
  // Reads `git status --porcelain` at its own cwd, exactly as `mainCheckoutCleanliness.ts` above does — the
  // lefthook `pre-push` entry point, deciding whether the tree the gate is about to read is the commit the
  // push would send. A local checkout read that refuses a LOCAL git operation; the push it precedes goes
  // through the door in its own right.
  "src/admit/prePushWorkingTreeCli.ts": "local-state",
  // The repo-scoped operation lock for github stack push/sync/adopt: one lock directory per key, holding
  // its holder's token file, entirely under $SLOPWEAVER_HOME/ledgers/operation-locks. Local state protecting local git rewrites from a concurrent
  // invocation, not an external write itself.
  "src/admit/operationLock.ts": "local-state",
  // That lock's judgement of an occupant, and its removal when stale: the holder's own token file and then its
  // emptied directory, or a plain-file lock an older build left, under the same operation-locks directory.
  "src/admit/operationLockTakeover.ts": "local-state",
  // A home's runtime directory: two owner-only `mkdirSync`s under `/tmp/slopweaver-<uid>`, where the process-lifetime
  // locks and cmux stamps live. Local state on this machine, not an external write.
  "src/stateRuntime.ts": "local-state",
  // Whether an operation lock's holder is still the process that wrote it, through the relay lease's one probe
  // (`/bin/ps -o stat=,lstart=`, a zombie included), bounded at 5s. Reads this machine's process table and nothing else.
  "src/admit/lockHolder.ts": "local-state",
  // The pain-point ledger's writer: one append-only JSONL under $SLOPWEAVER_HOME/ledgers, exactly like the
  // door ledger beside it. It exists so a voice observation is counted by CODE rather than by an agent
  // remembering to `printf >>` mid-turn — see the module comment in painPoint.ts.
  "src/admit/painPoint.ts": "door-internal",
  // The loop-breakage ledger's ONE writer: one append-only JSONL under $SLOPWEAVER_HOME/ledgers. The code
  // classes write through it as they happen, and `turn breakage` is the only way a session adds a row, with
  // a required cause — see the module comments in live/turn/loopBreakage.ts and breakageClasses.ts.
  "src/live/turn/loopBreakage.ts": "local-state",
  // The Notion page ledger's writer: two append/overwrite JSONL-shaped record indexes entirely under
  // $SLOPWEAVER_HOME/ledgers/notion-pages. Local state exactly like the Linear issue ledger beside it — it
  // records which pages slopweaver created so an update can prove ownership, and never touches Notion.
  "src/outbound/notion/pageLedger.ts": "local-state",
  // The release of a page-create intent reservation that ledger took, when the create was refused before the
  // wire — the same $SLOPWEAVER_HOME records, same class. It renames the record aside, deletes only its own
  // unconfirmed reservation, and links anything else back; it never touches Notion.
  "src/outbound/notion/reservationRelease.ts": "local-state",
  // The withheld-reply queue's writer: one append-only JSONL under $SLOPWEAVER_HOME/queue. It is local state
  // by construction — the queue exists precisely because the external write it holds did NOT happen, and the
  // release that eventually sends one goes through the door like every other outbound write.
  "src/admit/queueStore.ts": "local-state",
  // The as-me draft register's writer: one append-only JSONL under $SLOPWEAVER_HOME/queue, `0600` inside a
  // `0700` directory because it holds a message the owner has not decided to send. Local state for the same reason
  // `queueStore.ts` above is, one step earlier in the story: a parked draft exists precisely because nothing
  // was posted, and the release that eventually sends one goes through the door on the `slack post` lane.
  "src/admit/slackDraftStore.ts": "local-state",
  // The GitHub review-draft register's writer, the same shape as `slackDraftStore.ts` above: a parked review exists
  // because nothing was posted, and the post that eventually sends one goes through the door with the owner's approval.
  "src/admit/reviewDraftStore.ts": "local-state",
  // The as-me send failure journal's writer: one append-only JSONL under $SLOPWEAVER_HOME/ledgers, `0600` inside a
  // `0700` directory. Local state by construction: a row exists precisely because the send it names did NOT go out,
  // and it carries a channel, a thread and the refusal's words, never the message (`talk slack-send-outcome`).
  "src/admit/slackSendFailureStore.ts": "local-state",
  // The press-reseal receipt journal: one append-only JSONL under $SLOPWEAVER_HOME/ledgers, `0600` inside a `0700`
  // directory, one line per `github press-reseal --apply` that re-keyed the local store's press register. Local
  // state by construction: the repair touches only this machine's store, and the line is its only receipt.
  "src/review/pressResealStoreRows.ts": "local-state",
  // `supervisor tick-reseal --apply`'s writer: an owner-only backup, a staging file and the rename over the tick
  // ledger, all under $SLOPWEAVER_HOME/ledgers, plus its receipt journal. Local state by construction: it rewrites
  // only this machine's own ledger, and a refusal removes the backup and staging file it made.
  "src/supervisor/tickResealStore.ts": "local-state",
  // `talk cursor-retire --apply`'s writer: it moves one unread cursor under `talk/unread-cursors/retired/` with a
  // receipt beside it, under the cursor's own lock. Local state by construction: the cursor is this machine's
  // record of what a reader has read, and the move is what lets the next chair start on the first-read path.
  "src/talk/cursorRetireStore.ts": "local-state",
  // The reflection loop's own two ledgers, both append-only JSONL under $SLOPWEAVER_HOME/ledgers/reflect.
  // Local state by construction, and by the OWNER'S RULING: the loop's autonomy ceiling for its first run is
  // T0 — report only — so it writes no board doc, opens no pull request and sends no message. Its whole write
  // surface is its own memory: a sighting per candidate so a terminal `drop` sticks and the recurrence
  // counter advances, and one heartbeat row so a quiet day is distinguishable from a day it did not run.
  "src/reflect/seen.ts": "local-state",
  "src/reflect/heartbeat.ts": "local-state",
  // The memory-hygiene proposal ledger, append-only JSONL under $SLOPWEAVER_HOME/ledgers/memory. Same class and
  // the same reason as `reflect/seen.ts` above: the pass PROPOSES and never edits a memory, so this append is
  // its ONLY write anywhere, and what it writes is the pass's own memory of what it put in front of the owner
  // and what the owner answered. There is no write path to a memory file in `src/memory/hygiene/` at all.
  "src/memory/hygiene/ledger.ts": "local-state",
  // CHECK 4's resolver. Two read-only `git` invocations against the repository the caller named — `grep -l -F`
  // and `ls-files` — to answer whether a path, flag or verb a memory names is still in the tree. It writes
  // nothing and reaches no provider: `read-only-tool` on the argv, which is a constant here rather than an
  // intent, since both subcommands are literals in the file and only the searched-for string varies.
  "src/memory/hygiene/referentTree.ts": "read-only-tool",
  // The proof-output guard's one question: which work tree holds a directory, by `git rev-parse
  // --show-toplevel`, a literal argv. It writes nothing and reaches no provider; only the directory varies.
  "src/proofPath/outputGuardEffects.ts": "read-only-tool",
  // The proof ignore block in a repository's own `.git/info/exclude`: a local, never-committed file in the
  // git directory of a checkout a spawn is about to create a worktree in. The `rmSync` removes only the staged
  // sibling this module wrote itself when another writer changed the file first. No provider, no push.
  "src/proofPath/localExclude.ts": "local-state",
  // The lock-in ledger, append-only JSONL under $SLOPWEAVER_HOME/ledgers/session-start. Same class and the
  // same reason: it is the walk's ONLY write, and what it writes is the list's own memory of what the owner
  // said about a row. Every action a resolution implies — closing the ticket, posting the update, answering
  // the run — is a separate verb the owner chooses, taken through the door with its existing gates.
  "src/sessionStart/lockIn.ts": "local-state",
  // The footprint assignment ledger, append-only JSONL under $SLOPWEAVER_HOME/footprint. Same class and
  // the same reason as the lock-in ledger it is modelled on: the ONLY thing it persists is which
  // workstream the owner put a node in, and every status a reader sees is recomposed live from the
  // sources and the board. It reaches no provider on any path.
  "src/footprint/ledger.ts": "local-state",
  // The list's own memory of what it showed, so the next run can say what moved. Append-only JSONL under
  // $SLOPWEAVER_HOME/ledgers/session-start, beside the lock-in ledger and the same class: session-start
  // reads, ranks and asks, and reaches no provider on any path.
  "src/sessionStart/runStore.ts": "local-state",
  // The sweep ledger: one append-only JSONL under $SLOPWEAVER_HOME/ledgers/sweep.jsonl, one row per act
  // `slopweaver sweep apply` took. Same class and the same reason as the lock-in ledger above — it is this
  // module's ONLY write, and what it writes is the sweep's own memory of what it closed or settled and on
  // what witness. The ACT itself is never taken here: `sweep apply` dispatches `handover close`/`settle`,
  // which carry their own gates, and this file appends the row afterwards. It reaches no provider on any path.
  "src/sweep/journalStore.ts": "local-state",
  // The ratchet bump records: one write-once `<digest>.json` per declaration under
  // $SLOPWEAVER_HOME/ledgers/baseline-bumps, staged beside its name, published by a hard link and the stage
  // removed. Local state only: `dev baseline-bump` writes it, the landing verbs read it, and no provider is reached.
  "src/codex/bumpRecordStore.ts": "local-state",
  // The home-reclaim ledger: one append-only JSONL under $SLOPWEAVER_HOME/ledgers/home-reclaim.jsonl, one
  // row per root a `home reclaim --apply` entered. Same class and the same reason as the sweep ledger above
  // — it is this module's ONLY write, and what it writes is the reclaim's own memory of what it took, on
  // what witness and under whose session, which is the whole findability rail for an act that has no undo.
  // It reaches no provider on any path.
  "src/home/reclaim/journalStore.ts": "local-state",
  // The home reclaim's own filesystem edge: it walks a DECLARED root under $SLOPWEAVER_HOME
  // (`home/reclaim/roots.ts` is the allowlist — one segment, never an absolute path and never `..`) and
  // `rmSync`s one path at a time inside that same root. Removal is by PATH and
  // never by inode, so it can never reach the hardlinked twin of a scratch file in a checkout elsewhere on
  // the machine. Local machine state exclusively; it reaches no provider and starts no model.
  "src/home/reclaim/scan.ts": "local-state",
  // The shared atlas generic file primitives (atomic write, digest, read-if-present), used by every atlas
  // platform (Vanta, Cloudflare) — writes only under $SLOPWEAVER_HOME/atlas/<platform>, never an external
  // provider. Same class as corpusStore.ts below.
  "src/atlas/atlasFile.ts": "local-state",
  // The platform-agnostic atlas kit: the generation protocol and the archive-and-reset protocol every
  // atlas publishes through. Writes only under $SLOPWEAVER_HOME/atlas/<platform> — the same class as the
  // per-platform store/reset modules below, which now call these.
  "src/atlas/kit/store.ts": "local-state",
  // The publish half of that kit, split out of `store.ts` when publication grew a mandatory lock and a
  // compare-and-swap and took the file past the size ratchet. Same sanction for the same reason: the one
  // `mkdirSync` it holds creates `$SLOPWEAVER_HOME/atlas/<platform>` immediately before the generation is
  // installed into it.
  "src/atlas/kit/publish.ts": "local-state",
  "src/atlas/kit/reset.ts": "local-state",
  // The GCP audit-log reader's generation store: one `0700` `mkdirSync` of
  // `$SLOPWEAVER_HOME/atlas/gcp-audit/<generation>` before its `0600` entries file is opened for streaming. Local
  // machine state exclusively; every Google read it stores arrived through `gcpAudit/transport.ts`'s closed union.
  "src/gcpAudit/store.ts": "local-state",
  // The two-phase swap `store.ts` publishes through: it stages each file at `<destination>.publishing` and
  // renames the set into place, parking the previous bytes at `<destination>.superseding`. Every path it
  // touches is one the caller already named under $SLOPWEAVER_HOME/atlas/<platform>, so it is the same class
  // as the two above — these seams were inside `store.ts` under that sanction until the protocol earned its
  // own module.
  "src/atlas/kit/generationSwap.ts": "local-state",
  // The pre-`.jsonl` generation repair: rewrites a kind file already under $SLOPWEAVER_HOME/atlas/<platform>
  // into the layout this build reads, and moves what it replaced into that platform's own `_superseded`
  // slot. It fetches nothing — every byte it writes came off the same directory a moment earlier — so it is
  // the same class as the two above.
  "src/atlas/kit/singleFileRepair.ts": "local-state",
  // The other direction of `reset.ts`: it lists what that verb archived under
  // $SLOPWEAVER_HOME/atlas/_superseded/<platform>, and installs one back as the live generation. Every path
  // it renames is one of those two, both already sanctioned above, and it fetches nothing — a restore only
  // ever moves bytes that were written here by a previous publish. It deletes neither generation: the one it
  // displaces is archived under its own timestamp first, which is why the seams are renames rather than
  // removals.
  "src/atlas/kit/archive.ts": "local-state",
  // The Vanta access token, shared across processes under `$SLOPWEAVER_HOME/secrets/vanta-token/<digest>.json`
  // at `0700`/`0600` — the same treatment `secrets/store.ts` gives a stored secret. It reaches no provider:
  // the token it caches was minted by the doored transport, and this file only stops the NEXT process
  // minting a second one, which Vanta answers by revoking the first. The file is named for a digest of the
  // client id rather than the id itself, so a directory listing names no application.
  "src/atlas/vanta/tokenCache.ts": "local-state",
  // Withheld financial companion files, written only under $SLOPWEAVER_HOME/atlas/vanta/_sensitive — never
  // the committed kind file, never an external write.
  "src/atlas/vanta/privacy.ts": "local-state",
  // The Vanta change log under $SLOPWEAVER_HOME/vanta/changes. The `rmSync` removes one record this sync wrote
  // moments earlier, by the path `writeVantaChangeRecord` answered, when its publish then failed. Nothing
  // reaches Vanta or Slack.
  "src/atlas/vanta/changesStore.ts": "local-state",
  // A `talk verb` answer too long for the voice, kept whole under $SLOPWEAVER_HOME/talk/verb-spill (0700/0600).
  // The `rmSync` prunes only that directory's own lowercase-v4-UUID `.txt` names, and a symlinked directory is
  // refused before any is touched. Nothing reaches a provider.
  "src/talk/verbSpill.ts": "local-state",
  // The Linear atlas's own generation write: page screenshots, addressed by digest, under
  // $SLOPWEAVER_HOME/atlas/linear/artifacts. The kit store above writes the kind files; this writes the
  // bytes those files reference, and nothing else. No external effect.
  "src/atlas/linear/sync.ts": "local-state",
  // `atlas linear sync`/`walk`'s own scratch directory: one `mkdtemp` under the OS temp dir for the walk's
  // screenshots, removed in a `finally`. The Linear READS this verb performs go through the shared
  // transport in corpus/linear/transport.ts, which is doored; the browser leg drives the owner's own Chrome
  // through browser/playwrightCli.ts, and a slopweaver verb driving a browser IS the door (rule 3).
  "src/cli/commands/atlas/linearRun.ts": "local-state",
  // `vanta reset`'s archive/reinstall: renames the current generation directory aside and republishes an
  // empty one, entirely under $SLOPWEAVER_HOME/atlas/vanta — no external effect.
  "src/atlas/vanta/reset.ts": "local-state",
  // `cloudflare reset`'s archive/reinstall — the same protocol as vanta/reset.ts above, entirely under
  // $SLOPWEAVER_HOME/atlas/cloudflare — no external effect.
  "src/atlas/cloudflare/reset.ts": "local-state",
  // The JumpCloud atlas's resume journal, appended under $SLOPWEAVER_HOME/atlas/jumpcloud and removed by
  // the publish it was building for. It exists because a full walk of an organisation can run to a very large
  // request count, so an interruption must not be a restart — see `atlas/jumpcloud/resume.ts`. Local-state:
  // it writes one file inside the generation directory and reaches nothing external.
  "src/atlas/jumpcloud/resume.ts": "local-state",
  // Where the Vanta atlas lives under $SLOPWEAVER_HOME — read/publish only, same class as
  // corpus/corpusStore.ts below.
  "src/atlas/vanta/store.ts": "local-state",
  // `vanta vulnerabilities --html` writes ONE file, at a path the caller named on its own command line, and
  // its bytes are a rendering of what the read just returned. It reaches no provider: the verb's only
  // external contact is the GET walk above it. It is here rather than doored because a door decision
  // recorded for "wrote a local page" would count as a mutation of the world, which it is not — the write
  // that IS one is `vanta deactivate`, and that routes through `throughDoor`.
  "src/cli/commands/vanta/vulnerabilitiesRun.ts": "local-state",
  // `vanta controls-evidence` and `vanta control-evidence` file ONE JSON document each, under
  // $SLOPWEAVER_HOME/atlas/vanta or at a path the caller named on its own command line, and its bytes are a
  // rendering of what the read just returned. Same shape and same reason as the row above: the only
  // external contact either verb makes is the GET walk, and a door decision recorded for "wrote a local
  // evidence document" would count as a mutation of the world, which it is not.
  "src/cli/commands/vanta/controlsEvidenceRun.ts": "local-state",
  "src/cli/commands/vanta/controlEvidenceRun.ts": "local-state",
  // Where the Cloudflare atlas lives under $SLOPWEAVER_HOME — read/publish only, same class as
  // atlas/vanta/store.ts above.
  "src/atlas/cloudflare/store.ts": "local-state",
  // The 1Password atlas's README + generation directory, written under $SLOPWEAVER_HOME/atlas/onepassword.
  // The generation itself publishes through atlas/kit/store.ts above; this is the mkdir that precedes it.
  "src/atlas/onepassword/sync.ts": "local-state",
  // The cache of the PINNED Microsoft Graph specification, written under
  // $SLOPWEAVER_HOME/atlas/microsoft365/spec. The bytes are a public, commit-addressed vendor document and
  // are digest-verified before anything is written, so this is a local-state seam in the strongest sense
  // available: nothing caller-supplied reaches the path or the contents. The generation itself publishes
  // through atlas/kit/store.ts above.
  "src/atlas/microsoft365/specSource.ts": "local-state",
  // Shells the LOCAL `op` binary. `read-only-tool` for a reason stronger than intent: the argv is never
  // supplied by a caller, it is looked up from a CLOSED command allowlist in atlas/onepassword/inventory.ts
  // that contains no write verb and no item-reading verb (`op item get`, `op document get`, `op read` are
  // absent, and a test fails if one is added). A vault's item COUNT comes off `op vault get`, which is why
  // listing items is not merely unused but unreachable. Nothing leaves the machine that `op` did not fetch.
  // Its one call outside the allowlist is a fixed `op signin` under /usr/bin/expect, which mints the session
  // those surfaces run as and reads nothing.
  "src/atlas/onepassword/opCli.ts": "read-only-tool",
} as const satisfies Readonly<Record<string, "door-internal" | "local-state" | "read-only-tool">>;
