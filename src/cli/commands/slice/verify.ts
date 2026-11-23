/**
 * `slopweaver slice verify --name <slice>` — run a pinned slice end to end and exit non-zero if anything was
 * lost without saying so.
 *
 * Read-only and zero-token by construction: it re-walks the pinned roots, re-projects through the SAME
 * production code `refresh` uses, reads the bronze that already exists, and computes the identities. It
 * never writes bronze — `refresh` stays the only writer — so idempotence is proven by showing that an
 * unchanged re-projection reproduces the pin, rather than by writing and seeing nothing appear.
 *
 * A thin effectful shell. Every judgement lives in {@link ../../../corpus/sliceChecks}, which is pure, so the
 * exact wording of a failure is unit-testable and a check cannot quietly depend on the filesystem.
 */
import { type CensusEntry, censusCorpus } from "../../../corpus/corpusCensus.js";
import { readCensusRecords } from "../../../corpus/corpusCensusRead.js";
import { bronzeDir } from "../../../corpus/corpusPaths.js";
import { redactRecord } from "../../../corpus/redactRecord.js";
import { type RowReader, withRowReader } from "../../../corpus/rowReader.js";
import { gitFirstAddedDates } from "../../../corpus/self/eventTime.js";
import { dateSelfFiles, readSelfAuthor, selfMaxBytes } from "../../../corpus/self/ingest.js";
import { projectSelfRecords } from "../../../corpus/self/project.js";
import { type SelfScanResult, scanSelfCorpus } from "../../../corpus/self/scan.js";
import { countSelfSkips, type SelfSkipReason, selfSkipIsFault } from "../../../corpus/self/skips.js";
import type { SliceManifest, SliceSentinel } from "../../../corpus/slice.js";
import { buildSlicePin } from "../../../corpus/slice.js";
import {
  anyBroken,
  checkCaptureWrite,
  checkDiscovery,
  checkIdempotence,
  checkKeyInjectivity,
  checkProjection,
  checkReconstruction,
  checkRetrievalHandoff,
  type IdentityResult,
  provedNothing,
  renderSliceReport,
} from "../../../corpus/sliceChecks.js";
import { readSliceManifest } from "../../../corpus/sliceStore.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { logger } from "../../../lib/logger.js";
import { MAX_RECORD_CHARS, planShards, shardRecordFrom } from "../../../retrieval/fanout.js";
import { admitLoadSlot } from "../../admitLoadSlot.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { SLICE_VERBS, verbTail } from "./core.js";

const USAGE = "usage: slopweaver slice verify --name <slice> [--check] [--json] [--home <dir>]";

/** Every skip reason that means something went wrong rather than something was deliberately declined. */
const FAULT_REASONS: ReadonlySet<string> = new Set<SelfSkipReason>(
  (
    [
      "unsupported-extension",
      "symlink",
      "inside-home",
      "excluded-directory",
      "too-large",
      "binary-content",
      "unreadable",
    ] as const
  ).filter((reason) => selfSkipIsFault({ reason })),
);

/**
 * Run the verify verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code — non-zero when any identity is broken
 */
export function runSliceVerify(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: SLICE_VERBS });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: { boolean: ["check", "json"], value: ["home", "name"] } });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const name = parsed.value.values["name"];
  if (name === undefined) {
    logger.error({ msg: "slice verify needs --name <slice>" });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: parsed.value.values["home"] });
  // BEFORE bronze is re-read, deliberately: verifying a slice streams the whole corpus into a census holding
  // one entry per logical record, so it is rationed like every other whole-corpus verb (src/lib/loadSlots.ts).
  const admitted = admitLoadSlot({ logger });
  if ("code" in admitted) {
    return admitted.code;
  }

  return verifySlice({ check: parsed.value.flags.has("check"), home, json: parsed.value.flags.has("json"), name });
}

/**
 * Load the pin, re-observe the slice, and report — the whole verb once its flags are settled.
 *
 * @param home the state home
 * @param name the slice to verify
 * @param json emit the identities as machine-readable JSON on stdout instead of a human report
 * @param check the yes/no form the doc asked for — the exit code IS the answer, so the report is suppressed
 * @returns the process exit code
 */
