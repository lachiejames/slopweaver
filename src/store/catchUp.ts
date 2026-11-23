/**
 * The effectful half of the door's catch-up — gather the three conditions {@link ./catchUpCore.catchUpDecision}
 * judges, apply when it says so, and refuse to open unless `store verify` then reads the database clean.
 *
 * Called by `connectStore` on a `behind` database and by nothing else: every verb opens the store through that
 * one door, so this is where a landed migration reaches the database whichever path moved the installed tree — a
 * `checkout sync`, a hook, a pull with hooks off, a desktop rebuild. A hook would cover only the paths it is
 * wired to, and a hook's failure fails no ref move; the door is the one place every read already passes.
 *
 * Concurrency is `applyStore`'s own advisory lock: two processes that both read `behind` serialise there, and the
 * second records nothing, because the migrator applies only entries newer than the last one recorded — so its
 * outcome is `current`, never a second claim to have applied the same tags.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hatchFor } from "../hatch/lookup.js";
import { hatchOpen } from "../hatch/open.js";
import { hatchRefusal } from "../hatch/render.js";
import { logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";

import { migratorSelectionDeclined, reachableCode } from "./catchUpCatalog.js";
import { catchUpDecision, caughtUpLine, nonAdditiveStatements, recordedTags } from "./catchUpCore.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { strictUtf8 } from "./landedRead.js";
import { readJournal, readLandedMigrations, verifyStore } from "./lifecycle.js";
import { type MigrationState, migrationStateLine, unlandedMigrationDetails } from "./lifecycleCore.js";
import { verifyLines } from "./lifecycleVerify.js";
import { isLocalStoreUrl } from "./localStoreUrl.js";
import { applyStore, firstLineOf, MIGRATIONS_DIR } from "./migrate.js";

/**
 * What a catch-up did: applied the named tags; found the database already brought current by another verb that held
 * the lock first; or declined, and said why.
 *
 * @internal — `connectStore` branches on it
 */
export type CatchUpOutcome =
  | { readonly kind: "applied"; readonly pending: readonly string[] }
  | { readonly kind: "current" }
  | { readonly kind: "declined"; readonly why: string };

/**
 * Every pending statement off the additive allowlist, read from this tree's own files. A file that is not valid
 * UTF-8 declines too: its hash is drizzle's hash of the decoded text, so only a strict decode makes the landed
 * comparison byte for byte ({@link strictUtf8}).
 *
 * @param cwd the tree the migrations are read from
 * @param pending the tags the database has not recorded
 * @returns one line per such statement, or one line naming a file that could not be read or is not valid UTF-8
 */
function pendingNonAdditive({ cwd, pending }: { cwd: string; pending: readonly string[] }): readonly string[] {
  return pending.flatMap((tag) => {
    const path = join(cwd, MIGRATIONS_DIR, `${tag}.sql`);
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error: unknown) {
      return [`${tag}: ${path} could not be read (${error instanceof Error ? error.message : String(error)})`];
    }
    try {
      return nonAdditiveStatements({ sql: strictUtf8({ bytes }), tag });
    } catch {
      return [`${tag}: ${path} is not valid UTF-8, so its landed copy cannot be compared byte for byte`];
    }
  });
}

/**
 * Copy a folder as plain files and folders, following every symlink to the bytes it points at. `cpSync`'s own
 * `dereference` does not reach a link INSIDE the folder (measured on Node v24.21.0, Codex r31: the nested link is
 * kept, pointing back into the tree), so the walk reads each file itself. A folder already on the walk's path is
 * refused rather than entered again, so a link loop throws instead of recursing forever, and an entry that is
 * neither a regular file nor a folder (a FIFO, whose read would block for ever) throws before it is opened. Every
 * file and folder is created exclusively (`wx`, and `mkdirSync` without `recursive`), so two names that are distinct
 * in the checkout but one name in the temp volume (`A.sql` and `a.sql` from a case-sensitive checkout into a
 * case-insensitive temp root, Codex r31) throw rather than one silently overwriting the other.
 *
 * @param from the folder whose contents are copied, a symlink to one included
 * @param to where they land, created here
 * @param ancestors the real paths of the folders the walk is already inside
 */
