/**
 * What `tick open`'s digest reads that no capture reading carries: what the seat's previous pass held, and where a
 * broken recipe's fix row would be pointed on this machine. Both are read at the edge, once per tick, so the digest
 * itself stays pure and prints only what these say.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { resolveRepoCheckout } from "../../../handover/repoCheckout.js";
import { priorHoldsOf } from "../../../supervisor/digestPriorHolds.js";
import type { PriorHolds, RecipeFixCheckout } from "../../../supervisor/digestRead.js";
import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";
import { deltaLines, digestDelta, type PriorDigest } from "../../../supervisor/tickDigestDelta.js";
import { readJson, readRegularFileBytes, TICK_INPUT_FILE } from "./tickFiles.js";

/** The file `tick open` writes its whole digest to, inside the tick's directory: the drill-down, and next tick's prior. */
export const TICK_DIGEST_FILE = "digest.txt";

/**
 * The previous tick's whole digest, read from the file its open wrote — tick n-1 exactly, never the nearest earlier
 * one, so "changed since tick N" names the tick it compared.
 *
 * @param dir the scratch directory
 * @param tick the tick being opened; the one before it is read
 * @returns `none` on the seat's first tick; `unreadable` when the earlier tick's file is missing (an open by an older
 *   build, or one that died before writing it), is a link or not a regular file, or cannot be read — never an empty
 *   digest
 */
export function readPriorDigest({ dir, tick }: { dir: string; tick: number }): PriorDigest {
  const prior = tick - 1;
  if (prior < 1) {
    return { kind: "none" };
  }
  // Past 2^53 a tick number cannot name its predecessor: `n - 1 === n`, so the path below would be this tick's own.
  // A seat counts up from 1 and never gets there; a directory named that way is not one it wrote.
  if (!Number.isSafeInteger(tick)) {
    return {
      kind: "unreadable",
      tick: prior,
      why: `tick ${String(tick)} is past the safe-integer range, so n-1 is not exact`,
    };
  }
  // A regular file in a real directory, never followed through a link at either step: a link names another tick's digest, and folding against it
  // would claim "unchanged since tick n-1" over a baseline tick n-1 never wrote. What this does NOT close,
  // by construction: a HARD link, or any file placed there by hand, is a regular file in a real directory. Only a
  // writer inside the seat's own scratch directory can make one, and that writer could write digest.txt itself, so
  // no read-side check tells them apart; a digest signed by the open that wrote it would.
  const tickDir = join(dir, `tick-${String(prior)}`);
  if (!realDirectory({ path: tickDir })) {
    return {
      kind: "unreadable",
      tick: prior,
      why: `${tickDir}: is not a directory this seat wrote (absent, or a link)`,
    };
  }
  // `readRegularFileBytes` opens non-blocking, so a FIFO there is refused rather than hanging the open.
  const path = join(tickDir, TICK_DIGEST_FILE);
  const read = readRegularFileBytes({ path });
  if (read.isErr()) {
    return { kind: "unreadable", tick: prior, why: read.error };
  }
  let whole: string;
  try {
    whole = new TextDecoder("utf-8", { fatal: true }).decode(read.value);
  } catch {
    return { kind: "unreadable", tick: prior, why: `${path}: is not valid UTF-8` };
  }
  if (whole === "") {
    return { kind: "read", lines: [], tick: prior };
  }
  // Every entry `persistTickDigest` writes ends in a newline, so a file that does not was cut short or not written by it.
  if (!whole.endsWith("\n")) {
    return {
      kind: "unreadable",
      tick: prior,
      why: `${path}: does not end in a newline, so its last entry was cut short`,
    };
  }
  return {
    kind: "read",
    lines: whole
      .slice(0, -1)
      .split("\n")
      .map((line) => decodeDigestEntry({ line })),
    tick: prior,
  };
}

/**
 * One digest entry as one file line: a backslash doubled, a newline inside the entry written `\n`, so reading the
 * file back splits at entries and nowhere else (a ready row's label carrying a newline would split into a
 * phantom prior line, which would fold a genuinely new one).
 *
 * @param line one digest entry
 * @returns its file line
 */
