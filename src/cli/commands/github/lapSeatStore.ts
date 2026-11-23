/**
 * The file edges of the lap seat (`./lapSeat.ts`): reading, writing and clearing `<home>/laps/seat.json`, and
 * assembling the facts `github lap` judges from it — the designation, whether its run has closed, and the run the
 * invoking session holds.
 *
 * Every read FAILS CLOSED. The designation exists to stop an hour-long lap out of the chair's order, so a seat file
 * that will not decode, or a designated journal that is missing, empty or carries an undecodable line, is an
 * error rather than "no rota" or "rota lapsed": reading damage as absence would reopen exactly the defect.
 */

import { readFileSync, rmSync, statSync } from "node:fs";
import { runStateOf } from "../../../handover/ledger.js";
import { heldRunSlug } from "../../../handover/registerProvenance.js";
import { readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { stateHomePaths } from "../../../stateHome.js";
import { decodeLapSeat, type LapSeat, type LapSeatFacts } from "./lapSeat.js";

/** The seat file could not be read, or read and did not decode. */
export interface LapSeatFileError {
  readonly code: "SEAT_READ_FAILED" | "SEAT_INVALID" | "SEAT_WRITE_FAILED" | "SEAT_CLEAR_FAILED";
  readonly message: string;
}

/** The designated run's journal is absent, or present and not safely foldable. */
export interface LapSeatRunError {
  readonly code: "RUN_MISSING" | "RUN_UNREADABLE";
  readonly message: string;
  readonly slug: string;
}

/** Every failure the lap seat's store authors. */
export type LapSeatError = LapSeatFileError | LapSeatRunError;

/** The failure text of an unknown thrown value. */
function causeOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

export const LapSeatErrors = {
  clearFailed: ({ path, cause }: { path: string; cause: string }): LapSeatFileError => ({
    code: "SEAT_CLEAR_FAILED",
    message: `could not remove the lap seat at ${path}: ${cause}`,
  }),
  invalid: ({ path, problems }: { path: string; problems: readonly string[] }): LapSeatFileError => ({
    code: "SEAT_INVALID",
    message: `the lap seat at ${path} does not decode (${problems.join("; ")}); \`github lap-seat set <slug>\` or \`github lap-seat clear\` replaces it`,
  }),
  readFailed: ({ path, cause }: { path: string; cause: string }): LapSeatFileError => ({
    code: "SEAT_READ_FAILED",
    message: `could not read the lap seat at ${path}: ${cause}`,
  }),
  runMissing: ({ slug }: { slug: string }): LapSeatRunError => ({
    code: "RUN_MISSING",
    message: `the lap seat names ${slug}, which has no started run journal; \`github lap-seat set <slug>\` names a real run`,
    slug,
  }),
  runUnreadable: ({ slug, why }: { slug: string; why: string }): LapSeatRunError => ({
    code: "RUN_UNREADABLE",
    message: `the lap seat names ${slug}, whose journal cannot be judged: ${why}`,
    slug,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: string }): LapSeatFileError => ({
    code: "SEAT_WRITE_FAILED",
    message: `could not write the lap seat at ${path}: ${cause}`,
  }),
} as const;

/**
 * Read the standing designation.
 *
 * @param home the state home whose `laps/seat.json` is read
 * @returns the designation, `undefined` when none stands, or why it could not be read
 */
export function readLapSeat({ home }: { home: string }): Result<LapSeat | undefined, LapSeatError> {
  const path = stateHomePaths({ home }).lapSeatJson;
  let text: string;
  try {
    if (!statSync(path).isFile()) {
      return err(LapSeatErrors.readFailed({ cause: "not a regular file", path }));
    }
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(undefined);
    }
    return err(LapSeatErrors.readFailed({ cause: causeOf({ error }), path }));
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    return err(LapSeatErrors.invalid({ path, problems: [causeOf({ error })] }));
  }
  const decoded = decodeLapSeat({ value });
  if (decoded.isErr()) {
    return err(LapSeatErrors.invalid({ path, problems: decoded.error }));
  }
  return ok(decoded.value);
}

/**
 * Write the designation, replacing any standing one.
 *
 * @param home the state home whose `laps/seat.json` is written
 * @param seat the designation
 * @returns the path written, or why it could not be
 */
export function writeLapSeat({ home, seat }: { home: string; seat: LapSeat }): Result<string, LapSeatError> {
  const path = stateHomePaths({ home }).lapSeatJson;
  try {
    writeFileAtomic({ contents: `${JSON.stringify(seat, undefined, 2)}\n`, dirMode: 0o700, fileMode: 0o600, path });
    return ok(path);
  } catch (error: unknown) {
    return err(LapSeatErrors.writeFailed({ cause: causeOf({ error }), path }));
  }
}

/**
 * Remove the designation without decoding it, so a damaged one can always be cleared.
 *
 * @param home the state home whose `laps/seat.json` is removed
 * @returns `cleared`, `absent` when none stood, or why it could not be removed
 */
export function clearLapSeat({ home }: { home: string }): Result<"cleared" | "absent", LapSeatError> {
  const path = stateHomePaths({ home }).lapSeatJson;
  try {
    rmSync(path);
    return ok("cleared");
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok("absent");
    }
    return err(LapSeatErrors.clearFailed({ cause: causeOf({ error }), path }));
  }
}

/**
 * Whether the designated run's current cycle is closed, from a journal that must be there, started and wholly
 * decodable — a missing or damaged journal is never read as a closed one.
 *
 * @param home the state home whose `runs/` holds the journal
 * @param slug the designated run
 * @returns `true` when closed, `false` when open or waiting, or why it cannot be judged
 */
export function lapSeatRunClosed({ home, slug }: { home: string; slug: string }): Result<boolean, LapSeatError> {
  const runsDir = stateHomePaths({ home }).runs;
  try {
    statSync(runJournalPath({ runsDir, slug }));
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return err(LapSeatErrors.runMissing({ slug }));
    }
    return err(LapSeatErrors.runUnreadable({ slug, why: causeOf({ error }) }));
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return err(LapSeatErrors.runUnreadable({ slug, why: journal.error.message }));
  }
  if (journal.value.unreadable.length > 0) {
    return err(
      LapSeatErrors.runUnreadable({
        slug,
        why: `${String(journal.value.unreadable.length)} line(s) this checkout cannot decode; pull, or read it with \`handover resume ${slug}\``,
      }),
    );
  }
  if (!journal.value.events.some((event) => event.kind === "started")) {
    return err(LapSeatErrors.runMissing({ slug }));
  }
  return ok(runStateOf({ events: journal.value.events }).phase === "closed");
}

/**
 * Everything `github lap` judges the seat from: the designation, its run's closure (only when one stands) and the
 * run this session holds.
 *
 * @param home the state home
 * @param cwd the directory the verb ran in, whose branch and name propose the caller's run
 * @param env the environment the session id is read from
 * @returns the facts, or why the designation or its run cannot be read
 */
export function lapSeatFacts({
  home,
  cwd,
  env,
}: {
  home: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Result<LapSeatFacts, LapSeatError> {
  const seat = readLapSeat({ home });
  if (seat.isErr()) {
    return err(seat.error);
  }
  if (seat.value === undefined) {
    return ok({ callerRun: undefined, seat: undefined, seatRunClosed: false });
  }
  const closed = lapSeatRunClosed({ home, slug: seat.value.slug });
  if (closed.isErr()) {
    return err(closed.error);
  }
  return ok({ callerRun: heldRunSlug({ cwd, env, home }), seat: seat.value, seatRunClosed: closed.value });
}
