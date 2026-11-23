/**
 * The PURE half of the store backup — every name, shape and decision, with no process, socket or clock.
 *
 * ## What a backup IS here
 *
 * One backup is a directory holding four files, and the same four under one object prefix in the destination —
 * five when a backup passphrase is set:
 *
 * - `files.json` — the files leg's manifest: every file under {@link BACKED_UP_FILE_ROOTS}, its path
 *   relative to the home, its length and its SHA-256. The BYTES live in the destination as content-addressed
 *   blobs — or, for a file of `CHUNKED_FILE_MIN_BYTES` or more, as the chunks its entry lists — rather than
 *   in this directory, so a staged backup is a manifest and a restore fetches what it names. These are the roots the owner ruled go FIRST, because they are what cannot be regenerated.
 * - `store.dump` — `pg_dump -Fc` of the ONE database the store selection names. Custom format, so
 *   `pg_restore` can rebuild it into any database name and the file is already compressed.
 * - `storage.tar` — the bytes under the local Supabase Storage volume. `storage.buckets` and
 *   `storage.objects` — the metadata — are tables inside the same database, so the dump carries them and
 *   the tar carries the objects they point at. A backup with one half and not the other restores a store
 *   that lists files it cannot open. The one writer through the Storage API is `store import-fleet --only
 *   measurements`, which puts every measurement body a text column cannot hold into the bucket
 *   `measurements` (`src/store/fleet/measurementStore.ts`) — so the tar carries those objects and the dump
 *   the `storage.objects` rows naming them. Atlas media is NOT in it and never was: screenshots and PDFs are
 *   plain files under `$SLOPWEAVER_HOME/atlas`, and they reach a backup through the files leg above.
 * - `manifest.json` — what the dump and the tar are: which database, which stack, when, how many bytes,
 *   and a SHA-256 of each. A restore reads the manifest FIRST and refuses a dump whose digest does not
 *   match, because a truncated download restores cleanly up to the point it was cut.
 * - `secrets.enc` — `$SLOPWEAVER_HOME/secrets/`, AES-256-GCM under the one passphrase the owner
 *   holds. Present iff a passphrase is set.
 *
 * ## Why the dump runs INSIDE the container
 *
 * The host's `pg_dump` is 15.19 (`pg_dump --version`, Homebrew) and the stack is Postgres 17.6.1
 * (`docker ps`); a `pg_dump` older than its server refuses with "aborting because of server version
 * mismatch". `supabase_db_<project>` carries 17.6, so every Postgres tool here is a `docker exec` into
 * it. That also means no password crosses the host: inside the container the `postgres` role connects
 * over the local socket. The container names are the Supabase CLI's own, `supabase_<service>_<project>`,
 * with the project id `supabase/config.toml` declares — a unit test pins the two together.
 *
 * ## The destination is resolved, never chosen
 *
 * The destination directory resolves through `./destination.ts` from `--destination`,
 * `SLOPWEAVER_BACKUP_DIRECTORY` or `secrets/store-backup-directory` in `$SLOPWEAVER_HOME`, never a constant,
 * and the object prefix is `<stack>/<instant>/` so two installs backing up into one destination never collide
 * and a listing reads in time order. There is no `latest` pointer: the newest prefix IS the latest, and a
 * pointer that lags a failed upload is the kind of lie a restore would trust.
 */
import { posix } from "node:path";

import { z } from "zod";

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
import { ATOMIC_WRITE_TEMP_TAIL as ATOMIC_WRITE_TEMP } from "#lib/writeAtomic.js";
import { type ChunkedContent, chunkedContentSchema, lengthsAgree } from "./chunkPlan.js";
import { type BackupError, BackupErrors } from "./errors.js";

/**
 * The Supabase project id `supabase/config.toml` declares, which names every container the CLI starts.
 *
 * Pinned by `src/__tests__/unit/store/backupPlan.test.ts` against the config file itself, so a renamed
 * project reddens the suite rather than leaving this verb exec-ing into a container that no longer exists.
 */
export const SUPABASE_PROJECT_ID = "slopweaver";

