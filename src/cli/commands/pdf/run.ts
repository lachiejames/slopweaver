/**
 * The `pdf` noun's effectful shells — `read`, which opens one local file and extracts it, and `check`,
 * the zero-argument scope command the `attachments` capability row names.
 *
 * Data goes to STDOUT and diagnostics to STDERR, so `slopweaver pdf read report.pdf | wc -l` counts the
 * document's lines rather than this verb's commentary, and `--json` stdout carries exactly one document.
 */
import { readFile } from "node:fs/promises";

import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { buildPdfProbe, PDF_PROBE_PHRASE } from "../../../pdf/probe.js";
import { extractPdfText } from "../../../pdf/text.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  PDF_CHECK_CEILINGS,
  type PdfCheckReport,
  parsePdfCheckArgs,
  parsePdfReadArgs,
  pdfReadReport,
  renderPdfCheck,
  renderPdfRead,
} from "./core.js";
import { PDF_CHECK_USAGE, PDF_READ_USAGE, PDF_USAGE } from "./usage.js";

/** The argv index the `pdf <verb>` tail starts at — past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so each shell is exercised without touching the process streams. */
export interface PdfDeps {
  readonly readFile: (args: { path: string }) => Promise<Uint8Array>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `pdf read` against injected edges.
 *
 * @param rest the argv tail after `pdf read`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runPdfRead({ rest, deps }: { rest: readonly string[]; deps: PdfDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(PDF_READ_USAGE);
    return EXIT_OK;
  }
  const options = parsePdfReadArgs({ rest });
  if (options.isErr()) {
    for (const problem of options.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(PDF_READ_USAGE);
    return EXIT_USAGE;
  }
  const { json, maxPages, path } = options.value;
  let bytes: Uint8Array;
  try {
    bytes = await deps.readFile({ path });
  } catch (error: unknown) {
    deps.writeDiagnostic(`could not read ${path}: ${errorMessage({ error })}`);
    return EXIT_ERROR;
  }
  const extracted = await extractPdfText({ bytes, maxPages });
  if (extracted.isErr()) {
    for (const problem of extracted.error) {
      deps.writeDiagnostic(`${path}: ${problem}`);
    }
    return EXIT_ERROR;
  }
  const report = pdfReadReport({ extraction: extracted.value, path });
  if (json) {
    deps.writeOut(safeJsonStringify({ label: `pdf read ${path}`, space: 2, value: report }));
    return EXIT_OK;
  }
  deps.writeOut(renderPdfRead({ report }));
  return EXIT_OK;
}

/**
 * Observe whether this host can extract PDF text at all.
 *
 * It extracts a real document rather than reporting that a module imported: `pdfjs-dist` resolves its
 * standard fonts and its worker lazily, so an import that succeeds proves nothing about a read that has to
 * do both.
 *
 * @returns what the check observed
 */
export async function observePdfExtractor(): Promise<PdfCheckReport> {
  const built = await buildPdfProbe();
  if (built.isErr()) {
    return { ...PDF_CHECK_CEILINGS, extractorLoads: false, problem: built.error.join("; ") };
  }
  const extracted = await extractPdfText({ bytes: built.value });
  if (extracted.isErr()) {
    return { ...PDF_CHECK_CEILINGS, extractorLoads: false, problem: extracted.error.join("; ") };
  }
  // Asserted on the phrase rather than on "not empty": a reader that answered whitespace for every document
  // would pass a non-empty check and then report every real attachment as blank.
  if (!extracted.value.text.includes(PDF_PROBE_PHRASE)) {
    return {
      ...PDF_CHECK_CEILINGS,
      extractorLoads: false,
      problem: `the extractor read a document this host had just written and did not find ${JSON.stringify(PDF_PROBE_PHRASE)} in it`,
    };
  }
  return { ...PDF_CHECK_CEILINGS, extractorLoads: true, problem: undefined };
}

/**
 * Run `pdf check` against injected edges.
 *
 * @param rest the argv tail after `pdf check`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runPdfCheck({ rest, deps }: { rest: readonly string[]; deps: PdfDeps }): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(PDF_CHECK_USAGE);
    return EXIT_OK;
  }
  const options = parsePdfCheckArgs({ rest });
  if (options.isErr()) {
    for (const problem of options.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(PDF_CHECK_USAGE);
    return EXIT_USAGE;
  }
  const report = await observePdfExtractor();
  if (options.value.json) {
    deps.writeOut(safeJsonStringify({ label: "pdf check", space: 2, value: report }));
  } else {
    deps.writeOut(renderPdfCheck({ report }));
  }
  return report.extractorLoads ? EXIT_OK : EXIT_ERROR;
}

/**
 * The production edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionPdfDeps(): PdfDeps {
  return {
    readFile: async ({ path }) => new Uint8Array(await readFile(path)),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver pdf read <path>` — one local PDF's page count and its words. */
export const pdfReadCommand = defineCommand({
  run: (argv) => runPdfRead({ deps: productionPdfDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver pdf check` — whether this host can extract PDF text, and the ceilings it holds. */
export const pdfCheckCommand = defineCommand({
  run: (argv) => runPdfCheck({ deps: productionPdfDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver pdf` with no verb — the noun's own usage. */
export const pdfUsageCommand = defineCommand({
  run: () => {
    logger.error({ msg: PDF_USAGE });
    return EXIT_USAGE;
  },
});
