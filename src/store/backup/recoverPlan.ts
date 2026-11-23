/**
 * The pure half of `slopweaver store recover`: which connection string the recovered database is reached by,
 * what to do with each file or credential the home may already hold, and the marker a re-run resumes from.
 *
 * Nothing here touches the disk, the stack or the destination — `./recoverFiles.ts` is the edge and `./recover.ts`
 * the sequence — so every decision a recovery makes about a home it did not build is a unit test.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { STORE_URL_SECRET } from "../config.js";
import { withDatabase } from "./plan.js";
import { type RecoverError, RecoverErrors } from "./recoverErrors.js";
import { BACKUP_PASSPHRASE_SECRET } from "./secretsBundle.js";

/** The recovered database's connection string, and the home's own database it may repoint `store-url` away from. */
export interface RecoveredStoreUrl {
  readonly url: string;
  /**
   * The database this home's own `secrets/store-url` names, when the URL was derived from it — the one case a
   * recovery may repoint that credential. `null` for a URL derived from the environment's `SLOPWEAVER_STORE_URL`, a
   * one-off selection that never changes the remembered store, so it may fill an empty home but never replace what
   * the home holds.
   */
  readonly homeStoreDatabase: string | null;
}

/**
 * The connection string the recovered database is reached by: the selected store, rewritten to name the recovered
 * database, so its login, host and port are the ones `yarn store:start` wrote for this stack.
 *
 * With no store selected there is nothing to rewrite, and it refuses rather than guess a login: the image's
 * default `postgres:postgres` is the login the store lock refuses, so a recovery built on it fails only after
 * the long restore. `yarn store:start` locks the stack and writes `store-url`.
 *
 * @param selection the store already selected and where it came from, or `null` when none is
 * @param database the recovered database
 * @returns the URL and its authority over the home's `store-url`, or why it could not be derived
 */
export function recoveredStoreUrl({
  selection,
  database,
}: {
  selection: { url: string; origin: "environment" | "secret" } | null;
  database: string;
}): Result<RecoveredStoreUrl, RecoverError> {
  if (selection === null) {
    return err(
      RecoverErrors.urlUnresolved({
        reasons: [
          "no store is selected: run `yarn store:start` from the checkout first, which locks the stack and writes " +
            "secrets/store-url, then run store recover again",
        ],
      }),
    );
  }
  return withDatabase({ database, url: selection.url })
    .map((url) => ({
      homeStoreDatabase: selection.origin === "secret" ? databaseNameOf({ url: selection.url }) : null,
      url,
    }))
    .mapErr((error) => RecoverErrors.urlUnresolved({ reasons: [error.message] }));
}

/**
 * Whether the home's own `store-url` may be repointed from the database it names at the recovered one: only when
 * that database holds no store, judged exactly as the restore refusal judges its target (`databaseAction`) — any
 * table in its `public` schema. On a fresh stack it holds none, since `yarn store:start` migrates nothing and `store
 * push` is the one migrator. On a Mac already in use it is the live store, and repointing would move every verb
 * off it silently, so the recovery refuses before anything is downloaded and names the way to recover beside it.
 *
 * @param current the database the home's `store-url` names now
 * @param recovered the database this recovery restores into
 * @param publicTables how many tables `current`'s `public` schema holds, `0` when it does not exist
 * @returns nothing when the repoint may happen, else the refusal
 */
export function homeStoreUrlRepoint({
  current,
  recovered,
  publicTables,
}: {
  current: string;
  recovered: string;
  publicTables: number;
}): Result<void, RecoverError> {
  if (publicTables === 0) {
    return ok(undefined);
  }
  return err(RecoverErrors.homeStoreInUse({ current, recovered }));
}

/**
 * Whether two connection strings name the same scheme, login, password, host, port, options and fragment, and
 * differ only in the database. The one difference a recovery may write over: it derived the incoming URL from the present one.
 *
 * @param present the URL the home holds
 * @param incoming the URL the recovery derived
 * @returns true only when both parse and the database is the sole difference
 */
export function storeUrlDiffersOnlyByDatabase({ present, incoming }: { present: string; incoming: string }): boolean {
  if (!URL.canParse(present) || !URL.canParse(incoming)) {
    return false;
  }
  const before = new URL(present);
  const after = new URL(incoming);
  const sameConnection =
    before.protocol === after.protocol &&
    before.username === after.username &&
    before.password === after.password &&
    before.hostname === after.hostname &&
    before.port === after.port &&
    before.search === after.search &&
    before.hash === after.hash;
  return sameConnection && before.pathname !== after.pathname;
}

/**
 * The database a connection string names — its path, without the leading slash, decoded where it decodes. Never
 * the login, the host or the URL, so it can ride a report.
 *
 * @param url a URL that parses
 * @returns the database name
 */
