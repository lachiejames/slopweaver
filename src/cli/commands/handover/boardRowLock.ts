/**
 * The one lock every rewrite of a board row takes: the owner's quote and each steer (`./quoteRow.ts`, `./quoteSteerRow.ts`,
 * `./quoteAttach.ts`, `../talk/relayOfferAttach.ts`), a settle's row write (`./settleRowWrite.ts`), `set-priority`,
 * `pause`/`unpause`, `set-repo`, `set-workspace`, `recheck`, `example`, `shot`, `lint --fix`, and a registered ask's
 * `reconfirm`/`correct`/`withdraw` (`./registeredAskWrite.ts`). Each write re-reads the row, judges it and writes it
 * whole, so two writers on one row without a shared lock both judge the same text and the later atomic write drops
 * the earlier one's edit while both report success: two `--add-steer`s both numbered their steer 1, and the owner's steer
 * could be dropped by a `set-priority` or a `pause` that read the row before it landed when those writers took a
 * different lock or none. Under the one lock the second writer's
 * re-read sees the first one's edit and writes past it. Every writer reads the row INSIDE the lock and replaces it
 * atomically inside it; a check made on a board scan before the lock only picks the row, never authorises the write.
 *
 * Per BOARD, keyed by its directory's identity on disk — device and inode — never by any spelling of its path. A path
 * names one file many ways: through a symlinked directory or file, and on a case-insensitive
 * volume through any casing of it, which `realpathSync` keeps as the caller gave it. A row name
 * has the same aliases, so the lock is the whole board's rather than one row's: a holder reads, judges and writes one
 * small file, and a second row waiting that long costs nothing. The lock lives BESIDE the board, in its
 * {@link LOCK_DIR}, never under a Slopweaver home: two writers given different `--home`s over one board would
 * otherwise each take a lock of their own. Every reader of a board lists only its `.md` files
 * (`../../../handover/store.ts`), so the directory is invisible to the board.
 *
 * The same casing alias reaches the WRITE: an atomic write renames its replacement onto the name it was given, and on
 * a case-insensitive volume whose rename takes the new name, a writer spelling the row `THE-ASK.MD` would leave a file
 * the board's lower-case `.md` filter no longer lists, while reporting success. APFS keeps the
 * stored name on such a rename — measured on a Mac's default volume: in `node`, write `the-ask.md` and
 * `tmp` into an empty directory, rename `tmp` onto `THE-ASK.MD`, and `readdirSync` lists `["the-ask.md"]` — but
 * nothing here should rest on one volume's rename. So the write is handed the name the directory itself stores, never
 * the caller's spelling of it.
 *
 * The one alias no lock can cover is a HARD LINK: two names for one file in two directories resolve to two boards and
 * two locks, and an atomic write replaces one name, splitting the file so a write through the other is stranded.
 * Every write that replaces a file whole splits hard links, so a row with more than one is
 * refused, under the lock, rather than written — the writer reports it, which the property asks for.
 */
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { sleepSync } from "#lib/sleepSync.js";

import { acquireOperationLock } from "../../../admit/operationLock.js";

/**
 * The directory, inside a board's own, its rows' lock is made under, and the prefix of that lock's key. Both carry the
 * name the lock had when only quote writes took it, and stay so: every checkout on the machine writes the one board, so
 * a checkout that predates this name still takes exactly this lock, and a new name would be a second lock beside it.
 */
const LOCK_DIR = ".quote-locks";

/** See {@link LOCK_DIR}. */
const LOCK_KEY_PREFIX = "handover-quote:";

/** The first pause before retrying a held lock; doubled each time up to {@link MAX_RETRY_MS}. */
const FIRST_RETRY_MS = 50;

/** The longest single pause between attempts. */
const MAX_RETRY_MS = 1000;

/**
 * How many attempts before a held lock is refused: 50 ms doubling to 1 s, about 15 s in all. A holder reads, judges
 * and writes one row file, so it is held for one file's read and write — a wait this long is a holder that is stuck.
 */
const MAX_ATTEMPTS = 20;

/** A row's lock stayed held through every attempt, so the write was never run. */
interface BoardRowBusyError {
  readonly code: "ROW_LOCK_BUSY";
  readonly message: string;
  readonly path: string;
}

