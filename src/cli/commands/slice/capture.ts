/**
 * `slopweaver slice capture --name <slice> --root <dir>...` — pin a named subset of a source.
 *
 * Writes exactly one file, `$SLOPWEAVER_HOME/slices/<name>.json`, and nothing else. In particular it does
 * NOT write bronze: `refresh` stays the only writer, so a capture describes what the corpus WOULD hold
 * rather than putting it there. That keeps `capture` safe to run against a live home.
 *
 * The pin it records is the baseline every later `slice verify` compares against, which is why re-capturing
 * over an existing name is refused by default — silently replacing a baseline is the moving-baseline defect
 * the whole capability exists to prevent.
 */
import { redactRecord } from "../../../corpus/redactRecord.js";
import { gitFirstAddedDates } from "../../../corpus/self/eventTime.js";
import { dateSelfFiles, readSelfAuthor, selfMaxBytes } from "../../../corpus/self/ingest.js";
import { projectSelfRecords } from "../../../corpus/self/project.js";
import { scanSelfCorpus } from "../../../corpus/self/scan.js";
import { countSelfSkips } from "../../../corpus/self/skips.js";
import {
  buildSlicePin,
  SLICE_MANIFEST_VERSION,
  type SliceManifest,
  type SliceSentinel,
} from "../../../corpus/slice.js";
import { isValidSliceName, writeSliceManifest } from "../../../corpus/sliceStore.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ProfileReadError } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { collectRepeated } from "../refresh/core.js";
import { SLICE_VERBS, verbTail } from "./core.js";

const USAGE =
  "usage: slopweaver slice capture --name <slice> --root <dir>... [--sentinel '<text>::<query>']... [--exclude <rel-path>]... [--overwrite] [--home <dir>]";

/** The separator inside a `--sentinel` value: the string that must survive, then the query that should find it. */
const SENTINEL_SEPARATOR = "::";

/**
 * Parse one `--sentinel` value into its text and query halves. Pure.
 *
 * @param raw the flag value, `<text>::<query>`
 * @returns the sentinel, or undefined when either half is missing
 */
export function parseSentinel({ raw }: { raw: string }): SliceSentinel | undefined {
  const at = raw.indexOf(SENTINEL_SEPARATOR);
  if (at <= 0) {
    return undefined;
  }
  const text = raw.slice(0, at).trim();
  const query = raw.slice(at + SENTINEL_SEPARATOR.length).trim();
  return text.length > 0 && query.length > 0 ? { query, text } : undefined;
}

/**
 * Run the capture verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export function runSliceCapture(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: SLICE_VERBS });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const roots = collectRepeated({ flag: "--root", rest });
  const sentinelFlags = collectRepeated({ flag: "--sentinel", rest: roots.rest });
  const excludes = collectRepeated({ flag: "--exclude", rest: sentinelFlags.rest });
  const parsed = parseFlagTail({
    rest: excludes.rest,
    spec: { boolean: ["overwrite"], value: ["home", "name"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const name = parsed.value.values["name"];
  if (name === undefined || !isValidSliceName({ name })) {
    logger.error({ msg: "slice capture needs --name <slice> (lower-case letters, digits and hyphens)" });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  if (roots.values.length === 0) {
    logger.error({ msg: "slice capture needs at least one --root <dir>" });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const sentinels = parseSentinels({ raws: sentinelFlags.values });
  if (sentinels === undefined) {
    logger.error({ msg: "--sentinel needs '<text>::<query>' on both sides of the separator" });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });

  const captured = captureSlice({ exclude: excludes.values, home, name, roots: roots.values, sentinels });
  if (captured.isErr()) {
    logger.error({ msg: `refused: ${captured.error.message}. No slice was captured.` });
    return EXIT_ERROR;
  }
  const manifest = captured.value;
  const written = writeSliceManifest({ home, manifest, overwrite: parsed.value.flags.has("overwrite") });
  if (written.isErr()) {
    logger.error({ msg: written.error.message });
    return EXIT_ERROR;
  }
  logger.error({
    msg: `pinned slice \`${name}\`: ${String(manifest.pin.records)} record(s), ${String(manifest.entriesSeen)} entr(ies) seen, digest ${manifest.pin.digest.slice(0, 12)}`,
  });
  logger.out({ line: written.value });
  return EXIT_OK;
}

/**
 * Walk the roots and build the manifest that pins what was found.
 *
 * Reads only: `refresh` remains the only writer of bronze, so a capture describes what the corpus WOULD
 * hold rather than putting it there.
 *
 * The author is read before anything is walked: a corrupt profile refuses rather than pinning every record
 * under the default author.
 *
 * @param home the state home
 * @param name the slice's name
 * @param roots the directories to walk
 * @param sentinels the strings that must survive to a prompt
 * @param exclude relative-path prefixes to decline
 * @returns the manifest, ready to write, or why the profile that is there cannot be trusted
 */
function captureSlice({
  home,
  name,
  roots,
  sentinels,
  exclude,
}: {
  home: string;
  name: string;
  roots: readonly string[];
  sentinels: readonly SliceSentinel[];
  exclude: readonly string[];
}): Result<SliceManifest, ProfileReadError> {
  const author = readSelfAuthor({ home });
  if (author.isErr()) {
    return err(author.error);
  }
  // The SAME ceiling production `refresh` uses, break-glass included. Reading the environment here is
  // what keeps slice and production agreeing about what the corpus contains; without it a run with
  // `SLOPWEAVER_ALLOW_LARGE_FILES=1` would ingest a file the slice then reports as legitimately declined.
  const scanned = scanSelfCorpus({ exclude, home, maxBytes: selfMaxBytes({ env: process.env }), roots });
  const gitDatesByRoot = new Map(roots.map((root) => [root, gitFirstAddedDates({ root })] as const));
  const dated = dateSelfFiles({ files: scanned.files, gitDatesByRoot });
  // Redacted BEFORE pinning, because `writeCorpusRecords` redacts before it fingerprints. Pinning the raw
  // projection would make any note containing an email or a token pin one value and store another, and
  // `checkCaptureWrite` would then report a privacy transformation working correctly as data loss.
  const records = projectSelfRecords({ author: author.value, files: dated }).map((record) => redactRecord({ record }));
  const declinedByReason: Record<string, number> = {};
  for (const { reason, count } of countSelfSkips({ skips: scanned.skips })) {
    declinedByReason[reason] = count;
  }
  return ok({
    capturedAtIso: new Date().toISOString(),
    declinedByReason,
    entriesSeen: scanned.files.length + scanned.skips.length,
    exclude,
    name,
    pin: buildSlicePin({ records }),
    roots,
    sentinels,
    source: "self",
    version: SLICE_MANIFEST_VERSION,
  });
}

/**
 * Parse every `--sentinel` value, refusing the whole set if any one is malformed. Pure.
 *
 * All-or-nothing rather than skipping the bad one: a slice that silently pinned three of its four sentinels
 * would later report a clean handoff over an incomplete claim, which is this capability's own failure mode.
 *
 * @param raws the raw `--sentinel` flag values
 * @returns the parsed sentinels, or undefined when any value is malformed
 */
export function parseSentinels({ raws }: { raws: readonly string[] }): readonly SliceSentinel[] | undefined {
  const parsed: SliceSentinel[] = [];
  for (const raw of raws) {
    const sentinel = parseSentinel({ raw });
    if (sentinel === undefined) {
      return undefined;
    }
    parsed.push(sentinel);
  }
  return parsed;
}

/** The `slice capture` command. */
export const sliceCaptureCommand = defineCommand({ run: (argv) => runSliceCapture(argv) });
