/*
 * The `store` noun's BACKUP family: dump, restore, the recipe row that schedules the dump, and the
 * exclusions pass that decides what is worth keeping in the first place. Metadata only — no handlers, no
 * imports — so `store.ts` holds the read and load verbs and this holds the ones that move the data
 * somewhere else. They were one file until the 300 code-line cap refused the next verb.
 */

export const backupMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: true,
  dryParseSafe: true,
  effect: "external-write",
  example: "slopweaver store backup",
  parseRejectIsIoFree: true,
  summary:
    "Dump the store, tar its Storage volume and seal its Vault and credentials once, then write each verified file encrypted to every destination on the list, in order",
  usage:
    "usage: slopweaver store backup [--local-only | --check | --status | --sweep-only | --create-key | --create-master-password | --copy-master-password | --set-destination <address> | --add-destination <address> | --remove-destination <address>] [--destination <address>] [--keep-local <n>] [--home <dir>] [--json]",
} as const;

export const restoreMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example:
    "slopweaver store restore --from ~/.slopweaver/backups/store/<instant> --into store_restore_proof --compare --drop-after",
  parseRejectIsIoFree: true,
  summary: "Restore a verified backup into a fresh database in the stack, its credentials under a passphrase you paste",
  usage:
    "usage: slopweaver store restore --from <staging dir | <destination>/<project>/<instant>> --into <database> [--compare] [--drop-after] [--files-into <dir>] [--secrets-into <dir>] [--storage --overwrite-storage] [--home <dir>] [--json]",
} as const;

export const recoverMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store recover --destination /Volumes/Backup/slopweaver",
  parseRejectIsIoFree: true,
  summary:
    "Bring a wiped or new Mac back from the encrypted backup in one run: the store, its Vault, the files, the credentials, the board and the boot files",
  usage:
    "usage: slopweaver store recover [--destination <dir>] [--from <project>/<instant>/] [--into <database>] [--dry-run] [--home <dir>]",
} as const;

export const rehearseMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store rehearse",
  parseRejectIsIoFree: true,
  summary: "Restore the newest backup into a throwaway Postgres and prove it against the live store, read-only",
  usage:
    "usage: slopweaver store rehearse [--from <project>/<instant>/] [--destination <dir>] [--into <database>] [--port <n>] [--container <name>] [--sample-size <n>] [--keep] [--no-record] [--home <dir>] [--json]",
} as const;

export const backupRegisterMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store backup-register",
  parseRejectIsIoFree: true,
  summary: "Write the daily store-backup and hourly backup-sweep recipe rows the recipe scheduler runs",
  usage: 'usage: slopweaver store backup-register [--cadence "<cron>"] [--home <dir>] [--json]',
} as const;

export const exclusionsMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store exclusions detect",
  parseRejectIsIoFree: true,
  summary: "Propose the (app, channel) pairs that are pure alert traffic, or remove what the denylist already covers",
  usage:
    "usage: slopweaver store exclusions detect|purge [--apply] [--delete-human-threads] [--home <dir>] [--json]\n" +
    "  detect  proposes the (app, channel) pairs that read as pure alert traffic. It changes nothing: a\n" +
    "          proposal becomes policy only when somebody writes its line into the denylist, so the rule\n" +
    "          cannot start or stop excluding a channel on its own as that channel gets busier or quieter.\n" +
    "  purge   counts what the denylist already covers; --apply deletes it. Bronze is never touched, so\n" +
    "          re-ingesting it with the denylist line removed restores what a purge deleted.\n" +
    "          A denied alert a human replied under is KEPT, so no reply is left without its parent\n" +
    "          (rule D); --delete-human-threads takes those as well.",
} as const;