/**
 * The schemas the dump covers — what this install OWNS in the database, and nothing Supabase installs.
 *
 * `public` is the store, `drizzle` its migration bookkeeping (the record `yarn store:migrate` reads, and
 * what the baseline row is about), `storage` the Storage API's buckets and objects. Everything else in the
 * database — `auth`, `realtime`, `extensions`, `vault`, `supabase_functions` and their kin — is what
 * `yarn store:start` creates on any machine, and MEASURED: a whole-database dump restored into a
 * fresh database fails at `realtime.list_changes`, whose body sets `log_min_messages` and needs a
 * superuser the `postgres` role here is not. The stack is re-created by the CLI; only what is ours is
 * carried.
 */
export const DUMPED_SCHEMAS = ["public", "drizzle", "storage"] as const;

/**
 * The files one backup consists of, beside {@link FILES_MANIFEST}.
 *
 * `secrets` is present iff a `backup-passphrase` is set on the machine that took the backup — it is the
 * credentials directory encrypted under the one passphrase the operator holds in their password manager. The
 * manifest says which of those two happened; a reader must never infer it from the file being there,
 * because a partial download looks identical.
 */
export const BACKUP_FILES = {
  dump: "store.dump",
  manifest: "manifest.json",
  secrets: "secrets.enc",
  storage: "storage.tar",
  vault: "vault.enc",
} as const;

/** Where the Storage API keeps its objects inside its own container — the path the tar is cut from. */
export const STORAGE_VOLUME_MOUNT = "/mnt";

/**
 * The manifest version this build WRITES, so a reader can refuse a shape it does not know rather than misread it.
 *
 * Version 2 added one field to the dump and to every files entry, `chunked` (`./chunkPlan.ts`): the chunk
 * list a large file is stored as, or `null` for one stored whole. A version-1 manifest has neither and reads
 * as `null` throughout, which is exactly what it meant — so every backup taken before chunking still parses
 * and still restores.
 *
 * Version 3 added `vault` (owner ruling): the Vault leg's secrets, sealed under the backup key into
 * `vault.enc` before they touch the staging directory, exactly as the credentials leg seals `secrets.enc`. It is
 * `null` only for a backup taken with no key to seal them under, which is then said rather than skipped. A
 * version-1 or version-2 manifest reads it as `null`. How the destination's objects were encrypted is not here:
 * that is a fact about SENDING a staging, so the upload receipt records it.
 */
export const BACKUP_MANIFEST_VERSION = 3;

/** Every manifest version this build READS. */
type BackupManifestVersion = 1 | 2 | typeof BACKUP_MANIFEST_VERSION;

const versionSchema = z.union([z.literal(1), z.literal(2), z.literal(BACKUP_MANIFEST_VERSION)]);

/** The Vault leg: `vault.enc`'s length and digest, how many secrets it seals, and under which key. */
export interface VaultArtefact extends BackupArtefact {
  readonly rows: number;
  /** The first 16 hex digits of the sealing key's SHA-256 — which key, never the key. */
  readonly keyFingerprint: string;
}

/** The dump, as the manifest records it: the whole file's length and digest, and its chunks when chunked. */
export interface DumpArtefact extends BackupArtefact {
  /** The chunk list the dump is stored as, or `null` for a dump sent as one object (every version-1 backup). */
  readonly chunked: ChunkedContent | null;
}

/** One artefact of a backup, as the manifest records it. */
export interface BackupArtefact {
  readonly bytes: number;
  readonly sha256: string;
}

/** One extension the dumped schemas depend on, which a `-n`-scoped dump does not carry and a restore creates first. */
export interface BackupExtension {
  readonly name: string;
  readonly schema: string;
}

/** What one backup is, as written beside its two payloads and uploaded with them. */
export interface BackupManifest {
  readonly version: BackupManifestVersion;
  /** When the dump began, ISO-8601. Also the last segment of the object prefix. */
  readonly createdAtIso: string;
  /** The Supabase project the containers belong to. */
  readonly project: string;
  /** The database that was dumped — the one the store selection named. */
  readonly database: string;
  /** `pg_dump --version`, verbatim, so a restore onto an older server has something to point at. */
  readonly pgDumpVersion: string;
  /** The schemas the dump was scoped to, so a reader knows what is NOT in it. */
  readonly schemas: readonly string[];
  /** Extensions installed INTO a dumped schema. `pg_dump -n` omits every `CREATE EXTENSION`; a restore replays these. */
  readonly extensions: readonly BackupExtension[];
  readonly dump: DumpArtefact;
  readonly storage: BackupArtefact;
  /**
   * The encrypted credentials bundle, or `null` when no `backup-passphrase` was set and they were NOT
   * carried.
   *
   * REQUIRED rather than optional, and that is the whole point of the field. An omitted key and a key
   * holding `null` read identically to a careless caller, so the schema demands it: a manifest that does
   * not say cannot be parsed, and nobody discovers at recovery time that the leg silently did not run.
   */
  readonly secrets: BackupArtefact | null;
  /**
   * The sealed Vault leg, or `null` when the backup had no key to seal it under (and every v1/v2 backup).
   * REQUIRED on a version-3 manifest for the same reason `secrets` is.
   */
  readonly vault: VaultArtefact | null;
}

