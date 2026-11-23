/**
 * The PURE half of `slopweaver store backup`, `store restore` and `store backup-register` — parsers and
 * rendered lines, with no process, socket, clock or filesystem.
 *
 * The recipe row is built here too, because its shape is what makes the daily backup a scheduled fact
 * rather than a hand-written file: `verb-run`, argv `["store", "backup"]`, effect `read-write` (the
 * verb's manifest is `external-write` and `verbRun.ts` refuses a row declaring less), and a five-field
 * cron cadence the recipe scheduler's `run-due` tick reads.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../live/automation/definition.js";
import { VERB_RUN_KIND } from "../../../live/automation/verbRun.js";
import { parseBackupSourceAddress } from "../../../store/backup/destination.js";
import { backupErrorLines } from "../../../store/backup/errors.js";
import { SUPABASE_PROJECT_ID, validateDatabaseName } from "../../../store/backup/plan.js";
import { parseFlags } from "../../parseFlags.js";
import type { DestinationChangeKind } from "./destinationSettings.js";
import { type StoreCommandError, StoreCommandErrors, storeCommandErrorLines } from "./errors.js";

/** The flags `store backup` accepts. */
const BACKUP_FLAGS = {
  boolean: [
    "check",
    "copy-master-password",
    "create-key",
    "create-master-password",
    "json",
    "local-only",
    "status",
    "sweep-only",
  ],
  string: ["add-destination", "destination", "home", "keep-local", "remove-destination", "set-destination"],
} as const;

/** The three flags that change the remembered destination list, by the change each asks for. */
const DESTINATION_CHANGE_FLAGS = [
  ["set", "set-destination"],
  ["add", "add-destination"],
  ["remove", "remove-destination"],
] as const;

/** The flags `store backup` advertises, for the help-truth ratchet. */
export const STORE_BACKUP_FLAG_NAMES: readonly string[] = [
  ...BACKUP_FLAGS.string.map((name) => `--${name}`),
  ...BACKUP_FLAGS.boolean.map((name) => `--${name}`),
];

/** The flags `store restore` accepts. */
const RESTORE_FLAGS = {
  boolean: ["compare", "drop-after", "json", "overwrite-storage", "storage"],
  string: ["files-into", "from", "home", "into", "secrets-into"],
} as const;

/** The flags `store restore` advertises, for the help-truth ratchet. */
export const STORE_RESTORE_FLAG_NAMES: readonly string[] = [
  ...RESTORE_FLAGS.string.map((name) => `--${name}`),
  ...RESTORE_FLAGS.boolean.map((name) => `--${name}`),
];

/** The flags `store backup-register` accepts. */
const BACKUP_REGISTER_FLAGS = { boolean: ["json"], string: ["cadence", "home"] } as const;

/** The flags `store backup-register` advertises, for the help-truth ratchet. */
export const STORE_BACKUP_REGISTER_FLAG_NAMES: readonly string[] = [
  ...BACKUP_REGISTER_FLAGS.string.map((name) => `--${name}`),
  ...BACKUP_REGISTER_FLAGS.boolean.map((name) => `--${name}`),
];

/** The recipe id the daily backup row carries. */
export const BACKUP_RECIPE_ID = "store-backup-daily";

/**
 * When the daily backup runs unless the caller moves it: 03:00 local, once a day.
 *
 * Local time because every row in the definition store is (`definition.ts`), and three in the morning
 * because it is the hour the machine is least likely to be mid-ingest — a dump taken during a load is
 * consistent (one transaction) but slower for both.
 */
export const DEFAULT_BACKUP_CADENCE = "0 3 * * *";

/** The recipe id the hourly sweep row carries. */
export const BACKUP_SWEEP_RECIPE_ID = "store-backup-sweep-hourly";

/** When the hourly sweep runs: half past every hour, local time. Not a flag: nothing has asked to move it. */
export const BACKUP_SWEEP_CADENCE = "30 * * * *";

/** What a `store backup` invocation asked for. */
export interface StoreBackupArgs {
  readonly home?: string;
  readonly json: boolean;
  /** Stage and stop — no destination. The Vault leg is still sealed when the backup key can be read. */
  readonly localOnly: boolean;
  /** Probe the destination and read the backup key, dump nothing. */
  readonly check: boolean;
  /** Report the most recent attempt, run nothing. */
  readonly status: boolean;
  /** Send every staging the destination never got, and take no new dump. */
  readonly sweepOnly: boolean;
  /** Create the backup key in the login Keychain, refusing when one exists; run nothing else. */
  readonly createKey: boolean;
  /** Generate the master password once, copy it to the clipboard and wrap the key at the destination. */
  readonly createMasterPassword: boolean;
  /** Put the master password from its `0600` file on the clipboard again; run nothing else. */
  readonly copyMasterPassword: boolean;
  /** One destination for this run, replacing the remembered list; `null` when the flag was not passed. */
  readonly destination: string | null;
  /**
   * Change the remembered list — replace it with one address, add one, or remove one, pinning a drive an address
   * is on — and run nothing else; `null` when none of the three flags was passed.
   */
  readonly destinationChange: { readonly change: DestinationChangeKind; readonly address: string } | null;
  readonly keepLocal: number;
}