/** The row's file has more than one hard link, which no write here can keep together, so it was never written. */
interface BoardRowHardLinkedError {
  readonly code: "ROW_HARD_LINKED";
  readonly message: string;
  readonly path: string;
}

/** The row's path named another file once its lock was held, so it was never written under that lock. */
interface BoardRowMovedError {
  readonly code: "ROW_MOVED";
  readonly message: string;
  readonly path: string;
}

/** Why a write on a board row never ran. */
export type BoardRowLockError = BoardRowBusyError | BoardRowHardLinkedError | BoardRowMovedError;

/** Builds each {@link BoardRowLockError}. */
const BoardRowLockErrors = {
  busy: ({ path, holder }: { path: string; holder: string }): BoardRowBusyError => ({
    code: "ROW_LOCK_BUSY",
    message: `another board-row write holds ${path}: ${holder}`,
    path,
  }),
  hardLinked: ({ path, links }: { path: string; links: bigint }): BoardRowHardLinkedError => ({
    code: "ROW_HARD_LINKED",
    message: `${path} has ${String(links)} hard links, and a row write would split them: make the row one file`,
    path,
  }),
  moved: ({ path }: { path: string }): BoardRowMovedError => ({
    code: "ROW_MOVED",
    message: `${path} named another row once its lock was taken; nothing was written, so run it again`,
    path,
  }),
} as const;

/**
 * The file a row's path names, symlinks followed. `resolve` alone is lexical, so a board reached through an alias
 * directory took a lock of its own; and an atomic write to a symlinked row file replaces the link rather
 * than the row it points at. So the lock is keyed by this path AND the write reads and replaces it.
 */
function realRowPath({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    // No file there: the read the lock guards refuses it, so no write can race on it and the lexical path will do.
    return resolve(path);
  }
}

/**
 * The row's file under the name its directory stores. `realpathSync` follows every symlink but keeps the caller's
 * casing, so on a case-insensitive volume its last component may name the entry in a case the directory does not
 * hold. The stored one is the entry that is the row ITSELF: a regular file by `lstat`, with the row's inode. Never a
 * name compared by folding it: a volume's case and Unicode folding is its own, and any fold written here misses some of
 * it, Greek final sigma for one. Nor by `stat`, which follows a link, so another symlink to
 * the row passed for it and the atomic write replaced that link rather than the row. A row with a second hard
 * link is refused before any write (`lockedTarget`), so a written row has exactly one entry carrying its inode. The
 * exact name is kept whenever the directory holds it. No file there: the read refuses it, so any name will do.
 */
function storedRowPath({ path }: { path: string }): string {
  const real = realRowPath({ path });
  const board = dirname(real);
  try {
    const entries = readdirSync(board);
    if (entries.includes(basename(real))) {
      return real;
    }
    const row = statSync(real, { bigint: true });
    const stored = entries.find((entry) => {
      const other = lstatSync(join(board, entry), { bigint: true });
      return other.isFile() && other.dev === row.dev && other.ino === row.ino;
    });
    if (stored === undefined) {
      return real;
    }
    return join(board, stored);
  } catch {
    return real;
  }
}

/**
 * The file a write under the lock may read and replace: exactly the row the lock was chosen for, or nothing. The lock
 * is chosen from the path's resolution before the wait, so a symlink retargeted during it would hand the write another
 * row — on another board, whose lock it does not hold, or on this one, where a writer of the intended row never sees
 * it. So the path is resolved again once the lock is held and must name the same file; the
 * write is handed that real path, so nothing it reads or replaces is resolved a third time.
 *
 * @param intended the stored path of the row the lock was chosen for
 * @param path the row's file, as the caller spells it
 * @param rewrites whether the caller replaces the row; one that only reads it under the lock splits no hard link
 * @returns the file to write, or why it may not be written under that lock
 */
