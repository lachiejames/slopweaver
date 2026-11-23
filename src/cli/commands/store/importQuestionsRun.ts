/**
 * `slopweaver store import-questions` — every staged import question nobody has answered yet, read from the
 * store. The Queue reads its `--json` form, so an open question reaches the owner wherever it was staged.
 * Writes nothing.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { connectStore } from "../../../store/client.js";
import { listUnresolvedImportQuestions, type UnresolvedImportQuestion } from "../../../store/transfer/importAnswers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import { parseStoreImportQuestionsArgs } from "./importArgs.js";
import { importResolveCommand, printedHome } from "./importResolveCommand.js";
import { STORE_IMPORT_QUESTIONS_USAGE } from "./transferUsage.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

/** The `--json` document `store import-questions` prints, and the Queue decodes. */
export interface ImportQuestionsReport {
  readonly observedAtIso: string;
  readonly questions: readonly UnresolvedImportQuestion[];
}

/**
 * The `--json` document, built from the open questions and the instant they were read — one field at a time, in one
 * order, so what the Queue decodes is exactly this shape whatever order the store returned a row's columns in. The
 * contract test (`src/__tests__/unit/cli/commands/store/importQuestionsContract.test.ts`) pins its output to the
 * golden the console's reader is tested against.
 *
 * @param observedAtIso when the store was read, which the console shows as the register's own time
 * @returns the report the verb prints
 */
export function importQuestionsReport({
  observedAtIso,
  questions,
}: {
  observedAtIso: string;
  questions: readonly UnresolvedImportQuestion[];
}): ImportQuestionsReport {
  return {
    observedAtIso,
    questions: questions.map((question) => ({
      actions: [...question.actions],
      batchId: question.batchId,
      current: question.current,
      imported: question.imported,
      key: question.key,
      kind: question.kind,
      part: question.part,
      questionId: question.questionId,
      stagedAtIso: question.stagedAtIso,
    })),
  };
}

/**
 * The lines a person reads: one block per open question, each with the exact command that answers it.
 *
 * @param home the absolute home this verb used, which every printed command names so it answers under the same home
 * @returns the heading, then each question's lines
 */
export function importQuestionsLines({
  report,
  home,
}: {
  report: ImportQuestionsReport;
  home: string;
}): readonly string[] {
  if (report.questions.length === 0) {
    return ["store import-questions: no staged import question is waiting for an answer"];
  }
  return [
    `store import-questions: ${String(report.questions.length)} staged question(s) waiting for an answer`,
    ...report.questions.flatMap((question) => [
      `  ${question.questionId}  ${question.kind}  ${question.part} ${question.key}  (batch ${question.batchId})`,
      `      imported: ${question.imported}`,
      ...(question.current === null ? [] : [`      current:  ${question.current}`]),
      ...question.actions.map(
        (action) => `      answer: ${importResolveCommand({ action, home, questionId: question.questionId })}`,
      ),
    ]),
  ];
}

/**
 * Run `store import-questions`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreImportQuestions(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "import-questions" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_IMPORT_QUESTIONS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreImportQuestionsArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error, usage: STORE_IMPORT_QUESTIONS_USAGE });
  }
  const home = resolvedHome({ home: parsed.value.home });
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return fail({ lines: [`store import-questions: ${opened.error.message}`] });
  }
  const client = opened.value;
  try {
    const listed = await listUnresolvedImportQuestions({ client });
    if (listed.isErr()) {
      return fail({ lines: [`store import-questions: ${listed.error.message}`] });
    }
    const report = importQuestionsReport({ observedAtIso: new Date().toISOString(), questions: listed.value });
    if (parsed.value.json) {
      logger.out({ line: safeJsonStringify({ label: "store import-questions", value: report }) });
      return EXIT_OK;
    }
    const printed = printedHome({ cwd: process.cwd(), home });
    importQuestionsLines({ home: printed, report }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const storeImportQuestionsCommand = defineCommand({ run: runStoreImportQuestions });