function encodeDigestEntry({ line }: { line: string }): string {
  return line.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

/**
 * The digest entry one file line holds, the inverse of {@link encodeDigestEntry}.
 *
 * @param line one file line
 * @returns the entry
 */
function decodeDigestEntry({ line }: { line: string }): string {
  return line.replace(/\\(\\|n)/gu, (_escape, char: string) => (char === "n" ? "\n" : "\\"));
}

/**
 * Whether a path is a directory itself, never a link to one.
 *
 * @returns true for a real directory
 */
function realDirectory({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Write this tick's whole digest, one line each, before any of it is printed — so the fold line never names a file
 * that is not there.
 *
 * @param dir this tick's directory
 * @param lines the whole digest
 * @returns the file's path, or why it could not be written
 */
export function persistTickDigest({
  dir,
  lines,
}: {
  dir: string;
  lines: readonly string[];
}): Result<string, ScratchError> {
  const path = join(dir, TICK_DIGEST_FILE);
  try {
    writeFileAtomic({ contents: lines.map((line) => `${encodeDigestEntry({ line })}\n`).join(""), path });
  } catch (cause: unknown) {
    return err(ScratchErrors.fileFailed({ cause, path }));
  }
  return ok(path);
}

/**
 * What `tick open` prints of its digest: tick n-1's digest is read, this one is saved, and only then are the two compared.
 *
 * @param captureDir this tick's own directory, where the digest is saved
 * @param dir the seat's scratch directory, where tick n-1's digest is read from
 * @param lines this tick's whole digest
 * @returns the lines to print, or why the digest could not be saved
 */
export function tickDigestShown({
  captureDir,
  dir,
  lines,
  tick,
}: {
  captureDir: string;
  dir: string;
  lines: readonly string[];
  tick: number;
}): Result<readonly string[], ScratchError> {
  // The prior is read BEFORE this tick's digest exists, so no path arithmetic can ever compare a tick with itself.
  // This one is written before a line of it prints: the fold line names it, and the next tick reads it.
  const prior = readPriorDigest({ dir, tick });
  return persistTickDigest({ dir: captureDir, lines }).map((digestPath) =>
    deltaLines({ delta: digestDelta({ lines, prior }), digestPath, lines }),
  );
}

/**
 * What the seat's previous pass held on purpose, read from its filled `tick.json` — so `tick open` can leave those
 * rows out of the seatable list instead of re-printing them at the head of it every pass (eight of them).
 *
 * @param dir the scratch directory
 * @param tick the tick being opened; the one before it is read
 * @returns `none` on the seat's first tick; `unreadable` when the earlier tick's file is missing or will not parse —
 *   `tick open` writes one into every tick it opens, so its absence is a fact to say, never "nothing was held"
 */
export function readPriorHolds({ dir, tick }: { dir: string; tick: number }): PriorHolds {
  const prior = tick - 1;
  if (prior < 1) {
    return { kind: "none" };
  }
  const read = readJson({ path: join(dir, `tick-${String(prior)}`, TICK_INPUT_FILE) });
  if (read.isErr()) {
    return { kind: "unreadable", tick: prior, why: read.error };
  }
  return priorHoldsOf({ tick: prior, value: read.value });
}

/**
 * The checkout a recipe-failing finding is fixed in. Every recipe's verb is this repository's code, so its fix is
 * cut from here — the same name `automation run-due` gives when it registers the finding.
 */
const RECIPE_FIX_REPO = "slopweaver";

/**
 * Where a broken recipe's fix row would be pointed, resolved exactly as `handover set-repo --repo slopweaver`
 * resolves it in this home — so the digest prints a path that verb accepts, or that verb's own refusal.
 *
 * @param home the state home whose declared checkouts a bare name resolves through
 * @returns the resolved main checkout, or why there is none
 */
export function readRecipeFixCheckout({ home }: { home: string }): RecipeFixCheckout {
  const resolved = resolveRepoCheckout({ home, requested: RECIPE_FIX_REPO });
  if (resolved.isErr()) {
    return { kind: "unresolved", why: resolved.error.message };
  }
  return { kind: "resolved", path: resolved.value };
}
