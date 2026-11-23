/**
 * The local store and its backup — the connection string the store verbs address, the master password that wraps
 * the backup key and encrypts the backup's credentials leg, and the local directory the nightly writes its
 * encrypted objects into. The backup KEY those objects are encrypted under is not a row here: it lives in the login Keychain
 * (`src/store/backup/backupKeychain.ts`), never in `secrets/`, so a copy of the home never carries it.
 */
import type { CredentialSpec } from "./spec.js";

/** The store and backup rows, in register order: the store URL, the master password, the backup destination. */
export const STORE_AND_BACKUP_CREDENTIALS = [
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "read-write",
    name: "store-url",
    platform: "Supabase (the local store)",
    reader: "src/store/config.ts",
    readVerbs: "slopweaver store *, slopweaver turn brief",
    settable: true,
    shape: "line",
    usedFor:
      "naming WHICH Postgres the store verbs and the bot's history leg address. A remembered selection is not a guessed one — the read side synthesises no host, port, database or password, and an unselected store still refuses. On the local stack `store lock` writes it: the login role `slopweaver_login` with a random per-install password it generated, the only login the stack accepts from this Mac (`skills/store/reference/local-lock.md`). It is stored like a credential because it carries that password, and because a bot turn needs it without an exported variable: before this row, a store read in a turn refused and the turn read bronze files instead",
    what: "the connection string this install's store verbs log in with — on the local stack, the lock's own login",
    writtenBy: "slopweaver secrets set store-url",
  },
  {
    // Its platform is the operator's own password manager, which no other row names, so only a declared link can say that a stored
    // backup destination with no master password is a nightly running without its credentials leg or its key wrap
    // (`src/store/backup/stageSecrets.ts` treats a missing password as `secrets: null`, not a failure).
    absentMattersWith: ["store-backup-directory"],
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "backup-passphrase",
    platform: "the operator's password manager — slopweaver never reads it from there",
    reader: "src/store/backup/secretsBundle.ts",
    readVerbs: "slopweaver store backup, slopweaver store rehearse",
    settable: true,
    shape: "line",
    usedFor:
      "the backup's ONE master password: the fleet generates it with `slopweaver store backup --create-master-password` at 128 random bits, copied to the clipboard once for the operator's password manager and never printed; `secrets set` is how the operator puts back one they already hold. It wraps the random backup key at `<project>/keys/<fingerprint>.wrap` beside every backup, so `store recover`, `store restore` and `store rehearse` open a destination backup with it instead of the Keychain, and it encrypts `secrets.enc`, the credentials leg. The nightly and the rehearsal read this FILE, unattended; a recovery on a machine with no secrets directory left takes it pasted, and installs it here again. It is excluded from the bundle it encrypts. Not a provider credential: it reaches nothing",
    valueShape: { describe: "at least 26 characters", pattern: /^.{26,}$/u },
    what: "the one master password that wraps the backup key and encrypts the backup's credentials leg",
    writtenBy: "slopweaver secrets set backup-passphrase",
  },
  {
    expiry: "none",
    lifecycle: "live",
    mintScope: "not-a-credential",
    name: "store-backup-directory",
    platform: "the local backup destinations (directories on this machine or a mounted volume)",
    reader: "src/store/backup/destinationConfig.ts",
    readVerbs: "slopweaver store backup, slopweaver store rehearse, slopweaver store recover",
    settable: true,
    shape: "line",
    usedFor:
      "naming, one absolute address per line in order, every directory `store backup` writes its encrypted objects into, under `<project>/<instant>/` (local paths the fleet picks, no cloud — this Mac's folder for rollback, a pinned SSD for disaster recovery). A night is staged once and sent to each in turn; a read takes the first. A per-install choice, never in the code. Not a secret, and stored like one because a committed constant would be wrong for every other install and the nightly run needs it without an exported variable. `slopweaver store backup` with `--set-destination`, `--add-destination` or `--remove-destination <address>` changes it, and for a folder on an external drive (`/Volumes/<name>/…`) also pins that volume by UUID in `backups/store/destination-pin.json`, so a night the drive is out stages locally rather than writing to the boot disk; set by hand, such a destination is refused until it is pinned",
    what: "the absolute paths of the local backup destinations, one per line",
    writtenBy: "slopweaver secrets set store-backup-directory",
  },
] as const satisfies readonly CredentialSpec[];