function verifySlice({
  home,
  name,
  json,
  check,
}: {
  home: string;
  name: string;
  json: boolean;
  check: boolean;
}): number {
  const loaded = readSliceManifest({ home, name });
  if (loaded.isErr()) {
    // A pin that cannot be READ is not a pin that MATCHED. This is the whole reason the store is fail-loud.
    logger.error({ msg: loaded.error.message });
    return EXIT_ERROR;
  }
  const manifest = loaded.value;
  const author = readSelfAuthor({ home });
  if (author.isErr()) {
    // Re-projected under the default author, every record would read as lost against its pin.
    logger.error({ msg: `refused: ${author.error.message}. No slice was verified.` });
    return EXIT_ERROR;
  }

  const observed = observeSlice({ author: author.value, home, manifest });
  if (observed === undefined) {
    // Fail LOUD. A corpus this run could not read is not a corpus that held everything — reporting
    // conservation over it would be the exact silent success this capability exists to prevent.
    logger.error({
      msg: "bronze could not be read — refusing to report conservation over a corpus this run never saw",
    });
    return EXIT_ERROR;
  }
  return reportSlice({ check, json, name, results: sliceIdentities({ manifest, ...observed }) });
}

/**
 * Re-walk and re-project the pinned slice, and read what bronze currently holds for it.
 *
 * Uses the PRODUCTION scanner and projector rather than a second implementation, so a defect in the real one
 * shows up here instead of being masked by a reimplementation that happens to be correct.
 *
 * @param author the persona every re-projected record is attributed to, already read from the profile
 * @param home the state home
 * @param manifest the pinned slice
 * @returns everything the identities are computed from, or undefined when bronze could not be read
 */
function observeSlice({ author, home, manifest }: { author: string; home: string; manifest: SliceManifest }):
  | {
      scanned: SelfScanResult;
      projected: readonly CorpusRecord[];
      stored: readonly CorpusRecord[];
      physical: readonly CorpusRecord[];
      everySource: readonly CensusEntry[];
      declinedByReason: Readonly<Record<string, number>>;
    }
  | undefined {
  // The SAME ceiling production `refresh` uses, break-glass included. Reading the environment here is
  // what keeps slice and production agreeing about what the corpus contains; without it a run with
  // `SLOPWEAVER_ALLOW_LARGE_FILES=1` would ingest a file the slice then reports as legitimately declined.
  // The manifest's OWN exclusions, never a fresh flag: re-walking a different subtree than was pinned
  // would compare two different slices and report the difference as loss.
  const scanned = scanSelfCorpus({
    exclude: manifest.exclude,
    home,
    maxBytes: selfMaxBytes({ env: process.env }),
    roots: manifest.roots,
  });
  const gitDatesByRoot = new Map(manifest.roots.map((root) => [root, gitFirstAddedDates({ root })]));
  const dated = dateSelfFiles({ files: scanned.files, gitDatesByRoot });
  // Redacted BEFORE comparison, for the same reason capture pins redacted records: the writer redacts
  // before it fingerprints, so anything else compares two different things and calls the difference loss.
  const projected = projectSelfRecords({ author, files: dated }).map((record) => redactRecord({ record }));

  const read = withRowReader({ run: (reader) => readSliceBronze({ home, reader, source: manifest.source }) });
  if (read === undefined) {
    return undefined;
  }

  const declinedByReason: Record<string, number> = {};
  for (const { reason, count } of countSelfSkips({ skips: scanned.skips })) {
    declinedByReason[reason] = count;
  }
  return { declinedByReason, projected, scanned, ...read };
}

/**
 * What bronze holds for the slice, STREAMED through the corpus census: every physical row of the slice's own
 * source, that source's latest view, and a census entry per logical record across EVERY source.
 *
 * This used to read the whole corpus into one array, and on the owner's corpus that read refused at the heap
 * preflight, so the verb could not verify any slice at all. Only the slice's own source is ever held as
 * records — `self`, tiny beside the corpus — and the census's latest view is `latestRecords` exactly, under
 * the `bronze` projection this read always used.
 *
 * @param home the state home
 * @param source the slice's source
 * @param reader the open row reader ties and the stored view read rows back through
 * @returns what bronze holds, or undefined (with the reason logged) when it could not all be read
 */
