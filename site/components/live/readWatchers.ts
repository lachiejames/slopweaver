/**
 * The reader for the checks-read register: which sessions hold a watch on each pull request, and when it was last
 * read. A sibling of `./read.ts`, under every rule its module doc states.
 */
import { type Bag, bags, isBag, num, str, sub } from "../../lib/bag";

/** One session holding a watch on a pull request — or one that held it and died, when `stale`. */
export interface WatcherRow {
  readonly session: string;
  readonly sinceIso: string;
  readonly mode: string;
  readonly headSha: string;
  /** The verb's own judgement: past the run's timeout ceiling with no watch-done, so a dead session. */
  readonly stale: boolean;
}

/** The last time anybody read a pull request's checks, and what the rollup said then. */
export interface WatchLastRead {
  readonly atIso: string;
  readonly headSha: string;
  readonly rollup: string;
}

/** What the register says about one pull request. `lastRead` is absent only when nothing ever read it. */
export interface WatchEntry {
  readonly repo: string;
  readonly number: number;
  readonly watchers: readonly WatcherRow[];
  readonly lastRead: WatchLastRead | undefined;
}

/** The fold `github watchers --json` prints: every pull request the register names, at one instant. */
export interface Watchers {
  readonly observedAtIso: string;
  readonly entries: readonly WatchEntry[];
}

/**
 * One watcher off the fold, or `undefined` when a field the column's claim rests on is missing.
 *
 * @returns the watcher, or `undefined`
 */
function watcherOf({ bag }: { bag: Bag }): WatcherRow | undefined {
  const session = str({ bag, key: "session" });
  const sinceIso = str({ bag, key: "sinceIso" });
  const mode = str({ bag, key: "mode" });
  const headSha = str({ bag, key: "headSha" });
  const stale = bag.stale;
  if (
    session === undefined ||
    sinceIso === undefined ||
    mode === undefined ||
    headSha === undefined ||
    typeof stale !== "boolean"
  ) {
    return undefined;
  }
  return { headSha, mode, session, sinceIso, stale };
}

/**
 * One entry off the fold. An absent `lastRead` is carried as the absence it is — the verb omits the key
 * for a pull request only ever watched, never read — while a present one that will not parse refuses.
 *
 * @returns the entry, or `undefined`
 */
function watchEntryOf({ bag }: { bag: Bag }): WatchEntry | undefined {
  const repo = str({ bag, key: "repo" });
  const number = num({ bag, key: "number" });
  const held = bags({ bag, key: "watchers" });
  if (repo === undefined || number === undefined || held === undefined) {
    return undefined;
  }
  const watchers: WatcherRow[] = [];
  for (const row of held) {
    const watcher = watcherOf({ bag: row });
    if (watcher === undefined) {
      return undefined;
    }
    watchers.push(watcher);
  }
  let lastRead: WatchLastRead | undefined;
  if (bag.lastRead !== undefined) {
    const read = sub({ bag, key: "lastRead" });
    if (read === undefined) {
      return undefined;
    }
    const atIso = str({ bag: read, key: "atIso" });
    const headSha = str({ bag: read, key: "headSha" });
    const rollup = str({ bag: read, key: "rollup" });
    if (atIso === undefined || headSha === undefined || rollup === undefined) {
      return undefined;
    }
    lastRead = { atIso, headSha, rollup };
  }
  return { lastRead, number, repo, watchers };
}

/**
 * Read the object `github watchers --json` prints. A malformed entry refuses the whole reading, per the
 * rule at the top of this file: a pull request missing from the watched column would read as "not
 * watched", which is the confident wrong answer the column exists to end.
 *
 * @returns the fold, or `undefined` when the payload is not one
 */
export function readWatchers(payload: unknown): Watchers | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const held = bags({ bag: payload, key: "entries" });
  if (observedAtIso === undefined || held === undefined) {
    return undefined;
  }
  const entries: WatchEntry[] = [];
  for (const bag of held) {
    const entry = watchEntryOf({ bag });
    if (entry === undefined) {
      return undefined;
    }
    entries.push(entry);
  }
  return { entries, observedAtIso };
}