/** What a `store restore` invocation asked for. */
export interface StoreRestoreArgs {
  readonly home?: string;
  readonly json: boolean;
  readonly from: string;
  readonly into: string;
  readonly compare: boolean;
  readonly storage: boolean;
  readonly dropAfter: boolean;
  /** Rebuild the backed-up files under this directory, from the destination's blobs. */
  readonly filesInto?: string;
  /**
   * Decrypt the credentials bundle under this directory.
   *
   * The passphrase itself is NEVER a flag — argv reaches `ps` and the door ledger. It is read from a
   * no-echo prompt, or from piped stdin, inside the verb.
   */
  readonly secretsInto?: string;
}

/** What a `store backup-register` invocation asked for. */
export interface StoreBackupRegisterArgs {
  readonly home?: string;
  readonly json: boolean;
  readonly cadence: string;
}

/**
 * How many of the mutually exclusive modes an invocation passed.
 *
 * @param values the parsed flag values
 * @returns the count
 */
function modeCount({ values }: { values: Readonly<Record<string, string | boolean | undefined>> }): number {
  return [
    values["check"] === true,
    values["status"] === true,
    values["local-only"] === true,
    values["sweep-only"] === true,
    values["create-key"] === true,
    values["create-master-password"] === true,
    values["copy-master-password"] === true,
    ...DESTINATION_CHANGE_FLAGS.map(([, flag]) => typeof values[flag] === "string"),
  ].filter(Boolean).length;
}

/**
 * Parse a `store backup` invocation.
 *
 * @param rest the argv tail
 * @returns the arguments, or every reason the invocation was refused
 */