function readSliceBronze({
  home,
  source,
  reader,
}: {
  home: string;
  source: string;
  reader: RowReader;
}):
  | { physical: readonly CorpusRecord[]; stored: readonly CorpusRecord[]; everySource: readonly CensusEntry[] }
  | undefined {
  const physical: CorpusRecord[] = [];
  const census = censusCorpus({
    dir: bronzeDir({ home }),
    home,
    onRow: ({ record }) => {
      if (record.source === source) {
        physical.push(record);
      }
    },
    reader,
    tieProjection: "bronze",
  });
  if (census.isErr()) {
    logger.error({ msg: census.error.message });
    return undefined;
  }
  // A file this could not open would be counted as records the slice failed to capture — the verdict would
  // read "lossy capture" when the truth is "wrong permission bit", which sends the reader to re-export
  // instead of to `chmod`. Same reasoning as `dev manifest`: a completeness check over a partial corpus
  // measures the wrong thing rather than measuring the right thing badly.
  if (census.value.unreadable.length > 0) {
    logger.error({
      msg: `refusing to verify: ${String(census.value.unreadable.length)} corpus path(s) could not be read, and their records would be counted as capture loss — ${census.value.unreadable.join(", ")}`,
    });
    return undefined;
  }
  // Deliberately NOT filtered to the slice's source. BM25 and the vector index key every record by bare
  // `sourceId`, so two records from DIFFERENT sources sharing an id collapse just as surely as two from the
  // same one. Checking only the slice's own source is why this identity was permanently vacuous on `self`,
  // which has no collisions at all, while the corpus has thousands.
  const everySource = [...census.value.winners.values()];
  const stored = readCensusRecords({
    entries: everySource.filter((entry) => entry.source === source),
    projection: "bronze",
    reader,
  });
  if (stored.isErr()) {
    logger.error({ msg: stored.error.message });
    return undefined;
  }
  return { everySource, physical, stored: stored.value };
}

/**
 * Emit the outcome and choose the exit code.
 *
 * `--json` writes to STDOUT (pristine, so `| jq` stays clean) and the human report to stderr, matching how
 * every other diagnostic verb here splits the two. `--check` suppresses the prose entirely: the doc asked for
 * "one thing you can run and get a yes/no rather than a paragraph", and the exit code is that answer.
 *
 * @param results every identity's result
 * @param name the slice's name
 * @param json emit machine-readable JSON on stdout
 * @param check suppress the human report, leaving only the exit code
 * @returns the process exit code
 */
