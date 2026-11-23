/**
 * `slopweaver store read` and `store collect` — the fan-out reader's two halves.
 *
 * `read` selects candidates from the store and writes one shard per reader, then prints the plan: which
 * shard is where, and the exact instruction to hand each reader. `collect` takes what the readers returned
 * and CHECKS it against the shard each one was actually given, keeping only findings whose quote is
 * verbatim in a record that reader was shown.
 *
 * **No model runs here, and that is rule 2 rather than an omission.** The readers are in-process `Agent`
 * calls the visible session makes, so the owner can see and interrupt them; this CLI gathers the evidence,
 * briefs, and validates. The mechanism itself is fanning out cheap Haiku readers to read different things and find what's relevant.
 *
 * A thin effectful shell — every line it prints and every path it uses comes from {@link ./readCore}, and
 * the checking is pure in {@link ../../../retrieval/fanout}.
 */
import { randomUUID } from "node:crypto";
import { slopweaverHome } from "../../../config.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { writeFileAtomicStream } from "../../../lib/writeAtomic.js";
import { collectFindings, type FanoutPlan, planShards, type Shard } from "../../../retrieval/fanout.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { digestOf, readPlan, readReplies, shardsFromDisk } from "./fanoutFiles.js";
import { fanoutPaths, fanoutSlug, harvestLines, parseStoreCollectArgs, planLines, shardPath } from "./readCore.js";
import { readStoreQuestion, refuseParsed, refuseWith } from "./shell.js";

const READ_USAGE =
  "usage: slopweaver store read <question> [--search <terms>] [--contains <literal>] [--like <pattern>] [--source <s>] [--kind <k>] [--container <c>] [--author <a>] [--person <name>] [--since <iso>] [--until <iso>] [--visibility <v>] [--channel <c>] [--repo <o/r>] [--team <t>] [--assignee <a>] [--state <s>] [--limit <n>] [--shard-chars <n>] [--home <dir>] [--json]\n" +
  "  Selects candidates with Postgres full-text over the question plus whatever structured filters you\n" +
  "  give, shards them, and prints one reader instruction per shard. It runs NO model: dispatch one\n" +
  '  in-process Agent per shard at model "haiku", then check the replies with `store collect`.\n' +
  "  --search narrows the SELECTION without changing the question the readers answer, which is what a\n" +
  "  naturally-phrased question usually needs: full text ANDs its content words.\n" +
  "  --contains matches literal CHARACTERS where --search matches stemmed WORDS, so a name inside an email\n" +
  "  address, a mention or a URL path reaches one and is invisible to the other. --like takes your own ILIKE\n" +
  "  pattern. At most one of the three per query.";

const COLLECT_USAGE =
  "usage: slopweaver store collect --plan <path> --replies <file.json> [--json]\n" +
  "  Checks every reply against the shard its reader was given: an id from another shard is refused, and\n" +
  "  so is a quote that is not verbatim in the record it names. Both are reported, never dropped quietly.";

/** How many candidate rows a fan-out selects when the caller names no limit. */
const DEFAULT_CANDIDATES = 120;

/**
 * The flags `store read` accepts — the query surface, plus where to put the shards and how big to make
 * them. Exported so the help-truth ratchet probes the same spec the verb parses with, not a copy of it.
 *
 * @internal
 */
export const STORE_READ_FLAG_SPEC = {
  boolean: ["json"],
  string: [
    "search",
    "contains",
    "like",
    "source",
    "kind",
    "container",
    "author",
    "person",
    "since",
    "until",
    "visibility",
    "channel",
    "repo",
    "team",
    "thread",
    "assignee",
    "state",
    "limit",
    "shard-chars",
    "home",
  ],
} as const;