export function lockedTarget({
  intended,
  path,
  rewrites = true,
}: {
  intended: string;
  path: string;
  rewrites?: boolean;
}): Result<string, BoardRowLockError> {
  const target = storedRowPath({ path });
  if (target !== intended) {
    return err(BoardRowLockErrors.moved({ path }));
  }
  if (!rewrites) {
    return ok(target);
  }
  const links = hardLinksOf({ target });
  if (links > 1n) {
    return err(BoardRowLockErrors.hardLinked({ links, path }));
  }
  return ok(target);
}

/** How many hard links the row's file has; one when nothing is there, which the write's own read then refuses. */
function hardLinksOf({ target }: { target: string }): bigint {
  try {
    return statSync(target, { bigint: true }).nlink;
  } catch {
    return 1n;
  }
}

/**
 * Where one row's lock is taken: the lock home inside its real board directory, and the key that directory's identity
 * on disk gives — the same for every spelling of the board.
 *
 * @param path the row's file, as any caller spells it
 * @returns the home and key to pass to the operation lock
 */
export function boardRowLockSite({ path }: { path: string }): { readonly home: string; readonly key: string } {
  const board = dirname(realRowPath({ path }));
  return { home: join(board, LOCK_DIR), key: `${LOCK_KEY_PREFIX}${boardIdentity({ board })}` };
}

/**
 * A board directory's device and inode, which every alias of it shares. A board that will not stat has no file to
 * race on — the read the lock guards refuses it — so its lexical path will do.
 */
function boardIdentity({ board }: { board: string }): string {
  try {
    const stats = statSync(board, { bigint: true });
    return `${String(stats.dev)}:${String(stats.ino)}`;
  } catch {
    return board;
  }
}

/**
 * How a writer waits on a held row lock: how many tries, and what runs between two of them. Every writer of a row takes
 * this, so a test can hold the lock as an in-flight writer and let it finish from inside `wait` — the moment another
 * process would have released it — which interleaves two writers in one process without a timing race.
 */
export interface BoardRowLockOptions {
  /** How many tries before a held lock is refused. */
  readonly attempts?: number;
  /** What runs between two tries; a pause of the given backoff when absent. */
  readonly wait?: (backoff: { readonly ms: number }) => void;
  /**
   * `false` for a caller that only READS the row under the lock (`./appendUnlessRefused.ts`): a hard link is refused
   * because a replacement would split it, and a read splits nothing. The moved-row check stands either way.
   */
  readonly rewrites?: boolean;
}

/**
 * Run one rewrite of a board row while holding that row's lock, released however the write ends.
 *
 * @param path the row's file, as the caller spells it
 * @param write the read, judgement and write, run only once the lock is held, given the real file to read and replace
 *   under the name its directory stores
 * @param attempts how many tries before a held lock is refused
 * @param wait what runs between two tries
 * @param rewrites whether the write replaces the row, which a hard link refuses
 * @returns the write's own value, or why the lock was never free
 */
export function withBoardRowLock<T>({
  path,
  write,
  attempts = MAX_ATTEMPTS,
  wait = sleepSync,
  rewrites = true,
}: {
  path: string;
  write: (at: { readonly target: string }) => T;
} & BoardRowLockOptions): Result<T, BoardRowLockError> {
  const intended = storedRowPath({ path });
  const { home, key } = boardRowLockSite({ path: intended });
  // Never taken over from a LIVE holder by age, exactly as the row-tags lock: a takeover would let two writers judge
  // one row at once, the race this exists to close. A dead holder's lock is still recovered — the primitive checks.
  const acquire = (): ReturnType<typeof acquireOperationLock> =>
    acquireOperationLock({ home, key, nowIso: new Date().toISOString(), staleAfterMs: Number.POSITIVE_INFINITY });
  let waitMs = FIRST_RETRY_MS;
  let last = acquire();
  for (let attempt = 1; attempt < attempts && last.isErr(); attempt += 1) {
    wait({ ms: waitMs });
    waitMs = Math.min(waitMs * 2, MAX_RETRY_MS);
    last = acquire();
  }
  if (last.isErr()) {
    return err(BoardRowLockErrors.busy({ holder: last.error, path }));
  }
  const handle = last.value;
  try {
    const target = lockedTarget({ intended, path, rewrites });
    if (target.isErr()) {
      return err(target.error);
    }
    return ok(write({ target: target.value }));
  } finally {
    handle.release();
  }
}
