/**
 * `slopweaver store ingest` — put a bounded slice of bronze into the store, one file or a whole source.
 *
 * The other typed-query verbs sit in {@link ./run}, whose store-opening and report-emitting helpers this verb
 * shares; the loader is {@link ../../../store/ingest} and {@link ../../../store/ingestSource}. Like every verb
 * there, it refuses without `SLOPWEAVER_STORE_URL` rather than picking its own database.
 *
 * It reads the owner's protect list FIRST, before the store is opened or any bronze listed: a source or file
 * reaching a `no-access` path is refused by name (`../../../store/protectedBronze.ts`), and a protect list that
 * cannot be read refuses everything. This is the verb `store status` used to print as its repair line over a
 * source the owner had withheld, so the refusal sits here as well as in the scan.
 */

import type { BronzeFileStat } from "../../../corpus/bronzeStorage.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { ProtectedPath } from "../../../protectedPaths/registry.js";
import type { StoreClient } from "../../../store/client.js";
import { storeUrl } from "../../../store/config.js";
import { type StoreError, storeErrorLines } from "../../../store/errors.js";
import { ingestJsonl } from "../../../store/ingestJsonl.js";
import { ingestSource, planSourceFiles } from "../../../store/ingestSource.js";
import { listProtectedBronzeFiles, ownerProtectionFor, protectedBronzeFile } from "../../../store/protectedBronze.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseStoreIngestArgs, type StoreIngestArgs, storeTail } from "./core.js";
import { ingestLines, sourceIngestLines } from "./ingestLines.js";
import { emit, homeOf, openOrRefuse } from "./run.js";
import { refuseParsed, refuseWith } from "./shell.js";

const INGEST_USAGE =
  "usage: slopweaver store ingest --file <path.jsonl> --limit <n> [--from <byte>] [--all] [--home <dir>] [--json]\n" +
  "       slopweaver store ingest --source <s> --limit <n> [--all] [--from-file <basename>] [--home <dir>] [--json]\n" +
  "  --limit is the PER-SLICE record ceiling (the heap bound), never a ceiling on the run.\n" +
  "  --all reads each file to its end; without it, one bounded slice per file — a cheap pass over a whole\n" +
  "  source that reports what its bronze will refuse before a multi-hour load spends the time.\n" +
  "  A file or source reaching a no-access path on the owner's protect list is refused before anything is\n" +
  "  read or the store is opened (`slopweaver protect list` shows why); a session never takes a path off it.";

/** What the protect-list preflight cleared: one file at the spelling to read, or a source's listed files. */
export type IngestTarget =
  | { readonly kind: "file"; readonly path: string; readonly protection: readonly ProtectedPath[] }
  | {
      readonly kind: "source";
      readonly source: NonNullable<StoreIngestArgs["source"]>;
      readonly files: readonly BronzeFileStat[];
      readonly protection: readonly ProtectedPath[];
    };

/**
 * Judge an invocation against the owner's protect list, before the store is opened.
 *
 * `--source` lists the source under the invocation's OWN `--home` — the listing used to ignore it and read the
 * environment's home whatever was asked.
 *
 * @param args the already-validated invocation
 * @param protection the owner's protect-list entries, or why they could not be read
 * @returns what may be read, `BRONZE_PROTECTED`, `PROTECTION_UNKNOWN`, or `BRONZE_UNREADABLE`
 * @internal exported for its own test, which drives it over a throwaway home and a synthetic registry.
 */
export function ingestPreflight({
  args,
  protection,
}: {
  args: StoreIngestArgs;
  protection: Result<readonly ProtectedPath[], StoreError>;
}): Result<IngestTarget, StoreError> {
  return protection.andThen((entries): Result<IngestTarget, StoreError> => {
    const { source, home = slopweaverHome() } = args;
    if (source !== undefined) {
      return listProtectedBronzeFiles({ entries, home, source }).map((files): IngestTarget => ({
        files,
        kind: "source",
        protection: entries,
        source,
      }));
    }
    return protectedBronzeFile({ entries, path: String(args.file) }).map((path): IngestTarget => ({
      kind: "file",
      path,
      protection: entries,
    }));
  });
}

/**
 * Read a bounded slice of one bronze file into the store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreIngest(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: INGEST_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreIngestArgs({ rest });
  if (args.isErr()) {
    return refuseParsed({ error: args.error, usage: INGEST_USAGE });
  }
  // No store configured is refused before the protect list is read, as it always was: nothing is read either way.
  const configured = storeUrl(homeOf({ args: args.value }));
  if (configured.isErr()) {
    logger.error({ msg: configured.error.message });
    return EXIT_ERROR;
  }
  const { home = slopweaverHome() } = args.value;
  const target = ingestPreflight({ args: args.value, protection: ownerProtectionFor({ home }) });
  if (target.isErr()) {
    storeErrorLines({ error: target.error }).forEach((msg) => {
      logger.error({ msg: `store ingest: ${msg}` });
    });
    return EXIT_ERROR;
  }
  const opened = await openOrRefuse({ max: 4, ...homeOf({ args: args.value }) });
  if ("code" in opened) {
    return opened.code;
  }
  try {
    if (target.value.kind === "source") {
      return await ingestWholeSource({ args: args.value, client: opened.client, target: target.value });
    }
    const report = await ingestJsonl({
      client: opened.client,
      from: args.value.from,
      limit: args.value.limit,
      path: target.value.path,
      protection: target.value.protection,
      wholeFile: args.value.all,
      ...homeOf({ args: args.value }),
    });
    if (report.isErr()) {
      logger.error({ msg: report.error.message });
      return EXIT_ERROR;
    }
    emit({
      json: args.value.json,
      lines: ingestLines({ file: String(args.value.file), report: report.value }),
      payload: report.value,
    });
    return EXIT_OK;
  } finally {
    await opened.client.close();
  }
}

/**
 * Read one source's whole bronze, in bronze read order, reporting per file as it goes.
 *
 * Split out of {@link runStoreIngest} rather than branched inline because the two modes refuse different
 * things: a bad `--from-file` is a usage refusal computed from the file listing, which only exists here.
 *
 * @param args the already-validated invocation
 * @param client the open store
 * @param target the source and its files, as the protect-list preflight cleared them
 * @returns the process exit code
 */
async function ingestWholeSource({
  args,
  client,
  target,
}: {
  args: StoreIngestArgs;
  client: StoreClient;
  target: Extract<IngestTarget, { kind: "source" }>;
}): Promise<number> {
  const { source, files: listed } = target;
  if (listed.length === 0) {
    logger.error({ msg: `store ingest --source ${source}: no bronze under that source — nothing to read` });
    return EXIT_ERROR;
  }
  const planned = planSourceFiles({
    files: listed,
    ...(args.fromFile === undefined ? {} : { fromFile: args.fromFile }),
  });
  if (planned.isErr()) {
    return refuseWith({ lines: storeErrorLines({ error: planned.error }), usage: INGEST_USAGE });
  }
  const report = await ingestSource({
    client,
    files: planned.value.read,
    limit: args.limit,
    protection: target.protection,
    skipped: planned.value.skipped,
    source,
    wholeFile: args.all,
    ...homeOf({ args }),
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  emit({ json: args.json, lines: sourceIngestLines({ report: report.value }), payload: report.value });
  return EXIT_OK;
}

export const storeIngestCommand = defineCommand({ run: runStoreIngest });