/** The flags `store read` advertises, for the help-truth ratchet. */
export const STORE_READ_FLAG_NAMES: readonly string[] = [
  ...STORE_READ_FLAG_SPEC.string.map((name) => `--${name}`),
  ...STORE_READ_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/**
 * Write one shard's records, one JSON object per line.
 *
 * Streamed rather than joined into a string first: a shard is bounded by its own budget, but the shape
 * "serialise every record then write" is the one the `whole-file-json` gate exists to keep out of a
 * `.jsonl` writer, and writing it correctly here costs nothing.
 *
 * @param path where the shard goes
 * @param shard the planned shard whose records are written
 */
function writeShard({ path, shard }: { path: string; shard: Shard }): void {
  writeFileAtomicStream({
    path,
    produce: ({ write }) => {
      for (const record of shard.records) {
        write({ text: `${safeJsonStringify({ label: "shard record", value: record })}\n` });
      }
    },
  });
}

/**
 * Select the candidates, shard them, write them, and print the plan.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreRead(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "read" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: READ_USAGE });
    return EXIT_OK;
  }
  const read = await readStoreQuestion({
    defaultLimit: DEFAULT_CANDIDATES,
    rest,
    spec: STORE_READ_FLAG_SPEC,
    usage: READ_USAGE,
  });
  if ("code" in read) {
    return read.code;
  }
  const home = read.values["home"];
  return planFanout({
    home: typeof home === "string" ? home : slopweaverHome(),
    json: read.values["json"] === true,
    question: read.resolved.question,
    records: read.resolved.records,
    shardChars: readShardChars({ values: read.values }),
  });
}

/**
 * The per-reader character budget a caller asked for, or the module default.
 *
 * @param values the tokenised flag values
 * @returns the budget, or `undefined` to take {@link ../../../retrieval/fanout.DEFAULT_SHARD_CHARS}
 */
function readShardChars({ values }: { values: Readonly<Record<string, string | boolean>> }): number | undefined {
  const raw = values["shard-chars"];
  return typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/**
 * Shard the selected records, write them, and print the plan.
 *
 * @param records the candidates the store selected, newest first
 * @param question the question the readers are given
 * @param home the Slopweaver home the fan-out is written under
 * @param shardChars the per-reader character budget, when the caller set one
 * @param json whether to print the machine-readable plan instead of the report
 * @returns the process exit code
 */
function planFanout({
  records,
  question,
  home,
  shardChars,
  json,
}: {
  records: readonly CorpusRecord[];
  question: string;
  home: string;
  shardChars: number | undefined;
  json: boolean;
}): number {
  const shards = planShards({ records, ...(shardChars !== undefined ? { shardChars } : {}) });
  const paths = fanoutPaths({ home, slug: fanoutSlug({ nowIso: new Date().toISOString(), question }) });
  const written: Shard[] = [];
  for (const shard of shards) {
    const path = shardPath({ dir: paths.dir, shard });
    writeShard({ path, shard });
    // The digest is taken AFTER the write and recorded in the plan, so `collect` can tell a reader that
    // read this file from a reader that read something the file has since become.
    const digest = digestOf({ shardFile: path });
    // The token is minted per shard and travels only in that shard's own printed instruction, so a reader
    // cannot claim a shard it was not dispatched to. See `Shard.token` for the counterexample without it.
    const tokened = { ...shard, token: randomUUID() };
    written.push(digest === null ? tokened : { ...tokened, digest });
  }
  const plan: FanoutPlan = { candidates: records.length, question, shards: written };
  writeFileAtomicStream({
    path: paths.plan,
    produce: ({ write }) => {
      // The persisted plan carries each shard's COUNT, never its records: the file is the one place they
      // live, so a plan and a shard cannot describe two different slices.
      write({
        text: safeJsonStringify({
          label: "fan-out plan",
          space: 2,
          value: {
            candidates: plan.candidates,
            question: plan.question,
            shards: written.map((shard) => ({
              digest: shard.digest,
              id: shard.id,
              records: shard.records.length,
              token: shard.token,
            })),
          },
        }),
      });
    },
  });
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "fan-out plan", value: { dir: paths.dir, plan: paths.plan } }) });
    return shards.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  }
  planLines({ dir: paths.dir, plan, planPath: paths.plan }).forEach((line) => {
    logger.out({ line });
  });
  return shards.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Check what the readers returned against the shards they were given.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runStoreCollect(argv: readonly string[]): number {
  const rest = argv.slice(argv[3] === "collect" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: COLLECT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreCollectArgs({ rest });
  if (parsed.isErr()) {
    return refuseParsed({ error: parsed.error, usage: COLLECT_USAGE });
  }
  const planPath = parsed.value.plan;
  const repliesPath = parsed.value.replies;
  const plan = readPlan({ planFile: planPath });
  if ("errors" in plan) {
    return refuseWith({ lines: plan.errors, usage: COLLECT_USAGE });
  }
  const replies = readReplies({ repliesFile: repliesPath });
  if ("errors" in replies) {
    return refuseWith({ lines: replies.errors, usage: COLLECT_USAGE });
  }
  const fromDisk = shardsFromDisk({ plan: plan.plan, planPath });
  const harvest = collectFindings({
    digests: fromDisk.digests,
    plan: { candidates: plan.plan.candidates, question: plan.plan.question, shards: fromDisk.shards },
    replies: replies.replies,
  });
  if (parsed.value.json) {
    logger.out({ line: safeJsonStringify({ label: "fan-out harvest", value: harvest }) });
  } else {
    harvestLines({ harvest }).forEach((line) => {
      logger.out({ line });
    });
  }
  // A rejection is never a quiet outcome: a run whose readers hallucinated and whose exit code said OK is
  // a run a script would build on. Findings surviving and findings refused are separate facts, so an
  // otherwise-successful harvest still exits non-zero when anything was refused. `shardFailures` is
  // checked separately from `rejected` because a tampered shard answered with zero findings produces no
  // per-finding rejection at all — that gap let a sibling shard's valid finding carry a run to exit zero.
  if (harvest.rejected.length > 0 || harvest.shardFailures.length > 0 || harvest.missingShards.length > 0) {
    return EXIT_ERROR;
  }
  return harvest.kept.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

export const storeReadCommand = defineCommand({ run: runStoreRead });
export const storeCollectCommand = defineCommand({ run: runStoreCollect });