function copyBytes({ from, to, ancestors = [] }: { from: string; to: string; ancestors?: readonly string[] }): void {
  const real = realpathSync(from);
  if (ancestors.includes(real)) {
    throw new Error(`${from} links back to a folder already being copied`);
  }
  if (!statSync(from).isDirectory()) {
    throw new Error(`${from} is not a folder, and the migrations are only ever read from one`);
  }
  mkdirSync(to);
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const entry = statSync(source);
    if (entry.isDirectory()) {
      copyBytes({ ancestors: [...ancestors, real], from: source, to: join(to, name) });
    } else if (entry.isFile()) {
      writeFileSync(join(to, name), readFileSync(source), { flag: "wx" });
    } else {
      throw new Error(`${source} is neither a file nor a folder, and a migration is only ever a file`);
    }
  }
}

/**
 * Copy this tree's migrations folder, journal included, under a fresh temporary root laid out as a tree, so what is
 * judged is byte for byte what is applied. The migrator re-reads its folder after waiting on the apply lock, and a
 * file changed in that wait — a `git checkout` onto a branch with its own migration, say — would otherwise be applied
 * unjudged. A hostile writer to the checkout is out of scope: it can rewrite this CLI.
 *
 * A copy that fails removes its own root before refusing, and a symlink, the folder itself or a file in it, is
 * copied as the bytes it points at rather than as a link back into the tree (both Codex r31).
 *
 * @param cwd the tree whose migrations are copied
 * @returns the temporary root to judge and apply from, which the caller removes
 */
function snapshotMigrations({ cwd }: { cwd: string }): Result<string, StoreError> {
  const folder = join(cwd, MIGRATIONS_DIR);
  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), "sw-catchup-"));
  } catch (error: unknown) {
    return err(StoreErrors.journalUnreadable({ detail: firstLineOf({ error }), folder }));
  }
  try {
    mkdirSync(join(root, MIGRATIONS_DIR, ".."), { recursive: true });
    copyBytes({ from: folder, to: join(root, MIGRATIONS_DIR) });
    return ok(root);
  } catch (error: unknown) {
    rmSync(root, { force: true, recursive: true });
    return err(StoreErrors.journalUnreadable({ detail: firstLineOf({ error }), folder }));
  }
}

/**
 * Bring a `behind` local store current when everything pending has landed and only adds, or say why not.
 *
 * @param url the connection string the door selected
 * @param cwd the tree the journal and the landed ref are read from
 * @param state the classification the door just read
 * @returns what was done; a failure when the journal does not read, the apply fails, or verify is not clean after it
 * @internal — `connectStore` is the one caller
 */
export async function catchUpStore({
  url,
  cwd,
  state,
}: {
  url: string;
  cwd: string;
  state: MigrationState;
}): Promise<Result<CatchUpOutcome, StoreError>> {
  const local = isLocalStoreUrl({ url });
  if (state.kind !== "behind" || !local) {
    const early = catchUpDecision({ local, nonAdditive: [], reachableCode: [], state, unlanded: [] });
    if (!early.apply) {
      return ok({ kind: "declined", why: early.why });
    }
  }
  const root = snapshotMigrations({ cwd });
  if (root.isErr()) {
    return err(root.error);
  }
  try {
    return await catchUpFromSnapshot({ cwd, root: root.value, state, url });
  } finally {
    rmSync(root.value, { force: true, recursive: true });
  }
}

/**
 * Judge and apply one snapshot of the migrations, then verify the real tree — the half of {@link catchUpStore} that
 * runs once the store is known local and `behind`.
 *
 * @param root the snapshot's temporary root, judged and applied from
 * @param cwd the real tree, whose landed ref and journal the verify reads
 * @returns what was done, as {@link catchUpStore} returns it
 */