export function parseStoreBackupArgs({ rest }: { rest: readonly string[] }): Result<StoreBackupArgs> {
  const parsed = parseFlags({ args: rest, spec: BACKUP_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const errors: string[] = [];
  const keepRaw = values["keep-local"];
  let keepLocal = 1;
  if (typeof keepRaw === "string") {
    if (!/^\d+$/.test(keepRaw)) {
      errors.push(`--keep-local takes a whole number, not "${keepRaw}"`);
    } else {
      keepLocal = Number(keepRaw);
    }
  }
  if (modeCount({ values }) > 1) {
    errors.push(
      "--check, --status, --local-only, --sweep-only, --create-key, --create-master-password, " +
        "--copy-master-password, --set-destination, --add-destination and --remove-destination are separate " +
        "modes — pass at most one",
    );
  }
  const home = values["home"];
  const destination = values["destination"];
  const changes = DESTINATION_CHANGE_FLAGS.flatMap(([change, flag]) => {
    const address = values[flag];
    return typeof address === "string" ? [{ address, change, flag }] : [];
  });
  const destinationChange = changes[0];
  if (destinationChange !== undefined && typeof destination === "string") {
    errors.push(
      `--${destinationChange.flag} changes the remembered list; --destination replaces it for a run — pass one of them`,
    );
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({
    check: values["check"] === true,
    copyMasterPassword: values["copy-master-password"] === true,
    createKey: values["create-key"] === true,
    createMasterPassword: values["create-master-password"] === true,
    destination: typeof destination === "string" ? destination : null,
    destinationChange:
      destinationChange === undefined ? null : { address: destinationChange.address, change: destinationChange.change },
    json: values["json"] === true,
    keepLocal,
    localOnly: values["local-only"] === true,
    status: values["status"] === true,
    sweepOnly: values["sweep-only"] === true,
    ...(typeof home === "string" ? { home } : {}),
  });
}

/**
 * The one required flag that also has to be a Postgres identifier.
 *
 * @param into what the caller typed
 * @returns the name, or why the invocation is refused
 */
function restoreTargetName({ into }: { into: string | boolean | undefined }): Result<string, StoreCommandError> {
  if (typeof into !== "string" || into.length === 0) {
    return err(StoreCommandErrors.restoreTargetMissing());
  }
  return validateDatabaseName({ name: into }).mapErr((error) =>
    StoreCommandErrors.argumentsRefused({ reasons: backupErrorLines({ error }) }),
  );
}

/**
 * Whether `--from` addresses a backup inside a destination, rather than a staging directory.
 *
 * @param from the `--from` value
 * @returns `true` for a `<destination>/<project>/<instant>` address
 */
function namesDestinationBackup({ from }: { from: string }): boolean {
  const address = parseBackupSourceAddress({ from, project: SUPABASE_PROJECT_ID });
  return address.isOk() && address.value.kind === "local-destination";
}

/**
 * Every refusal a restore invocation can earn beyond its target's name, in the order a reader meets them.
 *
 * @param from the `--from` value
 * @param filesInto the `--files-into` value
 * @param storage whether `--storage` was passed
 * @param acknowledged whether `--overwrite-storage` was passed with it
 * @returns the refusal lines, empty when the invocation is fine
 */
function restoreFlagRefusals({
  from,
  filesInto,
  storage,
  acknowledged,
}: {
  from: string | boolean | undefined;
  filesInto: string | boolean | undefined;
  storage: boolean;
  acknowledged: boolean;
}): readonly string[] {
  const fromMissing = typeof from !== "string" || from.length === 0;
  const filesNeedDestination =
    typeof filesInto === "string" && typeof from === "string" && !namesDestinationBackup({ from });
  return [
    ...(fromMissing ? ["--from <staging directory | <destination>/<project>/<instant>> is required"] : []),
    ...(filesNeedDestination
      ? [
          "--files-into needs a destination source (<destination>/<project>/<instant>) — a staged backup holds the files' digests, not their bytes",
        ]
      : []),
    ...(storage && !acknowledged ? hatchRefusalLines({ hatch: hatchFor({ id: "restore-overwrites-storage" }) }) : []),
  ];
}

/**
 * Parse a `store restore` invocation, including the one refusal that carries a hatch.
 *
 * @param rest the argv tail
 * @returns the arguments, or every reason the invocation was refused
 */
export function parseStoreRestoreArgs({ rest }: { rest: readonly string[] }): Result<StoreRestoreArgs> {
  const parsed = parseFlags({ args: rest, spec: RESTORE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const from = values["from"];
  const filesInto = values["files-into"];
  const storage = values["storage"] === true;
  const target = restoreTargetName({ into: values["into"] });
  const errors = [
    ...restoreFlagRefusals({
      acknowledged: values["overwrite-storage"] === true,
      filesInto,
      from,
      storage,
    }),
    ...(target.isErr() ? storeCommandErrorLines({ error: target.error }) : []),
  ];
  if (errors.length > 0 || target.isErr()) {
    return err(errors);
  }
  const home = values["home"];
  const secretsInto = values["secrets-into"];
  return ok({
    compare: values["compare"] === true,
    dropAfter: values["drop-after"] === true,
    from: typeof from === "string" ? from : "",
    into: target.value,
    json: values["json"] === true,
    storage,
    ...(typeof home === "string" ? { home } : {}),
    ...(typeof filesInto === "string" ? { filesInto } : {}),
    ...(typeof secretsInto === "string" ? { secretsInto } : {}),
  });
}

/**
 * Parse a `store backup-register` invocation.
 *
 * @param rest the argv tail
 * @returns the arguments, or every reason the invocation was refused
 */
export function parseStoreBackupRegisterArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<StoreBackupRegisterArgs, StoreCommandError> {
  const parsed = parseFlags({ args: rest, spec: BACKUP_REGISTER_FLAGS });
  if (parsed.isErr()) {
    return err(StoreCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = parsed.value.values;
  const cadenceRaw = values["cadence"];
  const cadence = typeof cadenceRaw === "string" ? cadenceRaw.trim() : DEFAULT_BACKUP_CADENCE;
  if (cadence.split(/\s+/).length !== 5) {
    return err(StoreCommandErrors.cadenceInvalid({ got: cadence }));
  }
  const home = values["home"];
  return ok({ cadence, json: values["json"] === true, ...(typeof home === "string" ? { home } : {}) });
}

/**
 * The daily backup's recipe row.
 *
 * @param cadence when it is due
 * @returns the definition, as the store parses it
 */
export function backupRecipeDefinition({ cadence }: { cadence: string }): RecipeDefinition {
  return {
    cadence,
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "backfill",
    params: { argv: ["store", "backup"] },
    recipeId: BACKUP_RECIPE_ID,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

/**
 * The hourly sweep's recipe row: `store backup --sweep-only`, every hour at half past.
 *
 * A night with the pinned drive out stages here and sends nothing, so without this row that night waits for the
 * next nightly's NAMING line and a hand-typed sweep. Hourly, a missed night starts sending at the first firing
 * after the drive is plugged back in, while the scheduler ticks and the row is not held — a staging that will not
 * go fails the firing, and the scheduler's failure policy then holds the row behind a finding.
 *
 * With the drive still out the sweep prints `drive not plugged in at <mount point>` and exits 0 without reading
 * the key. With the drive in and nothing stranded it sends nothing, so that hour costs one Keychain read and one
 * directory listing.
 *
 * **`onMissed: "skip"`**: every sweep sends everything stranded, so a machine asleep for six hours needs one
 * sweep when it wakes, not six. **Half past**, so it never shares a slot with the 03:00 nightly; two sweeps
 * over the same staging at once are benign anyway (`src/store/backup/sweep.ts`).
 *
 * @returns the definition, as the store parses it
 */
export function backupSweepRecipeDefinition(): RecipeDefinition {
  return {
    cadence: BACKUP_SWEEP_CADENCE,
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: VERB_RUN_KIND,
    onMissed: "skip",
    params: { argv: ["store", "backup", "--sweep-only"] },
    recipeId: BACKUP_SWEEP_RECIPE_ID,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}