const artefactSchema = z.object({ bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });

const manifestSchema = z
  .object({
    createdAtIso: z.iso.datetime(),
    database: z.string().min(1),
    dump: artefactSchema.extend({ chunked: chunkedContentSchema.nullable().default(null) }),
    extensions: z.array(z.object({ name: z.string().min(1), schema: z.string().min(1) }).strict()),
    pgDumpVersion: z.string().min(1),
    project: z.string().min(1),
    schemas: z.array(z.string().min(1)).min(1),
    secrets: artefactSchema.nullable(),
    storage: artefactSchema,
    vault: artefactSchema
      .extend({ keyFingerprint: z.string().regex(/^[0-9a-f]{16}$/), rows: z.number().int().nonnegative() })
      .strict()
      .nullable()
      .optional(),
    version: versionSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const saysVault = manifest.vault !== undefined;
    if (manifest.version < BACKUP_MANIFEST_VERSION && saysVault) {
      ctx.addIssue({
        code: "custom",
        message: `a version-${String(manifest.version)} manifest carries no vault`,
        path: ["vault"],
      });
    }
    if (manifest.version === BACKUP_MANIFEST_VERSION && !saysVault) {
      ctx.addIssue({ code: "custom", message: "a version-3 manifest must say vault, null or not", path: ["vault"] });
    }
  })
  .transform((manifest) => ({ ...manifest, vault: unsetFieldAsNull({ key: "vault", record: manifest }) }));

/**
 * Parse a manifest read back from disk or from the destination.
 *
 * @param value the decoded JSON
 * @returns the manifest, or every reason it is not one
 */
export function parseBackupManifest({ value }: { value: unknown }): Result<BackupManifest, BackupError> {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      BackupErrors.manifestInvalid({ manifest: "backup", reasons: issueLines({ issues: parsed.error.issues }) }),
    );
  }
  return ok(parsed.data);
}

