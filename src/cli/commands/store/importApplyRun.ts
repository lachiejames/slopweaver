/**
 * `slopweaver store import --apply <batch-id>` — one staged batch written into the live registers in one transaction,
 * or nothing of it (`../../../store/transfer/importApply.ts`); a batch already applied is reported as such, and
 * otherwise each register's legacy home import runs first, in its own transaction, as before an export. An append-only
 * difference keeps the live row and is
 * reported; `--stop-on-conflict` refuses the whole apply on one instead. There is no prompt: every question was
 * answered, or is still owed, in the store.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { connectStore } from "../../../store/client.js";
import { storeUrlSelection } from "../../../store/config.js";
import { applyStagedImport } from "../../../store/transfer/importApply.js";
import { EXIT_OK } from "../../exitCodes.js";

import { importApplyLines, importApplyRefusalLines, withStoreOrigin } from "./importApplyLines.js";
import { printedHome } from "./importResolveCommand.js";
import type { StoreImportApplyArgs } from "./transferArgs.js";
import { fail, resolvedHome } from "./verbShell.js";

/**
 * Apply one staged batch and print what it did.
 *
 * @param args the parsed `--apply` arguments
 * @returns the process exit code
 */
export async function runStoreImportApply({ args }: { args: StoreImportApplyArgs }): Promise<number> {
  const home = resolvedHome({ home: args.home });
  const selected = storeUrlSelection({ home });
  if (selected.isErr()) {
    return fail({ lines: [`store import: ${selected.error.message}`] });
  }
  const { origin } = selected.value;
  const opened = await connectStore({ home });
  if (opened.isErr()) {
    return fail({ lines: [`store import: ${opened.error.message}`] });
  }
  const client = opened.value;
  const printed = printedHome({ cwd: process.cwd(), home });
  try {
    const applied = await applyStagedImport({
      batchId: args.batchId,
      client,
      home,
      nowIso: new Date().toISOString(),
      stopOnConflict: args.stopOnConflict,
    });
    if (applied.isErr()) {
      const refusal = importApplyRefusalLines({
        home: printed,
        refusal: applied.error,
        stopOnConflict: args.stopOnConflict,
      });
      return fail({ lines: withStoreOrigin({ lines: refusal, origin }) });
    }
    if (args.json) {
      logger.out({ line: safeJsonStringify({ label: "store import", value: applied.value }) });
      return EXIT_OK;
    }
    const lines = importApplyLines({ home: printed, outcome: applied.value });
    withStoreOrigin({ lines, origin }).forEach((line) => {
      logger.out({ line });
    });
    return EXIT_OK;
  } finally {
    await client.close();
  }
}