export function databaseNameOf({ url }: { url: string }): string {
  const path = new URL(url).pathname.replace(/^\//u, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** What to do with one file or credential, given what the home already holds at its path. */
export type InstallDecision = "write" | "identical" | "conflict";

/**
 * Decide one install: write what is absent, skip what is byte-identical, and never overwrite a difference.
 *
 * Compared by SHA-256 rather than by bytes, so a multi-gigabyte bronze file is streamed through a digest and
 * never held whole.
 *
 * @param incoming the SHA-256 of what the backup carries
 * @param present the SHA-256 of what the home already holds at that path, or `null` when nothing is there
 * @returns the decision
 */
export function installDecision({ incoming, present }: { incoming: string; present: string | null }): InstallDecision {
  if (present === null) {
    return "write";
  }
  return incoming === present ? "identical" : "conflict";
}

/**
 * The bundle names a recovery installs as they are. `store-url` names the OLD machine's database and is
 * written from the recovered one instead; the passphrase is never in a bundle, and is filtered here too so a
 * hand-built bundle cannot carry one past the typed value. A name that is not one plain file name — a path
 * separator, `.` or `..` — is dropped, so no bundle can place a file outside `secrets/`.
 *
 * @param names every name the decrypted bundle wrote
 * @returns the names to install verbatim
 */
export function bundleNamesToInstall({ names }: { names: readonly string[] }): readonly string[] {
  return names.filter(
    (name) =>
      name !== STORE_URL_SECRET &&
      name !== BACKUP_PASSPHRASE_SECRET &&
      !/[/\\]/.test(name) &&
      name !== "." &&
      name !== "..",
  );
}

/** How far one recovery got, written after each long step so a re-run resumes rather than repeats. */
export interface RecoverMarker {
  readonly prefix: string;
  readonly database: string;
  readonly databaseRestoredAtIso: string | null;
  readonly filesRestoredAtIso: string | null;
  readonly secretsInstalledAtIso: string | null;
}

const RECOVER_MARKER = z.object({
  database: z.string().min(1),
  databaseRestoredAtIso: z.string().nullable(),
  filesRestoredAtIso: z.string().nullable(),
  prefix: z.string().min(1),
  secretsInstalledAtIso: z.string().nullable(),
});

/**
 * Read a marker back. A marker for another database is a fresh start for this one, never a resume.
 *
 * @param decoded the marker file's parsed JSON, or `null` when there is no file
 * @param prefix the backup this run recovers
 * @param database the database this run restores into
 * @returns the marker to resume from, a fresh one when there is nothing to resume
 */
export function resumeMarker({
  decoded,
  prefix,
  database,
}: {
  decoded: unknown;
  prefix: string;
  database: string;
}): RecoverMarker {
  const fresh: RecoverMarker = {
    database,
    databaseRestoredAtIso: null,
    filesRestoredAtIso: null,
    prefix,
    secretsInstalledAtIso: null,
  };
  const parsed = RECOVER_MARKER.safeParse(decoded);
  if (!parsed.success || parsed.data.prefix !== prefix || parsed.data.database !== database) {
    return fresh;
  }
  return parsed.data;
}

/**
 * Whether the database step may run: skipped when this recovery already restored it and it still holds tables,
 * refused when the database holds a store this recovery did not put there. A marker whose database has since
 * emptied or gone restores again rather than trusting the marker.
 *
 * @param marker how far this recovery got
 * @param publicTables how many tables the target's `public` schema holds, `0` when it does not exist
 * @returns `"restore"` or `"skip"`, or the refusal
 */
export function databaseAction({
  marker,
  publicTables,
}: {
  marker: RecoverMarker;
  publicTables: number;
}): Result<"restore" | "skip", RecoverError> {
  if (publicTables === 0) {
    return ok("restore");
  }
  if (marker.databaseRestoredAtIso !== null) {
    return ok("skip");
  }
  return err(RecoverErrors.databaseHoldsStore({ database: marker.database }));
}

/** What never rides the backup, so a recovery's report names each rather than implying it came back. */
export const NOT_IN_ANY_BACKUP: readonly string[] = [
  "sign-ins: each Claude plan (`slopweaver plans list`) and each Codex account is a fresh sign-in — `claude-accounts/` and `~/.codex*` never leave a machine",
  "`hygiene-denylist.txt`: every word in it is one the backup refuses to store — re-create it by hand",
  "the session transcripts under `~/.claude/projects/`",
  "the plugin install: follow skills/dogfood/SKILL.md",
  "absolute paths in `plans.json` and `profile.json` name the old machine's user directory — if it differs, re-home each plan with `plans set-store-dir` and edit `profile.json`, and move each auto-memory `memory/` directory, which comes back under its old project name",
  "Supabase Storage objects (the measurements' media): `storage.tar` is downloaded and digest-verified, never unpacked by this verb",
];
