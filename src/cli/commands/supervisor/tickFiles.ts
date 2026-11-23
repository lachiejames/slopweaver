/**
 * The file reads `supervisor tick` shares between `open` and `close`: one JSON document read whole and named on
 * failure, the seat, the two snapshot ages the render will judge, and each captured reading as the digest sees
 * it.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import type { ReadingOutcome } from "../../../supervisor/scratch/tickCapture.js";
import type { DigestReading } from "../../../supervisor/tickDigest.js";
import { parseTickSeat, SEAT_FILE, type TickSeat } from "../../../supervisor/tickSeat.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";

/** The file `tick open` writes and `tick close` reads, inside the tick's directory. */
export const TICK_INPUT_FILE = "tick.json";

/**
 * One file's text, or why it could not be read.
 *
 * @param path the file
 * @returns the text, or a line naming the file
 */
export function readText({ path }: { path: string }): Result<string, string> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (cause: unknown) {
    return err(`${path}: ${cause instanceof Error ? cause.message : "could not be read"}`);
  }
}

/**
 * A file's identity as text, from the EXACT 64-bit device and inode numbers. Node's default stats are Numbers, which
 * round every value past 2^53, so two different inodes on a filesystem reporting large ones compared equal;
 * a caller reads stats with `{ bigint: true }` and hands them here.
 *
 * @param dev the device number, unrounded
 * @param ino the inode number, unrounded
 * @returns `<dev>:<ino>`
 */
export function fileIdentity({ dev, ino }: { dev: bigint; ino: bigint }): string {
  return `${dev.toString()}:${ino.toString()}`;
}

/**
 * One file's text, refusing bytes that are not valid UTF-8, with the device and inode those bytes were read from.
 * Decoded leniently, two different invalid sequences both become U+FFFD, so a hash of the TEXT would call an edit
 * unchanged; strict decoding keeping any byte-order mark makes the text a faithful image of the bytes.
 * The bytes and the identity come through ONE descriptor, opened without following a link, so a caller comparing
 * both against an earlier read knows these bytes are that same file's: a clone of the directory holding a copy of
 * the validated text is a different inode and cannot stand in for an edited original.
 *
 * @param path the file
 * @returns the text and its file's identity, or a line naming the file
 */
