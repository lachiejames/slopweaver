/**
 * `slopweaver reading record` — append ONE verb's printed document to the readings ledger.
 *
 * The argv edge only: every rule is `../../../readings/row.ts`'s, so a caller that is not this CLI cannot
 * skip one. The document is read as TEXT and stored as text — this verb never re-serialises what the
 * producer printed, so the bytes a page reads back are the bytes the verb wrote.
 *
 * ## The instant is the document's own when it has one
 *
 * A producer that stamps `observedAtIso` at the top of its document (the console's fast-lane verbs) is
 * believed; one that does not (`github landing`) gets the recording instant unless `--observed-at` says
 * otherwise. The receipt names which happened, because "true as of" and "recorded at" are different facts
 * and a page that conflated them would age a reading wrongly.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { readStdin } from "#lib/readStdin.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { recordReading } from "../../../readings/store.js";
import type { ReadingReceipt } from "../../../readings/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { documentObservedAt, flag, parseReadingRecordArgs, RECORD_USAGE, VERB_ARG_OFFSET } from "./core.js";

/** `--from -` reads the document from stdin. */
const STDIN_SENTINEL = "-";

/** Everything `reading record` touches outside itself, injected so a test drives the whole verb. */
export interface ReadingRecordDeps {
  /** The recording instant, and the fallback `observedAtIso`. */
  readonly now: () => string;
  readonly readStdin: () => Promise<string>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Where a recorded reading's `observedAtIso` came from — said in the receipt, never inferred. */
type ObservedSource = "--observed-at" | "the document's own observedAtIso" | "the recording instant";

/**
 * Run `reading record` against injected seams.
 *
 * @param rest the argv tail after `reading record`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runReadingRecord({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ReadingRecordDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(RECORD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseReadingRecordArgs({ rest }).andThen((flags) => requiredFlags({ values: flags.values }));
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(RECORD_USAGE);
    return EXIT_USAGE;
  }
  const { by, from, producer, values } = parsed.value;
  const loaded = await loadDocument({ deps, from, producer });
  if (loaded.isErr()) {
    deps.writeDiagnostic(loaded.error);
    return EXIT_ERROR;
  }
  const { document, parsedDocument } = loaded.value;
  const nowIso = deps.now();
  const { observedAtIso, source } = observedInstant({
    explicit: flag({ name: "observed-at", values }),
    nowIso,
    parsedDocument,
  });
  const home = flag({ name: "home", values });
  const written = recordReading({
    by,
    document,
    nowIso,
    observedAtIso,
    producer,
    ...(home === undefined ? {} : { home }),
  });
  if (written.isErr()) {
    deps.writeDiagnostic(`reading record: ${written.error.message}`);
    return EXIT_ERROR;
  }
  if (values["json"] === true) {
    deps.writeOut(JSON.stringify({ ...written.value, observedFrom: source }));
    return EXIT_OK;
  }
  for (const line of receiptLines({ receipt: written.value, source })) {
    deps.writeOut(line);
  }
  return EXIT_OK;
}

/**
 * The three flags every record needs, named together so a caller missing one sees one line, not three.
 *
 * @returns the three values plus the parsed flag bag, or the one usage problem
 */
function requiredFlags({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<{ producer: string; from: string; by: string; values: Readonly<Record<string, string | boolean>> }> {
  const producer = flag({ name: "producer", values });
  const from = flag({ name: "from", values });
  const by = flag({ name: "by", values });
  if (producer === undefined || from === undefined || by === undefined) {
    return err(["reading record: --producer, --from and --by are all required"]);
  }
  return ok({ by, from, producer, values });
}

/**
 * The document's bytes, read from the file or stdin, and its parse — or the one diagnostic line to print.
 *
 * @returns the bytes and the parsed value, or the reason neither could be had
 */
async function loadDocument({
  deps,
  from,
  producer,
}: {
  deps: ReadingRecordDeps;
  from: string;
  producer: string;
}): Promise<Result<{ document: string; parsedDocument: unknown }, string>> {
  let document: string;
  try {
    document = from === STDIN_SENTINEL ? await deps.readStdin() : readFileSync(from, "utf8");
  } catch (cause) {
    return err(`reading record: could not read ${from} — ${errorMessage({ error: cause })}`);
  }
  try {
    return ok({ document, parsedDocument: safeJsonParse({ label: `the ${producer} document`, text: document }) });
  } catch (cause) {
    return err(`reading record: ${from} is not a JSON document — ${errorMessage({ error: cause })}`);
  }
}

/**
 * Which instant the reading is true as of, and where that instant came from.
 *
 * @returns the instant and its named source
 */
function observedInstant({
  explicit,
  parsedDocument,
  nowIso,
}: {
  explicit: string | undefined;
  parsedDocument: unknown;
  nowIso: string;
}): { observedAtIso: string; source: ObservedSource } {
  if (explicit !== undefined) {
    return { observedAtIso: explicit, source: "--observed-at" };
  }
  const own = documentObservedAt({ document: parsedDocument });
  if (own !== undefined) {
    return { observedAtIso: own, source: "the document's own observedAtIso" };
  }
  return { observedAtIso: nowIso, source: "the recording instant" };
}

/** The human receipt: what was recorded, and where. */
function receiptLines({ receipt, source }: { receipt: ReadingReceipt; source: ObservedSource }): readonly string[] {
  const { record } = receipt;
  return [
    `reading record: ${record.readingId} — ${record.producer} by ${record.by}, ${String(record.bytes)} bytes`,
    `  true as of ${record.observedAtIso} (${source}), recorded ${record.recordedAtIso}`,
    `  ${receipt.documentPath}`,
    `  ${receipt.indexPath}`,
  ];
}

/**
 * The real seams: the clock, stdin and the two output channels.
 *
 * @returns the production dependencies for {@link runReadingRecord}
 */
export function productionReadingRecordDeps(): ReadingRecordDeps {
  return {
    now: () => new Date().toISOString(),
    readStdin,
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver reading record`. */
export const readingRecordCommand = defineCommand({
  run: (argv) => runReadingRecord({ deps: productionReadingRecordDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