/** One line per schema issue, each led by the path it is about. */
function issueLines({ issues }: { issues: readonly z.core.$ZodIssue[] }): readonly string[] {
  return issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`);
}

/**
 * The container the Supabase CLI runs one service in, for the project this repository declares.
 *
 * @param service the CLI's own service name — `db`, `kong` (the API gateway), `storage`
 * @returns the container name `docker exec` takes
 */
export function supabaseContainer({ service }: { service: "db" | "kong" | "storage" }): string {
  return `supabase_${service}_${SUPABASE_PROJECT_ID}`;
}

/**
 * The database a store connection string names.
 *
 * @param url the store selection's connection string
 * @returns the database name, or why the string names none
 */
export function databaseNameOf({ url }: { url: string }): Result<string, BackupError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(BackupErrors.storeUrlUnreadable());
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (name.length === 0 || name.includes("/")) {
    return err(BackupErrors.storeDatabaseMissing());
  }
  return ok(name);
}

/**
 * The same connection string pointed at another database in the same server — how a restore proof reads
 * the restored copy through the ordinary client without inventing a second credential.
 *
 * @param url the store selection's connection string
 * @param database the database to address instead
 * @returns the rewritten connection string, or why the original could not be rewritten
 */
export function withDatabase({ url, database }: { url: string; database: string }): Result<string, BackupError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(BackupErrors.storeUrlUnrewritable());
  }
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return ok(parsed.toString());
}

/**
 * A safe Postgres identifier for a database a restore creates — refused rather than quoted, because the
 * name also travels through `createdb` argv and a destination path.
 *
 * @param name what the caller asked for
 * @returns the name, or why it was refused
 */
export function validateDatabaseName({ name }: { name: string }): Result<string, BackupError> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    return err(BackupErrors.databaseNameInvalid({ name }));
  }
  return ok(name);
}

/**
 * The object prefix one backup lands under: `<project>/<instant>/`.
 *
 * The instant keeps its colons out of the path — an ISO instant such as `<date>T03:00:00.000Z` becomes
 * `<date>T03-00-00-000Z` — so the same prefix is usable as a directory name on a filesystem that
 * refuses colons, and a listing still sorts in time order.
 *
 * @param project the Supabase project id
 * @param createdAtIso the backup's own instant
 * @returns the prefix, with its trailing slash
 */
export function backupPrefix({ project, createdAtIso }: { project: string; createdAtIso: string }): string {
  return `${project}/${backupDirectoryName({ createdAtIso })}/`;
}

/**
 * The directory name one backup stages under, and the last segment of its object prefix.
 *
 * @param createdAtIso the backup's own instant
 * @returns the instant with every character a path refuses replaced
 */
export function backupDirectoryName({ createdAtIso }: { createdAtIso: string }): string {
  return createdAtIso.replace(/[:.]/g, "-");
}

/**
 * The full object name of one artefact under a prefix.
 *
 * @param prefix the backup's prefix, from {@link backupPrefix}
 * @param file which of the three
 * @returns the object name
 */
export function objectNameFor({ prefix, file }: { prefix: string; file: keyof typeof BACKUP_FILES }): string {
  return `${prefix}${BACKUP_FILES[file]}`;
}

/**
 * Which staged backup directories a successful upload lets go of.
 *
 * A staging directory is kept until a LATER backup has been uploaded and verified — the newest is always
 * kept, and one that never uploaded is always kept, so the only thing ever removed is a copy the destination
 * already holds and a newer local copy already supersedes. Owner steer: nothing gets deleted until
 * it was last needed a while ago; a verified copy in the destination is what makes a local one no longer needed.
 *
 * With a LIST of destinations, "uploaded" means every destination the staging still owes holds a readable
 * receipt for it: one reached this Mac's folder and not the unplugged SSD is still owed, so it is kept.
 * `./staging.ts`'s `pruneStaging` decides that per directory; this function only orders and cuts.
 *
 * "One that never uploaded is always kept" is a statement about this function, not about the disk: a
 * receiptless staging is swept into the destination by `sweepStrandedStagings` before this runs, so what reaches
 * here having never uploaded is a copy that genuinely could not be sent — and holding those is the point.
 *
 * @param staged every staging directory name, with whether every destination it owes holds its receipt
 * @param keep how many eligible directories to keep locally, newest first
 * @returns the directory names to remove, oldest first
 */
export function stagingToPrune({
  staged,
  keep,
}: {
  staged: readonly { name: string; eligible: boolean }[];
  keep: number;
}): readonly string[] {
  const eligible = staged
    .filter((entry) => entry.eligible)
    .map((entry) => entry.name)
    .toSorted();
  if (eligible.length <= keep) {
    return [];
  }
  return eligible.slice(0, eligible.length - keep);
}

/**
 * The FILES the backup carries before it touches the database — owner ruling: bronze, members and
 * lessons first and the database second, because the files are what cannot be regenerated. The store is a projection of bronze and will be RESET
 * rather than migrated, so the dump is the second leg. `corpus/history` is here on the same principle:
 * it is an event log of edits nothing can be asked for again.
 *
 * ## Why the two content-addressed sidecars are ORIGINALS, not copies of bronze
 *
 * `corpus/attachments` and `corpus/bodies` look like things bronze already holds, and they are the
 * opposite: bronze holds the POINTERS and these hold what the pointers name. A record carries an
 * attachment's SHA-256 and never its url, because Notion's signed urls expire inside the hour — so a url
 * in bronze is "a dead pointer by the time anyone reads it, and worse, it looks live"
 * (`corpus/notion/attachmentStore.ts`). Backing up bronze without these restores a corpus whose every
 * attachment reference resolves to nothing, with no re-fetch path from what was restored.
 * `corpus/bodies` is the same shape one step along: a Notion record's `raw` has only ever held the PAGE
 * object, never the body, so a parsed body is the one thing a re-derivation cannot rebuild without
 * re-fetching the whole workspace (`corpus/notion/bodyStore.ts`).
 *
 * ## `atlas` is the THIRD instance of that same shape, and it was the one nobody added
 *
 * An atlas entity's `artifacts` field is a list of `{byteLength, kind, mediaType, relativePath, sha256}`
 * — a POINTER, exactly as a bronze record's attachment reference is, and `store/schema/atlas.ts` stores
 * it as `jsonb`. So `store import-atlas` puts the atlas's rows in Postgres and has never carried one byte
 * of what those rows point AT. Measured on this install: 1,915,850,793 bytes across 4,985
 * files under `$SLOPWEAVER_HOME/atlas` — 3,101 PNG, 239 PDF, 1,350 JSON — in no backup at all, while
 * `storage.buckets` and `storage.objects` were both 0 rows. Restore the database without this root and
 * every one of those artifact pointers resolves to nothing, which is the `corpus/attachments` failure
 * one platform over.
 *
 * **And the re-walk is not a recovery path here.** A Notion body can be re-fetched at a price; most of
 * these atlases cannot resync unattended at all (`cli/commands/store/importAtlasRun.ts`), so the files
 * are not "derivable at a price nobody would pay" — they are not derivable. The whole root goes in, kind
 * files and `_superseded` generations included: the files are authoritative and the tables are a
 * projection, which is the same reason `corpus/bronze` is on this list while the store also holds it.
 * Reproduce the measurement:
 * `find "$SLOPWEAVER_HOME/atlas" -type f ! -name '*.jsonl' -exec stat -f %z {} + | awk '{s+=$1} END {print s, NR}'`
 *
 * The ORDER here is legibility only — the corpus roots grouped, then `atlas`, `knowledge` last. Nothing
 * observes it: `walkBackedUpFiles` path-sorts every entry it returns, and a restore reads the manifest's
 * `files` rather than its `roots`. Which also means an older backup taken under a shorter list still
 * restores.
 *
 * ## `pages` and `published-pages` ride here only until they are retired
 *
 * Measured, 36 MiB of pages and 92 MiB of frozen versions sat on no backup at all, so a lost Mac lost every
 * page the owner had reacted to. They move into the store's Storage (`docs/store/published-pages.md`), and the backup taken
 * before those two folders are set aside must be able to give them back. Once they are gone these two entries walk
 * nothing, and they leave the list in the change that retires the folders. Reproduce:
 * `du -sh "$SLOPWEAVER_HOME/pages" "$SLOPWEAVER_HOME/published-pages"`
 *
 * The walk follows a directory symlink, so one under either folder would back up what it points at and restore as a
 * real directory, and a cycle would fail the walk. Measured, neither folder holds one; the import resolves
 * any that appear before the folders retire. Reproduce: `find "$SLOPWEAVER_HOME/pages" "$SLOPWEAVER_HOME/published-pages" -type l`
 *
 * A freeze's `latest.json` names its version by an absolute `path`, which restored into a different home points at
 * the old one. Nothing is lost: the same record carries the `key` and `sha256`, and each version file is named by its
 * own hash, so the import resolves a version by key and hash and never by that path.
 *
 * Relative to `$SLOPWEAVER_HOME`. Widen this list, never a flag — a root a flag forgot is a file lost.
 * The ONE thing a root does not carry is {@link isBackedUpFileEligible}'s subject, and that is a fixed
 * rule rather than the flag this paragraph refuses.
 */
export const BACKED_UP_FILE_ROOTS = [
  "corpus/bronze",
  "corpus/members",
  "corpus/history",
  "corpus/attachments",
  "corpus/bodies",
  "atlas",
  "knowledge",
  "pages",
  "published-pages",
] as const;

/** The path component an atlas writes a withheld value under, below its own platform directory. */
const SENSITIVE_COMPONENT = "_sensitive";

/*
 * ATOMIC_WRITE_TEMP is the name `#lib/writeAtomic.ts` gives a write in flight: `<target>.<pid>.<uuid>.tmp`, exactly.
 *
 * Such a file is never data. A live one is a write not yet renamed into place, and one whose writer died is
 * a partial write nothing will ever finish. MEASURED: two orphaned
 * `corpus/bronze/slack/compact.jsonl.<pid>.<uuid>.tmp` files, 20.4 GB between them from dead writers, were
 * what turned a nightly backup into a projected eighteen-hour one
 * (`find "$SLOPWEAVER_HOME/corpus" -name '*.tmp' -size +1G`). The pattern is the writer's exact shape rather
 * than any `.tmp` suffix, so a file some provider merely named `notes.tmp` is still carried — and it is the
 * writer's OWN pattern, imported, so the two cannot drift.
 */

/**
 * Whether one backed-up file is carried by the files leg — the two exclusions it applies.
 *
 * **An atomic write in flight** ({@link ATOMIC_WRITE_TEMP}) is never carried, under any root: it is a
 * partial copy of a file the leg carries anyway, once it lands under its real name.
 *
 * **A withheld atlas value** is the other, and the rest of this comment is about it.
 * An atlas withholds a value it judges too sensitive to publish into its kind files and writes it to a
 * companion under `atlas/<platform>/_sensitive/` instead (`stateHome.ts`'s `AtlasPlatformPaths.sensitive`;
 * `atlas/vanta/privacy.ts` is the writer that exists today, for financial values). Those companions are
 * the one thing under a backed-up root that is withheld BY CONSTRUCTION, and the files leg ships blobs to
 * the destination outside the sealed bundle while `secrets/` gets AES-256-GCM — so uploading them would route
 * around the one control the owner required. There were ZERO of them on this install when `atlas` joined the list
 * (measured), which is exactly why the rule is here: it has to hold for the run that writes
 * the first one, not for the tree that was measured.
 *
 * It is a fixed rule and not a flag, for the reason {@link BACKED_UP_FILE_ROOTS} gives, and it is
 * POSITIONAL rather than a search for the name anywhere below `atlas`. `atlasHomeShared.ts`'s
 * `atlasPlatformPaths` puts the companion directory at exactly one depth per generation, and a
 * `_sensitive` deeper than that is a directory some provider ID built: `atlas/vanta/policyDocuments.ts`
 * names an artifact directory `encodeURIComponent(providerId)`, and `_` is unreserved, so a resource
 * whose id IS `_sensitive` yields `atlas/vanta/artifacts/policy-document/_sensitive/source.pdf` — a
 * legitimate PDF that a depth-blind rule drops from the backup silently. A file merely NAMED `_sensitive`, an `artifacts/_sensitive-preview.png`, and a `_sensitive`
 * directory under any other root are all carried for the same reason.
 *
 * The archived depth is read off `atlas/kit/reset.ts`, not guessed from the live one: it `renameSync`s the
 * platform directory whole, so the companion lands one level BELOW the archive id rather than beside it.
 * Getting that wrong ships every archived withheld value in the clear while the live ones stay home —
 * a failure that is invisible on a tree with no archives yet, which is every fresh install.
 *
 * Encrypting the companions into the backup instead is a format change, and a separate one.
 *
 * @param relativePath the file's path under the home, slash-separated as the manifest records it
 * @returns whether the files leg carries it
 */
export function isBackedUpFileEligible({ relativePath }: { relativePath: string }): boolean {
  if (ATOMIC_WRITE_TEMP.test(relativePath)) {
    return false;
  }
  const components = relativePath.split("/");
  if (components[0] !== "atlas") {
    return true;
  }
  // `<platform>/_sensitive/…` for a live generation, and `_superseded/<platform>/<archiveId>/_sensitive/…`
  // once `reset` has archived one: `atlas/kit/reset.ts` renames the WHOLE platform directory into the
  // archive slot, companion included, so the archived shape is the live shape with two components in
  // front of it. Those are the only two the builders produce.
  const archived = components[1] === "_superseded";
  const companionDepth = archived ? 4 : 2;
  // The last component is the file's own name, so the companion has to be a directory holding something.
  const withheld = components[companionDepth] === SENSITIVE_COMPONENT && components.length > companionDepth + 1;
  return !withheld;
}

/** One entry of `files.json`: a backed-up file, and its chunks when it is too large to be one blob. */
export interface ManifestFile extends BackedUpFile {
  /** The chunk list the file is stored as, or `null` for a file stored as one blob at {@link blobObjectName}. */
  readonly chunked: ChunkedContent | null;
}

/** The manifest of the files leg, written beside the dump and the tar and uploaded under the same prefix. */
export const FILES_MANIFEST = "files.json";

/** One backed-up file: where it lives under the home, and what its bytes digest to. */
export interface BackedUpFile {
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The files leg's manifest. Each entry lives at {@link blobObjectName}, or as the chunks its `chunked` names. */
export interface FilesManifest {
  readonly version: BackupManifestVersion;
  readonly createdAtIso: string;
  readonly roots: readonly string[];
  readonly files: readonly ManifestFile[];
}

/**
 * Whether a recorded path names a file INSIDE the restore root, in the one spelling the walk writes: relative,
 * already normalised, and not climbing out. `dir/../a` and `a` would restore to one file, and `../x` to one
 * outside the directory the operator named, so neither is a path a restore may write to.
 *
 * @param path the entry's recorded path
 * @returns true when it is contained and canonical
 */
function isContainedPath({ path }: { path: string }): boolean {
  return !posix.isAbsolute(path) && posix.normalize(path) === path && path !== ".." && !path.startsWith("../");
}

const filesManifestSchema = z
  .object({
    createdAtIso: z.iso.datetime(),
    files: z
      .array(
        z
          .object({
            bytes: z.number().int().nonnegative(),
            chunked: chunkedContentSchema.nullable().default(null),
            relativePath: z
              .string()
              .min(1)
              .refine((path) => isContainedPath({ path }), "a relativePath must be normalised and inside the root"),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .refine(
        (files) => new Set(files.map((file) => file.relativePath)).size === files.length,
        "two entries name the same relativePath",
      )
      .refine((files) => lengthsAgree({ refs: files }), "a file digest is recorded at two lengths"),
    roots: z.array(z.string().min(1)).min(1),
    version: versionSchema,
  })
  .strict();

/**
 * Parse a files manifest read back from disk or from the destination.
 *
 * @param value the decoded JSON
 * @returns the manifest, or every reason it is not one
 */
export function parseFilesManifest({ value }: { value: unknown }): Result<FilesManifest, BackupError> {
  const parsed = filesManifestSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      BackupErrors.manifestInvalid({ manifest: "files", reasons: issueLines({ issues: parsed.error.issues }) }),
    );
  }
  return ok(parsed.data);
}

/**
 * Where one file's bytes live in the destination: by DIGEST, not by path, so a file that did not change costs
 * nothing tonight and two paths with the same bytes share one object.
 *
 * @param project the Supabase project id, the same top-level segment the dump prefixes use
 * @param sha256 the file's digest
 * @returns the object name
 */
export function blobObjectName({ project, sha256 }: { project: string; sha256: string }): string {
  return `${blobPrefix({ project })}${sha256}`;
}

/**
 * The prefix every blob of one project lives under — what the skip test lists ONCE rather than asking the
 * destination about each file.
 *
 * @param project the Supabase project id, the same top-level segment the dump prefixes use
 * @returns the prefix, ending in a slash
 */
export function blobPrefix({ project }: { project: string }): string {
  return `${project}/blobs/`;
}

/**
 * Which blobs the destination already holds AT THE RIGHT LENGTH, given one listing of the blob prefix. Pure.
 *
 * Presence alone is not enough: a name carrying the wrong bytes is the poisoned blob `./transport.ts`'s
 * `objectSizes` describes, and skipping on the name would make that state permanent, so a wrong length is not held.
 *
 * @param files every backed-up file the walk measured
 * @param sizes each listed object's name mapped to its length; a name listed with no size is left out
 * @param project the Supabase project id the blob names are built under
 * @returns the digests that need no upload
 */
export function blobsHeld({
  files,
  sizes,
  project,
}: {
  files: readonly BackedUpFile[];
  sizes: ReadonlyMap<string, number>;
  project: string;
}): ReadonlySet<string> {
  const held = new Set<string>();
  for (const file of files) {
    if (sizes.get(blobObjectName({ project, sha256: file.sha256 })) === file.bytes) {
      held.add(file.sha256);
    }
  }
  return held;
}

/**
 * Compare a set of restored files to the manifest that described them.
 *
 * @param manifest what was backed up
 * @param restored what came back, digested the same way
 * @returns every path whose digest or presence differs, empty when the restore is faithful
 */
export function filesDifferences({
  manifest,
  restored,
}: {
  manifest: readonly BackedUpFile[];
  restored: readonly BackedUpFile[];
}): readonly string[] {
  const byPath = new Map(restored.map((file) => [file.relativePath, file]));
  return manifest.flatMap((file) => {
    const back = byPath.get(file.relativePath);
    if (back === undefined) {
      return [`${file.relativePath}: missing after restore`];
    }
    if (back.sha256 !== file.sha256 || back.bytes !== file.bytes) {
      return [`${file.relativePath}: digest differs after restore`];
    }
    return [];
  });
}