export function readStrictText({ path }: { path: string }): Result<{ text: string; identity: string }, string> {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd, { bigint: true });
    if (!stat.isFile()) {
      return err(`${path}: is not a regular file`);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(fd));
    return ok({ identity: fileIdentity({ dev: stat.dev, ino: stat.ino }), text });
  } catch (cause: unknown) {
    return err(`${path}: ${cause instanceof Error ? cause.message : "could not be read as UTF-8"}`);
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/**
 * One file's exact bytes, through ONE descriptor opened without following a link and checked to be a regular file,
 * so what is read is the file that was checked — a link or a directory swapped in between cannot stand in for it.
 *
 * @param path the file a caller named
 * @returns the bytes, or a line naming the file
 */
export function readRegularFileBytes({ path }: { path: string }): Result<Buffer, string> {
  let fd: number | undefined;
  try {
    // O_NONBLOCK: a FIFO with no writer would otherwise hang this open before the check below.
    // Reproduce: `mkfifo /tmp/p && node -e 'require("fs").openSync("/tmp/p", "r")'` never returns.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) {
      return err(`${path}: is not a regular file`);
    }
    return ok(readFileSync(fd));
  } catch (cause: unknown) {
    return err(`${path}: ${cause instanceof Error ? cause.message : "could not be read"}`);
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

/**
 * Parse text already read from `path` — so a caller that hashes the text parses exactly those bytes.
 *
 * @param path where the text came from, for the failure line
 * @returns the parsed value, or the reason it is not JSON
 */
export function parseJsonText({ path, text }: { path: string; text: string }): Result<unknown, string> {
  try {
    return ok(safeJsonParse({ label: path, text }));
  } catch (cause: unknown) {
    return err(`${path}: ${cause instanceof Error ? cause.message : "is not JSON"}`);
  }
}

/**
 * Read and parse one JSON file whole, naming it on failure.
 *
 * @param path the file
 * @returns the parsed value, or the reason it could not be read
 */
export function readJson({ path }: { path: string }): Result<unknown, string> {
  return readText({ path }).andThen((text) => parseJsonText({ path, text }));
}

/**
 * The seat's constants, read from its scratch directory.
 *
 * @param dir the scratch directory
 * @returns the seat, or why it cannot be used
 */
export function readSeat({ dir }: { dir: string }): Result<TickSeat, TickWorkflowError> {
  const path = join(dir, SEAT_FILE);
  if (!existsSync(path)) {
    return err(
      TickWorkflowErrors.seatInvalid({
        path,
        reason: "no seat file — run `slopweaver supervisor tick seat` once in this seat",
      }),
    );
  }
  return readJson({ path })
    .mapErr((reason) => TickWorkflowErrors.seatInvalid({ path, reason }))
    .andThen((value) => parseTickSeat({ dir, path, value }));
}

/**
 * Whether a regular file — not a link, not a directory — sits at this path. A close trusts a file in the tick's
 * directory only on this test, so a link planted there is replaced rather than followed.
 *
 * @returns true only for a regular file
 */
export function isRegularFile({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * A real directory's identity — its device and inode — or undefined when a link or nothing stands there. A close
 * writes its scratch into the tick's directory before the chair gate, so a tick directory that is a link would aim
 * those writes at the seat.
 *
 * @returns `<dev>:<ino>`, or undefined
 */
export function directoryIdentity({ path }: { path: string }): string | undefined {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isDirectory() ? fileIdentity({ dev: stat.dev, ino: stat.ino }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the tick's directory is still the one the close read. A `--bin` child runs mid-close and could swap the
 * directory for a link to the seat, aiming the close's own scratch writes there, so every write the close
 * makes into the tick's directory after that child ran is preceded by this check.
 *
 * @param identity what {@link directoryIdentity} read when the close began
 * @returns nothing, or the refusal naming the directory
 */
export function tickDirIntact({
  tickDir,
  identity,
}: {
  tickDir: string;
  identity: string;
}): Result<void, TickWorkflowError> {
  if (directoryIdentity({ path: tickDir }) === identity) {
    return ok(undefined);
  }
  return err(
    TickWorkflowErrors.captureInvalid({
      path: tickDir,
      reason: "was replaced after the close read it — nothing more is written into it; close again to re-read it",
    }),
  );
}

/**
 * A path inside the tick's directory, taken IMMEDIATELY before the one read or write that uses it: the directory is
 * checked to be the one the close read, so a helper the refresh child left behind cannot aim the close's own
 * commit-stage access through a directory it swapped for a link. The residue is the instant between
 * this check and that one access. Throws, because every caller runs inside a stage whose failure is caught.
 *
 * @param identity what {@link directoryIdentity} read when the close began
 * @param name the file inside the tick's directory
 * @returns the path, only while the directory is intact
 */
export function tickPath({ tickDir, identity, name }: { tickDir: string; identity: string; name: string }): string {
  const intact = tickDirIntact({ identity, tickDir });
  if (intact.isErr()) {
    throw new Error(intact.error.message);
  }
  return join(tickDir, name);
}

/** How many links {@link physicalPath} follows before calling a chain a loop — the kernel's own `MAXSYMLINKS` on darwin. */
const MAX_LINK_HOPS = 32;

/**
 * A path with every link resolved the way the kernel resolves it: one component at a time from the root, each link
 * followed BEFORE a later `..` applies, so `outside/link/..` lands where the link's parent is, not in `outside`
 * (`resolve()` would collapse the `..` first). A DANGLING link is followed to where it points, because a
 * link aimed at a directory the refresh child creates later would otherwise read as outside the seat;
 * a name that does not exist is kept as written, since a home a close is about to create has no real path yet.
 *
 * @returns the physical path, or undefined for a chain of links that never ends
 */
function physicalPath({ path }: { path: string }): string | undefined {
  const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
  const pending = pathPieces({ path: absolute });
  let current: string = sep;
  let hops = 0;
  for (let part = pending.shift(); part !== undefined; part = pending.shift()) {
    const step = applyComponent({ current, part });
    current = step.current;
    if (step.link !== undefined) {
      hops += 1;
      if (hops > MAX_LINK_HOPS) {
        return undefined;
      }
      current = isAbsolute(step.link) ? sep : current;
      pending.unshift(...pathPieces({ path: step.link }));
    }
  }
  return current;
}

/**
 * A path split into its components, empty ones dropped.
 *
 * @returns the components in order
 */
function pathPieces({ path }: { path: string }): string[] {
  return path.split(sep).filter((piece) => piece !== "");
}

/**
 * One component applied to a physical directory: `..` climbs, `.` stays, a name descends — unless it is a link,
 * whose target is handed back to be expanded in its place.
 *
 * @param current the physical directory so far
 * @param part the next component
 * @returns the directory after the component, and the link target when the component was a link
 */
function applyComponent({ current, part }: { current: string; part: string }): {
  readonly current: string;
  readonly link: string | undefined;
} {
  if (part === "..") {
    return { current: dirname(current), link: undefined };
  }
  if (part === ".") {
    return { current, link: undefined };
  }
  const next = join(current, part);
  if (lstatSync(next, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
    return { current, link: readlinkSync(next) };
  }
  return { current: next, link: undefined };
}

/**
 * One path's identity through every link, or undefined when nothing readable stands there.
 *
 * @returns `<dev>:<ino>`, or undefined
 */
function pathIdentity({ path }: { path: string }): string | undefined {
  try {
    const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
    return stat === undefined ? undefined : fileIdentity({ dev: stat.dev, ino: stat.ino });
  } catch {
    return undefined;
  }
}

/**
 * Whether the seat IS `path` or one of the directories above it, judged by identity rather than spelling: a
 * case-insensitive filesystem resolves `Seat` and `seat` to one directory while `relative()` calls them apart.
 * A component that does not exist yet reads as no identity, so its nearest existing ancestor decides.
 *
 * @param path a physical path, its links already resolved
 * @param seatIdentity the seat directory's identity
 * @param identityOf one path's identity, or undefined when nothing stands there
 * @returns true when the seat is the path or an ancestor of it
 */
export function underSeatByIdentity({
  path,
  seatIdentity,
  identityOf,
}: {
  path: string;
  seatIdentity: string;
  identityOf: (candidate: string) => string | undefined;
}): boolean {
  let current = path;
  while (identityOf(current) !== seatIdentity) {
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
  return true;
}

/**
 * Whether a physical home sits outside a physical seat, by spelling AND by identity — either one placing it inside
 * refuses.
 *
 * @returns true only when both agree it is outside
 */
function physicallyOutside({ home, seat, dir }: { home: string; seat: string; dir: string }): boolean {
  const fromSeat = relative(seat, home);
  const lexicallyOutside = fromSeat === ".." || fromSeat.startsWith(`..${sep}`) || isAbsolute(fromSeat);
  const seatIdentity = pathIdentity({ path: dir });
  if (!lexicallyOutside || seatIdentity === undefined) {
    return false;
  }
  return !underSeatByIdentity({
    identityOf: (candidate) => pathIdentity({ path: candidate }),
    path: home,
    seatIdentity,
  });
}

/**
 * Refuse a home inside the seat directory — PHYSICALLY, links resolved and ancestors compared by inode, because a lexical comparison let a home
 * that was a link into the tick's directory through. The ledger and the page are written under the home
 * after the refresh child ran, through paths no tick-directory check guards, so the two never share a tree. A close
 * asks before it decides and again before every commit stage, since the child could have created a link's target.
 *
 * @param home the `--home`, or the default one
 * @param dir the seat directory
 * @returns nothing, or the refusal — also for a home whose links never resolve, which cannot be shown outside
 */
export function homeOutsideSeat({ home, dir }: { home: string; dir: string }): Result<void, TickWorkflowError> {
  const seat = physicalPath({ path: dir });
  const physicalHome = physicalPath({ path: home });
  if (seat !== undefined && physicalHome !== undefined && physicallyOutside({ dir, home: physicalHome, seat })) {
    return ok(undefined);
  }
  return err(
    TickWorkflowErrors.captureInvalid({
      path: resolve(home),
      reason: "--home sits inside the seat directory; point it outside",
    }),
  );
}

/**
 * Minutes between a file's modification and `nowIso` — the clock `briefing render` judges `open-pages.json` by.
 *
 * @returns the age in minutes, or undefined when the file does not exist
 */
export function fileAgeMinutes({ path, nowIso }: { path: string; nowIso: string }): number | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  return (Date.parse(nowIso) - statSync(path).mtimeMs) / 60_000;
}

/**
 * Whether a `session-start --json` document's bytes carry a `nowIso` the render can date. The render's age door
 * reads an undatable instant as fresh, by design, for the list its own child wrote; a list a caller HANDS in is
 * refused instead, so an arbitrary file cannot carry an old list past that door.
 *
 * @param bytes the document as read
 * @param path where it came from, for the failure line
 * @returns nothing, or the capture refusal naming the file — bytes that are not JSON carry no `nowIso` either
 */
export function datableRun({ bytes, path }: { bytes: Buffer; path: string }): Result<void, TickWorkflowError> {
  const parsed = parseJsonText({ path, text: bytes.toString("utf8") });
  const stamp = parsed.isOk() && isRecord(parsed.value) ? parsed.value["nowIso"] : undefined;
  if (typeof stamp !== "string" || Number.isNaN(Date.parse(stamp))) {
    return err(
      TickWorkflowErrors.captureInvalid({
        path,
        reason: "carries no nowIso the render can date, so its age could not be judged",
      }),
    );
  }
  return ok(undefined);
}

/**
 * Minutes since a `session-start --json` document's own `nowIso` — the clock `briefing render` judges it by.
 *
 * @returns the age in minutes, or undefined when there is no readable one
 */
export function runAgeMinutes({ path, nowIso }: { path: string; nowIso: string }): number | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const run = readJson({ path });
  if (run.isErr() || !isRecord(run.value)) {
    return undefined;
  }
  const stamp = run.value["nowIso"];
  if (typeof stamp !== "string") {
    return undefined;
  }
  return (Date.parse(nowIso) - Date.parse(stamp)) / 60_000;
}

/**
 * One completed reading as the digest reads it: JSON parsed, anything else as text.
 *
 * @returns the reading
 */
function readingOf({ dir, reading }: { dir: string; reading: ReadingOutcome }): DigestReading {
  const path = join(dir, reading.file);
  if (!reading.file.endsWith(".json")) {
    // An unreadable text reading reads as the reason it could not be read, never as an empty one.
    return {
      kind: "text",
      text: readText({ path }).match(
        (text) => text,
        (reason) => reason,
      ),
    };
  }
  const value = readJson({ path });
  if (value.isErr()) {
    return { kind: "text", text: value.error };
  }
  return { kind: "json", value: value.value };
}

/**
 * Each reading as the digest reads it: a completed document parsed, anything else named by how it ended.
 *
 * @param dir the tick's directory
 * @param readings what the capture left
 * @returns the readings by name
 */
export function digestReadings({
  dir,
  readings,
}: {
  dir: string;
  readings: readonly ReadingOutcome[];
}): ReadonlyMap<string, DigestReading> {
  return new Map(
    readings.map((reading): [string, DigestReading] => [
      reading.name,
      reading.completed ? readingOf({ dir, reading }) : { child: reading.child, kind: "unavailable" },
    ]),
  );
}
