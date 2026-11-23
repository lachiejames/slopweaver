/**
 * The shared shape of the lifecycle verbs that record one string onto a run's journal — resolve, ownership,
 * the value flag, the phase refusal, then one append re-checked against the row as it stands just before it.
 * Its own module because it is the one WRITE path the verbs in `./lifecycleRunCore.ts` share, and that file
 * is the resolve/flag machinery they read through.
 */

import { applyRowEvent } from "../../../handover/rowEvent.js";
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FreshCheck, journalUnlessRefused } from "./appendUnlessRefused.js";
import { lifecycleUsage, mutationRefusal, phaseRefusalFor, resolve, stringFlag } from "./lifecycleRunCore.js";

/**
 * The shared shape of the verbs that record one string onto the journal.
 *
 * @param argv the full process argv
 * @param verb the verb name, for messages and flag resolution
 * @param flag the verb's own string flag carrying the value to record
 * @param said what to print on success, prefixed with `handover <verb>: `
 * @param build builds the journal event to append from the trimmed flag value
 * @returns the process exit code
 */
export async function recordText({
  argv,
  verb,
  flag,
  said,
  build,
  afterRecord,
  fresh,
}: {
  argv: readonly string[];
  verb: string;
  flag: string;
  said: string;
  build: (args: { value: string }) => Parameters<typeof applyRowEvent>[0]["event"];
  /** Run once the event is appended and read back — an escalation that must follow the write, never precede it. */
  afterRecord?: (args: { home: string; slug: string }) => Promise<unknown>;
  /** The verb's check over the row re-read just before the append, locked where it says so (`./appendUnlessRefused.ts`). */
  fresh?: FreshCheck | undefined;
}): Promise<number> {
  const resolved = resolve({ argv, verb });
  if (typeof resolved === "number") {
    return resolved;
  }
  const ownership = mutationRefusal({ resolved, verb });
  if (ownership !== undefined) {
    return ownership;
  }
  const value = stringFlag({ name: flag, parsed: resolved.parsed });
  if (value === undefined || value.trim().length === 0) {
    logger.error({ msg: `handover ${verb}: --${flag} is required` });
    logger.error({ msg: lifecycleUsage({ verb }) });
    return EXIT_USAGE;
  }
  // Checked BEFORE the append. Writing an event the derived state would then discard is the silent-failure
  // shape this whole feature removes.
  const refusal = phaseRefusalFor({ resolved, verb });
  if (refusal !== undefined) {
    logger.error({ msg: `handover ${verb}: ${refusal}` });
    return EXIT_ERROR;
  }
  const { doc } = resolved.context;
  const event = build({ value: value.trim() });
  const appended = journalUnlessRefused({
    append: () => applyRowEvent({ event, runsDir: resolved.runsDir, slug: doc.slug }),
    doc,
    fresh,
    verb,
  });
  if (typeof appended === "number") {
    return appended;
  }
  // Before the receipt, so an output channel that fails cannot stop the escalation the write owes.
  await afterRecord?.({ home: resolved.home, slug: doc.slug });
  logger.out({ line: `handover ${verb}: ${said} for ${doc.slug}` });
  logger.out({ line: `  journal: ${appended.path}` });
  return EXIT_OK;
}