async function catchUpFromSnapshot({
  url,
  cwd,
  root,
  state,
}: {
  url: string;
  cwd: string;
  root: string;
  state: MigrationState;
}): Promise<Result<CatchUpOutcome, StoreError>> {
  const journal = readJournal({ cwd: root });
  if (journal.isErr()) {
    return err(journal.error);
  }
  const entries = journal.value.slice(state.applied);
  const pending = entries.map((entry) => entry.tag);
  if (pending.join("\n") !== state.pending.join("\n")) {
    const moved = `${state.pending.join(", ")} when the door read it, ${pending.join(", ")} now`;
    return ok({ kind: "declined", why: `not caught up, because the journal moved during the catch-up (${moved})` });
  }
  const selection = await migratorSelectionDeclined({ applied: state.applied, journal: journal.value, url });
  if (selection.isErr() || selection.value !== undefined) {
    return selection.isErr() ? err(selection.error) : ok({ kind: "declined", why: selection.value! });
  }
  const reachable = await reachableCode({ url });
  if (reachable.isErr()) {
    return err(reachable.error);
  }
  const decision = catchUpDecision({
    local: true,
    nonAdditive: pendingNonAdditive({ cwd: root, pending }),
    reachableCode: reachable.value,
    state,
    unlanded: unlandedMigrationDetails({ landed: readLandedMigrations({ cwd }), pending: entries }),
  });
  if (!decision.apply) {
    return ok({ kind: "declined", why: decision.why });
  }
  const applied = await applyStore({ cwd: root, url });
  if (applied.isErr()) {
    return err(applied.error);
  }
  const verify = await verifyStore({ cwd, url });
  if (verify.isErr()) {
    return err(verify.error);
  }
  if (verify.value.findings.length > 0 || verify.value.state.kind !== "current") {
    return err(
      StoreErrors.lifecycleRefused({
        reasons: [
          `caught up ${decision.pending.join(", ")} and store verify is not clean`,
          ...verifyLines(verify.value),
        ],
      }),
    );
  }
  const recorded = recordedTags({ judged: decision.pending, recorded: applied.value.recorded });
  return ok(recorded.length > 0 ? { kind: "applied", pending: recorded } : { kind: "current" });
}

/**
 * Catch a `behind` database up, or say why not — and print the one line naming what was applied, only from the
 * process that actually recorded it, so two verbs racing the same catch-up print it once.
 *
 * @param catchUp `false` declines outright, for a caller that promised to change nothing
 * @param url the connection string the door selected
 * @param cwd the tree the journal and the landed ref are read from
 * @param state the `behind` classification just read
 * @returns the outcome, or the failure of the apply or of the verify after it
 * @internal — `connectStore` is the one caller
 */
export async function catchUpOrSay({
  catchUp,
  url,
  cwd,
  state,
}: {
  catchUp: boolean;
  url: string;
  cwd: string;
  state: MigrationState;
}): Promise<Result<CatchUpOutcome, StoreError>> {
  if (!catchUp) {
    return ok({ kind: "declined", why: "not caught up, because this is a dry run, which changes nothing" });
  }
  const outcome = await catchUpStore({ cwd, state, url });
  if (outcome.isOk() && outcome.value.kind === "applied") {
    logger.error({ msg: caughtUpLine({ pending: outcome.value.pending }) });
  }
  return outcome;
}

/**
 * Whether the operator opened the `stale-store` hatch. Read BEFORE any catch-up as well as at the refusal: the hatch's
 * own first exception is a database deliberately held at an older schema, which a catch-up would move, so an open hatch opens a `behind` database unchanged, exactly as it did before the door caught up.
 *
 * @param env the environment the hatch is read from
 * @param home the Slopweaver home the hatch's grant is read under
 * @returns true when the hatch is open
 */
export function staleHatchOpen({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
}): boolean {
  // `hatchOpen` reads `SLOPWEAVER_ALLOW_STALE_STORE` through the row's suffix; the constant is the same name.
  return hatchOpen({
    env,
    id: "stale-store",
    nowIso: new Date().toISOString(),
    ...(home === undefined ? {} : { home }),
  });
}

/**
 * The refusal for a database that is not `current`, unless the `stale-store` hatch is open.
 *
 * @param state the classification the door read, after any catch-up declined
 * @param notCaughtUp why a `behind` database was not caught up, appended to the refusal's detail
 * @param cwd the tree the landed migrations are read from, for a `foreign` database's line
 * @param env the environment the hatch is read from
 * @param home the Slopweaver home the hatch's grant is read under
 * @returns the typed refusal, or `undefined` when the database is current or the hatch is open
 */
export function staleStoreRefusal({
  state,
  notCaughtUp,
  cwd,
  env,
  home,
}: {
  state: MigrationState;
  notCaughtUp: string | undefined;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
}): StoreError | undefined {
  if (state.kind === "current" || staleHatchOpen({ env, ...(home === undefined ? {} : { home }) })) {
    return undefined;
  }
  const stateLine = migrationStateLine({
    state,
    ...(state.kind === "foreign" ? { landed: readLandedMigrations({ cwd }) } : {}),
  });
  return StoreErrors.stale({
    refusal: hatchRefusal({
      detail: [stateLine, ...(notCaughtUp === undefined ? [] : [notCaughtUp])].join("; "),
      hatch: hatchFor({ id: "stale-store" }),
    }),
    state: state.kind,
  });
}
