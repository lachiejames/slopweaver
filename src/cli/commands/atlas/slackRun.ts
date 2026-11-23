/**
 * `slopweaver atlas slack` — the effectful shell.
 *
 * Thin by design: every decision is pure ({@link ../../../atlas/slack} and {@link ./slackCore}), and this
 * file only reads two files that other lanes already maintain. It makes **no network call**, which is the
 * property that lets "what have I never looked at" be a read rather than an investigation.
 *
 * Data to STDOUT, diagnostics to STDERR, so `--json` stays pristine for `… | jq`.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type HuddleRow,
  mergeReadTo,
  readToByChannel,
  readToFromPermalinks,
  slackAtlas,
  type UnreadableWindow,
} from "../../../atlas/slack.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { readThreadCursors as readStoredThreadCursors } from "../../../corpus/slack/threadCursors.js";
import { readStructureRows } from "../../../corpus/structures/store.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseAtlasSlackArgs, renderAtlasSlack } from "./slackCore.js";
import { ATLAS_SLACK_USAGE } from "./slackUsage.js";

/** The argv index the `atlas <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes and no filesystem. */
export interface AtlasSlackDeps {
  readonly structureRows: typeof readStructureRows;
  readonly threadCursors: (args: { home?: string }) => ReadonlyMap<string, string>;
  /**
   * ONE bronze pass answering both questions this verb asks of it — how far each conversation is read, and
   * which huddles exist. They were two seams for one afternoon and that was already wrong: the pass reads
   * every window file, so a second seam meant paying it twice to answer two questions about the same lines.
   * Measured at seconds of wall and hundreds of MB peak RSS over a several-GB corpus
   * (`/usr/bin/time -l slopweaver atlas slack`); it was about half that time over a smaller corpus when this
   * note was first written.
   */
  readonly bronzeScan: (args: { home?: string }) => BronzeScan;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Read the per-thread reply cursors `refresh` maintains, as a map of last-seen reply timestamps.
 *
 * Delegates to the store's own reader rather than parsing the file again here. It used to parse it, and
 * that second implementation understood exactly one shape — so the day the store gained a version it would
 * have returned an empty map and reported every channel `never-read`, quietly, with the atlas none the wiser.
 * A store with a migration is a store with ONE reader.
 *
 * An unreadable or absent file still yields an EMPTY map rather than throwing, and that degradation is safe
 * in one direction only: with no cursors every channel reports `never-read`, which understates coverage and
 * can never claim a channel was read when it was not. The opposite default would be the lie.
 *
 * @param home the Slopweaver home
 * @returns the `<channel>:<threadTs>` → last-seen-reply map, empty when there is none
 */
export function readThreadCursors({ home }: { home?: string }): ReadonlyMap<string, string> {
  const stored = readStoredThreadCursors(home !== undefined ? { home } : {});
  return new Map(Object.entries(stored).map(([key, cursor]) => [key, cursor.ts]));
}

/** What one pass over bronze's Slack windows found. */
export interface BronzeScan {
  /** The newest ingested timestamp per conversation id. */
  readonly readTo: ReadonlyMap<string, string>;
  /** Every `huddle` record found, reduced to what the census counts. */
  readonly huddles: readonly HuddleRow[];
  /**
   * Every window that could not be read. NON-EMPTY means both halves of the atlas — the huddle census and
   * the coverage map — are computed over a SUBSET, so the verb has to name it rather than print the numbers
   * as if they were the whole. See {@link scanBronze}.
   */
  readonly unreadableWindows: readonly UnreadableWindow[];
}

/**
 * Read the two census facts off one parsed bronze line, or undefined when the line is not a huddle.
 *
 * Field-by-field rather than a cast, and each field is checked for the type the census actually needs — so
 * a huddle written by an older projection that lacks `attrs` counts as a huddle without a transcript rather
 * than throwing or, worse, being asserted into a shape it does not have.
 *
 * @param line one JSONL line's parsed value
 * @returns the census row when the line is a huddle, else undefined
 */
function asHuddleRow({ line }: { line: unknown }): HuddleRow | undefined {
  if (!isRecord(line) || line["kind"] !== "huddle") {
    return undefined;
  }
  const attrs = isRecord(line["attrs"]) ? line["attrs"] : {};
  // A huddle whose transcript was long enough to chunk projects several `huddle` records, and only the
  // first carries no `chunkIndex`. Counting every row would report a 26-minute call as sixteen huddles.
  const chunkIndex = attrs["chunkIndex"];
  if (typeof chunkIndex === "number" && chunkIndex > 0) {
    return undefined;
  }
  const transcript = attrs["huddleTranscriptFileId"];
  return {
    hasWords: typeof attrs["huddleTranscriptChars"] === "number",
    transcriptFileId: typeof transcript === "string" && transcript.length > 0 ? transcript : undefined,
    tsIso: typeof line["tsIso"] === "string" ? line["tsIso"] : "",
  };
}

/**
 * The newest message this program has INGESTED per conversation, and every huddle, read out of bronze.
 *
 * Every bronze record carries its own Slack permalink, which encodes the conversation and the timestamp, so
 * this needs no parsing of the record body. Measured at ~4s over the owner's 344 MB corpus, which is slow
 * for a lookup and is accepted deliberately: the alternative — thread cursors alone — is simply WRONG for
 * any channel without threads, and it was wrong in practice. Three alert channels the owner belongs to were
 * reported never-read; two had in fact been ingested. A fast wrong answer is worth less than a slow right
 * one, and if this ever needs to be quick the fix is a cached index rather than a worse source.
 *
 * **A window that cannot be read is REPORTED, never skipped.** This used to `readFileSync(path, "utf8")`
 * inside a bare `try/catch` that returned `undefined`, and argued the resulting undercount was the safe
 * direction. That argument holds for one window of several and collapses for the COMPACTED one, which holds
 * everything: on a real home `compact.jsonl` is several gigabytes, so the read threw
 * `Cannot create a string longer than 0x1fffffe8 characters`, the catch swallowed it, and the verb printed a
 * confident census over the few MB it could still read — hundreds of conversations judged off a tenth of a
 * percent of the corpus,
 * with no witness anywhere. Understating to zero while printing a census is not a safe direction; it is a
 * wrong answer nobody can see. Reproduce the underlying throw with
 * `node -e "require('fs').readFileSync(process.argv[1],'utf8')" ~/.slopweaver/corpus/bronze/slack/compact.jsonl`.
 *
 * So both halves changed. Reading goes through {@link readJsonlLines}, the one reader in this repo allowed
 * to touch a data-scale `.jsonl`, whose transient is one 8 MiB chunk plus one line whatever the file's size.
 * And a window that still fails — a permission error, a truncated file — lands in
 * {@link BronzeScan.unreadableWindows} for the renderer to name, so the rest of the corpus is still
 * reported and the shortfall travels with it.
 *
 * @param home the Slopweaver home
 * @returns the coverage map, the huddle records, and every window that could not be read
 */
export function scanBronze({ home }: { home?: string }): BronzeScan {
  const dir = join(stateHomePaths(home !== undefined ? { home } : {}).corpus.bronze, "slack");
  const huddles: HuddleRow[] = [];
  const unreadableWindows: UnreadableWindow[] = [];
  let readTo: ReadonlyMap<string, string> = new Map();
  let links: string[] = [];
  // Fold the permalinks seen so far into the map and drop them, rather than holding every one to the end.
  // The compacted window alone holds well over a million records
  // (`wc -l ~/.slopweaver/corpus/bronze/slack/compact.jsonl`), and a held permalink is far more than its own
  // 35 characters — see {@link LINK_FOLD_BATCH}.
  const foldLinks = (): void => {
    readTo = mergeReadTo({ maps: [readTo, readToFromPermalinks({ permalinks: links })] });
    links = [];
  };
  for (const window of windowFiles({ dir })) {
    try {
      readJsonlLines({
        onLine: ({ line }) => {
          for (const match of line.matchAll(PERMALINK_SCAN)) {
            links.push(match[0]);
          }
          if (links.length >= LINK_FOLD_BATCH) {
            foldLinks();
          }
          // The substring test before the parse is the whole reason this is affordable: a huddle is a
          // handful of lines in millions, and `JSON.parse` on every one of them would dominate the pass.
          if (!line.includes('"kind":"huddle"')) {
            return;
          }
          const huddle = parseHuddleLine({ line });
          if (huddle !== undefined) {
            huddles.push(huddle);
          }
        },
        path: join(dir, window),
      });
    } catch (error: unknown) {
      unreadableWindows.push({
        file: window,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  foldLinks();
  return { huddles, readTo, unreadableWindows };
}

/**
 * How many permalinks accumulate before they are folded into the read-to map and dropped.
 *
 * A bound on the pass's own transient, not a tuning knob, and the number is small for a reason that is not
 * obvious from the code: **a matched substring in V8 does not copy its characters.** `match[0]` is a sliced
 * string pointing INTO the line it came from, so holding one permalink holds the whole ~3.8 KB bronze
 * record it was cut out of. At a hundred thousand links that is hundreds of MB of lines alive at once, which
 * is a per-corpus transient inside a pass that just bought a per-chunk one.
 *
 * MEASURED over a multi-gigabyte corpus, with
 * `NODE_OPTIONS=--max-old-space-size=<cap> /usr/bin/time -l slopweaver atlas slack`: at a hundred thousand
 * the pass peaked near two GB RSS and died outright under a hundreds-of-MB heap cap; at this figure it peaks
 * at hundreds of MB, runs under a low-hundreds-MB cap, and is FASTER, by about a fifth, for want of the
 * garbage.
 */
const LINK_FOLD_BATCH = 4_096;

/**
 * Every `.jsonl` window under a bronze source directory, or none when the directory is not there.
 *
 * @param dir the source's bronze directory
 * @returns the window filenames
 */
function windowFiles({ dir }: { dir: string }): readonly string[] {
  try {
    return readdirSync(dir).filter((entry) => entry.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

/**
 * Parse one candidate huddle line, treating a malformed line as absent rather than fatal.
 *
 * @param line the raw JSONL line
 * @returns the huddle census row, or undefined when the line does not parse or is not one
 */
function parseHuddleLine({ line }: { line: string }): HuddleRow | undefined {
  try {
    return asHuddleRow({ line: JSON.parse(line) });
  } catch {
    return undefined;
  }
}

/** Every archive permalink in one bronze line. Global so `matchAll` walks the whole line. */
const PERMALINK_SCAN = /\/archives\/[A-Z0-9]+\/p\d{16}/g;

/**
 * Run the verb against injected dependencies.
 *
 * @param rest the argv tail after `atlas slack`
 * @param deps the injected edges
 * @returns the process exit code
 */
export function runAtlasSlack({ rest, deps }: { rest: readonly string[]; deps: AtlasSlackDeps }): number {
  const options = parseAtlasSlackArgs({ rest });
  if (options.isErr()) {
    for (const problem of options.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(ATLAS_SLACK_USAGE);
    return EXIT_USAGE;
  }
  const { home, json, neverRead, unreadable } = options.value;
  const homeArgs = home !== undefined ? { home } : {};
  const stored = deps.structureRows({ source: "slack", ...homeArgs });
  for (const warning of stored.warnings) {
    deps.writeDiagnostic(`structure store: ${warning}`);
  }
  const bronze = deps.bronzeScan(homeArgs);
  for (const window of bronze.unreadableWindows) {
    // On STDERR as well as in the document, so a `--json | jq` pipeline that reads only the fields it
    // cares about still cannot miss that the numbers it is reading are partial.
    deps.writeDiagnostic(`bronze window unreadable: ${window.file} — ${window.message}`);
  }
  const atlas = slackAtlas({
    huddles: bronze.huddles,
    // BOTH sources, because each misses what the other holds: bronze knows every channel `refresh`
    // ingested (including top-level-only alert channels, which never gain a thread cursor), and the
    // cursors know replies a targeted read pulled in without ingesting. See `mergeReadTo`.
    readTo: mergeReadTo({ maps: [readToByChannel({ cursors: deps.threadCursors(homeArgs) }), bronze.readTo] }),
    rows: stored.rows,
  });
  if (atlas.counts.total === 0) {
    deps.writeDiagnostic("no Slack channels known yet — run `slopweaver refresh --source slack` first");
    return EXIT_ERROR;
  }
  const shortfall = bronze.unreadableWindows;
  // The shortfall rides in the SAME document rather than only on stderr: `--json` is what another program
  // reads, and a machine consumer that cannot see the census is computed over a subset is exactly the
  // reader this defect fooled.
  const document = JSON.stringify({ ...atlas, unreadableWindows: shortfall }, null, 2);
  deps.writeOut(json ? document : renderAtlasSlack({ atlas, options: { neverRead, unreadable }, shortfall }));
  return EXIT_OK;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 * @internal
 */
export function productionAtlasSlackDeps(): AtlasSlackDeps {
  return {
    bronzeScan: ({ home }) => scanBronze(home !== undefined ? { home } : {}),
    structureRows: readStructureRows,
    threadCursors: ({ home }) => readThreadCursors(home !== undefined ? { home } : {}),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * `slopweaver atlas slack` — what exists, what you can read, and what nobody has looked at.
 * @internal
 */
export const atlasSlackCommand = defineCommand({
  run: (argv) => runAtlasSlack({ deps: productionAtlasSlackDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
