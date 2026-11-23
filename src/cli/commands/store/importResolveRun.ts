/**
 * `slopweaver store import-resolve` — the owner's answer to one staged import question, recorded in the
 * store. An answer is never changed: the same one again writes nothing, and a different one is refused by
 * name. Recording an answer makes nothing live; `store import --apply` writes what the answers admit.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { connectStore } from "../../../store/client.js";
import { type RecordImportResolutionOutcome, recordImportResolution } from "../../../store/transfer/importAnswers.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK } from "../../exitCodes.js";

import { parseStoreImportResolveArgs } from "./importArgs.js";
import { STORE_IMPORT_RESOLVE_USAGE } from "./transferUsage.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

/**
 * The line a person reads for one recorded answer.
 *
 * @returns which question, which answer, and how many rows were written
 */
export function importResolveLine({ outcome }: { outcome: RecordImportResolutionOutcome }): string {
  if (outcome.outcome === "already-recorded") {
    return `store import-resolve: ${outcome.questionId} was already answered ${outcome.action}; 0 rows written; nothing is live`;
  }
  return `store import-resolve: ${outcome.questionId} answered ${outcome.action}; 1 row written; nothing is live`;
}

/**
 * Run `store import-resolve`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreImportResolve(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "import-resolve" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_IMPORT_RESOLVE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreImportResolveArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error, usage: STORE_IMPORT_RESOLVE_USAGE });
  }
  const opened = await connectStore({ home: resolvedHome({ home: parsed.value.home }) });
  if (opened.isErr()) {
    return fail({ lines: [`store import-resolve: ${opened.error.message}`] });
  }
  const client = opened.value;
  try {
    const recorded = await recordImportResolution({
      action: parsed.value.action,
      client,
      questionId: parsed.value.question,
    });
    if (recorded.isErr()) {
      return fail({ lines: [`store import-resolve: ${recorded.error.message}`] });
    }
    const line = parsed.value.json
      ? safeJsonStringify({ label: "store import-resolve", value: recorded.value })
      : importResolveLine({ outcome: recorded.value });
    logger.out({ line });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}

export const storeImportResolveCommand = defineCommand({ run: runStoreImportResolve });
