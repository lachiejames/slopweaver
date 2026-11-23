/**
 * The relay turn files read whole — every turn this install has staged, registered or not — and the two readings
 * taken off them: the registered relays since a floor, and the console steers the owner typed that never reached the board.
 *
 * A typed steer whose registration failed, or whose run was killed inside it, stays `intended` or `registering`
 * (`./relayStore.ts`), and a read of registered turns alone passes over it silently — so the voice, told every turn
 * the owner typed since their last call, would be told one fewer with nothing said.
 */
import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

import { isAbsentError } from "#lib/presentFile.js";

import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import type { ContinuityUnread } from "./continuity.js";
import { type TalkError, TalkErrors } from "./errors.js";
import type { TurnRecord } from "./relayStore.js";

/**
 * A turn file's name: a turn id in either case and the literal `.json` `turnPath` writes, never the `.delivery`
 * claim or a picture beside it. Only the id is case-blind: `readTurn` reopens `${turnId}.json`, so a `.JSON` it
 * accepted would be a path that does not exist on a case-sensitive filesystem.
 */
const TURN_FILE = /^[0-9a-fA-F-]{36}\.json$/u;

/**
 * Every turn file, in directory order; an unreadable one fails the read, and no directory is no turns.
 *
 * @param home the Slopweaver home
 * @param readTurn reads one turn's file (`./relayStore.ts`), passed in so the store can read through this module
 * @returns every turn record, or why the first that could not be read failed
 */
export function readTurnFiles({
  home,
  readTurn,
}: {
  home: string;
  readTurn: (args: { home: string; turnId: string }) => Result<TurnRecord, TalkError>;
}): Result<readonly TurnRecord[], TalkError> {
  return readEveryTurnFile({ home, readTurn }).andThen((read) => {
    const first = read.failures[0];
    if (first !== undefined) {
      return err(first);
    }
    return ok(read.turns);
  });
}

/**
 * Every turn file that reads, and each one that does not — so one bad file from months ago costs a reader that
 * wants a window only that file, said, rather than every turn (`profile words`).
 *
 * @param home the Slopweaver home
 * @param readTurn reads one turn's file (`./relayStore.ts`)
 * @param lowercaseOnly refuse a file whose name is not lowercase rather than read it: a reader that prints a turn's
 *   anchor needs the file that anchor reopens, and `talk:<id>` reopens `<lowercase id>.json` — on a case-sensitive
 *   disk, never a capitalised name. The intake sweep leaves it off, since it reads the record, not the
 *   anchor.
 * @returns the turns that read, why each other one did not, and the id of every turn with an entry on disk whether it
 *   read or not — or why the directory itself would not read
 */
export function readEveryTurnFile({
  home,
  readTurn,
  lowercaseOnly = false,
}: {
  home: string;
  readTurn: (args: { home: string; turnId: string }) => Result<TurnRecord, TalkError>;
  lowercaseOnly?: boolean;
}): Result<
  {
    readonly turns: readonly TurnRecord[];
    readonly failures: readonly TalkError[];
    readonly onDisk: readonly string[];
  },
  TalkError
> {
  const dir = stateHomePaths({ home }).talkTurns;
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok({ failures: [], onDisk: [], turns: [] });
    }
    return err(TalkErrors.pathUnreadable({ cause, path: dir }));
  }
  const turns: TurnRecord[] = [];
  const failures: TalkError[] = [];
  const named = entries.filter((candidate) => TURN_FILE.test(candidate.name));
  const onDisk = named.map((entry) => entry.name.slice(0, -".json".length));
  for (const entry of named) {
    // A turn file is only ever written as a regular file, and a FIFO would block `readFileSync` forever — the
    // hazard `../handover/store.ts` guards the board scan against. Anything else fails, loudly.
    if (!entry.isFile()) {
      const path = join(dir, entry.name);
      failures.push(TalkErrors.pathUnreadable({ cause: new Error("not a regular file"), path }));
      continue;
    }
    if (lowercaseOnly && entry.name !== entry.name.toLowerCase()) {
      const why = "its name is not lowercase, so no talk: anchor reopens it on a case-sensitive disk";
      failures.push(TalkErrors.pathUnreadable({ cause: new Error(why), path: join(dir, entry.name) }));
      continue;
    }
    const turn = readTurn({ home, turnId: entry.name.slice(0, -".json".length) });
    if (turn.isErr()) {
      failures.push(turn.error);
      continue;
    }
    turns.push(turn.value);
  }
  return ok({ failures, onDisk, turns });
}

/**
 * The id of every turn with a file on disk, read off the directory's names alone — so a reader after one turn whose
 * id it does not know reads that one file rather than every turn there has been.
 *
 * @param home the Slopweaver home
 * @returns the turn ids, none when there is genuinely no directory — a dangling symlink there also answers ENOENT and
 *   is unreadable, not absent — or why the directory would not read
 */
export function turnIdsOnDisk({ home }: { home: string }): Result<readonly string[], TalkError> {
  const dir = stateHomePaths({ home }).talkTurns;
  try {
    return ok(
      readdirSync(dir)
        .filter((name) => TURN_FILE.test(name))
        .map((name) => name.slice(0, -".json".length)),
    );
  } catch (cause) {
    if (isAbsentError({ error: cause, path: dir })) {
      return ok([]);
    }
    return err(TalkErrors.pathUnreadable({ cause, path: dir }));
  }
}

/**
 * Every turn reading `registered` at or after `sinceIso`, oldest first.
 *
 * @param turns every turn file's record
 * @param sinceIso the floor its registration must be at or after
 * @returns the registered turns
 */
export function registeredSince({
  turns,
  sinceIso,
}: {
  turns: readonly TurnRecord[];
  sinceIso: string;
}): readonly TurnRecord[] {
  const floor = Date.parse(sinceIso);
  return turns
    .filter((turn) => turn.state === "registered" && turn.registeredAtIso !== null)
    .filter((turn) => Date.parse(turn.registeredAtIso!) >= floor)
    .toSorted((a, b) => Date.parse(a.registeredAtIso!) - Date.parse(b.registeredAtIso!));
}

/**
 * The steers a continuity read carries — the registered relays since its floor — and, when a steer the owner typed on the
 * console since then never reached the board, that it is missing.
 *
 * @param turns every turn file's record
 * @param sinceIso the continuity window's floor
 * @returns the registered relays, oldest first, and the steers half's unread note when one is owed
 */
export function steerTurnsOf({ turns, sinceIso }: { turns: readonly TurnRecord[]; sinceIso: string }): {
  records: readonly TurnRecord[];
  unread: ContinuityUnread[];
} {
  const floor = Date.parse(sinceIso);
  const unfinished = turns.filter(
    (turn) => turn.typed && turn.state !== "registered" && Date.parse(turn.stagedAtIso) >= floor,
  );
  const unread: ContinuityUnread[] = [];
  if (unfinished.length > 0) {
    unread.push({
      section: "steers",
      why: `${String(unfinished.length)} steer(s) the owner typed on the console never reached the board, so what the owner typed is missing them`,
    });
  }
  return { records: registeredSince({ sinceIso, turns }), unread };
}