function reportSlice({
  results,
  name,
  json,
  check,
}: {
  results: readonly IdentityResult[];
  name: string;
  json: boolean;
  check: boolean;
}): number {
  if (json) {
    logger.out({ line: JSON.stringify({ identities: results, slice: name }, null, 2) });
  }
  if (!check) {
    for (const line of [`slice ${name}:`, ...renderSliceReport({ results })]) {
      logger.error({ msg: line });
    }
  }
  // Three outcomes, not two. `--check` is what CI and an agent use: the report is the same, the exit code
  // is the answer, and the verb exits non-zero with or without it because a report nobody reads plus a zero
  // exit is how this fails silently. INCONCLUSIVE gets its own code so "we proved nothing" can never be
  // mistaken for "we proved nothing was lost" — the two sentences that this whole capability exists to
  // keep apart.
  if (anyBroken({ results })) {
    return EXIT_ERROR;
  }
  return provedNothing({ results }) ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Compute every identity for a slice.
 *
 * Split out of the verb so the shell stays thin and the ORDER of the identities — which is the order they
 * are reported in — lives in one readable place.
 *
 * @param manifest the pinned slice
 * @param scanned what the walk found
 * @param projected the records the projector produced this run
 * @param stored the latest-view records bronze already holds for this source
 * @param physical every physical row for this source, superseded ones included
 * @param everySource a census entry per logical record across ALL sources — key injectivity is a property of the shared
 *   retrieval key space, so scoping it to one source is what made it permanently vacuous
 * @param declinedByReason the walk's declines, counted per typed reason
 * @returns every identity's result, in report order
 */
function sliceIdentities({
  manifest,
  scanned,
  projected,
  stored,
  physical,
  everySource,
  declinedByReason,
}: {
  manifest: SliceManifest;
  scanned: SelfScanResult;
  projected: readonly CorpusRecord[];
  stored: readonly CorpusRecord[];
  physical: readonly CorpusRecord[];
  everySource: readonly CensusEntry[];
  declinedByReason: Readonly<Record<string, number>>;
}): readonly IdentityResult[] {
  return [
    checkDiscovery({
      declinedByReason,
      entriesSeen: scanned.files.length + scanned.skips.length,
      faultReasons: FAULT_REASONS,
      filesRead: scanned.files.length,
    }),
    checkCaptureWrite({ physical, projected, stored }),
    checkProjection({ records: projected }),
    // Reconstruction renders each body through the REAL shard renderer at the REAL per-record budget — the
    // same call `store read` makes when it packs a reader's shard. Comparing the body to itself would be a check
    // that cannot fail, which is the exact defect this capability exists to prevent; comparing it to the
    // bytes a reader would actually be handed is a claim that CAN go red, and does the moment a record
    // exceeds the budget and `shardRecordFrom` clips it.
    checkReconstruction({
      budget: MAX_RECORD_CHARS,
      corpusExposure: truncationExposure({ entries: everySource }),
      pairs: projected.map((record) => ({
        body: recordSliceBody({ record }),
        label: `${record.container}/${record.sourceId}`,
        selected: shardRecordFrom({ record }).text,
      })),
    }),
    checkIdempotence({ after: buildSlicePin({ records: projected }), before: manifest.pin }),
    checkKeyInjectivity({ records: everySource }),
    traceSentinels({ records: projected, sentinels: manifest.sentinels }),
  ];
}

/**
 * Trace every declared sentinel from the corpus to the exact bytes a reader would be handed.
 *
 * This is the leg that makes the whole exercise mean something: the other identities prove records exist and
 * agree with a pin, and this one proves a specific string the owner cares about is still THERE at the point
 * of handoff. It packs the slice with the REAL shard planner, so a record that is present in the corpus and
 * then clipped away shows up as in-the-slice-but-not-in-the-shard rather than as a pass.
 *
 * **What it no longer claims.** It used to rank the slice with the retired BM25 engine first, so `retrieved`
 * meant "a ranker surfaced it for this sentinel's query". Deleting that
 * ranker, and nothing here selects from the store — `slice verify` reads files and holds no connection. So
 * `retrieved` now means the weaker, honest thing: the sentinel is in the slice's own projected records. The
 * CLIPPING half is untouched and is where this check can still go red.
 *
 * Zero tokens: `planShards` ASSEMBLES what a reader would be given, it sends nothing. The bytes are the
 * subject, and no transport is constructed — precisely the boundary the owner ruled "handed to a model"
 * means.
 *
 * @param records the slice's records
 * @param sentinels the strings that must survive, each with the query that names it
 * @returns the retrieval-and-handoff identity's result
 */
function traceSentinels({
  records,
  sentinels,
}: {
  records: readonly CorpusRecord[];
  sentinels: readonly SliceSentinel[];
}): IdentityResult {
  const shards = planShards({ records });
  const shardText = shards.flatMap((shard) => shard.records.map((entry) => entry.text)).join("\n");
  // Counted from the BODIES rather than from the clipped text: a shard entry carries what survived, so
  // measuring it would report the budget back rather than what the budget cost.
  const droppedChars = records.reduce(
    (total, record) => total + Math.max(0, recordSliceBody({ record }).length - MAX_RECORD_CHARS),
    0,
  );
  const observations = sentinels.map((sentinel) => ({
    inPrompt: shardText.includes(sentinel.text),
    retrieved: records.some((record) => recordSliceBody({ record }).includes(sentinel.text)),
    sentinel,
  }));
  return checkRetrievalHandoff({ droppedChars, observations });
}

/**
 * How many records ANYWHERE in the corpus exceed the prompt budget.
 *
 * Cheap — a length comparison per record, no selection run — so it costs nothing to state on every run, and
 * stating it is what turns "this slice cannot exercise reconstruction" from a shrug into a fact.
 *
 * @param entries a census entry per logical record across every source — its `bodyChars` is
 *   {@link recordSliceBody}'s length, pinned equal by the census's own unit test
 * @returns the over-budget count and the total it is drawn from
 */
function truncationExposure({ entries }: { entries: readonly CensusEntry[] }): {
  overBudget: number;
  ofRecords: number;
} {
  let overBudget = 0;
  for (const entry of entries) {
    if (entry.bodyChars > MAX_RECORD_CHARS) {
      overBudget += 1;
    }
  }
  return { ofRecords: entries.length, overBudget };
}

/**
 * The body a record contributes to a prompt: title and text joined, matching what `askPrompt` assembles.
 *
 * Duplicated here rather than imported because `askPrompt`'s own helper is private, and exporting it purely
 * for a checker would widen a module's surface to suit its observer. Pure.
 *
 * @param record the record to render
 * @returns the body the prompt budget is applied to
 */
function recordSliceBody({ record }: { record: CorpusRecord }): string {
  return record.title === undefined ? record.text : `${record.title}\n${record.text}`;
}

/** The `slice verify` command. */
export const sliceVerifyCommand = defineCommand({ run: (argv) => runSliceVerify(argv) });
